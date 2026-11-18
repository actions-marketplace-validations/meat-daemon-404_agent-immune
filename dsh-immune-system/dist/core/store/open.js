import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA_STATEMENTS } from './schema.js';
import { repairLibraryHygiene } from '../hygiene.js';
/**
 * Open (and initialise) the immune database.
 *
 * WAL and a busy timeout matter here because several hook processes may open
 * the same file at nearly the same moment. Statements run one at a time so a
 * broken migration names the DDL that failed instead of a wall of SQL.
 */
export function openDatabase(dbPath) {
    if (dbPath !== ':memory:')
        mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
        db.prepare('PRAGMA journal_mode = WAL').get();
    }
    db.prepare('PRAGMA busy_timeout = 5000').get();
    for (const statement of SCHEMA_STATEMENTS) {
        // Index on a column that only exists after `migrate` runs on legacy DBs must
        // not abort opening; `migrate` ensures those columns and indexes exist.
        if (statement.includes('idx_antibodies_scope'))
            continue;
        db.prepare(statement).run();
    }
    migrate(db);
    try {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_antibodies_scope ON antibodies(status, project_scope, hit_count DESC)').run();
    }
    catch {
        // Non-fatal if opened read-only or restricted.
    }
    return db;
}
/**
 * Additive migrations for databases created by an earlier version.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so columns added
 * across versions are checked and appended individually; nothing is dropped.
 */
const COLUMNS = [
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
    { table: 'distill_jobs', column: 'project_scope', ddl: "TEXT NOT NULL DEFAULT '*'" },
    { table: 'distill_jobs', column: 'cwd', ddl: "TEXT NOT NULL DEFAULT ''" },
    { table: 'session_turns', column: 'last_prompt_sig', ddl: "TEXT NOT NULL DEFAULT ''" },
    { table: 'session_turns', column: 'prompt_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];
function migrate(db) {
    let addedV2Quality = false;
    for (const { table, column, ddl } of COLUMNS) {
        try {
            const info = db.prepare(`PRAGMA table_info(${table})`).all();
            if (info.some((row) => row.name === column))
                continue;
            db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
            if (table === 'antibodies' && column === 'quality_grade')
                addedV2Quality = true;
        }
        catch {
            // A migration must never prevent the host from starting.
        }
    }
    if (addedV2Quality) {
        try {
            repairLibraryHygiene(db);
        }
        catch {
            // Best-effort v1 -> v2 hygiene heal on first schema upgrade.
        }
    }
}
/** Default on-disk location for a store that was not given an explicit path. */
export function defaultDbPath(base) {
    return base ? resolve(base, 'immune.sqlite') : resolve(process.cwd(), '.dsh', 'immune.sqlite');
}
