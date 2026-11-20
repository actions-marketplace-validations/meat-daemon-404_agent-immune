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
