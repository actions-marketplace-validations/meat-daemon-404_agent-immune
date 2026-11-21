import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.js';
import { repairLibraryHygiene } from '../hygiene.js';

/**
 * Open (and initialise) the immune database.
 *
 * WAL and a busy timeout matter here because several hook processes may open
 * the same file at nearly the same moment. Once a database reaches
 * `SCHEMA_VERSION`, `PRAGMA user_version` short-circuits the ~50 DDL &
 * `PRAGMA table_info` setup checks so short-lived hooks stay sub-millisecond.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  if (dbPath !== ':memory:') {
    db.prepare('PRAGMA journal_mode = WAL').get();
  }
  db.prepare('PRAGMA busy_timeout = 5000').get();

  const currentVersion = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined)
      ?.user_version ?? 0,
  );
  if (dbPath !== ':memory:' && currentVersion === SCHEMA_VERSION) {
    return db;
  }

  for (const statement of SCHEMA_STATEMENTS) {
    // Index on a column that only exists after `migrate` runs on legacy DBs must
    // not abort opening; `migrate` ensures those columns and indexes exist.
    if (statement.includes('idx_antibodies_scope')) continue;
    db.prepare(statement).run();
  }
  migrate(db);
  try {
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_antibodies_scope ON antibodies(status, project_scope, hit_count DESC)',
    ).run();
  } catch {
    // Non-fatal if opened read-only or restricted.
  }
  try {
    db.prepare(`PRAGMA user_version = ${SCHEMA_VERSION}`).run();
  } catch {
    // Read-only databases still work without stamping user_version.
  }
  return db;
}

/**
 * Additive migrations for databases created by an earlier version.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so columns added
 * across versions are checked and appended individually; nothing is dropped.
 */
const COLUMNS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  { table: 'pending_failures', column: 'human_hint', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'pending_failures', column: 'target_signature', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'distill_jobs', column: 'human_hint', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'session_injections', column: 'prescriptions', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'distill_jobs', column: 'repair_path', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'antibodies', column: 'repair_path', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'antibodies', column: 'prescription_source', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'antibodies', column: 'origin', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'distill_jobs', column: 'origin', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'antibodies', column: 'parent_id', ddl: 'INTEGER' },
  { table: 'antibodies', column: 'mutated_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'antibodies', column: 'env_fingerprint', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'antibodies', column: 'probation_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'antibodies', column: 'retire_reason', ddl: "TEXT NOT NULL DEFAULT ''" },
  // V2 schema columns
  { table: 'antibodies', column: 'project_scope', ddl: "TEXT NOT NULL DEFAULT '*'" },
  { table: 'antibodies', column: 'quality_grade', ddl: "TEXT NOT NULL DEFAULT 'advice'" },
  { table: 'antibodies', column: 'rubric_score', ddl: 'INTEGER NOT NULL DEFAULT 70' },
  { table: 'antibodies', column: 'root_cause', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'antibodies', column: 'triage_bucket', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'antibodies', column: 'ignored_count', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  // V4 schema columns
  { table: 'antibodies', column: 'promoted_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'distill_jobs', column: 'project_scope', ddl: "TEXT NOT NULL DEFAULT '*'" },
  { table: 'distill_jobs', column: 'cwd', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'session_turns', column: 'last_prompt_sig', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'session_turns', column: 'prompt_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];

/**
 * Upgrade legacy v1-v3 `pending_failures` whose PRIMARY KEY was `(session_id, tool_name)`
 * to v4's multi-target `(session_id, tool_name, target_signature)` without losing rows.
 */
function migratePendingFailuresPrimaryKey(db: DatabaseSync): void {
  try {
    const info = db.prepare('PRAGMA table_info(pending_failures)').all() as Array<{
      name?: unknown;
      pk?: unknown;
    }>;
    const targetCol = info.find((row) => row.name === 'target_signature');
    if (!targetCol || Number(targetCol.pk ?? 0) > 0) return;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE pending_failures_v4 (
          session_id       TEXT    NOT NULL,
          tool_name        TEXT    NOT NULL,
          trace            TEXT    NOT NULL,
          injected_ids     TEXT    NOT NULL DEFAULT '[]',
          human_hint       TEXT    NOT NULL DEFAULT '',
          target_signature TEXT    NOT NULL DEFAULT '',
          created_at       INTEGER NOT NULL,
          PRIMARY KEY (session_id, tool_name, target_signature)
        );
        INSERT OR REPLACE INTO pending_failures_v4
          (session_id, tool_name, trace, injected_ids, human_hint, target_signature, created_at)
        SELECT session_id, tool_name, trace, COALESCE(injected_ids, '[]'),
               COALESCE(human_hint, ''), COALESCE(target_signature, ''), created_at
          FROM pending_failures;
        DROP TABLE pending_failures;
        ALTER TABLE pending_failures_v4 RENAME TO pending_failures;
      `);
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
    }
  } catch {
    // Non-fatal on read-only or synthetic DBs.
  }
}

function migrate(db: DatabaseSync): void {
  let addedV2Quality = false;
  for (const { table, column, ddl } of COLUMNS) {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
      if (info.some((row) => row.name === column)) continue;
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
      if (table === 'antibodies' && column === 'quality_grade') addedV2Quality = true;
    } catch {
      // A migration must never prevent the host from starting.
    }
  }
  migratePendingFailuresPrimaryKey(db);
  if (addedV2Quality) {
    try {
      repairLibraryHygiene(db);
    } catch {
      // Best-effort v1 -> v2 hygiene heal on first schema upgrade.
    }
  }
}

/** Default on-disk location for a store that was not given an explicit path. */
export function defaultDbPath(base?: string): string {
  return base ? resolve(base, 'immune.sqlite') : resolve(process.cwd(), '.dsh', 'immune.sqlite');
}
