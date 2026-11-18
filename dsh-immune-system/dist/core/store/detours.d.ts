/**
 * Convergent-detour telemetry (ROADMAP 2.3b).
 *
 * A session that probes the same target 4+ times read-only before the
 * successful command lands has walked a detour; the row is a REVIEW
 * CANDIDATE — telemetry only. The deterministic path never mints a shortcut
 * rule from it: its advice would be the echoed command (AGENTS.md #28), so
 * minting stays on the LLM rewrite path (`immune rewrite`).
 */
import type { DatabaseSync } from 'node:sqlite';
export interface DetourRow {
    id: number;
    session_id: string;
    signature: string;
    probes: number;
    created_at: number;
}
/** Minimum same-target probes for a detour to be worth a row. */
export declare const DETOUR_MIN_PROBES = 4;
export declare function recordDetour(db: DatabaseSync, sessionId: string, signature: string, probes: number): void;
/** Newest rows first, for the CLI surface. */
export declare function recentDetours(db: DatabaseSync, limit?: number): DetourRow[];
export declare function detourCount(db: DatabaseSync): number;
/** Rows older than a week are history; pruneStale reclaims them. */
export declare function pruneDetours(db: DatabaseSync, olderThanMs: number, now?: number): number;
