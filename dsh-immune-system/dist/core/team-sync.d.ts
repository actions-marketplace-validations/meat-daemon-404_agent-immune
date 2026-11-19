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
}
export interface TeamRuleImportStore {
    insert(input: {
        trigger_pattern: string;
        symptom: string;
        prescription: string;
        tool_name?: string | null;
        prescription_source?: 'llm' | 'heuristic' | 'human';
        origin?: string;
    }): unknown;
}
/** Deterministic 16-hex-char SHA-256 fingerprint of a rule's prescription. */
export declare function canonicalRuleHash(prescription: string): string;
/**
 * Basic privacy and portability check for git-committed team rules:
 * rejects rules containing user home directories, Windows drive paths,
 * email addresses, or credential tokens.
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
/** Parse a `.immune/rules.jsonl` file back into validated records. */
export declare function parseTeamRulesJsonl(raw: string): TeamRuleRecord[];
/** Write sorted team rules to disk (e.g. `.immune/rules.jsonl`), merging with existing rows. */
export declare function writeTeamRulesFile(filePath: string, candidates: ReadonlyArray<TeamSyncCandidate>, opts?: {
    minHits?: number;
}): {
    exported: number;
    skippedUnsafe: number;
};
/**
 * Zero-config SessionStart/Stop hydration: if `.immune/rules.jsonl` exists in
 * the workspace and `IMMUNE_TEAM_SYNC !== 'off'`, idempotently import team rules
 * into the active project store.
 */
export declare function hydrateTeamRules(store: TeamRuleImportStore, workspace?: string, env?: NodeJS.ProcessEnv): {
    imported: number;
    total: number;
    path: string | null;
};
/**
 * Zero-config turn-end auto-export: if `.immune/rules.jsonl` already exists in
 * the workspace (or `IMMUNE_TEAM_SYNC === '1'`) and `IMMUNE_TEAM_SYNC !== 'off'`,
 * merge and export proven share-safe rules back to `.immune/rules.jsonl`.
 */
export declare function maybeSyncTeamRulesAfterDrain(store: {
    listAll(includeQuarantined?: boolean): ReadonlyArray<TeamSyncCandidate>;
}, workspace?: string, env?: NodeJS.ProcessEnv): {
    exported: number;
    skippedUnsafe: number;
    path: string;
} | null;
