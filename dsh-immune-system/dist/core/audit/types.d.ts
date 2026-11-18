import type { CallRow } from '../backfill.js';
export type AuditSourceName = 'zcode' | 'codex' | 'claude-code' | 'antigravity';
export interface AuditOptions {
    /** Look back this many days (default 30). */
    days?: number;
    sourceDb?: string;
    /** Override ~/.claude/projects (tests). */
    claudeProjectsDir?: string;
    /** Override ~/.codex/sessions (tests). */
    codexSessionsDir?: string;
    /** Override ~/.gemini/antigravity/brain (tests). */
    antigravityBrainDir?: string;
    /** Restrict to one source; default scans every source found on disk. */
    source?: 'auto' | AuditSourceName;
    /** Cap enqueued episodes. */
    max?: number;
    /** Report only — nothing enqueued, nothing distilled (--dry-run). */
    dryRun?: boolean;
    selfMarkers?: string[];
}
export interface AuditToolStat {
    tool: string;
    scanned: number;
    failures: number;
    paired: number;
}
export interface AuditFailureFamily {
    tool: string;
    error: string;
    count: number;
}
export interface AuditSourceReport {
    source: AuditSourceName;
    present: boolean;
    note?: string;
    scanned: number;
    failures: number;
    paired: number;
    superseded: number;
    enqueued: number;
    skippedSelf: number;
    byTool: AuditToolStat[];
    topFailures: AuditFailureFamily[];
    medianRequestTokens: number | null;
    medianSamples: number;
}
export interface AuditReport {
    sources: AuditSourceReport[];
    totals: {
        scanned: number;
        failures: number;
        paired: number;
        enqueued: number;
        skippedSelf: number;
    };
}
export interface AuditSession {
    calls: CallRow[];
    parts: Map<string, {
        input: unknown;
        output: string;
    }>;
    tokenSamples: number[];
    cwd?: string;
}
export declare const TRACE_CLAMP = 1200;
export declare const TOP_FAMILIES = 5;
export declare const MIN_FAMILY_COUNT = 2;
export declare const MIN_TOKEN_SAMPLES = 30;
export declare function clampText(text: string, max?: number): string;
export declare function medianOf(values: number[]): {
    median: number;
    samples: number;
} | null;
export declare function emptySource(source: AuditSourceName, note?: string): AuditSourceReport;
