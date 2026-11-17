/**
 * Red-3 Triage Engine (v2), fusing `daily-patrol` methodology into the immune
 * lifecycle:
 *
 *   "Before touching or retiring a rule, prove the failure is real, determine
 *    whose fault it is (5 buckets), and only then choose the surgical action."
 *
 * Five triage buckets:
 *   1. `flake_or_transient`  — network blip, rate limit, timeout, user cancel → ignore penalty
 *   2. `wrong_scope_leak`    — rule belonged to another project scope       → re-scope / quarantine
 *   3. `ignored_by_agent`    — valid proven/generic rule ignored by model   → escalate delivery, don't kill
 *   4. `stale_or_bad_advice` — advice failed on target / drifted env        → penalize, mutate, or retire
 *   5. `coverage_blindspot`  — uncovered failure family                     → synthesize via LLM / pack
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Antibody, TriageBucket, TriageEvent } from './types.js';
import { matchGenericLesson } from './lessons.js';
import { isNoiseFailure } from './coverage.js';

export interface TriageVerdict {
  bucket: Exclude<TriageBucket, ''>;
  shouldPenalize: boolean;
  shouldQuarantine: boolean;
  escalateSurface: boolean;
  reason: string;
}

const TRANSIENT_FLAKE_RE =
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|rate.?limit|\b429\b|\b503\b|temporarily unavailable|network error|timed out|超时|限流/i;

/**
 * Classify a post-injection failure before anti-rot blames the rule.
 */
export function triagePostInjectionFailure(
  rule: Antibody,
  failureText: string,
  _toolName: string,
  currentScope = '*',
): TriageVerdict {
  if (failureText && (isNoiseFailure(failureText) || TRANSIENT_FLAKE_RE.test(failureText))) {
    return {
      bucket: 'flake_or_transient',
      shouldPenalize: false,
      shouldQuarantine: false,
      escalateSurface: false,
      reason: 'transient/network/abort noise; rule not blamed',
    };
  }

  const ruleScope = rule.project_scope ?? '*';
  if (ruleScope !== '*' && currentScope !== '*' && ruleScope !== currentScope) {
    return {
      bucket: 'wrong_scope_leak',
      shouldPenalize: false,
      shouldQuarantine: true,
      escalateSurface: false,
      reason: `scope mismatch (rule=${ruleScope}, workspace=${currentScope})`,
    };
  }

  const isGeneric = matchGenericLesson(rule.symptom) !== null;
  const isHighHitHealthy = rule.hit_count >= 10 && rule.fail_count < rule.hit_count * 0.12;
  if ((isGeneric && rule.fail_count < 6) || isHighHitHealthy) {
    return {
      bucket: 'ignored_by_agent',
      shouldPenalize: !isGeneric, // generic rules stay protected up to 6 ignores; high-hit tracks ratio
      shouldQuarantine: false,
      escalateSurface: true,
      reason: isGeneric
        ? 'generic invariant ignored by agent — escalate warning instead of retiring'
        : 'high-hit rule ignored once — escalate delivery surface',
    };
  }

  return {
    bucket: 'stale_or_bad_advice',
    shouldPenalize: true,
    shouldQuarantine: false,
    escalateSurface: false,
    reason:
      (rule.probation_at ?? 0) > 0
        ? 'rule on env probation failed again'
        : 'rule applied on target and still failed',
  };
}

/** Append a Red-3 triage audit row (best-effort, bounded). */
export function recordTriageEvent(
  db: DatabaseSync,
  entry: {
    ruleId: number | null;
    sessionId?: string;
    toolName?: string;
    bucket: Exclude<TriageBucket, ''>;
    reason: string;
    actionTaken: string;
  },
): void {
  try {
    db.prepare(
      `INSERT INTO triage_events (rule_id, session_id, tool_name, bucket, reason, action_taken, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.ruleId,
      entry.sessionId ?? '',
      entry.toolName ?? '',
      entry.bucket,
      entry.reason.slice(0, 240),
      entry.actionTaken.slice(0, 120),
      Date.now(),
    );
  } catch {
    // Telemetry must never break hook execution.
  }
}

export interface TriageSummary {
  totalEvents: number;
  byBucket: Record<string, number>;
  ignoredRules: Array<{ id: number; trigger: string; ignoredCount: number; hitCount: number }>;
  quarantinedCount: number;
  probationCount: number;
  recentEvents: TriageEvent[];
}

/** Read-only summary of Red-3 triage telemetry across the store. */
export function summarizeTriage(db: DatabaseSync, limit = 20): TriageSummary {
  const counts = db
    .prepare('SELECT bucket, COUNT(*) AS n FROM triage_events GROUP BY bucket')
    .all() as Array<{ bucket: string; n: number | bigint }>;
  const byBucket: Record<string, number> = {};
  let totalEvents = 0;
  for (const row of counts) {
    const n = Number(row.n);
    byBucket[row.bucket] = n;
    totalEvents += n;
  }

  const ignoredRows = db
    .prepare(
      `SELECT id, trigger_pattern, ignored_count, hit_count
         FROM antibodies
        WHERE ignored_count > 0
        ORDER BY ignored_count DESC, hit_count DESC
        LIMIT 10`,
    )
    .all() as Array<{ id: number; trigger_pattern: string; ignored_count: number; hit_count: number }>;

  const quarantinedRow = db
    .prepare("SELECT COUNT(*) AS n FROM antibodies WHERE status = 'quarantined'")
    .get() as { n: number | bigint };
  const probationRow = db
    .prepare("SELECT COUNT(*) AS n FROM antibodies WHERE status = 'active' AND probation_at > 0")
    .get() as { n: number | bigint };

  const recentEvents = db
    .prepare('SELECT * FROM triage_events ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as unknown as TriageEvent[];

  return {
    totalEvents,
    byBucket,
    ignoredRules: ignoredRows.map((r) => ({
      id: r.id,
      trigger: r.trigger_pattern,
      ignoredCount: r.ignored_count,
      hitCount: r.hit_count,
    })),
    quarantinedCount: Number(quarantinedRow.n),
    probationCount: Number(probationRow.n),
    recentEvents,
  };
}
