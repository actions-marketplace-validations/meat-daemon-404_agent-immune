/**
 * Second-stage ranking for recall (v2).
 *
 * Combines retrieval relevance, hit-count log scaling, path affinity,
 * rubric quality boost, shared-library discount, and time decay.
 */
import type { Antibody } from '../types.js';
import { lexicalTriggerAffinity } from '../retrieval.js';

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

/** Path-ish tokens in the query: names with an extension, or dotted dirs. */
function queryPathTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const match of query.matchAll(/[\w@./\\-]+\.[A-Za-z0-9]{1,8}\b/g)) {
    const value = match[0].replace(/\\/g, '/').toLowerCase();
    if (value.length >= 3) tokens.add(value);
  }
  for (const match of query.matchAll(/(?:^|[\s"'(])((?:[\w-]+\/)+[\w-]+)/g)) {
    const value = match[1]?.replace(/\\/g, '/').toLowerCase();
    if (value && value.length >= 3) tokens.add(value);
  }
  return [...tokens].slice(0, 12);
}

/** True when the antibody's trigger names the same file or directory. */
function hasPathAffinity(trigger: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const haystack = trigger.replace(/\\/g, '/').toLowerCase();
  return tokens.some((token) => {
    if (haystack.includes(token)) return true;
    const base = token.split('/').pop();
    return Boolean(base && base.length >= 5 && haystack.includes(base));
  });
}

/** Exponential-free decay: halves in usefulness only after ~25 days. */
export function timeDecay(ageMs: number): number {
  const days = Math.max(0, ageMs) / (24 * 60 * 60 * 1000);
  return 1 / (1 + 0.02 * days);
}

/**
 * Re-rank candidates in memory.
 */
export function rerank(candidates: Antibody[], opts: RerankOptions): Antibody[] {
  const tokens = queryPathTokens(opts.query);
  const now = opts.now ?? Date.now();
  const sharedIds = opts.sharedIds;

  const scored = candidates.map((antibody) => {
    const relevance = opts.relevanceByRule?.get(antibody) ?? opts.relevance?.get(antibody.id);
    let score =
      relevance !== undefined
        ? relevance * (1 + Math.log1p(Math.max(0, antibody.hit_count)))
        : 1 + Math.log1p(Math.max(0, antibody.hit_count));
    if (hasPathAffinity(antibody.trigger_pattern, tokens)) score *= 1.5;
    // Reward concrete trigger/symptom lexical+concept overlap over short-field BM25 rank ties.
    const lex = lexicalTriggerAffinity(opts.query, antibody);
    if (lex > 0) score *= 1 + Math.min(4.5, lex * 0.65);
    // Mild quality boost: generalized advice outranks raw command tactics on ties.
    const rubric = antibody.rubric_score ?? 70;
    if (rubric >= 85) score *= 1.12;
    else if (rubric < 50) score *= 0.7;
    const isShared = opts.sharedSet ? opts.sharedSet.has(antibody) : Boolean(sharedIds?.has(antibody.id));
    if (isShared) score *= 0.85;
    const stamp = antibody.updated_at || antibody.created_at || now;
    score *= timeDecay(now - stamp);
    return { antibody, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.antibody);
}
