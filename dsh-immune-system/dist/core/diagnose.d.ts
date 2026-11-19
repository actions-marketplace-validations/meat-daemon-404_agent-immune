export interface DiagnosableRule {
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name?: string | null;
    readonly hit_count?: number;
    readonly fail_count?: number;
    readonly status?: string;
}
export type PitfallDomainId = 'filesystem' | 'shell' | 'toolchain' | 'types' | 'git_ci';
export interface DomainRadarAxis {
    readonly id: PitfallDomainId;
    readonly label: string;
    readonly ruleCount: number;
    readonly totalHits: number;
    readonly immunityPct: number;
}
export interface AgentArchetype {
    readonly id: 'blind-surgeon' | 'shell-trapper' | 'lockfile-rebel' | 'type-gladiator' | 'env-drifter' | 'immunized-sentinel';
    readonly title: string;
    readonly tagline: string;
    readonly diagnosis: string;
    readonly recommendedPacks: ReadonlyArray<string>;
    readonly vaccinePrompt: string;
}
export interface AgentDiagnosisReport {
    readonly activeRules: number;
    readonly totalHits: number;
    readonly overallImmunityPct: number;
    readonly dominantDomain: PitfallDomainId;
    readonly archetype: AgentArchetype;
    readonly radar: ReadonlyArray<DomainRadarAxis>;
}
export declare function classifyRuleDomain(rule: DiagnosableRule): PitfallDomainId;
export declare function diagnoseAgentArchetype(rules: ReadonlyArray<DiagnosableRule>): AgentDiagnosisReport;
export declare function renderDiagnosisTerminal(report: AgentDiagnosisReport): string;
export declare function renderDiagnosisMarkdown(report: AgentDiagnosisReport): string;
export declare function renderDiagnosisSvg(report: AgentDiagnosisReport): string;
