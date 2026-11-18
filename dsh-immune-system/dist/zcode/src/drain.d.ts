/**
 * Drain queued distillation jobs — thin wrapper over `core/runtime.ts`.
 */
import type { ImmuneStore } from '../../core/store/index.js';
import type { LlmConfig } from '../../core/llm.js';
import { DRAIN_BATCH_SIZE, type DrainSummary } from '../../core/runtime.js';
export type DrainResult = DrainSummary;
export { DRAIN_BATCH_SIZE };
export declare function drainBudgetMs(env?: NodeJS.ProcessEnv): number;
export declare function drainJobs(store: ImmuneStore, budgetMs?: number, opts?: {
    llm?: LlmConfig | null;
}): Promise<DrainResult>;
