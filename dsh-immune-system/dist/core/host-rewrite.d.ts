import type { ImmuneStore } from './store/index.js';
/** At most this many echo rules per delegated pass. */
export declare const HOST_REWRITE_BATCH = 3;
/** Minimum time between delegated passes. */
export declare const HOST_REWRITE_COOLDOWN_MS: number;
export interface HostRewriteCandidate {
    id: number;
    tool_name: string | null;
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    hit_count: number;
}
/**
 * Read-only: the next echo-grade rules worth rewriting, most-delivered first.
 * No cooldown here — a preview must always be available; the cooldown gates
 * the WRITE pass (applyHostRewrites).
 */
export declare function hostRewriteCandidates(store: ImmuneStore, limit?: number): HostRewriteCandidate[];
export type HostRewriteResult = {
    id: number;
    status: 'rewritten';
    from: string;
    to: string;
} | {
    id: number;
    status: 'skipped';
    detail: string;
} | {
    id: number;
    status: 'failed';
    detail: string;
};
/**
 * Apply one delegated pass. Guards, in order: cooldown (one pass per 12h),
 * rule exists and is still active, rule is STILL echo-grade (a candidate
 * already rewritten must not be clobbered), the new wording is not itself an
 * echo, and the id was not applied twice in this batch. Provenance records
 * 'host_llm' so captured evidence, endpoint-LLM wording and host-LLM wording
 * stay distinguishable (Decision #28).
 */
export declare function applyHostRewrites(store: ImmuneStore, rewrites: ReadonlyArray<{
    id: number;
    prescription: string;
}>, now?: number): {
    results: HostRewriteResult[];
    appliedCount: number;
    cooldownUntil: number | null;
};
