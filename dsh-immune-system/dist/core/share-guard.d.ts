export type ShareViolationKind = 'machine-path' | 'secret-shaped' | 'email';
export interface ShareViolation {
    /** Rule index in the export set (1-based, matches the rendered row order). */
    rule: number;
    field: string;
    kind: ShareViolationKind;
    /** The offending snippet, itself redacted before display. */
    sample: string;
}
/**
 * Inspect the rules destined for a shareable artifact. The FIRST violation is
 * enough to stop the export; the list lets the operator fix everything at once.
 */
export declare function shareSanityCheck(rules: ReadonlyArray<Pick<AntibodyFields, 'trigger_pattern' | 'symptom' | 'prescription'> & {
    repair_path?: string[];
}>): ShareViolation[];
/** Consistent human-readable summary shared by every blocked export path. */
export declare function formatShareViolations(violations: ReadonlyArray<ShareViolation>): string;
/** Minimal rule shape the AGENTS.md block parser needs. */
interface AntibodyFields {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
}
/**
 * Parse the rules a repository committed into its managed AGENTS.md section.
 * The block is fully replaced on every sync (sync-doc.ts), so the parse is
 * stable; a missing block is an EMPTY rule set, not an error.
 */
export declare function parseManagedBlock(docPath: string): Array<AntibodyFields>;
export interface CiCheckFinding {
    file?: string;
    line: number;
    text: string;
    trigger: string;
    symptom?: string;
    prescription?: string;
}
export interface CiCheckReport {
    addedLines: number;
    rulesConsidered: number;
    findings: CiCheckFinding[];
}
/**
 * Scan diff added lines against the managed-block rules.
 *
 * Improvements in v2.1:
 *  - Parses unified diff `+++ b/<file>` and `@@ -a,b +c,d @@` hunk headers so
 *    findings carry real file paths and line numbers (for GitHub PR annotations).
 *  - Skips changes inside the `<!-- immune:generated -->` block itself so
 *    running `immune sync-doc` never self-triggers CI failure.
 *  - Uses word-boundary + hyphen-safe token matching and requires >=2 matched
 *    trigger tokens (or an unambiguous high-specificity anchor), eliminating
 *    single-word false positives on ordinary `import` / `file` / `url` lines.
 */
export declare function ciCheck(diffText: string, rules: ReadonlyArray<AntibodyFields>, opts?: {
    ignoreFiles?: string[];
}): CiCheckReport;
export {};
