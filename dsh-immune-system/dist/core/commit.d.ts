import type { ImmuneStore, DistillJob } from './store/index.js';
import type { DistillResult } from './types.js';
export interface ApplyDistillOptions {
    /** Workspace fingerprint stamped onto the project row (ROADMAP 3.1). */
    fingerprint?: string;
    /**
     * A model-path degradation observed by the CALLER (the ZCode budget path
     * skips the model up front and reports that here), folded into the same
     * fallback counter and job note as an in-flight degradation.
     */
    extraFallbackReason?: string;
}
/**
 * Persist one distillation result for its job. Returns true when the episode
 * learned (a rule was stored or merged).
 */
export declare function applyDistillResult(store: ImmuneStore, job: DistillJob, result: DistillResult, opts?: ApplyDistillOptions): boolean;
