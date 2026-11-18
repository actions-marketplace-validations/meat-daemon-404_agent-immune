import type { DatabaseSync } from 'node:sqlite';
/** Turns to stay quiet before an unchanged set is re-injected. */
export declare const SUPPRESS_WINDOW = 4;
export interface TurnState {
    signature: string;
    turns: number;
}
export declare function readTurnState(db: DatabaseSync, sessionId: string): TurnState;
/** Record that this set was injected now (turn counter resets). */
export declare function recordTurnInjection(db: DatabaseSync, sessionId: string, ids: number[], sharedPrescriptions?: string[]): void;
/**
 * Guard against hosts (such as Antigravity `PreInvocation`) that re-invoke the
 * prompt hook before every tool-loop step inside a single user turn with the
 * exact same `lastUserInput`. Cleared at `Stop` (`clearPromptTurn`).
 */
export declare function claimPromptTurn(db: DatabaseSync, sessionId: string, prompt: string): boolean;
export declare function clearPromptTurn(db: DatabaseSync, sessionId: string): void;
/** Count one suppressed turn. */
export declare function bumpTurn(db: DatabaseSync, sessionId: string): number;
/** Forget the session's injection history (resume / clear / compact). */
export declare function clearTurnState(db: DatabaseSync, sessionId: string): void;
/** Stable ascending-id signature, e.g. "2,8,15". */
export declare function signatureOf(ids: number[]): string;
/**
 * Combined signature across project rule IDs and shared-library prescriptions
 * (Decision #7: shared rules have independent IDs, so key them by prescription digest).
 */
export declare function candidateSignature(ids: number[], sharedPrescriptions?: string[]): string;
/**
 * Decide whether this turn's injection should be suppressed.
 *
 * Suppression requires an identical, non-empty signature AND fewer than
 * `SUPPRESS_WINDOW` turns since it was last delivered.
 */
export declare function shouldSuppress(state: TurnState, candidateIds: number[], sharedPrescriptions?: string[]): boolean;
