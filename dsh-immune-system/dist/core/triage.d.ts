/**
 * Red-3 Triage Engine (v2), fusing `daily-patrol` methodology into the immune
 * lifecycle:
 *
 *   "Before touching or retiring a rule, prove the failure is real, determine
 *    whose fault it is (5 buckets), and only then choose the surgical action."
 *
 * Five triage buckets:
 *   1. `flake_or_transient`  — network blip, rate limit, timeout, user cancel → ignore penalty
 *   2. `wrong_scope_leak`    — rule belonged to another project scope       → re-scope / quarantine
 *   3. `ignored_by_agent`    — valid proven/generic rule ignored by model   → escalate delivery, don't kill
 *   4. `stale_or_bad_advice` — advice failed on target / drifted env        → penalize, mutate, or retire
 *   5. `coverage_blindspot`  — uncovered failure family                     → synthesize via LLM / pack
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Antibody, TriageBucket, TriageEvent } from './types.js';
export interface TriageVerdict {
    bucket: Exclude<TriageBucket, ''>;
    shouldPenalize: boolean;
    shouldQuarantine: boolean;
    escalateSurface: boolean;
    reason: string;
}
/**
 * Classify a post-injection failure before anti-rot blames the rule.
 */
export declare function triagePostInjectionFailure(rule: Antibody, failureText: string, _toolName: string, currentScope?: string): TriageVerdict;
/** Append a Red-3 triage audit row (best-effort, bounded). */
export declare function recordTriageEvent(db: DatabaseSync, entry: {
    ruleId: number | null;
    sessionId?: string;
    toolName?: string;
    bucket: Exclude<TriageBucket, ''>;
    reason: string;
    actionTaken: string;
}): void;
export interface TriageSummary {
    totalEvents: number;
    byBucket: Record<string, number>;
    ignoredRules: Array<{
        id: number;
        trigger: string;
        ignoredCount: number;
        hitCount: number;
    }>;
    quarantinedCount: number;
    probationCount: number;
    recentEvents: TriageEvent[];
}
/** Read-only summary of Red-3 triage telemetry across the store. */
export declare function summarizeTriage(db: DatabaseSync, limit?: number): TriageSummary;
