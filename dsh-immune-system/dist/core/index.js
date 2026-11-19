/**
 * Public programmatic SDK barrel (`import { ... } from 'dsh-immune-system/core'`).
 *
 * Exposes the zero-dependency SQLite+FTS5 pitfall immunity engine for custom
 * Node.js / TypeScript coding agents, frameworks (Vercel AI SDK, LangChain.js,
 * Mastra, OpenCode), and CI tooling.
 */
export { ImmuneStore, GlobalStore, globalDbPathFor, isPromotable, } from './store/index.js';
export { ImmuneRuntime, DRAIN_BATCH_SIZE, clampBudgetMs, resolveDrainBudgetMs, } from './runtime.js';
export { distillEpisode, distillBatch } from './distiller.js';
export { scoreAntibodyRubric, inferRootCause } from './rubric.js';
export { abstractMachinePaths, canonicalizeSymptom, classifyRuleQuality, deriveProjectScope, repairLibraryHygiene, } from './hygiene.js';
export { triagePostInjectionFailure, summarizeTriage } from './triage.js';
export { recordDeliveryReceipt, summarizeReceipts } from './receipts.js';
export { expandConceptQuery, lexicalTriggerAffinity } from './retrieval.js';
export { explainRecall } from './explain.js';
export { ciCheck, parseManagedBlock, shareSanityCheck, } from './share-guard.js';
export { BUILTIN_PACKS } from './packs.js';
export { HOSTS, connectAllDetected, connectHost, connectStatus, disconnectAllConnected, disconnectHost, } from './connect.js';
export { gitHookStatus, installGitHook, removeGitHook } from './git-hook.js';
export { redact, redactAndClamp, redactOutbound } from './redact.js';
export { computeImmunityScore, escapeSvgText, formatCompactNumber, renderImmunityBadgeSvg, renderWrappedMarkdown, renderWrappedSvg, } from './wrapped.js';
export { canonicalRuleHash, hydrateTeamRules, isTeamShareSafe, maybeSyncTeamRulesAfterDrain, parseTeamRulesJsonl, serializeTeamRulesJsonl, verifyTeamRulesJsonl, writeTeamRulesFile, } from './team-sync.js';
export { classifyRuleDomain, diagnoseAgentArchetype, renderDiagnosisMarkdown, renderDiagnosisSvg, renderDiagnosisTerminal, } from './diagnose.js';
export { IDE_TARGET_PATHS, compileIdeRules, inferRuleGlobs, mergeFencedContent, renderCursorMdc, renderFencedRuleBlock, selectCompilableRules, } from './compile-rules.js';
export { renderAutopsyMarkdown, renderAutopsyTerminal, runPitfallAutopsy, } from './autopsy.js';
