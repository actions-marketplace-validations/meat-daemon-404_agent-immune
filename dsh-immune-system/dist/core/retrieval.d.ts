/**
 * Hybrid retrieval & bilingual developer concept-expansion graph (v2).
 *
 * Keeps zero runtime dependencies (`node:sqlite` FTS5 trigram + CJK bigram LIKE)
 * while closing semantic synonym gaps across Chinese and English coding prompts
 * (e.g. "跨域" <-> "CORS Access-Control-Allow-Origin", "依赖冲突" <-> "ERESOLVE peer").
 *
 * Concept expansion only triggers when an explicit domain phrase is present,
 * preserving 0% false-positive rate on unrelated natural-language negatives.
 */
import type { Antibody } from './types.js';
/**
 * Expand a user prompt or tool trace with matched domain synonyms (capped to avoid
 * diluting BM25 ranking). Unrelated prompts return the original text unchanged.
 */
export declare function expandConceptQuery(query: string): string;
/**
 * Direct lexical + concept-trigger affinity score in [0, 3+].
 * Rewards rules whose trigger_pattern actually shares meaningful ASCII tokens or
 * CJK bigrams with the (concept-expanded) query, neutralizing BM25 short-field bias.
 */
export declare function lexicalTriggerAffinity(query: string, rule: Pick<Antibody, 'trigger_pattern' | 'symptom' | 'prescription'>): number;
