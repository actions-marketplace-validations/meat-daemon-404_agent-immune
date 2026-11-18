/**
 * Trigger-keyword normalisation.
 *
 * Production evidence: the first real antibodies stored absolute Windows paths
 * verbatim, so one file appeared five times in five spellings and a single
 * antibody carried 700+ characters of trigger. Rules need stable, short,
 * comparable tokens — a basename identifies the file just as well and matches
 * across machines.
 */
/**
 * Normalise one raw candidate.
 *
 * Paths collapse to their basename; quotes are stripped; over-long or generic
 * tokens are rejected. Returns null when the token is not worth keeping.
 */
export declare function normalizeKeyword(raw: string): string | null;
/** Up to `max` meaningful words from a command string, in order. */
export declare function meaningfulTokens(command: string, max?: number): string[];
