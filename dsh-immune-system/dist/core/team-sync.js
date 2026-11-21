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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deriveProjectScope } from './hygiene.js';
import { shareSanityCheck } from './share-guard.js';
/** Deterministic 16-hex-char SHA-256 fingerprint of a rule's prescription. */
export function canonicalRuleHash(prescription) {
    const normalized = prescription.replace(/\s+/g, ' ').trim().toLowerCase();
    return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}
/**
 * Canonical privacy and portability gate for git-committed team rules:
 * delegates to `shareSanityCheck` so every secret format (OpenAI/Anthropic/AWS/
 * GitHub/PEM/JWT/URL credentials), user/drive/UNC path, and real email address
 * is caught consistently across all sharing surfaces without rejecting `@2x.png`.
 */
export function isTeamShareSafe(rule) {
    return shareSanityCheck([
        {
            trigger_pattern: rule.trigger_pattern,
            symptom: rule.symptom,
            prescription: rule.prescription,
        },
    ]).length === 0;
}
/** Convert candidate rules into deterministically sorted JSONL text. */
export function serializeTeamRulesJsonl(candidates, opts = {}) {
    const minHits = opts.minHits ?? 3;
    const byHash = new Map();
    let skippedUnsafe = 0;
    for (const row of candidates) {
        if (row.status && row.status !== 'active')
            continue;
        if (typeof row.hit_count === 'number' && row.hit_count < minHits)
            continue;
        const trigger = row.trigger_pattern.replace(/\s+/g, ' ').trim();
        const symptom = row.symptom.replace(/\s+/g, ' ').trim();
        const prescription = row.prescription.replace(/\s+/g, ' ').trim();
        if (!trigger || !prescription)
            continue;
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
export function parseTeamRulesJsonl(raw) {
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || /^(?:<{7}|={7}|>{7})/.test(trimmed))
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed.trigger_pattern === 'string' &&
                parsed.trigger_pattern.trim() &&
                typeof parsed.prescription === 'string' &&
                parsed.prescription.trim()) {
                const prescription = parsed.prescription.trim();
                out.push({
                    hash: typeof parsed.hash === 'string' && parsed.hash ? parsed.hash : canonicalRuleHash(prescription),
                    trigger_pattern: parsed.trigger_pattern.trim(),
                    symptom: typeof parsed.symptom === 'string' ? parsed.symptom.trim() : '',
                    prescription,
                    tool_name: typeof parsed.tool_name === 'string' ? parsed.tool_name : null,
                });
            }
        }
        catch {
            // Skip malformed lines so one bad manual edit never breaks team sync.
        }
    }
    return out;
}
/** Write sorted team rules to disk (e.g. `.immune/rules.jsonl`), merging with existing rows. */
export function writeTeamRulesFile(filePath, candidates, opts = {}) {
    const existingRaw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
    const existing = !opts.replace && existingRaw ? parseTeamRulesJsonl(existingRaw) : [];
    const mergedCandidates = [
        ...existing.map((r) => ({ ...r, hit_count: opts.minHits ?? 3, status: 'active' })),
        ...candidates,
    ];
    const result = serializeTeamRulesJsonl(mergedCandidates, opts);
    if (existsSync(filePath) && existingRaw === result.jsonl) {
        return { exported: result.exported, skippedUnsafe: result.skippedUnsafe };
    }
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
        writeFileSync(tmpPath, result.jsonl, 'utf8');
        renameSync(tmpPath, filePath);
    }
    catch {
        try {
            rmSync(tmpPath, { force: true });
        }
        catch {
            // ignore temp cleanup error
        }
        writeFileSync(filePath, result.jsonl, 'utf8');
    }
    return { exported: result.exported, skippedUnsafe: result.skippedUnsafe };
}
/**
 * Zero-config SessionStart/Stop hydration: if `.immune/rules.jsonl` exists in
 * the workspace and `IMMUNE_TEAM_SYNC !== 'off'`, idempotently import team rules
 * into the active project store without inflating `hit_count` on duplicates.
 */
export function hydrateTeamRules(store, workspace = process.cwd(), env = process.env) {
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
        if (!isTeamShareSafe(rec))
            continue;
        const insertedId = store.insert({
            trigger_pattern: rec.trigger_pattern,
            symptom: rec.symptom || '(team rule)',
            prescription: rec.prescription,
            tool_name: rec.tool_name,
            prescription_source: 'human',
            origin: 'team_sync',
        }, { skipIfExists: true });
        if (insertedId !== null && insertedId !== undefined) {
            imported += 1;
        }
    }
    return { imported, total: records.length, path: filePath };
}
/**
 * Zero-config turn-end auto-export: if `.immune/rules.jsonl` already exists in
 * the workspace (or `IMMUNE_TEAM_SYNC === '1'`) and `IMMUNE_TEAM_SYNC !== 'off'`,
 * merge and export proven share-safe rules scoped to this workspace back to `.immune/rules.jsonl`.
 */
export function maybeSyncTeamRulesAfterDrain(store, workspace = process.cwd(), env = process.env) {
    if (env.IMMUNE_TEAM_SYNC === 'off')
        return null;
    const filePath = join(workspace, '.immune', 'rules.jsonl');
    if (!existsSync(filePath) && env.IMMUNE_TEAM_SYNC !== '1')
        return null;
    const minHitsRaw = Number(env.IMMUNE_TEAM_SYNC_MIN_HITS ?? '3');
    const minHits = Number.isFinite(minHitsRaw) && minHitsRaw >= 1 ? Math.floor(minHitsRaw) : 3;
    const workspaceScope = deriveProjectScope(workspace);
    const scoped = store
        .listAll(false)
        .filter((r) => !r.project_scope || r.project_scope === '*' || r.project_scope === workspaceScope);
    const res = writeTeamRulesFile(filePath, scoped, { minHits });
    return { exported: res.exported, skippedUnsafe: res.skippedUnsafe, path: filePath };
}
/**
 * Audit a `.immune/rules.jsonl` payload for CI gates (`immune team-sync --check`):
 * detects git merge conflict markers, malformed JSON lines, forged/mismatched
 * prescription hashes, unsorted hashes, duplicate hashes, and unsafe paths/secrets.
 */
export function verifyTeamRulesJsonl(raw) {
    const conflictMarkers = /^(?:<{7}|={7}|>{7})/m.test(raw);
    const seen = new Set();
    let total = 0;
    let duplicates = 0;
    let unsafeCount = 0;
    let unsorted = false;
    let malformedLines = 0;
    let hashMismatches = 0;
    let prevHash = '';
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || /^(?:<{7}|={7}|>{7})/.test(trimmed))
            continue;
        let parsed;
        try {
            const val = JSON.parse(trimmed);
            if (!val || typeof val !== 'object' || Array.isArray(val)) {
                malformedLines += 1;
                continue;
            }
            parsed = val;
        }
        catch {
            malformedLines += 1;
            continue;
        }
        if (typeof parsed.trigger_pattern !== 'string' ||
            !parsed.trigger_pattern.trim() ||
            typeof parsed.prescription !== 'string' ||
            !parsed.prescription.trim()) {
            malformedLines += 1;
            continue;
        }
        const prescription = parsed.prescription.trim();
        const expectedHash = canonicalRuleHash(prescription);
        const actualHash = typeof parsed.hash === 'string' && parsed.hash.trim() ? parsed.hash.trim() : '';
        if (!actualHash || actualHash !== expectedHash) {
            hashMismatches += 1;
        }
        const effectiveHash = actualHash || expectedHash;
        total += 1;
        if (seen.has(effectiveHash)) {
            duplicates += 1;
        }
        else {
            seen.add(effectiveHash);
        }
        if (prevHash && effectiveHash.localeCompare(prevHash) < 0) {
            unsorted = true;
        }
        prevHash = effectiveHash;
        const rec = {
            hash: effectiveHash,
            trigger_pattern: parsed.trigger_pattern.trim(),
            symptom: typeof parsed.symptom === 'string' ? parsed.symptom.trim() : '',
            prescription,
            tool_name: typeof parsed.tool_name === 'string' ? parsed.tool_name : null,
        };
        if (!isTeamShareSafe(rec)) {
            unsafeCount += 1;
        }
    }
    return {
        valid: !conflictMarkers &&
            !unsorted &&
            duplicates === 0 &&
            unsafeCount === 0 &&
            malformedLines === 0 &&
            hashMismatches === 0,
        total,
        unsorted,
        duplicates,
        unsafeCount,
        conflictMarkers,
        malformedLines,
        hashMismatches,
    };
}
