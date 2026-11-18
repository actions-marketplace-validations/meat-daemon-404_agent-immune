import type { ImmuneStore } from './store/index.js';
import type { NewAntibody } from './types.js';
export interface DiskIngestOptions {
    roots?: string[];
    maxDepth?: number;
    maxProjects?: number;
    maxRulesPerProject?: number;
    dryRun?: boolean;
    includeCodexSkills?: boolean;
}
export interface DiscoveredRepo {
    scopeId: string;
    name: string;
    rootPath: string;
    kind: 'skill' | 'dsh-plugin' | 'monorepo' | 'app';
    stacks: string[];
    baseline: string;
    extractedRules: NewAntibody[];
}
export interface DiskIngestReport {
    roots: string[];
    projectsScanned: number;
    profilesRecorded: number;
    rulesExtracted: number;
    rulesInserted: number;
    universalRules: number;
    scopedRules: number;
    skippedLowQuality: number;
    dryRun: boolean;
    projects: Array<{
        name: string;
        scopeId: string;
        kind: string;
        stacks: string[];
        rules: number;
        path: string;
    }>;
}
/**
 * Extract structured pitfall/invariant rules from AGENTS.md, CLAUDE.md,
 * REWRITE-NOTES.md, triage.md, or README.md troubleshooting sections.
 */
export declare function extractEngineeringRules(md: string, opts: {
    projectName: string;
    rootPath: string;
    scopeId: string;
    universal: boolean;
    isSkill?: boolean;
}): NewAntibody[];
/** Discover projects under `roots` safely without entering build/cache/binary trees. */
export declare function discoverDiskProjects(roots: string[], opts?: {
    maxDepth?: number;
    maxProjects?: number;
    includeCodexSkills?: boolean;
}): DiscoveredRepo[];
/**
 * Ingest discovered workspace profiles and scoped/universal engineering pitfalls
 * across local roots into the immune store.
 */
export declare function ingestDiskCorpus(store: ImmuneStore, opts?: DiskIngestOptions): DiskIngestReport;
