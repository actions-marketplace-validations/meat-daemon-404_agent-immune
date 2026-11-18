/**
 * Curated generic lessons.
 *
 * Live evidence: the SAME pitfall was learned once per file — "file modified
 * since read" produced a separate antibody for HANDOFF-DSH.md, format.ts and
 * core.test.mjs, each occupying an injection slot for the same lesson.
 *
 * A generic pitfall deserves a generic trigger: when a distilled symptom
 * matches one of these patterns, the per-file keywords are dropped and the
 * generic rule is stored instead. The store's prescription-level dedupe then
 * merges every later instance into that one row, so the lesson accumulates
 * hits instead of multiplying.
 */
export interface GenericLesson {
    /** Matches the extracted symptom text. */
    match: RegExp;
    /** Stable, compact trigger that recalls the lesson regardless of file. */
    trigger: string;
    /** Both languages, kept short for the injection clamp. */
    symptom: string;
    prescription: string;
}
export declare const GENERIC_LESSONS: readonly GenericLesson[];
/** The first generic lesson matching `symptomText`, or null. */
export declare function matchGenericLesson(symptomText: string): GenericLesson | null;
