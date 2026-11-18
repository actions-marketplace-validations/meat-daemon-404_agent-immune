/**
 * `immune audit` — fast streaming health check over all host session histories.
 *
 * Modularized across `core/audit/{types,zcode,logs,report}.ts`.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ImmuneStore } from './store/index.js';
import { loadAntigravitySessions, loadClaudeSessions, loadCodexSessions } from './audit/logs.js';
import { renderAuditReport, runSource } from './audit/report.js';
import { emptySource, medianOf, type AuditOptions, type AuditReport, type AuditSourceReport } from './audit/types.js';
import { loadZcodeSessions, zcodeTokenMedian } from './audit/zcode.js';

export type {
  AuditFailureFamily,
  AuditOptions,
  AuditReport,
  AuditSourceName,
  AuditSourceReport,
  AuditToolStat,
} from './audit/types.js';
export { renderAuditReport } from './audit/report.js';

export function auditHistory(store: ImmuneStore, opts: AuditOptions = {}): AuditReport {
  const days = opts.days ?? 30;
  const since = Date.now() - days * 86_400_000;
  const cap =
    opts.max !== undefined && Number.isFinite(opts.max) && opts.max > 0 ? Math.trunc(opts.max) : null;
  const selfMarkers = opts.selfMarkers ?? [];
  const wanted = opts.source ?? 'auto';
  const dryRun = opts.dryRun === true;

  const zcodeDb = opts.sourceDb ?? `${homedir()}/.zcode/cli/db/db.sqlite`.replace(/\\/g, '/');
  const codexDir = opts.codexSessionsDir ?? join(homedir(), '.codex', 'sessions');
  const claudeDir = opts.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  const antigravityDir = opts.antigravityBrainDir ?? join(homedir(), '.gemini', 'antigravity', 'brain');
  const sources: AuditSourceReport[] = [];

  if (wanted === 'auto' || wanted === 'zcode') {
    if (existsSync(zcodeDb)) {
      const sessions = loadZcodeSessions(zcodeDb, since);
      const report = runSource('zcode', sessions, store, { cap, dryRun, selfMarkers });
      const median = zcodeTokenMedian(zcodeDb);
      report.medianRequestTokens = median?.median ?? null;
      report.medianSamples = median?.samples ?? 0;
      sources.push(report);
    } else {
      sources.push(emptySource('zcode', 'no ~/.zcode/cli/db/db.sqlite'));
    }
  }

  if (wanted === 'auto' || wanted === 'codex') {
    const { sessions, present, note } = loadCodexSessions(codexDir, since);
    if (present) {
      const report = runSource('codex', sessions, store, { cap, dryRun, selfMarkers });
      if (note) report.note = note;
      const median = medianOf(sessions.flatMap((session) => session.tokenSamples));
      report.medianRequestTokens = median?.median ?? null;
      report.medianSamples = median?.samples ?? 0;
      sources.push(report);
    } else {
      sources.push(emptySource('codex', note));
    }
  }

  if (wanted === 'auto' || wanted === 'claude-code') {
    const { sessions, present, note } = loadClaudeSessions(claudeDir, since);
    if (present) {
      const report = runSource('claude-code', sessions, store, { cap, dryRun, selfMarkers });
      report.note = note ?? 'parser fixture-tested; not yet verified against a real install';
      const median = medianOf(sessions.flatMap((session) => session.tokenSamples));
      report.medianRequestTokens = median?.median ?? null;
      report.medianSamples = median?.samples ?? 0;
      sources.push(report);
    } else {
      sources.push(emptySource('claude-code', note));
    }
  }

  if (wanted === 'auto' || wanted === 'antigravity') {
    const { sessions, present, note } = loadAntigravitySessions(antigravityDir, since);
    if (present) {
      const report = runSource('antigravity', sessions, store, { cap, dryRun, selfMarkers });
      if (note) report.note = note;
      const median = medianOf(sessions.flatMap((session) => session.tokenSamples));
      report.medianRequestTokens = median?.median ?? null;
      report.medianSamples = median?.samples ?? 0;
      sources.push(report);
    } else {
      sources.push(emptySource('antigravity', note));
    }
  }

  const totals = sources.reduce(
    (acc, source) => ({
      scanned: acc.scanned + source.scanned,
      failures: acc.failures + source.failures,
      paired: acc.paired + source.paired,
      enqueued: acc.enqueued + source.enqueued,
      skippedSelf: acc.skippedSelf + source.skippedSelf,
    }),
    { scanned: 0, failures: 0, paired: 0, enqueued: 0, skippedSelf: 0 },
  );
  return { sources, totals };
}
