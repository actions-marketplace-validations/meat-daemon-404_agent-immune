/**
 * Pre-execution guards.
 *
 * Advisory text can be skipped by a model in a long turn, so a small set of
 * DETERMINISTIC mistakes also gets an explicit pre-execution check.
 *
 * Deliberately conservative in three ways:
 *
 *  1. Patterns live here, in code — never in the database. A distilled rule is
 *     model output; compiling it into a regex that can block tool calls would
 *     hand an unreviewed string the power to stop work (and invites ReDoS).
 *  2. Off unless `IMMUNE_GUARD` asks for it.
 *  3. Three modes: off (default), `warn` (louder advisory), `deny` (block).
 *     Denying is the highest-risk behaviour, so it is never the default.
 *
 * The value checked is the tool's own input text, redacted and length-capped by
 * the caller.
 */
export type GuardMode = 'off' | 'warn' | 'deny';
export interface GuardRule {
    /** Stable id, shown to the model so it can be referenced. */
    id: string;
    what: string;
    pattern: RegExp;
    /** What to do instead. */
    instead: string;
}
/**
 * Rules that are wrong in essentially every environment.
 *
 * Kept short on purpose: each entry is a claim that fires without human review.
 */
export declare const GUARD_RULES: readonly GuardRule[];
export declare function guardMode(env?: NodeJS.ProcessEnv): GuardMode;
export interface GuardHit {
    rule: GuardRule;
}
/**
 * Extract raw command text for shell payloads so real newlines are preserved
 * (preventing `JSON.stringify` `\\n` escapes from bypassing line anchors or
 * causing cross-line false positives).
 */
export declare function extractGuardInput(toolInput: unknown): string;
/**
 * First rule matching `text`, or null.
 *
 * Every pattern is anchored by construction (bounded alternation, no nested
 * quantifiers), and the input is already clamped by the caller, so a match
 * cannot run away on a pathological string.
 */
export declare function findGuardHit(text: string): GuardHit | null;
