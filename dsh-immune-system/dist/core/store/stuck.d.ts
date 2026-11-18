/**
 * Stuck detection state (ROADMAP 1.5): how many consecutive times the same
 * target has failed in one session, and whether the diagnostic hypothesis was
 * already delivered.
 *
 * The table exists because every hook is its own process (AGENTS.md #4): the
 * streak survives across hook invocations only in SQLite. Rows age out with
 * the pending-failure TTL — a stuck episode is only actionable while its
 * failure is still pending anyway.
 */
import type { DatabaseSync } from 'node:sqlite';
export interface StuckRow {
    fail_streak: number;
    hypothesized_at: number;
}
/** Consecutive-failure count for this session + signature (0 when none). */
export declare function stuckStreak(db: DatabaseSync, sessionId: string, signature: string): number;
/** Whether the diagnostic hypothesis was already injected for this streak. */
export declare function wasHypothesized(db: DatabaseSync, sessionId: string, signature: string): boolean;
/**
 * Count one failure against this signature's streak and return the new count.
 * Failures on other signatures do not reset it (two rakes can be stepped on in
 * alternation); a success clears the row (see clearStuck).
 */
export declare function recordStuckFailure(db: DatabaseSync, sessionId: string, signature: string): number;
/** Mark the diagnostic hypothesis as delivered (fires exactly once per streak). */
export declare function markHypothesized(db: DatabaseSync, sessionId: string, signature: string): void;
/**
 * The strongest unresolved stuck row for a session (streak >= min, hypothesis
 * not yet delivered), or null. The DSH preStep uses it for turn-start
 * delivery — that host's PreToolDecision has no context channel, the same
 * constraint that keeps the guard's warn mode ZCode-only.
 */
export declare function topStuckRow(db: DatabaseSync, sessionId: string, minStreak: number): {
    signature: string;
    failStreak: number;
} | null;
/**
 * The structured diagnostic hypothesis, shared verbatim by both delivery
 * surfaces (ZCode PreToolUse before the third attempt, DSH at turn start) so
 * the two hosts cannot drift into different advice.
 */
export declare function stuckHypothesisText(signature: string): string;
/** A success (any close of the episode) ends the stuck state. */
export declare function clearStuck(db: DatabaseSync, sessionId: string, signature: string): void;
/** Age out stale rows — called from pruneStale with the pending TTL. */
export declare function pruneStuck(db: DatabaseSync, olderThanMs: number, now?: number): number;
