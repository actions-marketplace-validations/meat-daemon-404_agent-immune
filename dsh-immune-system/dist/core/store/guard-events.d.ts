/**
 * Persistent Pre-Flight Guard audit ledger (v4.0).
 *
 * Records every live `warn`, `rewrite`, and `block` interception (always
 * redacted and bounded before hitting disk — AGENTS.md #10) so operators,
 * dashboards, CLI (`immune guard --log`), and MCP (`immune_guard_log`) can
 * audit prevented disasters without scanning ephemeral hook stderr logs.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { GuardEventSummary } from '../types.js';
export declare const GUARD_EVENT_RETENTION_MS: number;
export interface NewGuardEvent {
    sessionId?: string;
    toolName?: string;
    decision: 'warn' | 'rewrite' | 'block';
    severity: 'low' | 'medium' | 'high' | 'critical';
    blastRadius: number;
    policyIds: ReadonlyArray<string>;
    payloadPreview: string;
    suggestedRewrite?: string | null;
    projectScope?: string;
    createdAt?: number;
}
/** Record one live Pre-Flight Guard interception (best-effort; never throws on hook paths). */
export declare function recordGuardEvent(db: DatabaseSync, entry: NewGuardEvent): void;
/** Read-only summary + recent live guard interceptions. */
export declare function summarizeGuardEvents(db: DatabaseSync, limit?: number): GuardEventSummary;
/** Trim expired and excess guard audit rows during scheduled `pruneStale`. */
export declare function pruneGuardEvents(db: DatabaseSync, now?: number): number;
