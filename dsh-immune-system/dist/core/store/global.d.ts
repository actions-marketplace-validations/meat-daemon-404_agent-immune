/**
 * Global antibody library.
 *
 * A per-project database keeps unrelated work from bleeding together, but it
 * also means every new project re-learns the same generic pitfalls (edit
 * conflicts, pnpm-vs-npm, Windows quoting). This layer lets an antibody that is
 * provably generic be shared.
 *
 * Design note — why two connections instead of `ATTACH DATABASE`:
 * SQLite documents that a transaction spanning attached databases is not atomic
 * under WAL, and this plugin opens the database from several short-lived hook
 * processes. Two independent connections keep each write a normal single-file
 * transaction; there is no cross-database transaction to lose. The cost is that
 * recall is two queries instead of one, which is irrelevant at this scale.
 */
import type { Antibody } from '../types.js';
/** File name of the shared library next to the per-project database. */
export declare const GLOBAL_DB_FILE = "global.sqlite";
/** Path of the global library that belongs to a given project database. */
export declare function globalDbPathFor(projectDbPath: string): string;
/**
 * A structurally-identical store for the shared library.
 *
 * It reuses the same schema and the same match/insert helpers, so ranking and
 * de-duplication behave exactly as they do per project.
 */
export declare class GlobalStore {
    private db;
    readonly dbPath: string;
    constructor(dbPath: string);
    static existsFor(projectDbPath: string): boolean;
    insert(ab: {
        trigger_pattern: string;
        symptom: string;
        prescription: string;
        tool_name?: string | null;
    }): number | null;
    match(text: string, limit: number): Antibody[];
    /**
     * Count an injection of a shared rule.
     *
     * Without this the shared library would be write-only: `findMatches` is a
     * pure read, so a shared rule could never accumulate hits, never satisfy any
     * hit-based rule, and never be pruned or retired.
     */
    countInjection(ids: number[]): void;
    /** Drop shared rules that were never used and are old enough not to be new. */
    pruneZombies(olderThanMs: number): number[];
    /** Retire them instead — reversible, and the safer default for sharing. */
    retireZombies(olderThanMs: number): number[];
    listAll(includeRetired?: boolean): Antibody[];
    close(): void;
}
/**
 * Whether an antibody deserves to be shared with every project.
 *
 * Two proofs of generality:
 *  - it came from the curated table (`generic` is true), which by definition
 *    carries no project-specific trigger; or
 *  - it names no project-shaped token (a file path, a module path) and has
 *    proven itself by repeated successful injection.
 */
export declare function isPromotable(antibody: {
    trigger_pattern: string;
    prescription: string;
    hit_count?: number;
}, generic: boolean): boolean;
