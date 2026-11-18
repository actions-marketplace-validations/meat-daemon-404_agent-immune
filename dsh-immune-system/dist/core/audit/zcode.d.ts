import { type AuditSession } from './types.js';
/**
 * High-speed ZCode session loader: only fetches `part` inputs for sessions that
 * have BOTH an error call AND a completed call inside BACKFILL_TOOLS, preventing
 * multi-GB `part` scans from hanging on real 3+ GB ZCode databases.
 */
export declare function loadZcodeSessions(sourceDb: string, since: number): AuditSession[];
export declare function zcodeTokenMedian(sourceDb: string): {
    median: number;
    samples: number;
} | null;
