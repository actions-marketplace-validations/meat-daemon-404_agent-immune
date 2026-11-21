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
/** Automatically infer file globs from a rule's trigger, symptom, and prescription. */
export declare function inferRuleGlobs(rule: TeamSyncCandidate): string;
/** Filter and sort share-safe rules eligible for IDE compilation. */
export declare function selectCompilableRules(candidates: ReadonlyArray<TeamSyncCandidate>, minHits?: number): TeamSyncCandidate[];
/** Render a fenced Markdown block for Copilot, Windsurf, Cline, or Claude. */
export declare function renderFencedRuleBlock(target: IdeRuleTarget, rules: ReadonlyArray<TeamSyncCandidate>): string;
/** Render a Cursor `.mdc` rule file with valid YAML frontmatter and per-rule glob hints. */
export declare function renderCursorMdc(rules: ReadonlyArray<TeamSyncCandidate>): string;
/** Merge a fenced block into an existing Markdown file without clobbering user content. */
export declare function mergeFencedContent(existingRaw: string, fencedBlock: string): string;
/**
 * Compile and optionally write IDE rule files for one or more targets.
 */
export declare function compileIdeRules(workspace: string, candidates: ReadonlyArray<TeamSyncCandidate>, opts?: {
    targets?: ReadonlyArray<IdeRuleTarget>;
    minHits?: number;
    dryRun?: boolean;
}): CompiledIdeFile[];
