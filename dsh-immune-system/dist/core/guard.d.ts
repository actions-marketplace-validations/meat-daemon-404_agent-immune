import type { DiagnosableRule } from './diagnose.js';
export type GuardSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardDecision = 'allow' | 'warn' | 'rewrite' | 'block';
export type GuardHookHost = 'generic' | 'claude-code' | 'cursor' | 'antigravity' | 'gemini-cli';
export interface GuardMatchedPolicy {
    readonly id: string;
    readonly title: string;
    readonly severity: GuardSeverity;
    readonly blastRadiusScore: number;
    readonly reason: string;
    readonly prescription: string;
    readonly suggestedRewrite: string | null;
    readonly source: 'builtin-policy' | 'workspace-lockfile' | 'learned-antibody';
}
export interface GuardEvaluationOptions {
    readonly toolName?: string;
    readonly strict?: boolean;
    readonly workspacePackageManager?: 'pnpm' | 'yarn' | 'bun' | 'npm' | 'uv' | null;
}
export interface GuardVerdict {
    readonly payload: string;
    readonly toolName: string;
    readonly decision: GuardDecision;
    readonly severity: GuardSeverity;
    readonly blastRadiusScore: number;
    readonly suggestedRewrite: string | null;
    readonly matches: ReadonlyArray<GuardMatchedPolicy>;
    readonly summary: string;
}
export interface BuiltinGuardPolicySpec {
    readonly id: string;
    readonly title: string;
    readonly severity: GuardSeverity;
    readonly blastRadiusScore: number;
    readonly defaultDecision: GuardDecision;
    readonly pattern: RegExp;
    readonly negativePattern?: RegExp;
    readonly shellOnly?: boolean;
    readonly customMatch?: (payload: string) => boolean;
    readonly reason: string;
    readonly prescription: string;
    readonly rewrite?: (payload: string) => string | null;
}
/** Lightweight lockfile probe (<0.05 ms) for live PreToolUse lockfile-drift guard. */
export declare function detectWorkspacePackageManager(workspace?: string): 'pnpm' | 'yarn' | 'bun' | 'uv' | null;
export declare const BUILTIN_GUARD_POLICIES: ReadonlyArray<BuiltinGuardPolicySpec>;
/**
 * Evaluate a proposed tool command or file edit payload before execution.
 */
export declare function evaluatePreFlightGuard(payload: string, learnedRules?: ReadonlyArray<DiagnosableRule>, opts?: GuardEvaluationOptions): GuardVerdict;
/** Render a human-friendly terminal Pre-Flight Guard verdict. */
export declare function renderGuardTerminal(verdict: GuardVerdict): string;
/** Render a GitHub Markdown report for a Pre-Flight Guard evaluation. */
export declare function renderGuardMarkdown(verdict: GuardVerdict): string;
/**
 * Format a PreToolUse hook decision (generic JSON contract).
 */
export declare function renderGuardHookDecision(verdict: GuardVerdict): {
    readonly decision: 'allow' | 'block';
    readonly reason: string;
    readonly blastRadiusScore: number;
    readonly updatedInput?: {
        readonly command: string;
    };
};
/**
 * Format a strict host-schema PreToolUse hook payload without unknown keys (AGENTS.md #2).
 */
export declare function renderGuardHostHookDecision(verdict: GuardVerdict, host?: GuardHookHost): Record<string, unknown>;
/**
 * Render a concise, sanitized `<immune_guard>` banner for live PreToolUse hooks
 * (both warn and deny modes). Includes legacy `(force-push-main)` tag when a
 * force push targets main/master and surfaces deterministic safe rewrites.
 */
export declare function formatLiveGuardBanner(verdict: GuardVerdict): string;
