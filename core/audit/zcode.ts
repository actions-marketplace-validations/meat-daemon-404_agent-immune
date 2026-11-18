import { DatabaseSync } from 'node:sqlite';
import { BACKFILL_TOOLS, loadCalls, loadParts } from '../backfill.js';
import { medianOf, type AuditSession } from './types.js';

/**
 * High-speed ZCode session loader: only fetches `part` inputs for sessions that
 * have BOTH an error call AND a completed call inside BACKFILL_TOOLS, preventing
 * multi-GB `part` scans from hanging on real 3+ GB ZCode databases.
 */
export function loadZcodeSessions(sourceDb: string, since: number): AuditSession[] {
  const db = new DatabaseSync(sourceDb, { readOnly: true });
  try {
    const calls = loadCalls(db, since);
    const hasErr = new Set<string>();
    const hasOkAfterErr = new Set<string>();
    for (const call of calls) {
      if (!BACKFILL_TOOLS.has(call.tool_name)) continue;
      if (call.status === 'error') hasErr.add(call.session_id);
      else if (hasErr.has(call.session_id)) hasOkAfterErr.add(call.session_id);
    }

    const candidateSessions = [...hasOkAfterErr];
    const neededCallIds = new Set<string>();
    for (const call of calls) {
      if (hasOkAfterErr.has(call.session_id) && BACKFILL_TOOLS.has(call.tool_name)) {
        neededCallIds.add(call.tool_call_id);
      }
    }

    const parts = loadParts(db, candidateSessions, neededCallIds);
    const sessionDirs = new Map<string, string>();
    try {
      const rows = db
        .prepare('SELECT id, directory FROM session')
        .all() as Array<{ id?: unknown; directory?: unknown }>;
      for (const row of rows) {
        if (typeof row.id === 'string' && typeof row.directory === 'string' && row.directory) {
          sessionDirs.set(row.id, row.directory);
        }
      }
    } catch {
      // Minimal test fixtures omit the `session` table; scope falls back cleanly.
    }
    const sessions = new Map<string, AuditSession>();
    for (const call of calls) {
      let bucket = sessions.get(call.session_id);
      if (!bucket) {
        const cwd = sessionDirs.get(call.session_id);
        bucket = { calls: [], parts, tokenSamples: [], ...(cwd ? { cwd } : {}) };
        sessions.set(call.session_id, bucket);
      }
      bucket.calls.push(call);
    }
    return [...sessions.values()];
  } finally {
    db.close();
  }
}

export function zcodeTokenMedian(sourceDb: string): { median: number; samples: number } | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(sourceDb, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT computed_total_tokens AS t FROM model_usage
          WHERE status = 'completed' AND computed_total_tokens > 0
          ORDER BY started_at DESC LIMIT 500`,
      )
      .all() as Array<{ t: number }>;
    return medianOf(rows.map((row) => Number(row.t)));
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Read-only probe.
    }
  }
}
