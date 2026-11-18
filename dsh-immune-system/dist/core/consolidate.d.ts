/**
 * Consolidate repeated lessons without changing their evidence.
 *
 * The normal insert path catches exact and near-identical prescriptions, but a
 * model rewrite can leave two useful wordings of one lesson apart. This is the
 * explicit operator action for that case: same normalized symptom + same tool
 * are grouped, then every pair must pass the same prescription threshold and
 * share a trigger token. Similar symptoms alone are NOT enough to merge.
 *
 * The keeper is the most proven rule (hits, then older id). Its wording stays;
 * the trigger union widens recall; counters, repairs and model attribution are
 * carried over. Retirees are retired, not deleted, so they remain recoverable.
 */
import type { ImmuneStore } from './store/index.js';
import type { Antibody } from './types.js';
/**
 * Prescription similarity required before two rules may merge. The CLI's
 * "same symptom, different wording" report must use the SAME number, or the
 * display disagrees with what the tool would actually merge.
 */
export declare const CONSOLIDATE_SIMILARITY = 0.7;
/**
 * ROADMAP 2.4b: the pairwise similarity sample size for findLessonGroups.
 * Measured on a worst-case 300-member single group: full pairwise = 616 ms,
 * sampled (top-20 members, <=190 pairs) = single-digit ms. The apply path is
 * unaffected.
 */
export declare const MAX_SIMILARITY_SAMPLE = 20;
export interface ConsolidationCandidate {
    keepId: number;
    retireId: number;
    similarity: number;
    keepPrescription: string;
    retirePrescription: string;
    keepHits: number;
    retireHits: number;
    symptom: string;
}
export interface ConsolidationResult {
    /** Duplicate rules retired, once each. */
    retired: number;
    /** Pairs in the proposed groups; retired.length <= merged.length. */
    merged: ConsolidationCandidate[];
}
/** Normalized grouping key: wording case/whitespace must not split one lesson, nor merge across distinct workspaces. */
export declare function lessonKey(rule: Pick<Antibody, 'symptom' | 'tool_name' | 'project_scope'>): string;
/**
 * Plan the groups first, so dry-run and apply see exactly the same candidates.
 * Pairwise greedy grouping avoids requiring every paraphrase to score against
 * the keeper's wording; a pair still needs both a high score and shared trigger.
 */
export declare function findConsolidationCandidates(store: ImmuneStore): ConsolidationCandidate[];
export interface LessonGroup {
    key: string;
    symptom: string;
    rules: Array<{
        id: number;
        hits: number;
        prescription: string;
    }>;
    /** Best pairwise prescription similarity inside the group. */
    maxSimilarity: number;
}
/**
 * Rules that share a symptom but did not clear the merge bar.
 *
 * This exists because the honest answer to a real library was "no candidates":
 * five rules taught the same lesson in different words (and one in English),
 * and text similarity cannot see that. Reporting the group lets a person decide
 * instead of the tool either merging blindly or staying silent.
 */
export declare function findLessonGroups(store: ImmuneStore): LessonGroup[];
/** Apply a previously reviewed candidate list, or all current candidates. */
export declare function consolidateRules(store: ImmuneStore, candidates?: ConsolidationCandidate[]): ConsolidationResult;
