/**
 * Schema for the immune database (v4), as individual statements.
 *
 * Statements run one at a time through `prepare().run()` so DDL stays portable
 * and a broken statement names itself cleanly.
 *
 * FTS5 uses the `trigram` tokenizer for mixed Chinese + English substring recall.
 */
export declare const SCHEMA_VERSION = 4;
export declare const SCHEMA_STATEMENTS: readonly string[];
