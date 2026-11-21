export interface TeamRuleRecord {
    readonly hash: string;
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name: string | null;
}
export interface TeamSyncCandidate {
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name?: string | null;
    readonly hit_count?: number;
    readonly status?: string;
    readonly project_scope?: string;
}
export interface TeamRuleImportStore {
    insert(input: {
        trigger_pattern: string;
        symptom: string;
        prescription: string;
        tool_name?: string | null;
        prescription_source?: 'llm' | 'heuristic' | 'human';
        origin?: string;
    }, opts?: {
        skipIfExists?: boolean;
    }): unknown;
}
/** Deterministic 16-hex-char SHA-256 fingerprint of a rule's prescription. */
export declare function canonicalRuleHash(prescription: string): string;
/**
 * Canonical privacy and portability gate for git-committed team rules:
 * delegates to `shareSanityCheck` so every secret format (OpenAI/Anthropic/AWS/
 * GitHub/PEM/JWT/URL credentials), user/drive/UNC path, and real email address
 * is caught consistently across all sharing surfaces without rejecting `@2x.png`.
 */
export declare function isTeamShareSafe(rule: TeamSyncCandidate): boolean;
/** Convert candidate rules into deterministically sorted JSONL text. */
export declare function serializeTeamRulesJsonl(candidates: ReadonlyArray<TeamSyncCandidate>, opts?: {
    minHits?: number;
}): {
    jsonl: string;
    exported: number;
    skippedUnsafe: number;
};
/** Parse a `.immune/rules.jsonl` file back into validated records (auto-stripping Git conflict markers). */
export declare function parseTeamRulesJsonl(raw: string): TeamRuleRecord[];
/** Write sorted team rules to disk (e.g. `.immune/rules.jsonl`), merging with existing rows. */
export declare function writeTeamRulesFile(filePath: string, candidates: ReadonlyArray<TeamSyncCandidate>, opts?: {
    minHits?: number;
    replace?: boolean;
}): {
    exported: number;
    skippedUnsafe: number;
};
/**
 * Zero-config SessionStart/Stop hydration: if `.immune/rules.jsonl` exists in
 * the workspace and `IMMUNE_TEAM_SYNC !== 'off'`, idempotently import team rules
 * into the active project store without inflating `hit_count` on duplicates.
 */
export declare function hydrateTeamRules(store: TeamRuleImportStore, workspace?: string, env?: NodeJS.ProcessEnv): {
    imported: number;
    total: number;
    path: string | null;
};
/**
 * Zero-config turn-end auto-export: if `.immune/rules.jsonl` already exists in
 * the workspace (or `IMMUNE_TEAM_SYNC === '1'`) and `IMMUNE_TEAM_SYNC !== 'off'`,
 * merge and export proven share-safe rules scoped to this workspace back to `.immune/rules.jsonl`.
 */
export declare function maybeSyncTeamRulesAfterDrain(store: {
    listAll(includeQuarantined?: boolean): ReadonlyArray<TeamSyncCandidate>;
}, workspace?: string, env?: NodeJS.ProcessEnv): {
    exported: number;
    skippedUnsafe: number;
    path: string;
} | null;
export interface TeamRulesCheckReport {
    readonly valid: boolean;
    readonly total: number;
    readonly unsorted: boolean;
    readonly duplicates: number;
    readonly unsafeCount: number;
    readonly conflictMarkers: boolean;
    readonly malformedLines: number;
    readonly hashMismatches: number;
}
/**
 * Audit a `.immune/rules.jsonl` payload for CI gates (`immune team-sync --check`):
 * detects git merge conflict markers, malformed JSON lines, forged/mismatched
 * prescription hashes, unsorted hashes, duplicate hashes, and unsafe paths/secrets.
 */
export declare function verifyTeamRulesJsonl(raw: string): TeamRulesCheckReport;
