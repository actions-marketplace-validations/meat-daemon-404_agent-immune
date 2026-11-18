import type { DatabaseSync } from 'node:sqlite';
/**
 * Cross-process counters and bookkeeping in one key-value table.
 *
 * Every hook is its own process, so anything the UI or doctor wants to report
 * has to live in the database, not module memory. Access is parameterized and
 * values are stored as text; read it back with `readMeta`.
 */
/** Increment (or initialise) a counter. Returns the new value. */
export declare function bumpMeta(db: DatabaseSync, key: string, delta?: number): number;
/** Read one key, defaulting to 0. */
export declare function readMeta(db: DatabaseSync, key: string): number;
/** Set one key to an absolute integer value (timestamps, not just counters). */
export declare function setMeta(db: DatabaseSync, key: string, value: number): void;
