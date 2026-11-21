import { DatabaseSync } from 'node:sqlite';
/**
 * Open (and initialise) the immune database.
 *
 * WAL and a busy timeout matter here because several hook processes may open
 * the same file at nearly the same moment. Once a database reaches
 * `SCHEMA_VERSION`, `PRAGMA user_version` short-circuits the ~50 DDL &
 * `PRAGMA table_info` setup checks so short-lived hooks stay sub-millisecond.
 */
export declare function openDatabase(dbPath: string): DatabaseSync;
/** Default on-disk location for a store that was not given an explicit path. */
export declare function defaultDbPath(base?: string): string;
