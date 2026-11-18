import type { ImmuneStore } from './store/index.js';
export interface CoverageOptions {
    days?: number;
    top?: number;
    /** Host session database; defaults to IMMUNE_HOST_DB or ZCode's path. */
    sourceDb?: string;
    env?: NodeJS.ProcessEnv;
}
export interface CoverageCluster {
    tool: string;
    /** Normalized error signature used for grouping. */
    signature: string;
    count: number;
    sessions: number;
    /** One raw error line, for the human reading the report. */
    example: string;
}
export interface CoverageReport {
    days: number;
    failures: number;
    /** Failures that are not lessons (user cancelled, plan-mode denial, reset). */
    noise: number;
    /** A rule exists for this failure, whatever its status. */
    covered: number;
    /** Of those, the ones covered by a rule that is still injected. */
    deliverable: number;
    uncovered: number;
    /** Biggest uncovered clusters first. */
    clusters: CoverageCluster[];
}
export declare function isNoiseFailure(text: string): boolean;
/** Absolute paths, numbers and quoted literals vary per instance; the shape does not. */
export declare function normaliseFailure(text: string): string;
export declare function coverage(store: ImmuneStore, opts?: CoverageOptions): CoverageReport;
