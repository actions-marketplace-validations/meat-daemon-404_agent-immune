import { applyDistillResult } from './commit.js';
import { distillBatch, distillEpisode, isSubstantiveHint } from './distiller.js';
import { currentFingerprint } from './env-fingerprint.js';
import { findGuardHit, guardMode } from './guards.js';
import { deriveProjectScope } from './hygiene.js';
import { readLlmConfig } from './llm.js';
import { normaliseTargetPath, targetSignature } from './pairing.js';
import { prewarmStacks } from './prewarm.js';
import { redact } from './redact.js';
import { isRelated } from './relevance.js';
import { isRepairTool } from './repair-tools.js';
import { looksEchoPrescription } from './rewrite.js';
import { isSelfEpisode } from './selfnoise.js';
import { maybeSleepConsolidate } from './sleep-consolidate.js';
import { stuckHypothesisText } from './store/stuck.js';
import { maybeSyncDocAfterDrain } from './sync-doc.js';
export const DRAIN_BATCH_SIZE = 4;
/** Canonical 1-60 s clamp shared by every host drain and UI display. */
export function clampBudgetMs(value) {
    return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}
export function resolveDrainBudgetMs(env = process.env) {
    const raw = Number(env.IMMUNE_DISTILL_BUDGET_MS ?? '');
    const budget = Number.isFinite(raw) && raw > 0 ? raw : 12_000;
    return clampBudgetMs(budget);
}
export class ImmuneRuntime {
    store;
    constructor(store) {
        this.store = store;
    }
    /** Prepare session state (reset on resume, prune stale, env metabolism, stack prewarm). */
    prepareSessionStart(opts) {
        const { sessionId, source = '', workspace = process.cwd(), prewarm = false } = opts;
        if (source === 'resume' || source === 'clear' || source === 'compact') {
            this.store.resetTurnState(sessionId);
        }
        this.store.pruneStale();
        try {
            this.store.runEnvMetabolism(workspace);
        }
        catch {
            // Best-effort bookkeeping.
        }
        if (prewarm && process.env.IMMUNE_PREWARM !== 'off') {
            try {
                prewarmStacks(this.store, workspace);
            }
            catch {
                // Best-effort bookkeeping.
            }
        }
    }
    /** Select top non-echo active rules matching workspace scope and record their priming delivery. */
    primeSession(sessionId, workspace = process.cwd()) {
        const scope = deriveProjectScope(workspace);
        const top = this.store
            .listAll(false)
            .filter((a) => !looksEchoPrescription(a.prescription) &&
            a.quality_grade !== 'quarantined' &&
            (!a.project_scope || a.project_scope === '*' || a.project_scope === scope))
            .slice(0, 3);
        if (top.length > 0) {
            this.store.recordInjection(sessionId, top.map((a) => a.id), top.map((a) => a.prescription));
        }
        return top;
    }
    /** Session startup convenience: prepare + prime in one call. */
    sessionStart(opts) {
        this.prepareSessionStart(opts);
        return this.primeSession(opts.sessionId, opts.workspace);
    }
    /** Prompt submission / pre-step recall with repeat suppression and human hint capture. */
    userPrompt(opts) {
        const text = opts.prompt.trim();
        if (!text)
            return [];
        if (isSubstantiveHint(text)) {
            this.store.attachHumanHint(opts.sessionId, text);
        }
        return this.store.match(text, {
            limit: opts.limit ?? 3,
            sessionId: opts.sessionId,
            cwd: opts.workspace,
            excludeInjected: opts.excludeInjected,
            suppressRepeats: opts.suppressRepeats,
        });
    }
    /** Pre-tool check: probe thrash, antibody recall, stuck hypothesis, deterministic guard. */
    preToolUse(opts) {
        let input = '';
        try {
            input = JSON.stringify(opts.toolInput ?? {});
        }
        catch {
            input = '';
        }
        if (input.length < 3)
            return { recallRows: [] };
        const target = targetSignature(opts.toolName, opts.toolInput);
        let thrashNote;
        if (target.probeOnly && this.store.probeStreakCount(opts.sessionId, target.signature) === 2) {
            thrashNote =
                '同一目标已连续探测两次，这是第 3 次：换一条精确命令（grep -n 关键词、单次 Read）通常一步到位。' +
                    ' / Third consecutive probe of the same target — one precise command usually lands it.';
        }
        const isPassiveReadTool = /^(?:read|glob|grep)$/i.test(opts.toolName);
        const recallRows = this.store.match(input, {
            limit: 2,
            sessionId: opts.sessionId,
            toolName: opts.toolName,
            strictToolMatch: isPassiveReadTool,
            cwd: opts.workspace,
        });
        let stuckNote;
        if (!target.probeOnly &&
            recallRows.length === 0 &&
            this.store.stuckStreak(opts.sessionId, target.signature) >= 2 &&
            !this.store.wasHypothesized(opts.sessionId, target.signature)) {
            stuckNote = stuckHypothesisText(target.signature);
            this.store.markHypothesized(opts.sessionId, target.signature);
        }
        const mode = guardMode();
        if (mode !== 'off') {
            const inspected = redact(input).slice(0, 2000);
            const hit = findGuardHit(inspected);
            if (hit) {
                const banner = `<immune_guard>\n[${hit.rule.id}] ${hit.rule.what}\n` +
                    `请改用：${hit.rule.instead}\n</immune_guard>`;
                if (mode === 'deny') {
                    return { denyBanner: banner, recallRows };
                }
                return { warnBanner: banner, thrashNote, stuckNote, recallRows };
            }
        }
        return { thrashNote, stuckNote, recallRows };
    }
    /** Post-tool outcome processing: repair action diff, probes/detours, failure/success pairing. */
    postToolUse(opts) {
        const { sessionId, toolName, toolInput, failed, sandboxDenied = false, trace, workspace = process.cwd(), selfMarkers = [], skipProbeBookkeeping = false, } = opts;
        const scope = deriveProjectScope(workspace);
        const target = targetSignature(toolName, toolInput);
        if (!failed && isRepairTool(toolName) && this.store.hasPendingFailure(sessionId) && !this.store.hasPendingFailure(sessionId, toolName)) {
            const inputObj = toolInput ?? {};
            const filePath = inputObj.file_path ??
                inputObj.path ??
                inputObj.notebook_path ??
                inputObj.TargetFile ??
                inputObj.AbsolutePath ??
                inputObj.Path ??
                '';
            const base = typeof filePath === 'string' && filePath.length > 0
                ? filePath.split(/[\\/]/).pop() ?? filePath
                : toolName;
            const relative = typeof filePath === 'string' && filePath.length > 0
                ? normaliseTargetPath(filePath, workspace)
                : '';
            this.store.recordRepairAction(sessionId, `${toolName} ${relative || base}`);
        }
        if (!skipProbeBookkeeping) {
            if (!target.probeOnly && !failed) {
                const detourStreak = this.store.topProbeStreak(sessionId, this.store.detourMinProbes);
                if (detourStreak) {
                    this.store.recordDetour(sessionId, detourStreak.signature, detourStreak.count);
                }
            }
            this.store.recordProbeOutcome(sessionId, target.probeOnly ? target.signature : null);
        }
        if (failed) {
            if (sandboxDenied)
                return;
            const snapshot = this.store.recordFailure(sessionId, toolName, trace, target.signature);
            if (!target.probeOnly) {
                const covered = this.store
                    .peek(snapshot.trace, 3, scope)
                    .some((row) => isRelated(row.trigger_pattern, snapshot.trace, toolName));
                if (!covered)
                    this.store.recordStuckFailure(sessionId, target.signature);
            }
            this.store.penalize(snapshot.injected_ids, {
                failureText: snapshot.trace,
                toolName,
                sessionId,
                projectScope: scope,
            });
            return;
        }
        const failure = this.store.claimFailure(sessionId, toolName, target);
        const hypothesized = this.store.wasHypothesized(sessionId, target.signature);
        this.store.clearStuck(sessionId, target.signature);
        if (failure && !isSelfEpisode(`${failure.trace} ${trace}`, selfMarkers)) {
            const successTrace = failure.repair_path.length > 0
                ? `${trace}\nrepair actions: ${failure.repair_path.join(' | ')}`
                : trace;
            const origin = failure.human_hint.trim()
                ? 'user_correction'
                : hypothesized
                    ? 'self_healing_experiment'
                    : '';
            this.store.enqueueJob(toolName, failure.trace, successTrace, failure.injected_ids, failure.human_hint, failure.repair_path, origin, scope, workspace);
        }
    }
    /** Turn-end budgeted drain + sleep consolidation + optional AGENTS.md sync. */
    async drain(opts = {}) {
        const budgetMs = opts.budgetMs ?? resolveDrainBudgetMs();
        const deadline = Date.now() + budgetMs;
        const selfMarkers = opts.selfMarkers ?? [];
        let processed = 0;
        let learned = 0;
        let deferred = 0;
        this.store.requeueStuckJobs();
        const configured = opts.llm !== undefined ? opts.llm : readLlmConfig();
        const takeUsable = (jobs) => {
            const usable = [];
            for (const job of jobs) {
                if (isSelfEpisode(`${job.failure_trace} ${job.success_trace}`, selfMarkers)) {
                    this.store.finishJob(job.id, 'skipped', 'self-noise episode (drain-time gate)');
                    continue;
                }
                usable.push(job);
            }
            return usable;
        };
        const commit = (job, result, extraFallbackReason) => applyDistillResult(this.store, job, result, {
            fingerprint: currentFingerprint(job.cwd || undefined).key,
            ...(extraFallbackReason ? { extraFallbackReason } : {}),
        });
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                break;
            const llm = configured && remaining >= configured.timeoutMs ? configured : null;
            const budgetShort = configured !== null && llm === null;
            const backlog = this.store.pendingJobCount();
            const batch = Boolean(llm && backlog >= 2);
            const claimed = takeUsable(this.store.claimJobs(batch ? DRAIN_BATCH_SIZE : 1));
            if (claimed.length === 0) {
                if (this.store.pendingJobCount() === 0)
                    break;
                continue;
            }
            if (budgetShort)
                deferred += claimed.length;
            const budgetReason = budgetShort
                ? `budget ${budgetMs} ms < llm timeout ${configured?.timeoutMs ?? '?'} ms`
                : undefined;
            if (claimed.length >= 2) {
                try {
                    const results = await distillBatch(claimed.map((job) => ({
                        id: job.id,
                        toolName: job.tool_name,
                        failedTrace: job.failure_trace,
                        fixedTrace: job.success_trace,
                        humanHint: job.human_hint ?? '',
                        repairs: job.repair_path ?? [],
                        projectScope: job.project_scope,
                        workspaceRoot: job.cwd,
                    })), { llm, signal: AbortSignal.timeout(Math.max(1000, remaining)) });
                    for (const job of claimed) {
                        const result = results.get(job.id);
                        if (!result) {
                            this.store.finishJob(job.id, 'failed', 'no result from batch');
                            continue;
                        }
                        processed += 1;
                        if (commit(job, result, budgetReason))
                            learned += 1;
                    }
                }
                catch (error) {
                    const note = error instanceof Error ? error.message : String(error);
                    for (const job of claimed) {
                        this.store.finishJob(job.id, 'failed', `batch failed: ${note}`);
                    }
                }
                continue;
            }
            const job = claimed[0];
            if (!job)
                break;
            try {
                const result = await distillEpisode(job.tool_name, job.failure_trace, job.success_trace, {
                    llm,
                    signal: AbortSignal.timeout(Math.max(1000, remaining)),
                    humanHint: job.human_hint ?? '',
                    repairs: job.repair_path ?? [],
                    projectScope: job.project_scope,
                    workspaceRoot: job.cwd,
                });
                processed += 1;
                if (commit(job, result, budgetReason))
                    learned += 1;
            }
            catch (error) {
                this.store.finishJob(job.id, 'failed', error instanceof Error ? error.message : String(error));
            }
        }
        if (opts.runPostDrainHooks) {
            maybeSyncDocAfterDrain(this.store);
            try {
                maybeSleepConsolidate(this.store);
            }
            catch {
                // Best-effort turn-end sleep scan.
            }
        }
        return {
            processed,
            learned,
            deferred,
            remaining: this.store.pendingJobCount(),
        };
    }
}
