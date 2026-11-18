import { type BaselineLevel } from './baseline.js';
import type { ImmuneStore } from './store/index.js';
/** Which builtin stacks does this workspace use? File-existence + frontend manifest probe. */
export declare function detectStacks(cwd: string): string[];
export interface PrewarmReport {
    detected: string[];
    /** Packs actually installed by this call (first session only). */
    installed: string[];
    baseline?: BaselineLevel;
}
/**
 * Install every detected stack's seed pack once, scoped by project Baseline.
 * Idempotent across processes: the meta marker is written in the same pass that
 * installs, and installSeedPack's insert-path dedupe keeps the rows correct
 * even if two sessions race on a cold workspace.
 */
export declare function prewarmStacks(store: ImmuneStore, cwd: string, now?: number): PrewarmReport;
