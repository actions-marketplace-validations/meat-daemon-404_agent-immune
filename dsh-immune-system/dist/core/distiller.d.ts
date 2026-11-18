/**
 * Turns one failed-then-fixed episode into an antibody.
 *
 * Two paths:
 *  1. An OpenAI-compatible model, when IMMUNE_LLM_* is configured.
 *  2. A deterministic rule-based fallback, so the loop works with zero
 *     configuration (and stays testable offline).
 *
 * Distillation never throws: a failure here must not cost the user a turn.
 */
import type { DistillResult } from './types.js';
import { type LlmConfig } from './llm.js';
import type { BatchEpisode } from './prompts.js';
/** Pull up to `max` distinct, useful trigger keywords out of the two traces. */
export declare function extractKeywords(text: string, max?: number): string[];
export declare function repairEvidenceOf(successTrace: string, repairs?: string[]): string;
/**
 * Whether a human message is worth storing as a hint.
 *
 * "继续" or "ok" is a turn, not an explanation — attaching it would become a
 * useless prescription ("do: continue"). Only substantive text qualifies.
 */
export declare function isSubstantiveHint(text: string): boolean;
/**
 * Deterministic fallback: build a rule straight from the failed and successful
 * invocations without calling a model.
 */
export declare function ruleDistill(toolName: string, failureTrace: string, successTrace: string, humanHint?: string, repairs?: string[], opts?: {
    projectScope?: string;
    workspaceRoot?: string;
}): DistillResult;
/**
 * Distil one episode into an antibody.
 *
 * Uses the configured model when available and silently degrades to the
 * deterministic rule when the model is missing, slow, or returns junk.
 */
export declare function distillEpisode(toolName: string, failureTrace: string, successTrace: string, opts?: {
    llm?: LlmConfig | null;
    signal?: AbortSignal;
    humanHint?: string;
    repairs?: string[];
    projectScope?: string;
    workspaceRoot?: string;
    reflect?: boolean;
}): Promise<DistillResult>;
/**
 * Distil several episodes in ONE model request.
 *
 * The queue drains at turn end under a time budget, so the per-request latency
 * is what limits throughput: batching four episodes turns four round trips into
 * one. Everything that could go wrong degrades to the deterministic rule per
 * episode, so a malformed or partial batch never loses work.
 *
 * Returns a map keyed by episode id; every input id is present.
 */
export declare function distillBatch(episodes: readonly BatchEpisode[], opts?: {
    llm?: LlmConfig | null;
    signal?: AbortSignal;
}): Promise<Map<number, DistillResult>>;
