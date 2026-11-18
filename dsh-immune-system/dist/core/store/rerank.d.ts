/**
 * Second-stage ranking for recall (v2).
 *
 * Combines retrieval relevance, hit-count log scaling, path affinity,
 * rubric quality boost, shared-library discount, and time decay.
 */
import type { Antibody } from '../types.js';
export interface RerankOptions {
    /** The current prompt or tool input, used to detect path affinity. */
    query: string;
    /** Working directory, to normalise paths if needed. */
    cwd?: string;
    /** Ids that came from the shared library (they get a discount). */
    sharedIds?: ReadonlySet<number>;
    /** Shared-library candidates by object identity (safe across colliding DB ids). */
    sharedSet?: ReadonlySet<Antibody>;
    /** Retriever relevance as id -> score in (0, 1]. */
    relevance?: ReadonlyMap<number, number>;
    /** Retriever relevance by candidate object identity. */
    relevanceByRule?: ReadonlyMap<Antibody, number>;
    /** Injected by the caller for tests. */
    now?: number;
}
/** Exponential-free decay: halves in usefulness only after ~25 days. */
export declare function timeDecay(ageMs: number): number;
/**
 * Re-rank candidates in memory.
 */
export declare function rerank(candidates: Antibody[], opts: RerankOptions): Antibody[];
