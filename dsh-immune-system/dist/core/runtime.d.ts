/**
 * Unified host-agnostic immune runtime engine (v2).
 *
 * Replaces the duplicated orchestration previously spread across `dsh/src/index.ts`
 * (772 lines) and the six `zcode/src/hooks/*.ts` scripts + `drain.ts`.
 * Both DSH (Cordis event listeners) and ZCode / Claude Code / Codex / Antigravity
 * (stdin/stdout hooks) delegate every lifecycle phase here.
 */
import type { Antibody } from './types.js';
import type { ImmuneStore } from './store/index.js';
import { type GuardVerdict } from './guard.js';
import { type GuardMode } from './guards.js';
import { type LlmConfig } from './llm.js';
export declare const DRAIN_BATCH_SIZE = 4;
/** Canonical 1-60 s clamp shared by every host drain and UI display. */
export declare function clampBudgetMs(value: number): number;
export declare function resolveDrainBudgetMs(env?: NodeJS.ProcessEnv): number;
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
export declare class ImmuneRuntime {
    private readonly store;
    constructor(store: ImmuneStore);
    /** Prepare session state (reset on resume, prune stale, env metabolism, stack prewarm). */
    prepareSessionStart(opts: {
        sessionId: string;
        source?: string;
        workspace?: string;
        prewarm?: boolean;
    }): void;
    /** Select top non-echo active rules matching workspace scope and record their priming delivery. */
    primeSession(sessionId: string, workspace?: string): Antibody[];
    /** Session startup convenience: prepare + prime in one call. */
    sessionStart(opts: {
        sessionId: string;
        source?: string;
        workspace?: string;
        prewarm?: boolean;
    }): Antibody[];
    /** Prompt submission / pre-step recall with repeat suppression and human hint capture. */
    userPrompt(opts: {
        sessionId: string;
        prompt: string;
        workspace?: string;
        excludeInjected?: boolean;
        suppressRepeats?: boolean;
        limit?: number;
    }): Antibody[];
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
    }): LiveGuardResult | null;
    /** Pre-tool check: probe thrash, antibody recall, stuck hypothesis, unified Pre-Flight Guard. */
    preToolUse(opts: {
        sessionId: string;
        toolName: string;
        toolInput: unknown;
        workspace?: string;
    }): PreToolOutcome;
    /** Settle verified `'held'` receipts at turn end for rules that held up without failure. */
    settleTurn(sessionId: string, workspace?: string): number;
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
    }): void;
    /** Turn-end budgeted drain + sleep consolidation + optional AGENTS.md sync. */
    drain(opts?: {
        budgetMs?: number;
        llm?: LlmConfig | null;
        selfMarkers?: string[];
        runPostDrainHooks?: boolean;
    }): Promise<DrainSummary>;
}
