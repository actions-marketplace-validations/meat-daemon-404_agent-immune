import type { DatabaseSync } from 'node:sqlite';
import type { Antibody, AntibodyStatus, NewAntibody } from '../types.js';
/** An antibody is retired after this many injected-but-still-failed episodes. */
export declare const RETIRE_AFTER_FAILURES = 3;
/**
 * …and only if that many failures is a real share of its deliveries.
 */
export declare const RETIRE_FAILURE_RATE = 0.25;
/** True when the evidence says this rule is noise rather than occasionally unlucky. */
export declare function shouldRetire(hitCount: number, failCount: number): boolean;
/** Prescriptions at or above this similarity are the same rule. */
export declare const MERGE_THRESHOLD = 0.7;
/** Where a new rule came from; decides whether it may overwrite existing text. */
export interface InsertOptions {
    /** Distilled from a human correction — the highest-authority source. */
    humanHint?: boolean;
    /** Distilled by the model (as opposed to the deterministic rule path). */
    fromLlm?: boolean;
    /**
     * Idempotent hydration mode (team-sync / vaccine lockfile import):
     * if an exact or near-duplicate rule already exists, return `null` without
     * incrementing `hit_count` or mutating existing counters (AGENTS.md #9).
     */
    skipIfExists?: boolean;
}
/**
 * Union the incoming trigger into the stored one, keeping every recall path
 * the rule has earned.
 */
export declare function mergeTriggers(existing: string, incoming: string): string | null;
/** One rule by id, or null. Read-only. */
export declare function getAntibodyById(db: DatabaseSync, id: number): Antibody | null;
/**
 * ROADMAP 2.2 — mutate an injected-but-still-failed rule into a refined child.
 */
export declare function mutateRule(db: DatabaseSync, parentId: number, incomingTokens: string, evidence?: {
    repairPath?: string[];
    humanHint?: string;
}): number | null;
export declare function insertAntibody(db: DatabaseSync, ab: NewAntibody, options?: InsertOptions): number | null;
/**
 * Rank active antibodies against free text, scoped by workspace and expanded
 * via the bilingual developer concept graph.
 */
export declare function findMatches(db: DatabaseSync, text: string, limit: number, projectScope?: string): Antibody[];
/** Bump hit counters for injected antibodies. */
export declare function bumpHits(db: DatabaseSync, ids: number[]): void;
/** Record single-shot shared-library promotion timestamp so hot-path matches never re-open global.sqlite. */
export declare function markPromoted(db: DatabaseSync, id: number, now?: number): void;
export declare function listAntibodies(db: DatabaseSync, includeRetired?: boolean): Antibody[];
export declare function removeAntibody(db: DatabaseSync, id: number): boolean;
export declare function setAntibodyStatus(db: DatabaseSync, id: number, status: AntibodyStatus, retireReason?: string): boolean;
export interface PenaltyContext {
    failureText: string;
    toolName: string;
    sessionId?: string;
    projectScope?: string;
}
/**
 * Red-3 Triaged Anti-Rot: classifies post-injection failure before penalizing
 * or retiring a rule, preventing flake/scope-leak/ignored invariants from killing
 * healthy rules.
 */
export declare function penalizeAntibodies(db: DatabaseSync, ids: number[], ctx?: PenaltyContext): {
    retired: Antibody[];
    penalized: number[];
};
/** Antibodies worth sharing: proven by repeated successful injection. */
export declare function exportableAntibodies(db: DatabaseSync, minHits: number, projectScope?: string): Antibody[];
export declare function setPrescription(db: DatabaseSync, id: number, prescription: string, source: 'rule' | 'llm' | 'human' | 'host_llm'): boolean;
export declare function consolidateAntibodies(db: DatabaseSync, keepId: number, input: {
    trigger: string;
    hitCount: number;
    failCount: number;
    repairs: string[];
    retireIds: number[];
}): void;
export declare function newestActiveId(db: DatabaseSync): number | null;
export declare function retireZombieAntibodies(db: DatabaseSync, olderThanMs: number): number[];
export declare function pruneZombieAntibodies(db: DatabaseSync, olderThanMs: number): number[];
