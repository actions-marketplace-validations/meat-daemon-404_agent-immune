import type { DatabaseSync } from 'node:sqlite';
import { redact } from '../redact.js';
import { looksEchoPrescription } from '../rewrite.js';
import type { Antibody, AntibodyStatus, NewAntibody } from '../types.js';
import { buildFtsQuery, cjkBigrams, tokenize } from './tokenize.js';
import { isRelated } from '../relevance.js';
import { prescriptionSimilarity } from '../similarity.js';
import { expandConceptQuery } from '../retrieval.js';
import { classifyRuleQuality } from '../hygiene.js';
import { inferRootCause } from '../rubric.js';
import { recordTriageEvent, triagePostInjectionFailure } from '../triage.js';

/** An antibody is retired after this many injected-but-still-failed episodes. */
export const RETIRE_AFTER_FAILURES = 3;

/**
 * …and only if that many failures is a real share of its deliveries.
 */
export const RETIRE_FAILURE_RATE = 0.25;

/** True when the evidence says this rule is noise rather than occasionally unlucky. */
export function shouldRetire(hitCount: number, failCount: number): boolean {
  if (failCount < RETIRE_AFTER_FAILURES) return false;
  const deliveries = Math.max(hitCount, failCount);
  return failCount >= deliveries * RETIRE_FAILURE_RATE;
}

/** Prescriptions at or above this similarity are the same rule. */
export const MERGE_THRESHOLD = 0.7;

/** Where a new rule came from; decides whether it may overwrite existing text. */
export interface InsertOptions {
  /** Distilled from a human correction — the highest-authority source. */
  humanHint?: boolean;
  /** Distilled by the model (as opposed to the deterministic rule path). */
  fromLlm?: boolean;
}

/** Escape a token for a bound LIKE value (the pattern part is constant). */
function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, '\\$&');
}

function findMergeCandidates(
  db: DatabaseSync,
  trigger: string,
  projectScope: string,
): Array<{ id: number; trigger_pattern: string; prescription: string; symptom: string; project_scope: string }> {
  const tokens = tokenize(trigger, 8);
  const clauses = ['trigger_pattern = ?'];
  const params: Array<string> = [trigger];
  for (const token of tokens) {
    clauses.push("trigger_pattern LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(token)}%`);
  }
  return db
    .prepare(
      `SELECT id, trigger_pattern, prescription, symptom, project_scope FROM antibodies
        WHERE status = 'active'
          AND project_scope = ?
          AND (${clauses.join(' OR ')})
        LIMIT 25`,
    )
    .all(projectScope, ...params) as Array<{
    id: number;
    trigger_pattern: string;
    prescription: string;
    symptom: string;
    project_scope: string;
  }>;
}

/**
 * Union the incoming trigger into the stored one, keeping every recall path
 * the rule has earned.
 */
export function mergeTriggers(existing: string, incoming: string): string | null {
  const oldTokens = existing.split(/\s+/).filter(Boolean);
  const seen = new Set(oldTokens.map((t) => t.toLowerCase()));
  const added: string[] = [];
  for (const token of incoming.split(/\s+/).filter(Boolean)) {
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      added.push(token);
    }
  }
  if (added.length === 0) return null;
  const shares = incoming
    .split(/\s+/)
    .some((t) => oldTokens.some((o) => o.toLowerCase() === t.toLowerCase()));
  if (!shares) return null;
  const merged = [...oldTokens, ...added].join(' ');
  if (merged.length > 200) return null;
  return merged;
}

/** Parse the stored JSON action-diff into an array; tolerate legacy rows. */
function parseRepairPath(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rowToAntibody(row: Record<string, unknown>): Antibody {
  return { ...(row as unknown as Antibody), repair_path: parseRepairPath(row.repair_path) };
}

/** One rule by id, or null. Read-only. */
export function getAntibodyById(db: DatabaseSync, id: number): Antibody | null {
  const row = db.prepare('SELECT * FROM antibodies WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAntibody(row) : null;
}

/**
 * ROADMAP 2.2 — mutate an injected-but-still-failed rule into a refined child.
 */
export function mutateRule(
  db: DatabaseSync,
  parentId: number,
  incomingTokens: string,
  evidence: { repairPath?: string[]; humanHint?: string } = {},
): number | null {
  const hasEvidence =
    (evidence.repairPath ?? []).length > 0 || Boolean(evidence.humanHint?.trim());
  if (!hasEvidence) return null;
  const parent = getAntibodyById(db, parentId);
  if (!parent || parent.status !== 'active') return null;
  const refined = mergeTriggers(parent.trigger_pattern, incomingTokens);
  if (!refined || refined === parent.trigger_pattern) return null;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO antibodies
         (trigger_pattern, symptom, prescription, tool_name, repair_path, origin, parent_id, mutated_at,
          project_scope, quality_grade, rubric_score, root_cause, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      refined,
      parent.symptom,
      parent.prescription,
      parent.tool_name,
      toRepairJson(evidence.repairPath),
      parent.origin ?? '',
      parentId,
      now,
      parent.project_scope ?? '*',
      parent.quality_grade ?? 'advice',
      parent.rubric_score ?? 70,
      parent.root_cause ?? '',
      now,
      now,
    );
  db.prepare("UPDATE antibodies SET status = 'retired', updated_at = ? WHERE id = ?").run(now, parentId);
  return Number(info.lastInsertRowid);
}

/** Normalise and cap an incoming action diff for storage. */
function toRepairJson(repairPath?: string[]): string {
  const actions = (repairPath ?? [])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => redact(v).trim().slice(0, 120))
    .filter(Boolean)
    .slice(-3);
  return JSON.stringify(actions);
}

export function insertAntibody(
  db: DatabaseSync,
  ab: NewAntibody,
  options: InsertOptions = {},
): number | null {
  const trigger = redact(ab.trigger_pattern).trim().slice(0, 200);
  const symptom = redact(ab.symptom).trim().slice(0, 160);
  const prescription = redact(ab.prescription).trim().slice(0, 200);
  if (!trigger || !prescription) return null;

  const incomingScope = ab.project_scope?.trim() || '*';
  const verdict = classifyRuleQuality({
    trigger_pattern: trigger,
    symptom,
    prescription,
    tool_name: ab.tool_name ?? null,
    repair_path: ab.repair_path,
    prescription_source: ab.prescription_source ?? (options.fromLlm ? 'llm' : options.humanHint ? 'human' : ''),
    origin: ab.origin,
  });
  const qualityGrade = ab.quality_grade ?? verdict.grade;
  const rubricScore = ab.rubric_score ?? verdict.score;
  const rootCause = ab.root_cause || inferRootCause(symptom, prescription, ab.repair_path);
  // Universal advice upgrades scope to '*'; project tactics stay locked to incomingScope.
  const effectiveScope = verdict.universalEligible && incomingScope === '*' ? '*' : incomingScope;
  // Direct store.insert() calls preserve active status unless the caller (e.g.
  // distiller / hygiene repair) explicitly passes status = 'quarantined', so
  // rewriteEchoes / hostRewriteCandidates / share-gate tests stay observable.
  const initialStatus: AntibodyStatus = ab.status ?? 'active';
  const retireReason = initialStatus === 'quarantined' ? (verdict.quarantineReason ?? 'hygiene_quarantined') : '';

  const now = Date.now();

  // 1. Exact prescription match within compatible scope.
  const exact = db
    .prepare(
      `SELECT id, trigger_pattern, project_scope FROM antibodies
        WHERE prescription = ? AND (project_scope = '*' OR project_scope = ?)
        LIMIT 1`,
    )
    .get(prescription, effectiveScope) as
    | { id: number; trigger_pattern: string; project_scope: string }
    | undefined;
  if (exact) {
    const merged = mergeTriggers(exact.trigger_pattern, trigger);
    const nextScope = exact.project_scope === '*' || effectiveScope === '*' ? '*' : exact.project_scope;
    if (merged) {
      db.prepare(
        'UPDATE antibodies SET trigger_pattern = ?, project_scope = ?, hit_count = hit_count + 1, updated_at = ? WHERE id = ?',
      ).run(merged, nextScope, now, exact.id);
    } else {
      db.prepare(
        'UPDATE antibodies SET project_scope = ?, hit_count = hit_count + 1, updated_at = ? WHERE id = ?',
      ).run(nextScope, now, exact.id);
    }
    return exact.id;
  }

  // 2. Near-duplicate: overlapping trigger, similar prescription.
  if (initialStatus === 'active') {
    const candidates = findMergeCandidates(db, trigger, effectiveScope);
    for (const candidate of candidates) {
      if (prescriptionSimilarity(candidate.prescription, prescription) < MERGE_THRESHOLD) continue;
      if (options.humanHint || options.fromLlm) {
        const mergedTrigger = mergeTriggers(candidate.trigger_pattern, trigger);
        db.prepare(
          `UPDATE antibodies
              SET prescription = ?, symptom = ?, trigger_pattern = ?,
                  quality_grade = ?, rubric_score = ?, root_cause = ?,
                  hit_count = hit_count + 1, updated_at = ?
            WHERE id = ?`,
        ).run(
          prescription,
          symptom || candidate.symptom,
          mergedTrigger ?? candidate.trigger_pattern,
          qualityGrade,
          rubricScore,
          rootCause,
          now,
          candidate.id,
        );
      } else {
        const mergedTrigger = mergeTriggers(candidate.trigger_pattern, trigger);
        db.prepare(
          'UPDATE antibodies SET trigger_pattern = ?, hit_count = hit_count + 1, updated_at = ? WHERE id = ?',
        ).run(mergedTrigger ?? candidate.trigger_pattern, now, candidate.id);
      }
      return candidate.id;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO antibodies
         (trigger_pattern, symptom, prescription, status, tool_name, repair_path,
          prescription_source, origin, env_fingerprint, project_scope, quality_grade,
          rubric_score, root_cause, retire_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      trigger,
      symptom,
      prescription,
      initialStatus,
      ab.tool_name ?? null,
      toRepairJson(ab.repair_path),
      ab.prescription_source ?? (options.fromLlm ? 'llm' : options.humanHint ? 'human' : ''),
      ab.origin ?? '',
      ab.env_fingerprint ?? '',
      effectiveScope,
      qualityGrade,
      rubricScore,
      rootCause,
      retireReason,
      now,
      now,
    );
  const newId = Number(info.lastInsertRowid);
  if (ab.env_fingerprint) {
    db.prepare(
      `UPDATE antibodies
          SET status = 'retired', retire_reason = 'superseded_by_env_upgrade', updated_at = ?
        WHERE status = 'active' AND probation_at > 0
          AND id != ?
          AND tool_name IS ?
          AND symptom = ?`,
    ).run(now, newId, ab.tool_name ?? null, ab.symptom.trim());
  }
  return newId;
}

/**
 * Rank active antibodies against free text, scoped by workspace and expanded
 * via the bilingual developer concept graph.
 */
export function findMatches(
  db: DatabaseSync,
  text: string,
  limit: number,
  projectScope = '*',
): Antibody[] {
  const expanded = expandConceptQuery(text);
  const rows: Antibody[] = [];
  const seen = new Set<number>();
  const scopeFilter = "(a.project_scope = '*' OR a.project_scope = ? OR ? = '*')";

  const ftsQuery = buildFtsQuery(expanded);
  if (ftsQuery) {
    try {
      const raw = db
        .prepare(
          `SELECT a.* FROM antibodies a
             JOIN antibodies_fts f ON a.id = f.rowid
            WHERE antibodies_fts MATCH ?
              AND a.status = 'active'
              AND ${scopeFilter}
            ORDER BY bm25(antibodies_fts)
            LIMIT ?`,
        )
        .all(ftsQuery, projectScope, projectScope, limit) as unknown as Array<Record<string, unknown>>;
      const hits = raw.map(rowToAntibody);
      for (const row of hits) {
        rows.push(row);
        seen.add(row.id);
      }
    } catch {
      // A malformed MATCH expression must never break the user's turn.
    }
  }

  if (rows.length >= limit) return rows.slice(0, limit);

  const bigrams = cjkBigrams(expanded);
  if (bigrams.length === 0) return rows;

  try {
    const clause = '(trigger_pattern LIKE ? OR symptom LIKE ? OR prescription LIKE ?)';
    const where = bigrams.map(() => clause).join(' OR ');
    const params: string[] = [];
    for (const gram of bigrams) {
      const needle = `%${gram}%`;
      params.push(needle, needle, needle);
    }

    const rawCandidates = db
      .prepare(
        `SELECT * FROM antibodies a
          WHERE a.status = 'active'
            AND ${scopeFilter}
            AND (${where})
          ORDER BY a.hit_count DESC, a.created_at DESC
          LIMIT 24`,
      )
      .all(projectScope, projectScope, ...params) as unknown as Array<Record<string, unknown>>;
    const candidates = rawCandidates.map(rowToAntibody);

    const scored = candidates
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        const haystack = `${row.trigger_pattern} ${row.symptom} ${row.prescription}`;
        const score = bigrams.filter((gram) => haystack.includes(gram)).length;
        return { row, score };
      })
      .sort((a, b) => b.score - a.score || b.row.hit_count - a.row.hit_count);

    for (const entry of scored) {
      if (rows.length >= limit) break;
      rows.push(entry.row);
      seen.add(entry.row.id);
    }
  } catch {
    // The fallback is an optimisation; never let it cost the caller a turn.
  }

  return rows.slice(0, limit);
}

/** Bump hit counters for injected antibodies. */
export function bumpHits(db: DatabaseSync, ids: number[]): void {
  const stmt = db.prepare('UPDATE antibodies SET hit_count = hit_count + 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

export function listAntibodies(db: DatabaseSync, includeRetired = true): Antibody[] {
  const sql = includeRetired
    ? 'SELECT * FROM antibodies ORDER BY status ASC, hit_count DESC, created_at DESC'
    : "SELECT * FROM antibodies WHERE status = 'active' ORDER BY hit_count DESC, created_at DESC";
  return (db.prepare(sql).all() as unknown as Array<Record<string, unknown>>).map(rowToAntibody);
}

export function removeAntibody(db: DatabaseSync, id: number): boolean {
  let removed = false;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM model_hits WHERE rule_id = ?').run(id);
    db.prepare('DELETE FROM delivery_receipts WHERE rule_id = ?').run(id);
    removed = Number(db.prepare('DELETE FROM antibodies WHERE id = ?').run(id).changes) > 0;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return removed;
}

export function setAntibodyStatus(db: DatabaseSync, id: number, status: AntibodyStatus): boolean {
  const info = db
    .prepare('UPDATE antibodies SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
  return Number(info.changes) > 0;
}

export interface PenaltyContext {
  failureText: string;
  toolName: string;
  sessionId?: string;
  projectScope?: string;
}

/**
 * Red-3 Triaged Anti-Rot: classifies post-injection failure before penalizing
 * or retiring a rule, preventing flake/scope-leak/ignored invariants from killing
 * healthy rules.
 */
export function penalizeAntibodies(
  db: DatabaseSync,
  ids: number[],
  ctx?: PenaltyContext,
): { retired: Antibody[]; penalized: number[] } {
  if (ids.length === 0) return { retired: [], penalized: [] };
  const retired: Antibody[] = [];
  const penalized: number[] = [];
  const now = Date.now();
  const bumpFail = db.prepare(
    'UPDATE antibodies SET fail_count = fail_count + 1, triage_bucket = ?, updated_at = ? WHERE id = ?',
  );
  const bumpIgnored = db.prepare(
    'UPDATE antibodies SET ignored_count = ignored_count + 1, triage_bucket = ?, updated_at = ? WHERE id = ?',
  );

  for (const id of ids) {
    const rawBefore = db.prepare('SELECT * FROM antibodies WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!rawBefore || rawBefore.status !== 'active') continue;
    const before = rowToAntibody(rawBefore);
    if (ctx && !isRelated(before.trigger_pattern, ctx.failureText, ctx.toolName)) continue;

    if (ctx) {
      const verdict = triagePostInjectionFailure(
        before,
        ctx.failureText,
        ctx.toolName,
        ctx.projectScope ?? '*',
      );
      if (verdict.bucket === 'flake_or_transient') {
        recordTriageEvent(db, {
          ruleId: id,
          sessionId: ctx.sessionId,
          toolName: ctx.toolName,
          bucket: verdict.bucket,
          reason: verdict.reason,
          actionTaken: 'skipped_penalty',
        });
        continue;
      }
      if (verdict.shouldQuarantine) {
        db.prepare(
          "UPDATE antibodies SET status = 'quarantined', triage_bucket = ?, retire_reason = ?, updated_at = ? WHERE id = ?",
        ).run(verdict.bucket, verdict.reason.slice(0, 120), now, id);
        recordTriageEvent(db, {
          ruleId: id,
          sessionId: ctx.sessionId,
          toolName: ctx.toolName,
          bucket: verdict.bucket,
          reason: verdict.reason,
          actionTaken: 'quarantined_scope_leak',
        });
        continue;
      }
      if (verdict.bucket === 'ignored_by_agent') {
        bumpIgnored.run(verdict.bucket, now, id);
        recordTriageEvent(db, {
          ruleId: id,
          sessionId: ctx.sessionId,
          toolName: ctx.toolName,
          bucket: verdict.bucket,
          reason: verdict.reason,
          actionTaken: verdict.shouldPenalize ? 'recorded_ignore_and_fail' : 'protected_generic_rule',
        });
        if (!verdict.shouldPenalize) continue;
      } else {
        recordTriageEvent(db, {
          ruleId: id,
          sessionId: ctx.sessionId,
          toolName: ctx.toolName,
          bucket: verdict.bucket,
          reason: verdict.reason,
          actionTaken: 'penalized',
        });
      }
    }

    bumpFail.run(ctx ? 'stale_or_bad_advice' : '', now, id);
    penalized.push(id);
    if (!shouldRetire(before.hit_count, before.fail_count + 1)) continue;
    setAntibodyStatus(db, id, 'retired');
    retired.push({ ...before, status: 'retired', fail_count: before.fail_count + 1 });
  }
  return { retired, penalized };
}

/** Antibodies worth sharing: proven by repeated successful injection. */
export function exportableAntibodies(db: DatabaseSync, minHits: number): Antibody[] {
  const raw = db
    .prepare(
      `SELECT * FROM antibodies
        WHERE status = 'active' AND hit_count >= ?
        ORDER BY hit_count DESC, created_at DESC`,
    )
    .all(minHits) as unknown as Array<Record<string, unknown>>;
  return raw
    .map(rowToAntibody)
    .filter((ab) => !looksEchoPrescription(ab.prescription));
}

export function setPrescription(
  db: DatabaseSync,
  id: number,
  prescription: string,
  source: 'rule' | 'llm' | 'human' | 'host_llm',
): boolean {
  const clean = redact(prescription).trim().slice(0, 200);
  const existing = getAntibodyById(db, id);
  const nextGrade = existing
    ? classifyRuleQuality({ ...existing, prescription: clean, prescription_source: source })
    : null;
  const info = db
    .prepare(
      `UPDATE antibodies
          SET prescription = ?,
              prescription_source = ?,
              quality_grade = ?,
              rubric_score = ?,
              status = CASE WHEN status = 'quarantined' THEN 'active' ELSE status END,
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      clean,
      source,
      nextGrade?.grade ?? 'advice',
      nextGrade?.score ?? 85,
      Date.now(),
      id,
    );
  return Number(info.changes) > 0;
}

export function consolidateAntibodies(
  db: DatabaseSync,
  keepId: number,
  input: {
    trigger: string;
    hitCount: number;
    failCount: number;
    repairs: string[];
    retireIds: number[];
  },
): void {
  const tx = db.prepare('BEGIN');
  try {
    tx.run();
    db.prepare(
      `UPDATE antibodies SET trigger_pattern = ?, hit_count = ?, fail_count = ?,
        repair_path = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    ).run(input.trigger.slice(0, 200), input.hitCount, input.failCount, toRepairJson(input.repairs), Date.now(), keepId);
    if (input.retireIds.length > 0) {
      const placeholders = input.retireIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE antibodies SET status = 'retired', updated_at = ?
          WHERE id IN (${placeholders}) AND status = 'active'`,
      ).run(Date.now(), ...input.retireIds);
      const move = db.prepare(
        `INSERT INTO model_hits (rule_id, model, hits, fails, updated_at)
          SELECT ?, model, SUM(hits), SUM(fails), MAX(updated_at) FROM model_hits
           WHERE rule_id IN (${placeholders}) GROUP BY model
          ON CONFLICT(rule_id, model) DO UPDATE SET
            hits = hits + excluded.hits, fails = fails + excluded.fails,
            updated_at = MAX(updated_at, excluded.updated_at)`,
      );
      move.run(keepId, ...input.retireIds);
      db.prepare(`DELETE FROM model_hits WHERE rule_id IN (${placeholders})`).run(
        ...input.retireIds,
      );
    }
    db.prepare('COMMIT').run();
  } catch (error) {
    db.prepare('ROLLBACK').run();
    throw error;
  }
}

export function newestActiveId(db: DatabaseSync): number | null {
  const row = db
    .prepare("SELECT id FROM antibodies WHERE status = 'active' ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function retireZombieAntibodies(db: DatabaseSync, olderThanMs: number): number[] {
  const cutoff = Date.now() - olderThanMs;
  const rows = db
    .prepare(
      `SELECT id FROM antibodies
        WHERE status = 'active' AND hit_count = 0 AND created_at < ?`,
    )
    .all(cutoff) as Array<{ id: number }>;

  const retired: number[] = [];
  for (const row of rows) {
    if (setAntibodyStatus(db, row.id, 'retired')) retired.push(row.id);
  }
  return retired;
}

export function pruneZombieAntibodies(db: DatabaseSync, olderThanMs: number): number[] {
  const cutoff = Date.now() - olderThanMs;
  const rows = db
    .prepare(
      `SELECT id FROM antibodies
        WHERE status = 'active' AND hit_count = 0 AND created_at < ?`,
    )
    .all(cutoff) as Array<{ id: number }>;

  const removed: number[] = [];
  for (const row of rows) {
    if (removeAntibody(db, row.id)) removed.push(row.id);
  }
  return removed;
}
