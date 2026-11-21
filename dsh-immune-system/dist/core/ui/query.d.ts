import type { Antibody, GuardEventSummary, WorkspaceProfile } from '../types.js';
import type { ImmuneStore } from '../store/index.js';
import type { TriageSummary } from '../triage.js';
import type { ReceiptSummary } from '../receipts.js';
import type { HygieneReport } from '../hygiene.js';
import { type MagpieGatewaySummary } from '../audit/magpie.js';
import { type AgentDiagnosisReport } from '../diagnose.js';
import { type AutopsyReport } from '../autopsy.js';
import { type GuardVerdict } from '../guard.js';
import { type VaccineVerificationReport, type WorkspaceDNA } from '../vaccine.js';
import { type SwarmFederationReport } from '../federate.js';
export declare const MAX_QUERY = 200;
export declare const ACTIONS: Set<string>;
export interface DashboardStats {
    active: number;
    retired: number;
    hits: number;
    shared: number;
    /** Live episode/session tables and the on-disk footprint (null = :memory:). */
    pendingFailures: number;
    sessions: number;
    jobsPending: number;
    jobsTotal: number;
    /** Value metric: repeats the suppression window measurably prevented. */
    suppressedRepeats: number;
    /**
     * Deliveries followed by a relevant failure (anti-rot penalties). `hits` is
     * how often the library was used; `hits - fails` is how often it held. The
     * pair is what says the rules are being used, not merely accumulated.
     */
    fails: number;
    /** Deliveries per model; 'unknown' when the host reported none. */
    byModel: Array<{
        model: string;
        hits: number;
        fails: number;
        rules: number;
    }>;
    /** Rules delivered under more than one model: the cross-model proof. */
    crossModelRules: number;
    /** Model path: rules it produced, and times it degraded to the rule path. */
    llmDistilled: number;
    llmFallbacks: number;
    dbBytes: number | null;
    /** V2 quality, isolation, Red-3 triage, and receipt telemetry. */
    quarantined: number;
    avgRubric: number;
    echoNoise: number;
    workspaces: number;
    triage: TriageSummary;
    receipts: ReceiptSummary;
    /** V4 live Pre-Flight Guard interceptions recorded in this store. */
    guardInterceptions: number;
    /** Read-only Magpie local AI gateway summary when `~/.config/magpie` exists. */
    gateway?: MagpieGatewaySummary;
}
export interface DashboardState {
    stats: DashboardStats;
    antibodies: Antibody[];
    /** Effective turn-end distillation budget, so the UI can show it. */
    budgetMs: number;
}
/**
 * The same variable and clamp the adapters use (zcode/src/drain.ts,
 * dsh/src/index.ts). Read here only to display it; the drain itself owns the
 * real value.
 */
export declare function resolveBudgetMs(env?: NodeJS.ProcessEnv): number;
export declare function dashboardStats(store: ImmuneStore): DashboardStats;
/** Read state for one view. Never bumps hit counts: browsing is not delivery. */
export declare function readState(store: ImmuneStore, view: 'project' | 'shared' | 'quarantined', query?: string, budgetMs?: number): DashboardState;
export declare function readWorkspaces(store: ImmuneStore): WorkspaceProfile[];
export declare function runHygieneAction(store: ImmuneStore, dryRun?: boolean): HygieneReport;
export interface InsightsPayload {
    immunityScore: number;
    diagnosis: AgentDiagnosisReport;
    autopsy: AutopsyReport;
    workspaceDna: WorkspaceDNA;
    lockfile: {
        exists: boolean;
    } & Partial<VaccineVerificationReport>;
    guardSummary: GuardEventSummary;
    receipts: ReceiptSummary;
}
/**
 * Unified v4 read-only insights payload shared by both standalone dashboard and
 * DSH native settings tab. Grounded strictly in real database receipts, hits,
 * suppressions, and guard events (zero synthetic multipliers).
 */
export declare function readInsights(store: ImmuneStore, workspace?: string): InsightsPayload;
/** Shared read-only Pre-Flight Guard evaluator for both UI HTTP endpoints. */
export declare function evaluateUiGuard(store: ImmuneStore, payload: string, opts?: {
    toolName?: string;
    strict?: boolean;
    workspace?: string;
}): GuardVerdict;
/** Shared read-only Pre-Flight Guard audit ledger query. */
export declare function readGuardEvents(store: ImmuneStore, limit?: number): GuardEventSummary;
/** Shared read-only Swarm Federation preview across local SQLite, shared DB, and `.immune/rules.jsonl`. */
export declare function readFederationPreview(store: ImmuneStore, workspace?: string): SwarmFederationReport;
export interface EvolutionStats {
    /** New rules per week, oldest of the shown weeks first (8 buckets). */
    newRules: number[];
    /** Episodes distilled (jobs done) per week, same buckets. */
    episodes: number[];
    /** Rules with mutation lineage (parent_id set) — refined children. */
    lineage: number;
    /** Rules whose origin is a human correction. */
    fromUserCorrection: number;
    /** Rules whose origin is a self-healing experiment. */
    fromSelfHealing: number;
    /** Rules on probation after an environment change (3.1). */
    probation: number;
    /** Retirements with the env-upgrade reason (3.1). */
    supersededByEnv: number;
    /** Convergent detours recorded (2.3b). */
    detours: number;
}
/**
 * Evolution telemetry from what the database actually records. The roadmap's
 * first-try-success-rate and mean-retries curves need per-call outcome history
 * the store does not keep — those are NOT invented here; the panel shows the
 * rule lifecycle the store can prove.
 */
export declare function evolutionStats(store: ImmuneStore, now?: number): EvolutionStats;
export interface ActionResult {
    status: number;
    body: unknown;
}
/** Apply one validated mutation. */
export declare function applyAction(store: ImmuneStore, op: string, id: number): ActionResult;
