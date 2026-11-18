import type { DatabaseSync } from 'node:sqlite';
/** A distillation job waiting for (or held by) the background worker. */
export interface DistillJob {
    id: number;
    tool_name: string;
    failure_trace: string;
    success_trace: string;
    injected_ids: string;
    human_hint?: string;
    /** Action-diff provenance (JSON text in the DB, parsed on claim). */
    repair_path?: string[];
    /** ROADMAP 1.4b: '' (self-repair) or 'user_correction'. */
    origin?: string;
    project_scope?: string;
    cwd?: string;
    status: string;
    note: string;
    created_at: number;
    updated_at: number;
}
export declare function enqueueJob(db: DatabaseSync, toolName: string, failureTrace: string, successTrace: string, injectedIds: number[], humanHint?: string, repairPath?: string[], origin?: string, projectScope?: string, cwd?: string): number;
/**
 * Claim the oldest pending job atomically.
 *
 * A single UPDATE ... RETURNING is used so two workers racing on the same
 * database cannot both take the same job.
 */
export declare function claimJob(db: DatabaseSync): DistillJob | null;
/**
 * Claim up to `count` pending jobs atomically.
 *
 * One statement per claim keeps the race posture of `claimJob`; batching is the
 * caller's concern so a partial claim is still safe.
 */
export declare function claimJobs(db: DatabaseSync, count: number): DistillJob[];
export declare function finishJob(db: DatabaseSync, id: number, status: 'done' | 'failed' | 'skipped', note?: string): void;
/** Newest jobs for telemetry (ROADMAP 3.3); read-only. */
export declare function listRecentJobs(db: DatabaseSync, limit?: number): DistillJob[];
/**
 * How long a 'running' claim may be silent before another drain may take it.
 *
 * A claim is only held for the life of one drain, and the drain aborts its
 * model calls at its own deadline — but `backfill --budget-ms` may legitimately
 * pass ten minutes, so a five-minute window let a hook's turn-end drain steal
 * jobs out from under a live backfill and distil the same episode twice. The
 * window must therefore exceed the largest legal budget (plus request
 * overhead), not the common one.
 */
export declare const STUCK_JOB_MS: number;
/** Recover jobs whose worker died mid-flight, so they are not lost forever. */
export declare function requeueStuckJobs(db: DatabaseSync, olderThanMs?: number): number;
export declare function pendingJobCount(db: DatabaseSync): number;
