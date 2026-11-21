import { applyAction, evaluateUiGuard, evolutionStats, readFederationPreview, readGuardEvents, readInsights, readState, readWorkspaces, resolveBudgetMs, runHygieneAction, } from '../../core/ui/query.js';
import { exportLibrary, importLibrary } from '../../core/sync.js';
import { renderSkillMarkdown } from '../../core/export.js';
import { shareSanityCheck } from '../../core/share-guard.js';
import { scanMagpieTelemetry } from '../../core/audit/magpie.js';
import { explainRecall } from '../../core/explain.js';
export const UI_ROUTE_PREFIX = '/plugins/dsh-immune-system/api';
/**
 * Same-origin check for mutations.
 *
 * The GUI is served from the same origin, so a legitimate request either omits
 * `Origin` (same-origin GET) or presents it. Requiring JSON also forces a CORS
 * preflight for any cross-origin caller, which a hostile page cannot satisfy.
 */
function isSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    try {
        return new URL(origin).host === req.headers.host;
    }
    catch {
        return false;
    }
}
function sendJson(res, status, payload) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(payload));
}
class PayloadTooLargeError extends Error {
    constructor() {
        super('body too large');
    }
}
function readBody(req, max = 4096) {
    return new Promise((resolve, reject) => {
        let body = '';
        let settled = false;
        req.on('data', (chunk) => {
            if (settled)
                return;
            body += chunk.toString('utf8');
            if (body.length > max) {
                settled = true;
                reject(new PayloadTooLargeError());
                req.resume();
            }
        });
        req.on('end', () => {
            if (!settled) {
                settled = true;
                resolve(body);
            }
        });
        req.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
    });
}
/**
 * `getBudgetMs` lets the host half report the *session's* effective budget
 * (which `/immune --budget` can override) instead of just the env default.
 */
export function registerImmuneUiRoute(ctx, store, getBudgetMs) {
    const injectable = ctx;
    // A host without cordis-style optional injection (or a minimal test harness)
    // simply gets no web route; the plugin's core behaviour is unaffected.
    if (typeof injectable.inject !== 'function')
        return;
    injectable.inject(['webServer'], (web) => {
        const server = web.webServer;
        if (!server?.register)
            return;
        server.register({
            kind: 'prefix',
            path: UI_ROUTE_PREFIX,
            handler: async (req, res) => {
                const url = new URL(req.url ?? '/', 'http://127.0.0.1');
                const path = url.pathname.replace(/\/+$/, '');
                try {
                    if (req.method === 'GET' && path.endsWith('/export')) {
                        const format = url.searchParams.get('format') === 'json' ? 'json' : 'md';
                        const snapshot = format === 'json' ? exportLibrary(store) : null;
                        const mdRows = snapshot ? null : store.exportable(3);
                        const exportRows = snapshot ? snapshot.antibodies : mdRows;
                        const violations = shareSanityCheck(exportRows);
                        if (violations.length > 0) {
                            sendJson(res, 422, { error: 'export blocked by the share gate', violations });
                            return;
                        }
                        res.writeHead(200, {
                            'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
                            'content-disposition': `attachment; filename="immune-library.${format}"`,
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(snapshot ? JSON.stringify(snapshot, null, 2) : renderSkillMarkdown(mdRows));
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/workspaces')) {
                        sendJson(res, 200, { workspaces: readWorkspaces(store) });
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/models')) {
                        sendJson(res, 200, store.modelImmunity(scanMagpieTelemetry()));
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/triage')) {
                        sendJson(res, 200, { triage: store.triageSummary(20), receipts: store.receiptSummary(500) });
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/explain')) {
                        const query = url.searchParams.get('q') ?? '';
                        const rawLimit = Number(url.searchParams.get('limit') ?? '5');
                        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(10, Math.trunc(rawLimit)) : 5;
                        const toolName = url.searchParams.get('tool') ?? undefined;
                        sendJson(res, 200, explainRecall(store, query, { limit, toolName }));
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/insights')) {
                        sendJson(res, 200, readInsights(store, process.cwd()));
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/guard-events')) {
                        const rawLimit = Number(url.searchParams.get('limit') ?? '25');
                        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.trunc(rawLimit)) : 25;
                        sendJson(res, 200, readGuardEvents(store, limit));
                        return;
                    }
                    if (req.method === 'GET' && path.endsWith('/federate')) {
                        sendJson(res, 200, readFederationPreview(store, process.cwd()));
                        return;
                    }
                    if (req.method === 'GET') {
                        const rawView = url.searchParams.get('view');
                        const view = rawView === 'shared' ? 'shared' : rawView === 'quarantined' ? 'quarantined' : 'project';
                        const query = url.searchParams.get('q') ?? '';
                        // evolution rides on top of the shared readState payload so BOTH
                        // UIs render the strip from one query layer (AGENTS.md #14).
                        sendJson(res, 200, {
                            ...readState(store, view, query, getBudgetMs?.() ?? resolveBudgetMs()),
                            evolution: evolutionStats(store),
                        });
                        return;
                    }
                    if (req.method === 'POST' && path.endsWith('/hygiene')) {
                        if (!isSameOrigin(req)) {
                            sendJson(res, 403, { error: 'cross-origin mutation refused' });
                            return;
                        }
                        const type = String(req.headers['content-type'] ?? '');
                        if (!type.includes('application/json')) {
                            sendJson(res, 415, { error: 'content-type must be application/json' });
                            return;
                        }
                        const body = await readBody(req);
                        let dryRun = false;
                        try {
                            const parsed = body.trim() ? JSON.parse(body) : {};
                            dryRun = parsed.dryRun === true;
                        }
                        catch {
                            sendJson(res, 400, { error: 'invalid json' });
                            return;
                        }
                        sendJson(res, 200, { ok: true, report: runHygieneAction(store, dryRun) });
                        return;
                    }
                    if (req.method === 'POST' && path.endsWith('/import')) {
                        if (!isSameOrigin(req)) {
                            sendJson(res, 403, { error: 'cross-origin mutation refused' });
                            return;
                        }
                        const type = String(req.headers['content-type'] ?? '');
                        if (!type.includes('application/json')) {
                            sendJson(res, 415, { error: 'content-type must be application/json' });
                            return;
                        }
                        const body = await readBody(req, 262144);
                        let parsed;
                        try {
                            parsed = JSON.parse(body);
                        }
                        catch {
                            sendJson(res, 400, { error: 'invalid json' });
                            return;
                        }
                        const report = importLibrary(store, parsed);
                        sendJson(res, 200, {
                            ok: true,
                            added: report.added,
                            merged: report.merged,
                            invalid: report.invalid,
                        });
                        return;
                    }
                    if (req.method === 'POST' && path.endsWith('/guard')) {
                        if (!isSameOrigin(req)) {
                            sendJson(res, 403, { error: 'cross-origin request refused' });
                            return;
                        }
                        const type = String(req.headers['content-type'] ?? '');
                        if (!type.includes('application/json')) {
                            sendJson(res, 415, { error: 'content-type must be application/json' });
                            return;
                        }
                        const body = await readBody(req, 65536);
                        let parsed;
                        try {
                            const raw = JSON.parse(body);
                            parsed = typeof raw === 'object' && raw !== null ? raw : {};
                        }
                        catch {
                            sendJson(res, 400, { error: 'invalid json' });
                            return;
                        }
                        const payload = typeof parsed.payload === 'string' ? parsed.payload : '';
                        if (!payload.trim()) {
                            sendJson(res, 400, { error: 'payload is required' });
                            return;
                        }
                        sendJson(res, 200, evaluateUiGuard(store, payload, {
                            toolName: typeof parsed.toolName === 'string' ? parsed.toolName : 'Bash',
                            strict: parsed.strict === true,
                        }));
                        return;
                    }
                    if (req.method === 'POST' && (path === UI_ROUTE_PREFIX || path.endsWith('/action'))) {
                        if (!isSameOrigin(req)) {
                            sendJson(res, 403, { error: 'cross-origin mutation refused' });
                            return;
                        }
                        const type = String(req.headers['content-type'] ?? '');
                        if (!type.includes('application/json')) {
                            sendJson(res, 415, { error: 'content-type must be application/json' });
                            return;
                        }
                        const body = await readBody(req);
                        let parsed;
                        try {
                            parsed = JSON.parse(body);
                        }
                        catch {
                            sendJson(res, 400, { error: 'invalid json' });
                            return;
                        }
                        const obj = (parsed ?? {});
                        const op = typeof obj.op === 'string' ? obj.op : '';
                        const id = typeof obj.id === 'number' ? obj.id : Number.NaN;
                        const result = applyAction(store, op, id);
                        sendJson(res, result.status, result.body);
                        return;
                    }
                    sendJson(res, 405, { error: 'method not allowed' });
                }
                catch (error) {
                    if (error instanceof PayloadTooLargeError) {
                        sendJson(res, 413, { error: 'body too large' });
                        return;
                    }
                    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        });
    });
}
