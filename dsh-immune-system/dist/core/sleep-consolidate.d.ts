import type { ImmuneStore } from './store/index.js';
/** Minimum time between consolidation scans. */
export declare const SLEEP_COOLDOWN_MS: number;
/** A cluster this big deserves the operator's attention. */
export declare const SLEEP_MIN_CLUSTER = 5;
export interface SleepConsolidationReport {
    /** False when the cooldown held and nothing ran. */
    ran: boolean;
    /** Clusters of SLEEP_MIN_CLUSTER+ same-lesson rules awaiting `immune consolidate`. */
    reviewGroups: number;
    lastRun: number;
}
/**
 * One bounded consolidation scan. Read-only over the rules; the only writes
 * are two meta keys. Never throws into the hook.
 */
export declare function maybeSleepConsolidate(store: ImmuneStore, env?: NodeJS.ProcessEnv, now?: number): SleepConsolidationReport | null;
/** The queued review count for `immune stats` (0 when no scan has run yet). */
export declare function sleepReviewGroupsOf(store: ImmuneStore): number;
