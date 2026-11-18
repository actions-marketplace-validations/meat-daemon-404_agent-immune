/**
 * Library snapshots: export / import for cross-machine and team sync.
 *
 * The format is deliberately boring JSON with an explicit format tag, so a
 * future version can refactor the table without breaking old snapshots. Merge
 * semantics are conservative on purpose:
 *
 *  - the prescription is the identity (same rule as the store's own dedupe);
 *  - when both sides know a rule, hit and fail counts take the MAX (a rule used
 *    on two machines has two independent tallies, not two conflicting ones);
 *  - status is active when EITHER side says active — retirement is one
 *    machine's judgement, not a consensus decision;
 *  - rows missing trigger or prescription are counted invalid, not fatal.
 */
import type { ImmuneStore } from './store/index.js';
export declare const SNAPSHOT_FORMAT = "dsh-immune-library";
export declare const SNAPSHOT_VERSION = 1;
export interface SnapshotAntibody {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    hit_count: number;
    fail_count: number;
    status: string;
    tool_name: string | null;
    repair_path?: string[];
    project_scope?: string;
    quality_grade?: string;
    rubric_score?: number;
    root_cause?: string;
    prescription_source?: string;
    origin?: string;
    created_at: number;
}
export interface LibrarySnapshot {
    format: string;
    version: number;
    exported_at: string;
    count: number;
    antibodies: SnapshotAntibody[];
}
export declare function exportLibrary(store: ImmuneStore): LibrarySnapshot;
export interface ImportReport {
    added: number;
    merged: number;
    invalid: number;
}
/**
 * Merge a snapshot into the store. Returns the per-row outcome counts so the
 * caller can report exactly what happened.
 */
export declare function importLibrary(store: ImmuneStore, snapshot: unknown): ImportReport;
