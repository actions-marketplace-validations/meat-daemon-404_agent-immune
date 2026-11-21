/**
 * Agent Pitfall Archetype & 5-Domain Immunity Radar Diagnosis (`immune diagnose`).
 *
 * Analyzes an agent's learned antibody library and failure distribution across
 * five engineering domains, assigns a vivid technical failure persona, and
 * prescribes a targeted seed-pack "booster shot" + 3-line system-prompt vaccine.
 */
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
/**
 * Compute a full 5-domain radar breakdown and archetype diagnosis from a rule list.
 */
export declare function diagnoseAgentArchetype(rules: ReadonlyArray<DiagnosableRule>): AgentDiagnosisReport;
/** Render a terminal-friendly diagnostic card with ASCII radar bars. */
export declare function renderDiagnosisTerminal(report: AgentDiagnosisReport): string;
/** Render a shareable GitHub Markdown diagnostic report. */
export declare function renderDiagnosisMarkdown(report: AgentDiagnosisReport): string;
/** Render a standalone 880x440 dark-mode SVG card for the Agent Pitfall Archetype & 5-Domain Radar. */
export declare function renderDiagnosisSvg(report: AgentDiagnosisReport): string;
