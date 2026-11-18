/**
 * Builtin seed packs (`immune seed <pack>`): curated starter rules, installed
 * through the SAME insert path as live learning, so near-duplicates of the
 * user's own rules merge instead of doubling, and every row records which
 * pack it came from. Removal is conservative: a recorded row is deleted only
 * when its prescription still matches what the pack seeded — a rule the user
 * has since edited, merged, or had rewritten carries its own evidence now and
 * is kept (and the report says so).
 */
import type { DatabaseSync } from 'node:sqlite';
export interface SeedRule {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    tool_name?: string | null;
}
export interface SeedInstallReport {
    pack: string;
    /** Rules newly inserted (or merged into an existing row). */
    inserted: number;
    /** Rules already recorded for this pack (a repeat `seed` is a no-op). */
    alreadySeeded: number;
}
export interface SeedRemoveReport {
    pack: string;
    removed: number;
    /** Recorded rows whose prescription changed since seeding — evidence kept. */
    keptChanged: number;
    /** Recorded rows that have been delivered since seeding — evidence kept. */
    keptProven: number;
}
export declare function installSeedPack(db: DatabaseSync, pack: string, rules: SeedRule[]): SeedInstallReport;
export declare function removeSeedPack(db: DatabaseSync, pack: string): SeedRemoveReport;
/** Per-pack counts of still-recorded seed rows, for the list view. */
export declare function seededPackCounts(db: DatabaseSync): Map<string, number>;
