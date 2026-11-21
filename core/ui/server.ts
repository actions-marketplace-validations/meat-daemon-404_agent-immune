/**
 * Local dashboard server.
 *
 * Deliberate constraints, because this exposes a database that contains text
 * captured from the user's own tool calls:
 *
 *  - binds `127.0.0.1` only, never `0.0.0.0`;
 *  - every `/api` call must present a random per-run token, so another page in
 *    the same browser cannot read or mutate the library (a simple cross-origin
 *    POST needs no preflight, so origin checking alone would not be enough);
 *  - responses carry a strict CSP and `nosniff`, and the page loads nothing
 *    external — it works offline and phones nowhere;
 *  - only three mutations exist, all on this project's rules, and a delete is
 *    confirmed in the page.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { basename, dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { ImmuneStore } from '../store/index.js';
import { renderPage } from './page.js';
import { resolveLocale } from '../i18n.js';
import {
  applyAction,
  evaluateUiGuard,
  evolutionStats,
  readFederationPreview,
  readGuardEvents,
  readInsights,
  readState,
  readWorkspaces,
  resolveBudgetMs,
  runHygieneAction,
} from './query.js';
import { exportLibrary, importLibrary } from '../sync.js';
import { renderSkillMarkdown } from '../export.js';
import { shareSanityCheck } from '../share-guard.js';
import { scanMagpieTelemetry } from '../audit/magpie.js';
import { explainRecall } from '../explain.js';

export interface UiServerOptions {
  /** Database to open. Defaults to the host's resolution. */
  dbPath?: string;
  /** Preferred port; falls forward to the next free one. */
  port?: number;
  /** How many ports to try before giving up. */
  portAttempts?: number;
}

export interface UiServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

function isLoopbackHost(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return true;
  return LOOPBACK_HOST_RE.test(host.trim());
}

function workspaceDirForDb(dbPath: string): string {
  if (!dbPath || dbPath === ':memory:') return process.cwd();
  const parent = dirname(dbPath);
  if (basename(parent).toLowerCase() === '.dsh') {
    return dirname(parent);
  }
  return process.cwd();
}

export async function startUiServer(options: UiServerOptions = {}): Promise<UiServerHandle> {
  const store = new ImmuneStore(options.dbPath ? { dbPath: options.dbPath } : {});
  const workspaceDir = workspaceDirForDb(store.dbPath);
  const token = randomBytes(24).toString('hex');
  const locale = resolveLocale() === 'en' ? 'en' : 'zh-CN';

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });

  function authorized(req: IncomingMessage, url: URL): boolean {
    const given = url.searchParams.get('t') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // Reject DNS-rebinding requests carrying a non-loopback Host header before
    // serving the page containing the per-run API token.
    if (!isLoopbackHost(req)) {
      sendJson(res, 403, { error: 'forbidden host' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      const langParam = url.searchParams.get('lang');
      const pageLocale: 'zh-CN' | 'en' =
        langParam === 'en' ? 'en' : langParam === 'zh-CN' ? 'zh-CN' : locale;
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      res.end(
        renderPage({
          token,
          locale: pageLocale,
          dbPath: store.dbPath,
          budgetMs: resolveBudgetMs(),
          evolution: evolutionStats(store),
        }),
      );
      return;
    }

    if (!path.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    if (!authorized(req, url)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }

    if (path === '/api/list' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      sendJson(res, 200, readState(store, 'project', query));
      return;
    }

    if (path === '/api/export' && req.method === 'GET') {
      // Token-gated like every /api path: the download link carries it.
      const format = url.searchParams.get('format') === 'json' ? 'json' : 'md';
      const snapshot = format === 'json' ? exportLibrary(store) : null;
      const mdRows = snapshot ? null : store.exportable(3);
      const exportRows = snapshot ? snapshot.antibodies : mdRows!;
      const violations = shareSanityCheck(exportRows);
      if (violations.length > 0) {
        sendJson(res, 422, { error: 'export blocked by the share gate', violations });
        return;
      }
      res.writeHead(200, {
        'content-type':
          format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="immune-library.${format}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(
        snapshot ? JSON.stringify(snapshot, null, 2) : renderSkillMarkdown(mdRows!),
      );
      return;
    }

    if (path === '/api/import' && req.method === 'POST') {
      readBody(req, res, (body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
        const report = importLibrary(store, parsed);
        sendJson(res, 200, { ok: true, added: report.added, merged: report.merged, invalid: report.invalid });
      }, 262144);
      return;
    }

    if (path === '/api/shared' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      sendJson(res, 200, readState(store, 'shared', query));
      return;
    }

    if (path === '/api/quarantined' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      sendJson(res, 200, readState(store, 'quarantined', query));
      return;
    }

    if (path === '/api/workspaces' && req.method === 'GET') {
      sendJson(res, 200, { workspaces: readWorkspaces(store) });
      return;
    }

    if (path === '/api/triage' && req.method === 'GET') {
      sendJson(res, 200, { triage: store.triageSummary(20), receipts: store.receiptSummary(500) });
      return;
    }

    if (path === '/api/models' && req.method === 'GET') {
      sendJson(res, 200, store.modelImmunity(scanMagpieTelemetry()));
      return;
    }

    if (path === '/api/explain' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      const rawLimit = Number(url.searchParams.get('limit') ?? '5');
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(10, Math.trunc(rawLimit)) : 5;
      const toolName = url.searchParams.get('tool') ?? undefined;
      sendJson(res, 200, explainRecall(store, query, { limit, toolName }));
      return;
    }

    if (path === '/api/insights' && req.method === 'GET') {
      sendJson(res, 200, readInsights(store, workspaceDir));
      return;
    }

    if (path === '/api/guard-events' && req.method === 'GET') {
      const rawLimit = Number(url.searchParams.get('limit') ?? '25');
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.trunc(rawLimit)) : 25;
      sendJson(res, 200, readGuardEvents(store, limit));
      return;
    }

    if (path === '/api/federate' && req.method === 'GET') {
      sendJson(res, 200, readFederationPreview(store, workspaceDir));
      return;
    }

    if (path === '/api/guard' && req.method === 'POST') {
      readBody(req, res, (body) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = (body.trim() ? JSON.parse(body) : {}) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
        const payload = typeof parsed.payload === 'string' ? parsed.payload : '';
        if (!payload.trim()) {
          sendJson(res, 400, { error: 'payload is required' });
          return;
        }
        sendJson(
          res,
          200,
          evaluateUiGuard(store, payload, {
            toolName: typeof parsed.toolName === 'string' ? parsed.toolName : 'Bash',
            strict: parsed.strict === true,
            workspace: workspaceDir,
          }),
        );
      }, 65536);
      return;
    }

    if (path === '/api/hygiene' && req.method === 'POST') {
      readBody(req, res, (body) => {
        let dryRun = false;
        try {
          const parsed = body.trim() ? (JSON.parse(body) as Record<string, unknown>) : {};
          dryRun = parsed.dryRun === true;
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
        sendJson(res, 200, { ok: true, report: runHygieneAction(store, dryRun) });
      });
      return;
    }

    if (path === '/api/action' && req.method === 'POST') {
      readBody(req, res, (body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
        const obj = (parsed ?? {}) as Record<string, unknown>;
        const op = typeof obj.op === 'string' ? obj.op : '';
        const id = typeof obj.id === 'number' ? obj.id : Number.NaN;
        const result = applyAction(store, op, id);
        sendJson(res, result.status, result.body);
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  let port: number;
  try {
    port = await listen(server, options.port ?? 7788, options.portAttempts ?? 8);
  } catch (error) {
    try {
      store.close();
    } catch {
      // ignore close failure on bind error
    }
    throw error;
  }
  const url = `http://127.0.0.1:${port}/`;

  let closed = false;
  return {
    url,
    port,
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => {
        server.close(() => {
          try {
            store.close();
          } catch {
            // ignore double-close
          }
          resolve();
        });
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    },
  };
}

/** Try successive ports until one binds, so a busy 7788 is not fatal. */
function listen(server: Server, start: number, attempts: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let current = start;
    let left = attempts;

    const attempt = (): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('error', onError);
        if (error.code === 'EADDRINUSE' && left > 0) {
          left -= 1;
          current += 1;
          attempt();
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(current, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve((server.address() as AddressInfo).port);
      });
    };

    attempt();
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  done: (body: string) => void,
  max = 4096,
): void {
  let body = '';
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    body += chunk.toString('utf8');
    // Small action objects by default; import and guard raise the cap.
    if (body.length > max) {
      aborted = true;
      res.writeHead(413, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        connection: 'close',
      });
      res.end(JSON.stringify({ error: 'body too large' }), () => {
        req.destroy();
      });
    }
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      done(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { error: message });
    }
  });
}
