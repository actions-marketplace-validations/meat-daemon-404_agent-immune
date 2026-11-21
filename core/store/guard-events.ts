/**
 * Persistent Pre-Flight Guard audit ledger (v4.0).
 *
 * Records every live `warn`, `rewrite`, and `block` interception (always
 * redacted and bounded before hitting disk — AGENTS.md #10) so operators,
 * dashboards, CLI (`immune guard --log`), and MCP (`immune_guard_log`) can
 * audit prevented disasters without scanning ephemeral hook stderr logs.
 */
import type { DatabaseSync } from 'node:sqlite';
import { redact } from '../redact.js';
import type { GuardEvent, GuardEventSummary } from '../types.js';

export const GUARD_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GUARD_EVENT_MAX_ROWS = 2000;

export interface NewGuardEvent {
  sessionId?: string;
  toolName?: string;
  decision: 'warn' | 'rewrite' | 'block';
  severity: 'low' | 'medium' | 'high' | 'critical';
  blastRadius: number;
  policyIds: ReadonlyArray<string>;
  payloadPreview: string;
  suggestedRewrite?: string | null;
  projectScope?: string;
  createdAt?: number;
}

/** Record one live Pre-Flight Guard interception (best-effort; never throws on hook paths). */
export function recordGuardEvent(db: DatabaseSync, entry: NewGuardEvent): void {
  try {
    const preview = redact(entry.payloadPreview).replace(/[\r\n]+/g, ' ').trim().slice(0, 260);
    const rewrite = entry.suggestedRewrite
      ? redact(entry.suggestedRewrite).replace(/[\r\n]+/g, ' ').trim().slice(0, 260)
      : '';
    const policyIds = entry.policyIds.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, 12);
    db.prepare(
      `INSERT INTO guard_events
         (session_id, tool_name, decision, severity, blast_radius, policy_ids,
          payload_preview, suggested_rewrite, project_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      (entry.sessionId ?? '').slice(0, 120),
      (entry.toolName ?? 'Bash').slice(0, 64),
      entry.decision,
      entry.severity,
      Math.max(0, Math.min(100, Math.round(entry.blastRadius))),
      JSON.stringify(policyIds),
      preview,
      rewrite,
      (entry.projectScope ?? '*').slice(0, 120),
      entry.createdAt ?? Date.now(),
    );
  } catch {
    // Telemetry must never break hook execution.
  }
}

function parsePolicyIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Read-only summary + recent live guard interceptions. */
export function summarizeGuardEvents(db: DatabaseSync, limit = 25): GuardEventSummary {
  const cap = Math.max(1, Math.min(200, Math.trunc(limit)));
  const totalRow = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(AVG(blast_radius), 0) AS avg_br FROM guard_events')
    .get() as { n: number | bigint; avg_br: number | null };
  const total = Number(totalRow.n);
  const avgBlastRadius = total > 0 ? Math.round(Number(totalRow.avg_br ?? 0)) : 0;

  const decisionRows = db
    .prepare('SELECT decision, COUNT(*) AS n FROM guard_events GROUP BY decision')
    .all() as Array<{ decision: string; n: number | bigint }>;
  const byDecision: Record<string, number> = {};
  for (const row of decisionRows) {
    byDecision[row.decision] = Number(row.n);
  }

  const allPolicies = db
    .prepare('SELECT policy_ids FROM guard_events ORDER BY id DESC LIMIT 500')
    .all() as Array<{ policy_ids: string }>;
  const policyCounts = new Map<string, number>();
  for (const row of allPolicies) {
    for (const id of parsePolicyIds(row.policy_ids)) {
      policyCounts.set(id, (policyCounts.get(id) ?? 0) + 1);
    }
  }
  const byPolicy = [...policyCounts.entries()]
    .map(([policyId, count]) => ({ policyId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const recentRows = db
    .prepare('SELECT * FROM guard_events ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(cap) as Array<Record<string, unknown>>;
  const recent: GuardEvent[] = recentRows.map((row) => ({
    id: Number(row.id),
    session_id: String(row.session_id ?? ''),
    tool_name: String(row.tool_name ?? 'Bash'),
    decision: (row.decision === 'block' || row.decision === 'rewrite' ? row.decision : 'warn') as GuardEvent['decision'],
    severity: (
      row.severity === 'critical' ||
      row.severity === 'high' ||
      row.severity === 'medium' ||
      row.severity === 'low'
        ? row.severity
        : 'medium'
    ) as GuardEvent['severity'],
    blast_radius: Number(row.blast_radius ?? 0),
    policy_ids: parsePolicyIds(row.policy_ids),
    payload_preview: String(row.payload_preview ?? ''),
    suggested_rewrite: String(row.suggested_rewrite ?? ''),
    project_scope: String(row.project_scope ?? '*'),
    created_at: Number(row.created_at ?? 0),
  }));

  return { total, byDecision, byPolicy, avgBlastRadius, recent };
}

/** Trim expired and excess guard audit rows during scheduled `pruneStale`. */
export function pruneGuardEvents(db: DatabaseSync, now = Date.now()): number {
  let removed = 0;
  try {
    const expired = db
      .prepare('DELETE FROM guard_events WHERE created_at < ?')
      .run(now - GUARD_EVENT_RETENTION_MS);
    removed += Number(expired.changes);
    const excess = db
      .prepare(
        `DELETE FROM guard_events
          WHERE id NOT IN (SELECT id FROM guard_events ORDER BY id DESC LIMIT ?)`,
      )
      .run(GUARD_EVENT_MAX_ROWS);
    removed += Number(excess.changes);
  } catch {
    // Table may not exist in minimal synthetic DBs.
  }
  return removed;
}
