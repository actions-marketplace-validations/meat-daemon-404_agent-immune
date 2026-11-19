/**
 * Public programmatic SDK barrel (`import { ... } from 'dsh-immune-system/core'`).
 *
 * Exposes the zero-dependency SQLite+FTS5 pitfall immunity engine for custom
 * Node.js / TypeScript coding agents, frameworks (Vercel AI SDK, LangChain.js,
 * Mastra, OpenCode), and CI tooling.
 */
export type {
  Antibody,
  AntibodyStatus,
  DeliveryReceipt,
  DistillResult,
  FailureSnapshot,
  NewAntibody,
  RootCauseType,
  RuleQualityGrade,
  TriageBucket,
  TriageEvent,
  WorkspaceProfile,
} from './types.js';

export type { ReceiptOutcome } from './receipts.js';

export {
  ImmuneStore,
  GlobalStore,
  globalDbPathFor,
  isPromotable,
  type DistillJob,
  type MatchOptions,
  type StoreOptions,
} from './store/index.js';

export {
  ImmuneRuntime,
  DRAIN_BATCH_SIZE,
  clampBudgetMs,
  resolveDrainBudgetMs,
  type DrainSummary,
  type PreToolOutcome,
} from './runtime.js';

export { distillEpisode, distillBatch } from './distiller.js';
export { scoreAntibodyRubric, inferRootCause, type RubricScore } from './rubric.js';
export {
  abstractMachinePaths,
  canonicalizeSymptom,
  classifyRuleQuality,
  deriveProjectScope,
  repairLibraryHygiene,
  type HygieneReport,
  type QualityVerdict,
} from './hygiene.js';
export { triagePostInjectionFailure, summarizeTriage, type TriageSummary } from './triage.js';
export { recordDeliveryReceipt, summarizeReceipts, type ReceiptSummary } from './receipts.js';
export { expandConceptQuery, lexicalTriggerAffinity } from './retrieval.js';
export { explainRecall, type ExplainRecallReport, type ExplainedCandidate } from './explain.js';
export {
  ciCheck,
  parseManagedBlock,
  shareSanityCheck,
  type CiCheckFinding,
  type CiCheckReport,
} from './share-guard.js';
export { BUILTIN_PACKS, type SeedPack, type SeedPackRule } from './packs.js';
export {
  HOSTS,
  connectAllDetected,
  connectHost,
  connectStatus,
  disconnectAllConnected,
  disconnectHost,
  type ConnectHostId,
  type ConnectOptions,
  type ConnectReport,
} from './connect.js';
export { gitHookStatus, installGitHook, removeGitHook, type GitHookStatus } from './git-hook.js';
export { redact, redactAndClamp, redactOutbound } from './redact.js';
export {
  computeImmunityScore,
  escapeSvgText,
  formatCompactNumber,
  renderWrappedSvg,
  type WrappedInput,
  type WrappedNemesis,
} from './wrapped.js';
export {
  canonicalRuleHash,
  isTeamShareSafe,
  parseTeamRulesJsonl,
  serializeTeamRulesJsonl,
  writeTeamRulesFile,
  type TeamRuleRecord,
  type TeamSyncCandidate,
} from './team-sync.js';
