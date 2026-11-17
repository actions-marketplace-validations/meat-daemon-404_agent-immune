/**
 * Schema for the immune database (v2), as individual statements.
 *
 * Statements run one at a time through `prepare().run()` so DDL stays portable
 * and a broken statement names itself cleanly.
 *
 * FTS5 uses the `trigram` tokenizer for mixed Chinese + English substring recall.
 */
export const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS antibodies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_pattern     TEXT    NOT NULL,
    symptom             TEXT    NOT NULL,
    prescription        TEXT    NOT NULL,
    hit_count           INTEGER NOT NULL DEFAULT 0,
    fail_count          INTEGER NOT NULL DEFAULT 0,
    status              TEXT    NOT NULL DEFAULT 'active',
    tool_name           TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    prescription_source TEXT    NOT NULL DEFAULT '',
    origin              TEXT    NOT NULL DEFAULT '',
    parent_id           INTEGER,
    mutated_at          INTEGER NOT NULL DEFAULT 0,
    env_fingerprint     TEXT    NOT NULL DEFAULT '',
    probation_at        INTEGER NOT NULL DEFAULT 0,
    retire_reason       TEXT    NOT NULL DEFAULT '',
    project_scope       TEXT    NOT NULL DEFAULT '*',
    quality_grade       TEXT    NOT NULL DEFAULT 'advice',
    rubric_score        INTEGER NOT NULL DEFAULT 70,
    root_cause          TEXT    NOT NULL DEFAULT '',
    triage_bucket       TEXT    NOT NULL DEFAULT '',
    ignored_count       INTEGER NOT NULL DEFAULT 0
  )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS antibodies_fts USING fts5(
    trigger_pattern,
    symptom,
    prescription,
    content='antibodies',
    content_rowid='id',
    tokenize='trigram'
  )`,
    `CREATE TRIGGER IF NOT EXISTS antibodies_ai AFTER INSERT ON antibodies BEGIN
    INSERT INTO antibodies_fts(rowid, trigger_pattern, symptom, prescription)
    VALUES (new.id, new.trigger_pattern, new.symptom, new.prescription);
  END`,
    `CREATE TRIGGER IF NOT EXISTS antibodies_ad AFTER DELETE ON antibodies BEGIN
    INSERT INTO antibodies_fts(antibodies_fts, rowid, trigger_pattern, symptom, prescription)
    VALUES ('delete', old.id, old.trigger_pattern, old.symptom, old.prescription);
  END`,
    `CREATE TRIGGER IF NOT EXISTS antibodies_au AFTER UPDATE ON antibodies BEGIN
    INSERT INTO antibodies_fts(antibodies_fts, rowid, trigger_pattern, symptom, prescription)
    VALUES ('delete', old.id, old.trigger_pattern, old.symptom, old.prescription);
    INSERT INTO antibodies_fts(rowid, trigger_pattern, symptom, prescription)
    VALUES (new.id, new.trigger_pattern, new.symptom, new.prescription);
  END`,
    `CREATE TABLE IF NOT EXISTS pending_failures (
    session_id       TEXT    NOT NULL,
    tool_name        TEXT    NOT NULL,
    trace            TEXT    NOT NULL,
    injected_ids     TEXT    NOT NULL DEFAULT '[]',
    human_hint       TEXT    NOT NULL DEFAULT '',
    target_signature TEXT    NOT NULL DEFAULT '',
    created_at       INTEGER NOT NULL,
    PRIMARY KEY (session_id, tool_name)
  )`,
    `CREATE TABLE IF NOT EXISTS stuck_state (
    session_id      TEXT    NOT NULL,
    signature       TEXT    NOT NULL,
    fail_streak     INTEGER NOT NULL DEFAULT 0,
    hypothesized_at INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (session_id, signature)
  )`,
    `CREATE TABLE IF NOT EXISTS detours (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    signature   TEXT    NOT NULL,
    probes      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS session_turns (
    session_id TEXT    PRIMARY KEY,
    signature  TEXT    NOT NULL DEFAULT '',
    turns      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS session_injections (
    session_id    TEXT    PRIMARY KEY,
    ids           TEXT    NOT NULL,
    prescriptions TEXT    NOT NULL DEFAULT '[]',
    created_at    INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_antibodies_status ON antibodies(status, hit_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_antibodies_scope ON antibodies(status, project_scope, hit_count DESC)`,
    `CREATE TABLE IF NOT EXISTS distill_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name     TEXT    NOT NULL,
    failure_trace TEXT    NOT NULL,
    success_trace TEXT    NOT NULL,
    injected_ids  TEXT    NOT NULL DEFAULT '[]',
    human_hint    TEXT    NOT NULL DEFAULT '',
    origin        TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'pending',
    note          TEXT    NOT NULL DEFAULT '',
    repair_path   TEXT    NOT NULL DEFAULT '[]',
    project_scope TEXT    NOT NULL DEFAULT '*',
    cwd           TEXT    NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_status ON distill_jobs(status, created_at)`,
    `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS repair_actions (
    session_id TEXT PRIMARY KEY,
    actions    TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS probe_streaks (
    session_id TEXT    NOT NULL,
    signature  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, signature)
  )`,
    `CREATE TABLE IF NOT EXISTS model_hits (
    rule_id    INTEGER NOT NULL,
    model      TEXT    NOT NULL,
    hits       INTEGER NOT NULL DEFAULT 0,
    fails      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, model)
  )`,
    `CREATE TABLE IF NOT EXISTS session_models (
    session_id  TEXT PRIMARY KEY,
    model       TEXT NOT NULL,
    resolved_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS seed_packs (
    rule_id      INTEGER PRIMARY KEY,
    pack         TEXT    NOT NULL,
    prescription TEXT    NOT NULL,
    seeded_at    INTEGER NOT NULL
  )`,
    // V2: Verifiable delivery receipts (Beacon-inspired credit & outcome chain).
    `CREATE TABLE IF NOT EXISTS delivery_receipts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id       INTEGER NOT NULL,
    session_id    TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    project_scope TEXT    NOT NULL DEFAULT '*',
    outcome       TEXT    NOT NULL,
    tokens_est    INTEGER NOT NULL DEFAULT 0,
    digest        TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_receipts_rule ON delivery_receipts(rule_id, created_at DESC)`,
    // V2: Red-3 Triage audit log (daily-patrol-inspired failure bucket classification).
    `CREATE TABLE IF NOT EXISTS triage_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id      INTEGER,
    session_id   TEXT    NOT NULL DEFAULT '',
    tool_name    TEXT    NOT NULL DEFAULT '',
    bucket       TEXT    NOT NULL,
    reason       TEXT    NOT NULL,
    action_taken TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_triage_bucket ON triage_events(bucket, created_at DESC)`,
    // V2: Whole-disk project registry (tracks discovered workspaces and baselines).
    `CREATE TABLE IF NOT EXISTS workspace_profiles (
    scope_id        TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    root_path       TEXT    NOT NULL,
    stack           TEXT    NOT NULL DEFAULT '',
    baseline        TEXT    NOT NULL DEFAULT 'newly',
    rules_count     INTEGER NOT NULL DEFAULT 0,
    source          TEXT    NOT NULL DEFAULT '',
    last_scanned_at INTEGER NOT NULL
  )`,
];
