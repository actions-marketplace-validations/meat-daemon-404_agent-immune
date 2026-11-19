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
