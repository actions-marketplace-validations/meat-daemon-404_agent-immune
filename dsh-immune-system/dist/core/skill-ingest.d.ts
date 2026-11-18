import { type BaselineLevel } from './baseline.js';
import type { SeedPackRule } from './packs.js';
import type { ImmuneStore } from './store/index.js';
export interface ParsedSkillDocument {
    frontmatterName?: string;
    rules: SeedPackRule[];
    skippedTooShort: number;
}
export interface SkillIngestOptions {
    pack?: string;
    cwd?: string;
    baseline?: BaselineLevel;
}
export interface SkillIngestReport {
    packId: string;
    filesRead: number;
    parsed: number;
    baselineFiltered: number;
    baseline: BaselineLevel;
    inserted: number;
    alreadySeeded: number;
    skippedTooShort: number;
}
export declare function normalizeSkillPackId(rawName: string): string;
/**
 * Parse external Markdown guidance (SKILL.md, cheat sheets, rulebooks) into
 * compact FTS5-indexable SeedPackRule entries with zero runtime LLM calls.
 */
export declare function parseSkillMarkdown(markdown: string, defaultTitle?: string): ParsedSkillDocument;
/**
 * Ingest Markdown skill/guidance files or directories into FTS5-indexed seed rules
 * under a named `skill:<slug>` pack, filtered by project Baseline.
 */
export declare function ingestSkillPaths(store: ImmuneStore, inputs: string[], opts?: SkillIngestOptions): SkillIngestReport;
