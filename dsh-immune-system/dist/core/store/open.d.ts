import { DatabaseSync } from 'node:sqlite';
/**
 * Open (and initialise) the immune database.
 *
 * WAL and a busy timeout matter here because several hook processes may open
 * the same file at nearly the same moment. Statements run one at a time so a
 * broken migration names the DDL that failed instead of a wall of SQL.
 */
export declare function openDatabase(dbPath: string): DatabaseSync;
/** Default on-disk location for a store that was not given an explicit path. */
export declare function defaultDbPath(base?: string): string;
