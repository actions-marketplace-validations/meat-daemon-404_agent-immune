/**
 * Drain queued distillation jobs — thin wrapper over `core/runtime.ts`.
 */
import type { ImmuneStore } from '../../core/store/index.js';
import type { LlmConfig } from '../../core/llm.js';
import {
  DRAIN_BATCH_SIZE,
  ImmuneRuntime,
  resolveDrainBudgetMs,
  type DrainSummary,
} from '../../core/runtime.js';
import { selfMarkers } from './root-marker.js';

export type DrainResult = DrainSummary;
export { DRAIN_BATCH_SIZE };

export function drainBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolveDrainBudgetMs(env);
}

export async function drainJobs(
  store: ImmuneStore,
  budgetMs = drainBudgetMs(),
  opts: { llm?: LlmConfig | null } = {},
): Promise<DrainResult> {
  return new ImmuneRuntime(store).drain({
    budgetMs,
    llm: opts.llm,
    selfMarkers: selfMarkers(),
  });
}
