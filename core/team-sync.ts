/**
 * Git-native, zero-conflict team memory (`.immune/rules.jsonl`).
 *
 * SQLite `.sqlite` databases are binary and cannot be merged cleanly across git
 * branches. This module serializes proven, sanitized project rules into a
 * line-sorted canonical JSONL file (`.immune/rules.jsonl`) where each line is
 * keyed by `sha256(prescription)` and sorted deterministically by hash.
 * Two branches adding different rules merge in git without conflicts.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface TeamRuleRecord {
  readonly hash: string;
  readonly trigger_pattern: string;
  readonly symptom: string;
  readonly prescription: string;
  readonly tool_name: string | null;
}

export interface TeamSyncCandidate {
  readonly trigger_pattern: string;
  readonly symptom: string;
  readonly prescription: string;
  readonly tool_name?: string | null;
  readonly hit_count?: number;
  readonly status?: string;
}

export interface TeamRuleImportStore {
  insert(input: {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    tool_name?: string | null;
    prescription_source?: 'llm' | 'heuristic' | 'human';
    origin?: string;
  }): unknown;
}

/** Deterministic 16-hex-char SHA-256 fingerprint of a rule's prescription. */
export function canonicalRuleHash(prescription: string): string {
  const normalized = prescription.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Basic privacy and portability check for git-committed team rules:
 * rejects rules containing user home directories, Windows drive paths,
 * email addresses, or credential tokens.
 */
export function isTeamShareSafe(rule: TeamSyncCandidate): boolean {
  const combined = `${rule.trigger_pattern} ${rule.symptom} ${rule.prescription}`;
  if (/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]+Users[\\/]+)/i.test(combined)) return false;
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(combined)) return false;
  if (/(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})/i.test(combined)) return false;
  return true;
}

/** Convert candidate rules into deterministically sorted JSONL text. */
export function serializeTeamRulesJsonl(
  candidates: ReadonlyArray<TeamSyncCandidate>,
  opts: { minHits?: number } = {},
): { jsonl: string; exported: number; skippedUnsafe: number } {
  const minHits = opts.minHits ?? 3;
  const byHash = new Map<string, TeamRuleRecord>();
  let skippedUnsafe = 0;

  for (const row of candidates) {
    if (row.status && row.status !== 'active') continue;
    if (typeof row.hit_count === 'number' && row.hit_count < minHits) continue;
    const trigger = row.trigger_pattern.replace(/\s+/g, ' ').trim();
    const symptom = row.symptom.replace(/\s+/g, ' ').trim();
    const prescription = row.prescription.replace(/\s+/g, ' ').trim();
    if (!trigger || !prescription) continue;
    if (!isTeamShareSafe({ trigger_pattern: trigger, symptom, prescription })) {
      skippedUnsafe += 1;
      continue;
    }
    const hash = canonicalRuleHash(prescription);
    if (!byHash.has(hash)) {
      byHash.set(hash, {
        hash,
        trigger_pattern: trigger,
        symptom,
        prescription,
        tool_name: row.tool_name ?? null,
      });
    }
  }

  const sorted = [...byHash.values()].sort((a, b) => a.hash.localeCompare(b.hash));
  const lines = sorted.map((record) => JSON.stringify(record));
  return {
    jsonl: lines.length > 0 ? `${lines.join('\n')}\n` : '',
    exported: sorted.length,
    skippedUnsafe,
  };
}

/** Parse a `.immune/rules.jsonl` file back into validated records (auto-stripping Git conflict markers). */
export function parseTeamRulesJsonl(raw: string): TeamRuleRecord[] {
  const out: TeamRuleRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || /^(?:<{7}|={7}|>{7})/.test(trimmed)) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<TeamRuleRecord>;
      if (
        typeof parsed.trigger_pattern === 'string' &&
        parsed.trigger_pattern.trim() &&
        typeof parsed.prescription === 'string' &&
        parsed.prescription.trim()
      ) {
        const prescription = parsed.prescription.trim();
        out.push({
          hash: typeof parsed.hash === 'string' && parsed.hash ? parsed.hash : canonicalRuleHash(prescription),
          trigger_pattern: parsed.trigger_pattern.trim(),
          symptom: typeof parsed.symptom === 'string' ? parsed.symptom.trim() : '',
          prescription,
          tool_name: typeof parsed.tool_name === 'string' ? parsed.tool_name : null,
        });
      }
    } catch {
      // Skip malformed lines so one bad manual edit never breaks team sync.
    }
  }
  return out;
}

/** Write sorted team rules to disk (e.g. `.immune/rules.jsonl`), merging with existing rows. */
export function writeTeamRulesFile(
  filePath: string,
  candidates: ReadonlyArray<TeamSyncCandidate>,
  opts: { minHits?: number } = {},
): { exported: number; skippedUnsafe: number } {
  const existing = existsSync(filePath) ? parseTeamRulesJsonl(readFileSync(filePath, 'utf8')) : [];
  const mergedCandidates: TeamSyncCandidate[] = [
    ...existing.map((r) => ({ ...r, hit_count: opts.minHits ?? 3, status: 'active' })),
    ...candidates,
  ];
  const result = serializeTeamRulesJsonl(mergedCandidates, opts);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, result.jsonl, 'utf8');
  return { exported: result.exported, skippedUnsafe: result.skippedUnsafe };
}

/**
 * Zero-config SessionStart/Stop hydration: if `.immune/rules.jsonl` exists in
 * the workspace and `IMMUNE_TEAM_SYNC !== 'off'`, idempotently import team rules
 * into the active project store.
 */
export function hydrateTeamRules(
  store: TeamRuleImportStore,
  workspace: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): { imported: number; total: number; path: string | null } {
  if (env.IMMUNE_TEAM_SYNC === 'off') {
    return { imported: 0, total: 0, path: null };
  }
  const filePath = join(workspace, '.immune', 'rules.jsonl');
  if (!existsSync(filePath)) {
    return { imported: 0, total: 0, path: null };
  }
  const records = parseTeamRulesJsonl(readFileSync(filePath, 'utf8'));
  let imported = 0;
  for (const rec of records) {
    store.insert({
      trigger_pattern: rec.trigger_pattern,
      symptom: rec.symptom || '(team rule)',
      prescription: rec.prescription,
      tool_name: rec.tool_name,
      prescription_source: 'human',
      origin: 'team_sync',
    });
    imported += 1;
  }
  return { imported, total: records.length, path: filePath };
}

/**
 * Zero-config turn-end auto-export: if `.immune/rules.jsonl` already exists in
 * the workspace (or `IMMUNE_TEAM_SYNC === '1'`) and `IMMUNE_TEAM_SYNC !== 'off'`,
 * merge and export proven share-safe rules back to `.immune/rules.jsonl`.
 */
export function maybeSyncTeamRulesAfterDrain(
  store: { listAll(includeQuarantined?: boolean): ReadonlyArray<TeamSyncCandidate> },
  workspace: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): { exported: number; skippedUnsafe: number; path: string } | null {
  if (env.IMMUNE_TEAM_SYNC === 'off') return null;
  const filePath = join(workspace, '.immune', 'rules.jsonl');
  if (!existsSync(filePath) && env.IMMUNE_TEAM_SYNC !== '1') return null;
  const minHitsRaw = Number(env.IMMUNE_TEAM_SYNC_MIN_HITS ?? '3');
  const minHits = Number.isFinite(minHitsRaw) && minHitsRaw >= 1 ? Math.floor(minHitsRaw) : 3;
  const res = writeTeamRulesFile(filePath, store.listAll(false), { minHits });
  return { exported: res.exported, skippedUnsafe: res.skippedUnsafe, path: filePath };
}

export interface TeamRulesCheckReport {
  readonly valid: boolean;
  readonly total: number;
  readonly unsorted: boolean;
  readonly duplicates: number;
  readonly unsafeCount: number;
  readonly conflictMarkers: boolean;
}

/**
 * Audit a `.immune/rules.jsonl` payload for CI gates (`immune team-sync --check`):
 * detects git merge conflict markers, unsorted hashes, duplicate hashes, and unsafe paths/secrets.
 */
export function verifyTeamRulesJsonl(raw: string): TeamRulesCheckReport {
  const conflictMarkers = /^(?:<{7}|={7}|>{7})/m.test(raw);
  const records = parseTeamRulesJsonl(raw);
  const seen = new Set<string>();
  let duplicates = 0;
  let unsafeCount = 0;
  let unsorted = false;
  let prevHash = '';

  for (const rec of records) {
    if (seen.has(rec.hash)) {
      duplicates += 1;
    } else {
      seen.add(rec.hash);
    }
    if (prevHash && rec.hash.localeCompare(prevHash) < 0) {
      unsorted = true;
    }
    prevHash = rec.hash;
    if (!isTeamShareSafe(rec)) {
      unsafeCount += 1;
    }
  }

  return {
    valid: !conflictMarkers && !unsorted && duplicates === 0 && unsafeCount === 0,
    total: records.length,
    unsorted,
    duplicates,
    unsafeCount,
    conflictMarkers,
  };
}
