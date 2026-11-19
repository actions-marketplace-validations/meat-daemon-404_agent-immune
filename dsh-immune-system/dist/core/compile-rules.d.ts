import { type TeamSyncCandidate } from './team-sync.js';
export type IdeRuleTarget = 'cursor' | 'copilot' | 'windsurf' | 'cline' | 'claude';
export declare const IDE_TARGET_PATHS: Record<IdeRuleTarget, string>;
export interface CompiledIdeFile {
    readonly target: IdeRuleTarget;
    readonly relativePath: string;
    readonly fullPath: string;
    readonly rulesCount: number;
    readonly content: string;
}
export declare function inferRuleGlobs(rule: TeamSyncCandidate): string;
export declare function selectCompilableRules(candidates: ReadonlyArray<TeamSyncCandidate>, minHits?: number): TeamSyncCandidate[];
export declare function renderFencedRuleBlock(target: IdeRuleTarget, rules: ReadonlyArray<TeamSyncCandidate>): string;
export declare function renderCursorMdc(rules: ReadonlyArray<TeamSyncCandidate>): string;
export declare function mergeFencedContent(existingRaw: string, fencedBlock: string): string;
export declare function compileIdeRules(workspace: string, candidates: ReadonlyArray<TeamSyncCandidate>, opts?: {
    targets?: ReadonlyArray<IdeRuleTarget>;
    minHits?: number;
    dryRun?: boolean;
}): CompiledIdeFile[];
