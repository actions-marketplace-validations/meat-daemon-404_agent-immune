/**
 * Structured 5-dimension quality rubric & causal root-cause classifier (v2).
 *
 * Inspired by InterviewAI v2's deterministic rubric calibration:
 *   total = specificity (20) + actionability (25) + portability (25)
 *         + evidenceStrength (15) + leakSafety (15) = 0..100.
 *
 * Every distilled, seeded, rewritten, or disk-ingested rule is scored so low-quality
 * raw command dumps and leaked machine paths are quantified and blocked rather than
 * blindly injected 1,000+ times across unrelated repositories.
 */
import type { Antibody, NewAntibody, RootCauseType } from './types.js';
export interface RubricScore {
    total: number;
    specificity: number;
    actionability: number;
    portability: number;
    evidenceStrength: number;
    leakSafety: number;
    issues: string[];
}
/** Infer causal root cause from error + repair signals. */
export declare function inferRootCause(symptomOrError: string, prescription: string, repairs?: readonly string[]): RootCauseType;
/**
 * Compute the deterministic 5-dimension rubric score for any rule candidate.
 * Calibration guarantees:
 *  - Clean generalized advice (`Edit: re-read...`, LLM-distilled rules) scores >= 80.
 *  - Clean scoped command tactics (`npm run build -> npx tsc`) score 55..75.
 *  - Raw command/path/JSON dumps (`Write: D:\...`, `{"stdout":...}`) score < 45.
 */
export declare function scoreAntibodyRubric(rule: Pick<Antibody | NewAntibody, 'trigger_pattern' | 'symptom' | 'prescription' | 'tool_name' | 'repair_path' | 'prescription_source' | 'origin'> & {
    hit_count?: number;
    fail_count?: number;
}): RubricScore;
