import type { DatabaseSync } from 'node:sqlite';
import type { FailureSnapshot } from '../types.js';
/** A failure is abandoned if no success follows within this window. */
export declare const PENDING_TTL_MS: number;
/** Injected antibodies are only penalised for failures within this window. */
export declare const INJECTION_TTL_MS: number;
/**
 * Terminal distill jobs (done/failed/skipped) are history: the antibody they
 * produced is already in the library, so the raw job rows only matter for
 * debugging. Keep a week, then let pruneStale reclaim the space.
 */
export declare const JOB_RETENTION_MS: number;
/** Turn-state rows for sessions quiet for a week are dead sessions. */
export declare const SESSION_RETENTION_MS: number;
/** What one pruneStale pass removed, for doctor output and tests. */
export interface PruneCounts {
    pendingFailures: number;
    sessionInjections: number;
    jobs: number;
    sessions: number;
    repairs: number;
    probes: number;
    stuck: number;
    detours: number;
    guardEvents: number;
}
/** Remember which antibodies were injected on this session's current window (accumulating unexpired deliveries atomically). */
export declare function recordInjection(db: DatabaseSync, sessionId: string, ids: number[], prescriptions?: string[]): void;
/** Antibody ids injected during the current turn of this session. */
export declare function injectedIds(db: DatabaseSync, sessionId: string): number[];
/**
 * Prescriptions delivered during the current turn.
 *
 * Shared-library rules have no stable id this database can reason about (their
 * ids come from another file), so they are deduplicated by prescription text.
 */
export declare function injectedPrescriptions(db: DatabaseSync, sessionId: string): string[];
/**
 * Record a failed tool call, capturing which antibodies were in context so they
 * can be penalised if they failed to prevent this.
 */
export declare function recordFailure(db: DatabaseSync, sessionId: string, toolName: string, trace: unknown, targetSignature?: string): FailureSnapshot;
/**
 * Attach the human's latest message to every un-hinted pending failure.
 *
 * Called when a NEW user turn starts. Because prompt capture happens before any
 * tool runs in that turn, every pending failure at this moment came from an
 * earlier turn — which is exactly the "agent failed, human explained, try again"
 * shape worth learning from.
 *
 * Returns how many rows were annotated.
 */
export declare function attachHumanHint(db: DatabaseSync, sessionId: string, hint: unknown): number;
/** Whether any tool has an unclosed failure for this session. */
export declare function hasPendingFailure(db: DatabaseSync, sessionId: string, toolName?: string): boolean;
/** How many consecutive same-target probes this session has made so far. */
export declare function probeStreakCount(db: DatabaseSync, sessionId: string, signature: string): number;
/**
 * Record a completed call's probe outcome. A probe increments its own streak
 * and zeroes every other streak for the session (consecutive semantics); a
 * non-probe (null) resets all of them.
 */
export declare function recordProbeOutcome(db: DatabaseSync, sessionId: string, signature: string | null): void;
/**
 * The strongest still-standing probe streak for a session, or null. The DSH
 * pre-step uses it at turn start: its PreToolDecision has no context channel,
 * so "you probed this target N times last turn" is the only delivery point.
 */
export declare function topProbeStreak(db: DatabaseSync, sessionId: string, min?: number): {
    signature: string;
    count: number;
} | null;
/**
 * Record one repair action for the session's open episodes (the action-diff
 * between the failure and the closing success). One row per session, newest
 * last, capped at three — the distiller needs the shape of the fix, not a log.
 */
export declare function recordRepairAction(db: DatabaseSync, sessionId: string, entry: string): void;
/**
 * Claim a pending failure for `toolName`, deleting it so one failure is only
 * ever paired once.
 *
 * `incoming` is the successful call that might close the episode. When it is
 * a read-only probe, or aimed at a different target, the failure is LEFT
 * PENDING — a `git status` between an error and its real fix must not consume
 * the episode, and the same tool called on another file must not either.
 *
 * Cross-session closing: when THIS session has no pending failure, the
 * newest still-standing failure of the same tool from ANOTHER session in the
 * same project database may be closed (pruneStale already removed rows older
 * than PENDING_TTL_MS, so the 30-minute window holds by construction). The
 * repair actions are read from the FAILING session's buffer — the common
 * shape is "session A failed, session A edited the fix, a fresh session B
 * re-ran the command and it worked". A repair made in session B is not
 * attributed (B's buffer only fills when B itself holds a pending failure);
 * the episode still distils from its failure/success traces.
 */
export declare function claimFailure(db: DatabaseSync, sessionId: string, toolName: string, incoming?: {
    signature: string;
    probeOnly: boolean;
}): FailureSnapshot | null;
/**
 * Drop expired rows on session start / turn end / explicit maintenance so the
 * database cannot grow without bound even over months of continuous operation.
 */
export declare function pruneStale(db: DatabaseSync, now?: number): PruneCounts;
