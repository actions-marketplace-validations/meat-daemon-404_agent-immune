import type { DatabaseSync } from 'node:sqlite';
import type { Antibody, NewAntibody, RuleQualityGrade } from './types.js';
/** Walk up from `cwd` to the nearest repo/workspace root (stopping before drive/home root). */
export declare function resolveWorkspaceRoot(cwd?: string): string;
/**
 * Stable workspace scope identifier (`proj:<slug>:<hash8>`), or `'*'` when no
 * workspace path is supplied.
 */
export declare function deriveProjectScope(cwd?: string): string;
/** Infer a workspace root path embedded in a legacy rule text, if any. */
export declare function inferScopeFromRuleText(text: string): string | null;
/**
 * Convert machine-specific paths inside text into portable `<repo>/...` or
 * `<path>/basename` placeholders so rules do not leak usernames or drive letters.
 */
export declare function abstractMachinePaths(input: string, workspaceRoot?: string): string;
/**
 * Unwrap raw JSON stdout wrappers or `tool=<name> input=` dumps into a clean,
 * human-readable symptom line.
 */
export declare function canonicalizeSymptom(raw: string, workspaceRoot?: string): string;
export interface QualityVerdict {
    grade: RuleQualityGrade;
    score: number;
    universalEligible: boolean;
    quarantineReason: string | null;
    issues: string[];
}
/**
 * Judge whether a rule is universal `advice`, workspace-scoped `tactic`, or
 * `quarantined` raw noise / echo garbage.
 */
export declare function classifyRuleQuality(ab: Pick<Antibody | NewAntibody, 'trigger_pattern' | 'symptom' | 'prescription' | 'tool_name' | 'repair_path' | 'prescription_source' | 'origin'> & {
    hit_count?: number;
    fail_count?: number;
}): QualityVerdict;
export interface HygieneChange {
    id: number;
    action: 'quarantined' | 'scoped' | 'restored' | 'cleaned_symptom';
    detail: string;
}
export interface HygieneReport {
    scanned: number;
    activeBefore: number;
    activeAfter: number;
    quarantined: number;
    scoped: number;
    restored: number;
    symptomsCleaned: number;
    garbageRateBefore: number;
    garbageRateAfter: number;
    dryRun: boolean;
    changes: HygieneChange[];
}
/**
 * Audit and heal an existing (potentially legacy/polluted) antibody database:
 *  - Assigns inferred `project_scope` to rules containing machine project paths.
 *  - Quarantines echo-grade garbage dumps (`Write: D:\...`, raw JSON stdout, ad-hoc grep).
 *  - Cleans malformed JSON/tool-wrapper symptoms when the rule itself is salvageable.
 *  - Restores valid generic or low-failure-rate rules unjustly retired before Decision #36.
 */
export declare function repairLibraryHygiene(db: DatabaseSync, opts?: {
    dryRun?: boolean;
}): HygieneReport;
