/**
 * History backfill: mine a ZCode session database for failed-then-fixed tool
 * episodes and enqueue them for distillation.
 *
 * The host records every tool call (`tool_usage`) and its full input/output
 * (`part` rows of type "tool", keyed by callID). That is everything the live
 * pairing loop sees, so the same logic can be REPLAYED over months of
 * history: the library does not have to wait for each pitfall to be
 * re-encountered — months of real lessons are already on disk.
 */
import { DatabaseSync } from 'node:sqlite';
import type { ImmuneStore } from './store/index.js';
export interface BackfillOptions {
    /** Path to the ZCode session database (db.sqlite). */
    sourceDb?: string;
    /** Only look back this many days (default 120). */
    days?: number;
    /** Cap how many episodes are enqueued (quota guard for slow LLM channels). */
    max?: number;
    /** Restrict to one session, for tests and targeted runs. */
    sessionId?: string;
    /** Self-noise markers (the adapters' selfMarkers()). */
    selfMarkers?: string[];
}
export interface BackfillReport {
    scanned: number;
    failures: number;
    paired: number;
    enqueued: number;
    superseded: number;
    skippedSelf: number;
}
/** One tool call as the pairing loop sees it. */
export interface CallRow {
    session_id: string;
    tool_call_id: string;
    tool_name: string;
    status: string;
    error_message: string | null;
    started_at: number;
}
/** ZCode session db loader — shared with core/audit.ts. */
export declare function loadCalls(db: DatabaseSync, since: number, sessionId?: string): CallRow[];
/** Tools whose episodes can produce a meaningful rule; protocol tools are excluded. */
export declare const BACKFILL_TOOLS: Set<string>;
/**
 * Full input/output per callID, for the sessions in scope only.
 *
 * The session database holds millions of part rows; loading every one of them
 * exhausts memory on a real library (observed as a V8 OOM crash). Sessions are
 * fetched in bounded chunks with bound parameters.
 */
/** Full input/output per callID, shared with core/audit.ts. */
export declare function loadParts(db: DatabaseSync, sessionIds: string[], neededCallIds?: ReadonlySet<string>): Map<string, {
    input: unknown;
    output: string;
}>;
/** Replay the live pairing loop over one session's ordered calls. */
export declare function pairSession(calls: CallRow[], parts: Map<string, {
    input: unknown;
    output: string;
}>, emit: (fail: CallRow, success: CallRow, repairs: string[]) => void): {
    failures: number;
    paired: number;
    superseded: number;
};
export declare function backfill(store: ImmuneStore, opts?: BackfillOptions): BackfillReport;
