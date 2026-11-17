/**
 * Shared types for the immune system (v2).
 *
 * Host-agnostic domain contracts: `core/` never imports ZCode, DSH, Claude Code,
 * Codex, or Antigravity host packages, so every adapter shares one engine.
 */

/** Lifecycle of an antibody. Only `active` rules are injected into context. */
export type AntibodyStatus = 'active' | 'retired' | 'quarantined';

/** Structural quality tier assigned by the admission & hygiene gate. */
export type RuleQualityGrade = 'advice' | 'tactic' | 'quarantined';

/** Causal failure taxonomy produced by deterministic or LLM distillation. */
export type RootCauseType =
  | 'missing_prerequisite'
  | 'env_or_path'
  | 'api_or_schema_drift'
  | 'stale_read'
  | 'config_mismatch'
  | 'command_syntax'
  | 'flake'
  | 'other'
  | '';

/** Red-3 Triage buckets (from daily-patrol methodology). */
export type TriageBucket =
  | 'flake_or_transient'
  | 'wrong_scope_leak'
  | 'stale_or_bad_advice'
  | 'ignored_by_agent'
  | 'coverage_blindspot'
  | '';

/** A pitfall-avoidance rule distilled from one failed-then-fixed episode. */
export interface Antibody {
  id: number;
  /** Where the pitfall is likely to bite: file names, package names, commands, API keywords. */
  trigger_pattern: string;
  /** The wrong instinct, in one line. */
  symptom: string;
  /** The verified correct move, in one line. */
  prescription: string;
  /** How many times this antibody has been injected into context. */
  hit_count: number;
  /** How many times this antibody was injected and the tool still failed. */
  fail_count: number;
  status: AntibodyStatus;
  /** Which tool the episode came from (e.g. Bash, Edit), for diagnostics. */
  tool_name: string | null;
  /** Write actions that repaired the problem when this rule was learned (capped at 3). */
  repair_path: string[];
  /** Provenance of current prescription wording: '', 'rule', 'llm', 'host_llm', 'human'. */
  prescription_source?: string;
  /** Teaching origin: '' (self-repair), 'user_correction', 'self_healing_experiment', 'disk_corpus'. */
  origin?: string;
  /** Mutation lineage: parent antibody id when refined from post-injection failure. */
  parent_id?: number | null;
  /** Timestamp of last evidence-based trigger refinement. */
  mutated_at?: number;
  /** Workspace lockfile/runtime fingerprint hash. */
  env_fingerprint?: string;
  /** Nonzero when the workspace env changed and the rule awaits re-validation. */
  probation_at?: number;
  /** Why a rule left active set when not anti-rot. */
  retire_reason?: string;
  /** Isolation scope: '*' = universal across all projects; 'proj:<slug>:<hash>' = workspace-locked. */
  project_scope?: string;
  /** Admission quality tier: 'advice' (transferable), 'tactic' (scoped), 'quarantined' (echo/noise). */
  quality_grade?: RuleQualityGrade;
  /** 0..100 multi-dimension rubric score (specificity, actionability, portability, evidence, safety). */
  rubric_score?: number;
  /** Causal root cause category. */
  root_cause?: RootCauseType;
  /** Last Red-3 Triage classification when evaluated/penalized. */
  triage_bucket?: TriageBucket;
  /** Count of times a valid rule was delivered but ignored by the agent. */
  ignored_count?: number;
  created_at: number;
  updated_at: number;
}

/** Fields a caller supplies when creating an antibody; the store owns the rest. */
export type NewAntibody = Pick<
  Antibody,
  'trigger_pattern' | 'symptom' | 'prescription'
> & {
  tool_name?: string | null;
  repair_path?: string[];
  origin?: string;
  env_fingerprint?: string;
  prescription_source?: string;
  project_scope?: string;
  quality_grade?: RuleQualityGrade;
  rubric_score?: number;
  root_cause?: RootCauseType;
  status?: AntibodyStatus;
};

/** One failed tool call, captured so a later success can be paired with it. */
export interface FailureSnapshot {
  session_id: string;
  tool_name: string;
  /** Compact, redacted summary of the failed invocation. */
  trace: string;
  /** Antibody ids injected before this failure, so they can be penalised. */
  injected_ids: number[];
  /** What the human said in the turn AFTER the failure. */
  human_hint: string;
  /** Non-probe write actions recorded between the failure and the closing success. */
  repair_path: string[];
  created_at: number;
}

/** An episode ready to be distilled: a failure followed by a success on the same tool. */
export interface Episode {
  session_id: string;
  tool_name: string;
  failureTrace: string;
  successTrace: string;
  /** Antibodies that were in context when the failure happened. */
  injected_ids: number[];
}

/** Result of a distillation attempt. */
export type DistillResult =
  | {
      ok: true;
      antibody: NewAntibody;
      /** Which path produced the rule. */
      source?: 'llm' | 'rule';
      /** Why the LLM path did not produce the rule, when it did not. */
      degradedReason?: string;
    }
  | { ok: false; reason: 'skip' | 'invalid' | 'error'; detail?: string };

/** Verifiable delivery receipt (inspired by Beacon usage receipts). */
export interface DeliveryReceipt {
  id: number;
  rule_id: number;
  session_id: string;
  model: string;
  project_scope: string;
  outcome: 'delivered' | 'held' | 'ignored' | 'failed' | 'wrong_scope';
  tokens_est: number;
  digest: string;
  created_at: number;
}

/** Red-3 Triage event log row. */
export interface TriageEvent {
  id: number;
  rule_id: number | null;
  session_id: string;
  tool_name: string;
  bucket: Exclude<TriageBucket, ''>;
  reason: string;
  action_taken: string;
  created_at: number;
}

/** Discovered workspace profile on local disk. */
export interface WorkspaceProfile {
  scope_id: string;
  name: string;
  root_path: string;
  stack: string;
  baseline: string;
  rules_count: number;
  source: string;
  last_scanned_at: number;
}
