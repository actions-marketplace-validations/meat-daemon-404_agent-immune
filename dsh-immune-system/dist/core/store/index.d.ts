import type { Antibody, AntibodyStatus, FailureSnapshot, NewAntibody, WorkspaceProfile } from '../types.js';
import { type HygieneReport } from '../hygiene.js';
import { type ReceiptSummary } from '../receipts.js';
import { type TriageSummary } from '../triage.js';
import type { MagpieTelemetryReport } from '../audit/magpie.js';
/** meta-table key for the value metric: repeats the plugin measurably prevented. */
export declare const SUPPRESSED_REPEATS_KEY = "suppressed_repeats";
/** Runtime truth for the optional model path: rules it produced / times it degraded. */
export declare const LLM_SUCCESS_KEY = "llm_distilled";
export declare const LLM_FALLBACK_KEY = "llm_fallbacks";
import { type InsertOptions, type PenaltyContext } from './antibodies.js';
import type { SeedInstallReport, SeedRemoveReport, SeedRule } from './seeds.js';
import { type ModelRow } from './models.js';
import { type DistillJob } from './jobs.js';
export { RETIRE_AFTER_FAILURES } from './antibodies.js';
export { resolveDbPath } from './path.js';
export { tokenize, buildFtsQuery } from './tokenize.js';
export type { DistillJob } from './jobs.js';
export type { PenaltyContext } from './antibodies.js';
export { GlobalStore, globalDbPathFor, isPromotable, GLOBAL_DB_FILE } from './global.js';
export interface StoreOptions {
    /** Full path to the database file, or ':memory:' for tests. */
    dbPath?: string;
    /** Directory the database lives in when `dbPath` is not given. */
    dataDir?: string;
    /** Workspace directory for resolving `.dsh/immune.sqlite` when `process.cwd()` is a daemon dir. */
    cwd?: string;
}
export interface MatchOptions {
    limit?: number;
    /** Record hits and remember this turn's injection set for later penalising. */
    sessionId?: string;
    /**
     * Skip rules this session already received within the injection TTL window.
     * Hosts that re-inject per turn (DSH) leave this off; hosts that prime at
     * session start and then match per prompt (ZCode) set it.
     */
    excludeInjected?: boolean;
    /**
     * Suppress an injection whose id set is identical to last turn's, for up to
     * SUPPRESS_WINDOW turns, without counting a hit. Callers that run once per
     * user turn (UserPromptSubmit, agent/pre-step) set this.
     */
    suppressRepeats?: boolean;
    /**
     * The tool the incoming call runs under, when the caller knows it (the
     * per-call PreToolUse hook does; turn-start matching does not). Adds a mild
     * same-tool affinity to the ranking.
     */
    toolName?: string;
    /** When true, only rules with no tool_name or matching `toolName` are eligible (e.g. passive Read/Glob/Grep). */
    strictToolMatch?: boolean;
    /** Workspace directory for path affinity + project_scope isolation. */
    cwd?: string;
    /** Explicit project_scope override ('*' matches universal + all when unbounded). */
    projectScope?: string;
}
export declare class ImmuneStore {
    private db;
    readonly dbPath: string;
    /** Shared library, opened on first need; undefined = not decided yet. */
    private globalStore;
    constructor(opts?: StoreOptions);
    insert(ab: NewAntibody, opts?: InsertOptions): number | null;
    /**
     * Insert and, when the rule is provably generic, also publish it to the
     * shared library so the next project starts already knowing it.
     */
    insertShared(ab: NewAntibody, opts?: {
        generic?: boolean;
        humanHint?: boolean;
        fromLlm?: boolean;
    }): number | null;
    /** Lazily open the shared library; null when sharing is disabled. */
    private global;
    match(queryText: string, opts?: MatchOptions): Antibody[];
    /** Record an injection that did not come through match() (session-start priming). */
    /** Whether an episode is open for this session (optionally: for this tool). */
    hasPendingFailure(sessionId: string, toolName?: string): boolean;
    /** Record one repair action for the session's open episodes (action diff). */
    recordRepairAction(sessionId: string, entry: string): void;
    /** Consecutive same-target probe count for this session. */
    probeStreakCount(sessionId: string, signature: string): number;
    /** Strongest still-standing probe streak (DSH turn-start advisory). */
    topProbeStreak(sessionId: string, min?: number): {
        signature: string;
        count: number;
    } | null;
    /** Record a completed call as a probe (+1) or a streak reset (null). */
    recordProbeOutcome(sessionId: string, signature: string | null): void;
    /** Consecutive same-target failures for this session (0 when none). */
    stuckStreak(sessionId: string, signature: string): number;
    /** Whether the diagnostic hypothesis already fired for this streak. */
    wasHypothesized(sessionId: string, signature: string): boolean;
    recordStuckFailure(sessionId: string, signature: string): number;
    /** The strongest unresolved stuck row (streak >= min, hypothesis undelivered), or null. */
    topStuck(sessionId: string, minStreak?: number): {
        signature: string;
        failStreak: number;
    } | null;
    markHypothesized(sessionId: string, signature: string): void;
    clearStuck(sessionId: string, signature: string): void;
    /** SessionStart pass: probation on fingerprint mismatch, re-validation on match. */
    runEnvMetabolism(cwd: string): {
        probation: number;
        revalidated: number;
    };
    /** Record a convergent-detour telemetry row (review candidate). */
    recordDetour(sessionId: string, signature: string, probes: number): void;
    /** Newest detour rows (telemetry only — never auto-distilled). */
    recentDetours(limit?: number): import("./detours.js").DetourRow[];
    detourCount(): number;
    /** Minimum same-target probes that qualify as a detour. */
    get detourMinProbes(): number;
    recordInjection(sessionId: string, ids: number[], prescriptions?: string[]): void;
    /**
     * Forget this session's repeat-suppression history.
     *
     * Called on resume / clear / compact: those are new contexts, so a rule that
     * was suppressed before must be eligible again.
     */
    resetTurnState(sessionId: string): void;
    /** Claim a prompt once for the active turn; returns false on duplicate mid-turn PreInvocation steps. */
    claimPromptTurn(sessionId: string, prompt: string): boolean;
    /** Release the active-turn prompt lock at `Stop`. */
    clearPromptTurn(sessionId: string): void;
    listAll(includeRetired?: boolean): Antibody[];
    /**
     * Read-only search over THIS project's rules, for tooling (the dashboard).
     *
     * Deliberately does NOT bump hit counts or record an injection: browsing in a
     * UI is not the same as delivering a rule to a model, and letting the two
     * share a counter would inflate the numbers that drive promotion and pruning.
     */
    peek(queryText: string, limit?: number, projectScope?: string): Antibody[];
    /** Shared-library rows, for the dashboard's second tab. */
    sharedAntibodies(limit?: number): Antibody[];
    remove(id: number): boolean;
    /** Forget the newest active antibody. Returns its id, or null when none. */
    forgetLast(): number | null;
    /** Retire never-injected antibodies older than `olderThanMs` (reversible). */
    retireZombies(olderThanMs: number): number[];
    /** Delete never-injected antibodies older than `olderThanMs` (not reversible). */
    pruneZombies(olderThanMs: number): number[];
    setStatus(id: number, status: AntibodyStatus): boolean;
    /** Write a consistent snapshot; a plain copy of a WAL db can be empty. */
    backupTo(path: string): Promise<void>;
    /** Merge proven duplicate lessons, retaining evidence and attribution. */
    consolidateInto(keepId: number, input: {
        trigger: string;
        hitCount: number;
        failCount: number;
        repairs: string[];
        retireIds: number[];
    }): void;
    /** Install a builtin seed pack through the normal insert path. */
    seedPack(pack: string, rules: SeedRule[]): SeedInstallReport;
    /** Remove a seed pack; rules changed since seeding are kept and reported. */
    removeSeedPack(pack: string): SeedRemoveReport;
    /** Per-pack counts of still-recorded seed rules, for the list view. */
    seededPackCounts(): Map<string, number>;
    /** Replace a prescription's wording, keeping the rule and its counters. */
    setPrescription(id: number, prescription: string, source: 'rule' | 'llm' | 'human' | 'host_llm'): boolean;
    /** One rule by id, or null. Read-only. */
    byId(id: number): Antibody | null;
    /**
     * Mutate an injected-but-still-failed rule into a refined child (v1 -> v2).
     * Returns the child id, or null when there is no repair evidence, the parent
     * is gone/retired, or the trigger would not actually change.
     */
    mutateRule(parentId: number, incomingTokens: string, evidence?: {
        repairPath?: string[];
        humanHint?: string;
    }): number | null;
    recordFailure(sessionId: string, toolName: string, trace: unknown, targetSignature?: string): FailureSnapshot;
    /** Annotate pending failures with what the human said in the next turn. */
    attachHumanHint(sessionId: string, hint: unknown): number;
    claimFailure(sessionId: string, toolName: string, incoming?: {
        signature: string;
        probeOnly: boolean;
    }): FailureSnapshot | null;
    injectedIds(sessionId: string): number[];
    penalize(ids: number[], ctx?: PenaltyContext): Antibody[];
    /** Deliveries per model, for the dashboard and `immune stats`. */
    modelBreakdown(): ModelRow[];
    /** Rules delivered under more than one model — the cross-model proof. */
    crossModelRules(): number;
    pruneStale(now?: number): import("./episodes.js").PruneCounts;
    exportable(minHits?: number, projectScope?: string): Antibody[];
    /**
     * Row counts by table plus the on-disk size of the database file. Feeds
     * `immune doctor` and the UI; lets retention be observed, not assumed.
     */
    stats(): {
        active: number;
        retired: number;
        quarantined: number;
        pendingFailures: number;
        sessions: number;
        jobsPending: number;
        jobsTotal: number;
        suppressedRepeats: number;
        /** Rules the configured model produced, and times it degraded to the rule path. */
        llmDistilled: number;
        llmFallbacks: number;
        dbBytes: number | null;
    };
    /** One meta value as a number (0 when unset). */
    metaValue(key: string): number;
    /** Write one meta value (timestamps for the sleep-consolidation cooldown). */
    setMetaValue(key: string, value: number): void;
    enqueueJob(tool: string, failure: string, success: string, injected: number[], humanHint?: string, repairPath?: string[], origin?: string, projectScope?: string, cwd?: string): number;
    /** Run admission hygiene audit/repair across stored antibodies. */
    repairHygiene(opts?: {
        dryRun?: boolean;
    }): HygieneReport;
    /** Read Red-3 Triage telemetry across failure buckets. */
    triageSummary(limit?: number): TriageSummary;
    /** Verify and summarize SHA-256 chained delivery receipts. */
    receiptSummary(limit?: number): ReceiptSummary;
    /** Build per-model immunity matrix + adaptive escalation targets. */
    modelImmunity(magpie?: MagpieTelemetryReport | null): {
        models: import("../model-intel.js").ModelImmunityProfile[];
        escalatedRules: import("../model-intel.js").EscalatedRuleHint[];
        crossModelProven: number;
    };
    /** Register or update a discovered workspace profile. */
    upsertWorkspaceProfile(profile: WorkspaceProfile): void;
    /** List all discovered/ingested workspace profiles. */
    listWorkspaceProfiles(): WorkspaceProfile[];
    claimJob(): DistillJob | null;
    /** Newest jobs for telemetry (ROADMAP 3.3); read-only. */
    listJobs(limit?: number): DistillJob[];
    /** Claim up to `count` pending jobs, for batch distillation. */
    claimJobs(count: number): DistillJob[];
    finishJob(id: number, status: 'done' | 'failed' | 'skipped', note?: string): void;
    /** Bump a named meta counter (value metrics surfaced by stats/doctor). */
    bumpMeta(key: string, delta?: number): number;
    /** Attach a note to a job without changing its status. */
    finishJobNote(id: number, note: string): void;
    requeueStuckJobs(): number;
    pendingJobCount(): number;
    close(): void;
}
