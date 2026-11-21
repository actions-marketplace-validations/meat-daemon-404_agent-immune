/**
 * Query surface shared by the standalone dashboard and the DSH web route.
 *
 * Kept separate from either server so the two cannot drift: one definition of
 * "what the UI may read" and "which mutations exist".
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanMagpieSummary } from '../audit/magpie.js';
import { diagnoseAgentArchetype } from '../diagnose.js';
import { runPitfallAutopsy } from '../autopsy.js';
import { evaluatePreFlightGuard } from '../guard.js';
import { detectWorkspaceDNA, verifyVaccineLockfile } from '../vaccine.js';
import { federateSwarmRules } from '../federate.js';
import { parseTeamRulesJsonl } from '../team-sync.js';
import { computeImmunityScore } from '../wrapped.js';
export const MAX_QUERY = 200;
export const ACTIONS = new Set(['retire', 'restore', 'delete']);
/**
 * The same variable and clamp the adapters use (zcode/src/drain.ts,
 * dsh/src/index.ts). Read here only to display it; the drain itself owns the
 * real value.
 */
export function resolveBudgetMs(env = process.env) {
    const raw = Number(env.IMMUNE_DISTILL_BUDGET_MS ?? '');
    const budget = Number.isFinite(raw) && raw > 0 ? raw : 12_000;
    return Math.min(60_000, Math.max(1_000, Math.trunc(budget)));
}
export function dashboardStats(store) {
    const all = store.listAll(true);
    const s = store.stats();
    const activeOrRetired = all.filter((a) => a.status !== 'quarantined');
    const scored = activeOrRetired.filter((a) => typeof a.rubric_score === 'number');
    const avgRubric = scored.length > 0
        ? Math.round(scored.reduce((sum, a) => sum + (a.rubric_score ?? 0), 0) / scored.length)
        : 0;
    return {
        active: all.filter((a) => a.status === 'active').length,
        retired: all.filter((a) => a.status === 'retired').length,
        quarantined: all.filter((a) => a.status === 'quarantined').length,
        hits: all.reduce((sum, a) => sum + a.hit_count, 0),
        fails: all.reduce((sum, a) => sum + a.fail_count, 0),
        byModel: store.modelBreakdown(),
        crossModelRules: store.crossModelRules(),
        shared: store.sharedAntibodies(1000).length,
        pendingFailures: s.pendingFailures,
        sessions: s.sessions,
        jobsPending: s.jobsPending,
        jobsTotal: s.jobsTotal,
        suppressedRepeats: s.suppressedRepeats,
        llmDistilled: s.llmDistilled,
        llmFallbacks: s.llmFallbacks,
        dbBytes: s.dbBytes,
        avgRubric,
        echoNoise: all.filter((a) => a.quality_grade === 'quarantined').length,
        workspaces: store.listWorkspaceProfiles().length,
        triage: store.triageSummary(12),
        receipts: store.receiptSummary(500),
        guardInterceptions: store.guardEventSummary(1).total,
        gateway: scanMagpieSummary(),
    };
}
/** Read state for one view. Never bumps hit counts: browsing is not delivery. */
export function readState(store, view, query = '', budgetMs = resolveBudgetMs()) {
    const rawQuery = query.slice(0, MAX_QUERY).trim();
    const q = rawQuery.replace(/^scope:/i, '').trim().toLowerCase();
    const scopeOnly = /^scope:/i.test(rawQuery);
    const matchFilter = (a) => {
        if (!q)
            return true;
        if (scopeOnly)
            return (a.project_scope ?? '').toLowerCase().includes(q);
        return (a.trigger_pattern.toLowerCase().includes(q) ||
            a.symptom.toLowerCase().includes(q) ||
            a.prescription.toLowerCase().includes(q) ||
            (a.project_scope ?? '').toLowerCase().includes(q) ||
            (a.root_cause ?? '').toLowerCase().includes(q) ||
            (a.tool_name ?? '').toLowerCase().includes(q));
    };
    let antibodies;
    if (view === 'shared') {
        antibodies = store.sharedAntibodies(MAX_QUERY).filter(matchFilter);
    }
    else if (view === 'quarantined') {
        antibodies = store
            .listAll(true)
            .filter((a) => a.status === 'quarantined')
            .filter(matchFilter)
            .slice(0, MAX_QUERY);
    }
    else if (!q) {
        antibodies = store
            .listAll(true)
            .filter((a) => a.status !== 'quarantined')
            .slice(0, MAX_QUERY);
    }
    else if (scopeOnly) {
        antibodies = store
            .listAll(true)
            .filter((a) => a.status !== 'quarantined')
            .filter(matchFilter)
            .slice(0, MAX_QUERY);
    }
    else {
        const ftsHits = store.peek(rawQuery, MAX_QUERY).filter((a) => a.status !== 'quarantined');
        const seen = new Set(ftsHits.map((a) => a.id));
        const substrHits = store
            .listAll(true)
            .filter((a) => a.status !== 'quarantined' && !seen.has(a.id) && matchFilter(a));
        antibodies = [...ftsHits, ...substrHits].slice(0, MAX_QUERY);
    }
    return { stats: dashboardStats(store), antibodies, budgetMs };
}
export function readWorkspaces(store) {
    return store.listWorkspaceProfiles();
}
export function runHygieneAction(store, dryRun = false) {
    return store.repairHygiene({ dryRun });
}
/**
 * Unified v4 read-only insights payload shared by both standalone dashboard and
 * DSH native settings tab. Grounded strictly in real database receipts, hits,
 * suppressions, and guard events (zero synthetic multipliers).
 */
export function readInsights(store, workspace = process.cwd()) {
    const active = store.listAll(false);
    const s = store.stats();
    const receipts = store.receiptSummary(500);
    const guardSummary = store.guardEventSummary(15);
    const totalInjections = active.reduce((sum, r) => sum + Math.max(0, r.hit_count), 0);
    const heldCount = receipts.byOutcome.held ?? 0;
    const failedCount = receipts.byOutcome.failed ?? 0;
    const prevented = s.suppressedRepeats + heldCount + guardSummary.total;
    const observedTotal = Math.max(prevented + failedCount, totalInjections);
    const lockPath = join(workspace, '.immune', 'vaccine.lock.json');
    const lockfile = existsSync(lockPath)
        ? { exists: true, ...verifyVaccineLockfile(readFileSync(lockPath, 'utf8')) }
        : { exists: false, valid: false, reason: 'No .immune/vaccine.lock.json found (run `immune vaccinate`)' };
    return {
        immunityScore: computeImmunityScore({
            totalCalls: observedTotal,
            repeatFailures: prevented,
            avoidableTokens: receipts.estimatedTokensSaved,
            activeRules: active.length,
            totalInjections,
        }),
        diagnosis: diagnoseAgentArchetype(active),
        autopsy: runPitfallAutopsy(active),
        workspaceDna: detectWorkspaceDNA(workspace),
        lockfile,
        guardSummary,
        receipts,
    };
}
/** Shared read-only Pre-Flight Guard evaluator for both UI HTTP endpoints. */
export function evaluateUiGuard(store, payload, opts = {}) {
    const dna = detectWorkspaceDNA(opts.workspace ?? process.cwd());
    const pm = dna.packageManager === 'pnpm' ||
        dna.packageManager === 'yarn' ||
        dna.packageManager === 'bun' ||
        dna.packageManager === 'uv'
        ? dna.packageManager
        : null;
    return evaluatePreFlightGuard(payload, store.listAll(false), {
        toolName: opts.toolName?.trim() || 'Bash',
        strict: opts.strict === true,
        workspacePackageManager: pm,
    });
}
/** Shared read-only Pre-Flight Guard audit ledger query. */
export function readGuardEvents(store, limit = 25) {
    return store.guardEventSummary(limit);
}
/** Shared read-only Swarm Federation preview across local SQLite, shared DB, and `.immune/rules.jsonl`. */
export function readFederationPreview(store, workspace = process.cwd()) {
    const sources = [{ sourceId: 'local-sqlite', rules: store.listAll(false) }];
    const shared = store.sharedAntibodies(200);
    if (shared.length > 0) {
        sources.push({ sourceId: 'shared-library', rules: shared });
    }
    const teamPath = join(workspace, '.immune', 'rules.jsonl');
    if (existsSync(teamPath)) {
        try {
            const teamRules = parseTeamRulesJsonl(readFileSync(teamPath, 'utf8'));
            if (teamRules.length > 0) {
                sources.push({ sourceId: '.immune/rules.jsonl', rules: teamRules });
            }
        }
        catch {
            // Ignore unreadable team rules file in UI preview.
        }
    }
    return federateSwarmRules(sources);
}
const WEEK = 7 * 24 * 60 * 60 * 1000;
const EVOLUTION_WEEKS = 8;
/**
 * Evolution telemetry from what the database actually records. The roadmap's
 * first-try-success-rate and mean-retries curves need per-call outcome history
 * the store does not keep — those are NOT invented here; the panel shows the
 * rule lifecycle the store can prove.
 */
export function evolutionStats(store, now = Date.now()) {
    const weeks = new Array(EVOLUTION_WEEKS).fill(0);
    const bucketOf = (timestamp) => {
        const age = now - timestamp;
        if (age < 0 || age >= EVOLUTION_WEEKS * WEEK)
            return -1;
        return EVOLUTION_WEEKS - 1 - Math.floor(age / WEEK);
    };
    for (const rule of store.listAll(true)) {
        const bucket = bucketOf(rule.created_at);
        if (bucket >= 0)
            weeks[bucket] = (weeks[bucket] ?? 0) + 1;
    }
    const episodeWeeks = new Array(EVOLUTION_WEEKS).fill(0);
    for (const job of store.listJobs(500)) {
        if (job.status !== 'done')
            continue;
        const bucket = bucketOf(job.created_at);
        if (bucket >= 0)
            episodeWeeks[bucket] = (episodeWeeks[bucket] ?? 0) + 1;
    }
    const all = store.listAll(true);
    return {
        newRules: weeks,
        episodes: episodeWeeks,
        lineage: all.filter((rule) => (rule.parent_id ?? 0) > 0).length,
        fromUserCorrection: all.filter((rule) => rule.origin === 'user_correction').length,
        fromSelfHealing: all.filter((rule) => rule.origin === 'self_healing_experiment').length,
        probation: all.filter((rule) => (rule.probation_at ?? 0) > 0 && rule.status === 'active').length,
        supersededByEnv: all.filter((rule) => rule.retire_reason === 'superseded_by_env_upgrade').length,
        detours: store.detourCount(),
    };
}
/** Apply one validated mutation. */
export function applyAction(store, op, id) {
    if (!ACTIONS.has(op) || !Number.isInteger(id) || id <= 0) {
        return { status: 400, body: { error: 'invalid action' } };
    }
    if (op === 'delete') {
        const ok = store.remove(id);
        return ok ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'not found' } };
    }
    const ok = store.setStatus(id, op === 'retire' ? 'retired' : 'active');
    return ok ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'not found' } };
}
