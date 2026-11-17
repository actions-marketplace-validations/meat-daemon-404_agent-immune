/**
 * Model-Aware Immunity Matrix & Adaptive Salience Escalation (v2.1).
 *
 * Joins per-model delivery stats (`model_hits`, `delivery_receipts`) with Red-3
 * `triage_events` and optional Magpie gateway telemetry so the runtime knows
 * *which* models ignore which rules and dynamically escalates reminders on
 * repeat-ignore rules without burning tokens on compliant rules.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { MagpieTelemetryReport } from './audit/magpie.js';

export interface ModelImmunityProfile {
  model: string;
  deliveries: number;
  fails: number;
  survivalRatePct: number;
  distinctRules: number;
  tokensEstSaved: number;
  gatewayRequests?: number;
  gatewayFailures?: number;
}

export interface EscalatedRuleHint {
  id: number;
  trigger: string;
  ignoredCount: number;
  failCount: number;
  hitCount: number;
}

export function buildModelImmunityReport(
  db: DatabaseSync,
  magpie?: MagpieTelemetryReport | null,
): {
  models: ModelImmunityProfile[];
  escalatedRules: EscalatedRuleHint[];
  crossModelProven: number;
} {
  const rows = db
    .prepare(
      `SELECT model,
              SUM(hits) AS hits,
              SUM(fails) AS fails,
              COUNT(DISTINCT rule_id) AS rules
         FROM model_hits
        GROUP BY model
        ORDER BY hits DESC`,
    )
    .all() as Array<{ model: string; hits: number; fails: number; rules: number }>;

  const savedByModel = new Map<string, number>();
  try {
    const rRows = db
      .prepare(
        `SELECT model, COALESCE(SUM(CASE WHEN outcome = 'held' THEN tokens_est ELSE 0 END), 0) AS saved
           FROM delivery_receipts
          GROUP BY model`,
      )
      .all() as Array<{ model: string; saved: number }>;
    for (const r of rRows) savedByModel.set(r.model, Number(r.saved) || 0);
  } catch {
    // Table optional in synthetic DBs
  }

  const gatewayByModel = new Map<string, { requests: number; failures: number }>();
  if (magpie?.present) {
    for (const m of magpie.byModel) {
      gatewayByModel.set(m.model.toLowerCase(), { requests: m.requests, failures: m.failures });
    }
  }

  const models: ModelImmunityProfile[] = rows.map((r) => {
    const hits = Number(r.hits) || 0;
    const fails = Number(r.fails) || 0;
    const survivalRatePct = hits > 0 ? Number((((Math.max(0, hits - fails)) * 100) / hits).toFixed(1)) : 100;
    const gw = gatewayByModel.get(r.model.toLowerCase());
    return {
      model: r.model,
      deliveries: hits,
      fails,
      survivalRatePct,
      distinctRules: Number(r.rules) || 0,
      tokensEstSaved: savedByModel.get(r.model) ?? 0,
      ...(gw ? { gatewayRequests: gw.requests, gatewayFailures: gw.failures } : {}),
    };
  });

  const escalated = db
    .prepare(
      `SELECT id, trigger_pattern, ignored_count, fail_count, hit_count
         FROM antibodies
        WHERE status = 'active' AND (ignored_count >= 2 OR (hit_count >= 8 AND fail_count >= 2))
        ORDER BY ignored_count DESC, fail_count DESC
        LIMIT 12`,
    )
    .all() as Array<{
    id: number;
    trigger_pattern: string;
    ignored_count: number;
    fail_count: number;
    hit_count: number;
  }>;

  const cross = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT rule_id FROM model_hits WHERE model != 'unknown' GROUP BY rule_id HAVING COUNT(DISTINCT model) >= 2
       )`,
    )
    .get() as { n: number | bigint };

  return {
    models,
    escalatedRules: escalated.map((e) => ({
      id: e.id,
      trigger: e.trigger_pattern,
      ignoredCount: Number(e.ignored_count) || 0,
      failCount: Number(e.fail_count) || 0,
      hitCount: Number(e.hit_count) || 0,
    })),
    crossModelProven: Number(cross.n),
  };
}
