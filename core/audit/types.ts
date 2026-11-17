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
  parts: Map<string, { input: unknown; output: string }>;
  tokenSamples: number[];
  cwd?: string;
}

export const TRACE_CLAMP = 1_200;
export const TOP_FAMILIES = 5;
export const MIN_FAMILY_COUNT = 2;
export const MIN_TOKEN_SAMPLES = 30;

export function clampText(text: string, max = 2_000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function medianOf(values: number[]): { median: number; samples: number } | null {
  if (values.length < MIN_TOKEN_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return Number.isFinite(median) && median > 0
    ? { median: Math.round(median), samples: sorted.length }
    : null;
}

export function emptySource(source: AuditSourceName, note?: string): AuditSourceReport {
  return {
    source,
    present: false,
    ...(note !== undefined ? { note } : {}),
    scanned: 0,
    failures: 0,
    paired: 0,
    superseded: 0,
    enqueued: 0,
    skippedSelf: 0,
    byTool: [],
    topFailures: [],
    medianRequestTokens: null,
    medianSamples: 0,
  };
}
