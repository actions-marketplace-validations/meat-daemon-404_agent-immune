/**
 * v3.0 Cross-Project Swarm Federation & Antibody Consensus Engine (`immune federate`).
 *
 * Aggregates antibody libraries across multiple workspaces or coding agents
 * (Claude Code, Cursor, Codex, Gemini CLI, Windsurf), filters out local paths
 * and secrets via `isTeamShareSafe`, clusters semantically equivalent lessons,
 * and computes a Swarm Consensus Score (0-100) to promote corroborated rules
 * into Universal Swarm Laws.
 */
import type { DiagnosableRule } from './diagnose.js';
export type SwarmConsensusTier = 'universal-law' | 'proven-tactic' | 'local-probation';
export interface SwarmRuleSource {
    readonly sourceId: string;
    readonly rules: ReadonlyArray<DiagnosableRule>;
}
export interface FederatedAntibodyCluster {
    readonly clusterHash: string;
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name: string | null;
    readonly sources: ReadonlyArray<string>;
    readonly sourceCount: number;
    readonly totalHits: number;
    readonly totalFails: number;
    readonly survivalPct: number;
    readonly consensusScore: number;
    readonly tier: SwarmConsensusTier;
}
export interface SwarmFederationReport {
    readonly totalSources: number;
    readonly totalInputRules: number;
    readonly withheldUnsafe: number;
    readonly clusters: ReadonlyArray<FederatedAntibodyCluster>;
    readonly universalLaws: ReadonlyArray<FederatedAntibodyCluster>;
    readonly averageConsensusScore: number;
}
export declare function federateSwarmRules(sources: ReadonlyArray<SwarmRuleSource>, opts?: {
    similarityThreshold?: number;
    minConsensusScore?: number;
}): SwarmFederationReport;
export declare function renderFederationTerminal(report: SwarmFederationReport): string;
export declare function renderFederationMarkdown(report: SwarmFederationReport): string;
export declare function renderFederationSvg(report: SwarmFederationReport): string;
