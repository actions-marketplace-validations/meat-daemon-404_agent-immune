/**
 * Model-Aware Immunity Matrix & Adaptive Salience Escalation (v2.1).
 *
 * Joins per-model delivery stats (`model_hits`, `delivery_receipts`) with Red-3
 * `triage_events` and optional Magpie gateway telemetry so the runtime knows
 * *which* models ignore which rules and dynamically escalates reminders on
 * repeat-ignore rules without burning tokens on compliant rules.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { MagpieTelemetryReport } from './audit/magpie.js';
export interface ModelImmunityProfile {
    model: string;
    deliveries: number;
    fails: number;
    survivalRatePct: number;
    distinctRules: number;
    tokensEstSaved: number;
    gatewayRequests?: number;
    gatewayFailures?: number;
}
export interface EscalatedRuleHint {
    id: number;
    trigger: string;
    ignoredCount: number;
    failCount: number;
    hitCount: number;
}
export declare function buildModelImmunityReport(db: DatabaseSync, magpie?: MagpieTelemetryReport | null): {
    models: ModelImmunityProfile[];
    escalatedRules: EscalatedRuleHint[];
    crossModelProven: number;
};
