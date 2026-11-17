import { DRAIN_BATCH_SIZE, ImmuneRuntime, resolveDrainBudgetMs, } from '../../core/runtime.js';
import { selfMarkers } from './root-marker.js';
export { DRAIN_BATCH_SIZE };
export function drainBudgetMs(env = process.env) {
    return resolveDrainBudgetMs(env);
}
export async function drainJobs(store, budgetMs = drainBudgetMs(), opts = {}) {
    return new ImmuneRuntime(store).drain({
        budgetMs,
        llm: opts.llm,
        selfMarkers: selfMarkers(),
    });
}
