import type { ImmuneStore } from './store/index.js';
export declare const SECTION_START = "<!-- immune:generated start -->";
export declare const SECTION_END = "<!-- immune:generated end -->";
export interface SyncDocOptions {
    /** Target file; created when missing. */
    file: string;
    /** Minimum hit count for a rule to be written (default 3). */
    minHits?: number;
    /** Heading level inside the section. */
    heading?: string;
}
export interface SyncDocReport {
    file: string;
    rules: number;
    skipped: number;
    created: boolean;
    replaced: boolean;
}
/** Build the managed section body from the store's proven, share-safe rules. */
export declare function buildDocSection(store: ImmuneStore, minHits: number, heading: string, projectScope?: string): string;
/** Create or replace the managed section in the target doc. */
export declare function syncDoc(store: ImmuneStore, opts: SyncDocOptions): SyncDocReport;
/**
 * Opt-in turn-end auto sync: when `IMMUNE_SYNC_DOC` names a file (or is a
 * truthy non-path like "1", meaning AGENTS.md next to the project root), the
 * drain calls this after distilling, so freshly learned rules reach the docs
 * the same turn. Never throws — a read-only project or a bad path must not
 * cost the user their turn.
 */
export declare function maybeSyncDocAfterDrain(store: ImmuneStore, env?: NodeJS.ProcessEnv): SyncDocReport | null;
