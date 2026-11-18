/**
 * Render proven antibodies as a shareable SKILL.md.
 *
 * Only high-hit, still-active antibodies are exported: the point is to turn
 * pitfalls that repeatedly mattered into team knowledge, not to dump the whole
 * database into a skill nobody reads.
 */
import type { Antibody } from './types.js';
export interface ExportOptions {
    /** Minimum hit count for an antibody to be considered proven. */
    minHits?: number;
    /** Title shown in the skill frontmatter. */
    title?: string;
    /** Emit bilingual (Chinese + English) scaffolding. Default true. */
    bilingual?: boolean;
}
/** Build the SKILL.md content for the given antibodies. */
export declare function renderSkillMarkdown(antibodies: Antibody[], opts?: ExportOptions): string;
