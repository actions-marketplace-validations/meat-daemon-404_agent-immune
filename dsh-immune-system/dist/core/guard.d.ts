/**
 * v3.0 Pre-Flight Blast-Radius Guard & Destructive Command Interceptor (`immune guard`).
 *
 * Evaluates proposed agent tool invocations (Bash, Edit, Write, Git, SQL)
 * BEFORE execution against built-in catastrophic blast-radius signatures,
 * workspace lockfile constraints, and high-confidence learned antibodies.
 * Computes a 0-100 Blast-Radius Score, emits a deterministic safe command
 * rewrite when possible, and formats hook protocol decisions for Claude Code,
 * Cursor, Codex, and CI gates.
 */
import type { DiagnosableRule } from './diagnose.js';
export type GuardSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardDecision = 'allow' | 'warn' | 'rewrite' | 'block';
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
    readonly reason: string;
    readonly prescription: string;
    readonly rewrite?: (payload: string) => string | null;
}
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
 * Format a PreToolUse hook decision compatible with Claude Code / Cursor hook protocol.
 */
export declare function renderGuardHookDecision(verdict: GuardVerdict): {
    readonly decision: 'allow' | 'block';
    readonly reason: string;
    readonly blastRadiusScore: number;
    readonly updatedInput?: {
        readonly command: string;
    };
};
