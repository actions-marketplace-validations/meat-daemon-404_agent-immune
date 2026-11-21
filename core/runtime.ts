/**
 * Unified host-agnostic immune runtime engine (v2).
 *
 * Replaces the duplicated orchestration previously spread across `dsh/src/index.ts`
 * (772 lines) and the six `zcode/src/hooks/*.ts` scripts + `drain.ts`.
 * Both DSH (Cordis event listeners) and ZCode / Claude Code / Codex / Antigravity
 * (stdin/stdout hooks) delegate every lifecycle phase here.
 */
import type { Antibody } from './types.js';
import type { DistillJob, ImmuneStore } from './store/index.js';
import { applyDistillResult } from './commit.js';
import { distillBatch, distillEpisode, isSubstantiveHint } from './distiller.js';
import { currentFingerprint } from './env-fingerprint.js';
import {
  detectWorkspacePackageManager,
  evaluatePreFlightGuard,
  formatLiveGuardBanner,
  type GuardVerdict,
} from './guard.js';
import { extractGuardInput, guardMode, type GuardMode } from './guards.js';
import { deriveProjectScope } from './hygiene.js';
import { readLlmConfig, type LlmConfig } from './llm.js';
import { normaliseTargetPath, targetSignature } from './pairing.js';
import { prewarmStacks } from './prewarm.js';
import { isRelated } from './relevance.js';
import { isRepairTool } from './repair-tools.js';
import { looksEchoPrescription } from './rewrite.js';
import { isSelfEpisode } from './selfnoise.js';
import { maybeSleepConsolidate } from './sleep-consolidate.js';
import { stuckHypothesisText } from './store/stuck.js';
import { maybeSyncDocAfterDrain } from './sync-doc.js';
import { isPassiveReadToolName } from './tools.js';
import { hydrateVaccineLockfile } from './vaccine.js';

export const DRAIN_BATCH_SIZE = 4;

/** Canonical 1-60 s clamp shared by every host drain and UI display. */
export function clampBudgetMs(value: number): number {
  return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}

export function resolveDrainBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.IMMUNE_DISTILL_BUDGET_MS ?? '');
  const budget = Number.isFinite(raw) && raw > 0 ? raw : 12_000;
  return clampBudgetMs(budget);
}

export interface DrainSummary {
  processed: number;
  learned: number;
  deferred: number;
  remaining: number;
}

export interface LiveGuardResult {
  mode: Exclude<GuardMode, 'off'>;
  verdict: GuardVerdict;
  banner: string;
  shouldDeny: boolean;
  shouldAsk: boolean;
}

export interface PreToolOutcome {
  denyBanner?: string;
  warnBanner?: string;
  askBanner?: string;
  thrashNote?: string;
  stuckNote?: string;
  guardVerdict?: GuardVerdict;
  recallRows: Antibody[];
}

export class ImmuneRuntime {
  constructor(private readonly store: ImmuneStore) {}

  /** Prepare session state (reset on resume, prune stale, env metabolism, stack prewarm). */
  prepareSessionStart(opts: {
    sessionId: string;
    source?: string;
    workspace?: string;
    prewarm?: boolean;
  }): void {
    const { sessionId, source = '', workspace = process.cwd(), prewarm = false } = opts;
    if (source === 'resume' || source === 'clear' || source === 'compact') {
      this.store.resetTurnState(sessionId);
    }
    this.store.pruneStale();
    try {
      this.store.runEnvMetabolism(workspace);
    } catch {
      // Best-effort bookkeeping.
    }
    try {
      hydrateVaccineLockfile(this.store, workspace);
    } catch {
      // Best-effort verified vaccine lockfile hydration; never break SessionStart.
    }
    if (prewarm && process.env.IMMUNE_PREWARM !== 'off') {
      try {
        prewarmStacks(this.store, workspace);
      } catch {
        // Best-effort bookkeeping.
      }
    }
  }

  /** Select top non-echo active rules matching workspace scope and record their priming delivery. */
  primeSession(sessionId: string, workspace = process.cwd()): Antibody[] {
    const scope = deriveProjectScope(workspace);
    const top = this.store
      .listAll(false)
      .filter(
        (a) =>
          !looksEchoPrescription(a.prescription) &&
          a.quality_grade !== 'quarantined' &&
          (!a.project_scope || a.project_scope === '*' || a.project_scope === scope),
      )
      .slice(0, 3);

    if (top.length > 0) {
      this.store.recordInjection(
        sessionId,
        top.map((a) => a.id),
        top.map((a) => a.prescription),
      );
    }
    return top;
  }

  /** Session startup convenience: prepare + prime in one call. */
  sessionStart(opts: {
    sessionId: string;
    source?: string;
    workspace?: string;
    prewarm?: boolean;
  }): Antibody[] {
    this.prepareSessionStart(opts);
    return this.primeSession(opts.sessionId, opts.workspace);
  }

  /** Prompt submission / pre-step recall with repeat suppression and human hint capture. */
  userPrompt(opts: {
    sessionId: string;
    prompt: string;
    workspace?: string;
    excludeInjected?: boolean;
    suppressRepeats?: boolean;
    limit?: number;
  }): Antibody[] {
    const text = opts.prompt.trim();
    if (!text) return [];
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

  /**
   * Unified live Pre-Flight Guard evaluator shared by every host adapter
   * (ZCode/Claude/Codex/Cursor/Antigravity/Gemini CLI + DSH `tools/pre-execute`).
   *
   * Strictly enforces AGENTS.md #8 (off by default; only code-owned policies
   * and workspace lockfile rules may fire on live execution — never DB text)
   * and AGENTS.md #10 (all persisted audit previews and returned banners are redacted).
   */
  evaluateLiveGuard(opts: {
    sessionId?: string;
    toolName: string;
    toolInput: unknown;
    workspace?: string;
    env?: NodeJS.ProcessEnv;
    /** Set false when the host surface cannot emit warn-only guidance (e.g. DSH PreToolDecision). */
    recordEvent?: boolean;
  }): LiveGuardResult | null {
    const mode = guardMode(opts.env);
    if (mode === 'off') return null;

    const rawInput = extractGuardInput(opts.toolInput);
    if (!rawInput || rawInput.trim().length < 2) return null;

    const pm = detectWorkspacePackageManager(opts.workspace);
    // Learned DB rules are intentionally omitted on live guard evaluation
    // (AGENTS.md #8); they reach the agent as advisory `<immune_memory>`.
    const verdict = evaluatePreFlightGuard(rawInput, [], {
      toolName: opts.toolName,
      strict: false,
      workspacePackageManager: pm,
    });
    if (verdict.decision === 'allow' || verdict.matches.length === 0) return null;

    const banner = formatLiveGuardBanner(verdict);
    const highRisk =
      verdict.decision === 'block' ||
      verdict.decision === 'rewrite' ||
      verdict.severity === 'critical' ||
      verdict.severity === 'high';
    const shouldDeny = mode === 'deny' && highRisk;
    const shouldAsk = mode === 'ask' && highRisk;
    // Record the ENFORCED outcome (not the raw strict recommendation) so
    // `guard_events` never claims a command was blocked when IMMUNE_GUARD=warn.
    const enforcedDecision: GuardVerdict['decision'] = shouldDeny
      ? 'block'
      : verdict.decision === 'rewrite'
        ? 'rewrite'
        : 'warn';

    if (opts.recordEvent !== false) {
      const scope = opts.workspace ? deriveProjectScope(opts.workspace) : '*';
      this.store.recordGuardEvent({
        sessionId: opts.sessionId ?? '',
        toolName: opts.toolName,
        decision: enforcedDecision,
        severity: verdict.severity,
        blastRadius: verdict.blastRadiusScore,
        policyIds: verdict.matches.map((m) => m.id),
        payloadPreview: verdict.payload,
        suggestedRewrite: verdict.suggestedRewrite,
        projectScope: scope,
      });
    }

    return {
      mode,
      verdict,
      banner,
      shouldDeny,
      shouldAsk,
    };
  }

  /** Pre-tool check: probe thrash, antibody recall, stuck hypothesis, unified Pre-Flight Guard. */
  preToolUse(opts: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    workspace?: string;
  }): PreToolOutcome {
    let input = '';
    try {
      input = JSON.stringify(opts.toolInput ?? {});
    } catch {
      input = '';
    }
    if (input.length < 3) return { recallRows: [] };

    const target = targetSignature(opts.toolName, opts.toolInput);
    let thrashNote: string | undefined;
    if (target.probeOnly && this.store.probeStreakCount(opts.sessionId, target.signature) === 2) {
      thrashNote =
        '同一目标已连续探测两次，这是第 3 次：换一条精确命令（grep -n 关键词、单次 Read）通常一步到位。' +
        ' / Third consecutive probe of the same target — one precise command usually lands it.';
    }

    const isPassiveReadTool = isPassiveReadToolName(opts.toolName);
    const recallRows = this.store.match(input, {
      limit: 2,
      sessionId: opts.sessionId,
      toolName: opts.toolName,
      strictToolMatch: isPassiveReadTool,
      cwd: opts.workspace,
    });

    let stuckNote: string | undefined;
    if (
      !target.probeOnly &&
      recallRows.length === 0 &&
      this.store.stuckStreak(opts.sessionId, target.signature) >= 2 &&
      !this.store.wasHypothesized(opts.sessionId, target.signature)
    ) {
      stuckNote = stuckHypothesisText(target.signature);
      this.store.markHypothesized(opts.sessionId, target.signature);
    }

    const guard = this.evaluateLiveGuard({
      sessionId: opts.sessionId,
      toolName: opts.toolName,
      toolInput: opts.toolInput,
      workspace: opts.workspace,
    });
    if (guard) {
      if (guard.shouldDeny) {
        return { denyBanner: guard.banner, guardVerdict: guard.verdict, recallRows };
      }
      if (guard.shouldAsk) {
        return { askBanner: guard.banner, warnBanner: guard.banner, guardVerdict: guard.verdict, thrashNote, stuckNote, recallRows };
      }
      return { warnBanner: guard.banner, guardVerdict: guard.verdict, thrashNote, stuckNote, recallRows };
    }

    return { thrashNote, stuckNote, recallRows };
  }

  /** Settle verified `'held'` receipts at turn end for rules that held up without failure. */
  settleTurn(sessionId: string, workspace?: string): number {
    if (!sessionId) return 0;
    const scope = workspace ? deriveProjectScope(workspace) : '*';
    return this.store.recordHeldReceipts(sessionId, scope);
  }

  /** Post-tool outcome processing: repair action diff, probes/detours, failure/success pairing. */
  postToolUse(opts: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    failed: boolean;
    sandboxDenied?: boolean;
    trace: string;
    workspace?: string;
    selfMarkers?: string[];
    skipProbeBookkeeping?: boolean;
  }): void {
    const {
      sessionId,
      toolName,
      toolInput,
      failed,
      sandboxDenied = false,
      trace,
      workspace = process.cwd(),
      selfMarkers = [],
      skipProbeBookkeeping = false,
    } = opts;
    const scope = deriveProjectScope(workspace);
    const target = targetSignature(toolName, toolInput);

    if (!failed && isRepairTool(toolName) && this.store.hasPendingFailure(sessionId) && !this.store.hasPendingFailure(sessionId, toolName)) {
      const inputObj = (toolInput as Record<string, unknown> | undefined) ?? {};
      const filePath =
        inputObj.file_path ??
        inputObj.path ??
        inputObj.notebook_path ??
        inputObj.TargetFile ??
        inputObj.AbsolutePath ??
        inputObj.Path ??
        '';
      const base =
        typeof filePath === 'string' && filePath.length > 0
          ? filePath.split(/[\\/]/).pop() ?? filePath
          : toolName;
      const relative =
        typeof filePath === 'string' && filePath.length > 0
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
      if (sandboxDenied) return;
      const snapshot = this.store.recordFailure(sessionId, toolName, trace, target.signature);
      if (!target.probeOnly) {
        const covered = this.store
          .peek(snapshot.trace, 3, scope)
          .some((row) => isRelated(row.trigger_pattern, snapshot.trace, toolName));
        if (!covered) this.store.recordStuckFailure(sessionId, target.signature);
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
      const successTrace =
        failure.repair_path.length > 0
          ? `${trace}\nrepair actions: ${failure.repair_path.join(' | ')}`
          : trace;
      const origin = failure.human_hint.trim()
        ? 'user_correction'
        : hypothesized
          ? 'self_healing_experiment'
          : '';
      this.store.enqueueJob(
        toolName,
        failure.trace,
        successTrace,
        failure.injected_ids,
        failure.human_hint,
        failure.repair_path,
        origin,
        scope,
        workspace,
      );
    }
  }

  /** Turn-end budgeted drain + sleep consolidation + optional AGENTS.md sync. */
  async drain(opts: {
    budgetMs?: number;
    llm?: LlmConfig | null;
    selfMarkers?: string[];
    runPostDrainHooks?: boolean;
  } = {}): Promise<DrainSummary> {
    const budgetMs = opts.budgetMs ?? resolveDrainBudgetMs();
    const deadline = Date.now() + budgetMs;
    const selfMarkers = opts.selfMarkers ?? [];
    let processed = 0;
    let learned = 0;
    let deferred = 0;

    this.store.requeueStuckJobs();
    const configured = opts.llm !== undefined ? opts.llm : readLlmConfig();

    const takeUsable = (jobs: DistillJob[]): DistillJob[] => {
      const usable: DistillJob[] = [];
      for (const job of jobs) {
        if (isSelfEpisode(`${job.failure_trace} ${job.success_trace}`, selfMarkers)) {
          this.store.finishJob(job.id, 'skipped', 'self-noise episode (drain-time gate)');
          continue;
        }
        usable.push(job);
      }
      return usable;
    };

    const commit = (
      job: DistillJob,
      result: Awaited<ReturnType<typeof distillEpisode>>,
      extraFallbackReason?: string,
    ): boolean =>
      applyDistillResult(this.store, job, result, {
        fingerprint: currentFingerprint(job.cwd || undefined).key,
        ...(extraFallbackReason ? { extraFallbackReason } : {}),
      });

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const llm = configured && remaining >= configured.timeoutMs ? configured : null;
      const budgetShort = configured !== null && llm === null;
      const backlog = this.store.pendingJobCount();
      const batch = Boolean(llm && backlog >= 2);
      const claimed = takeUsable(this.store.claimJobs(batch ? DRAIN_BATCH_SIZE : 1));
      if (claimed.length === 0) {
        if (this.store.pendingJobCount() === 0) break;
        continue;
      }
      if (budgetShort) deferred += claimed.length;

      const budgetReason = budgetShort
        ? `budget ${budgetMs} ms < llm timeout ${configured?.timeoutMs ?? '?'} ms`
        : undefined;

      if (claimed.length >= 2) {
        try {
          const results = await distillBatch(
            claimed.map((job) => ({
              id: job.id,
              toolName: job.tool_name,
              failedTrace: job.failure_trace,
              fixedTrace: job.success_trace,
              humanHint: job.human_hint ?? '',
              repairs: job.repair_path ?? [],
              projectScope: job.project_scope,
              workspaceRoot: job.cwd,
            })),
            { llm, signal: AbortSignal.timeout(Math.max(1000, remaining)) },
          );
          for (const job of claimed) {
            const result = results.get(job.id);
            if (!result) {
              this.store.finishJob(job.id, 'failed', 'no result from batch');
              continue;
            }
            processed += 1;
            if (commit(job, result, budgetReason)) learned += 1;
          }
        } catch (error) {
          const note = error instanceof Error ? error.message : String(error);
          for (const job of claimed) {
            this.store.finishJob(job.id, 'failed', `batch failed: ${note}`);
          }
        }
        continue;
      }

      const job = claimed[0];
      if (!job) break;
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
        if (commit(job, result, budgetReason)) learned += 1;
      } catch (error) {
        this.store.finishJob(job.id, 'failed', error instanceof Error ? error.message : String(error));
      }
    }

    if (opts.runPostDrainHooks) {
      maybeSyncDocAfterDrain(this.store);
      try {
        maybeSleepConsolidate(this.store);
      } catch {
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
