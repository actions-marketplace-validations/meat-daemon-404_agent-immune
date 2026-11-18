# Changelog

All notable changes to **agent-immune** (`dsh-immune-system`) are documented in this file.

## [2.3.0] - 2026-11-18

### Added
- **Read-Only Explainable Recall Simulator (`immune explain`, `/api/explain`, `immune_explain` MCP #21, Dashboard Tab)**: Inspect exact bilingual concept-graph expansions, per-signal scoring breakdowns (`bm25 × hit × path × lexical × rubric × decay`), and rendered `<immune_memory>` previews across terminal CLI, REST API, standalone Web Dashboard, and MCP without ever inflating hit counts.
- **Zero-Config TypeScript SDK Entry (`dsh-immune-system/core`)**: Enabled `.d.ts` type declarations (`tsconfig.json` `declaration: true`) and exported `ImmuneStore`, `ImmuneRuntime`, `explainRecall`, `ciCheck`, `connectHost`, `BUILTIN_PACKS`, and `redact` under `./core` for custom agent frameworks (Vercel AI SDK, LangChain.js, Mastra, OpenCode).
- **11-Host Ecosystem Expansion (`connect` for VS Code, Zed, Roo Code)**: Added `vscode` (`Code/User/mcp.json` under `servers`), `zed` (`zed/settings.json` under `context_servers`), and `roo-code` alongside all 8 existing environments (total **13 environments** including DSH & ZCode).

### Improved
- **9-Pack Retrieval Calibration (`R@1 = 100%`)**: Disambiguated Python `uv run` lockfile vs `pyproject/requirements.txt` and Docker `.dockerignore` concept edges in `core/retrieval.ts`, lifting `scripts/bench-seed-recall.mjs` across all **54 builtin rules** from **R@1 94% → 100%** (`R@3 100%`, `FP 0%`).

## [2.2.0] - 2026-11-18

### Added
- **Local Git `pre-commit` Gate (`immune git-hook`)**: Non-destructive `.git/hooks/pre-commit` installer (`--install`, `--remove`, `--status`, `--warn-only`, `--json`) supporting standard `.git` repos, worktrees, and coexistence with existing Husky / user hooks.
- **Shell Tab Completions (`immune completions`)**: Built-in completion generators for `bash`, `zsh`, `fish`, and `powershell` covering all 26 subcommands, 9 seed packs, and 8 host targets.
- **Rust & Go Bilingual Concept Graph**: Added bilingual semantic synonym edges (`core/retrieval.ts`) for borrow-checker aliasing (`E0502`), `Send` across `.await`, Tokio executor blocking, Go typed-nil interfaces, and concurrent map writes.
- **Community Standards**: Added `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, feature-request issue template, and convenience npm scripts (`npm run check`, `npm run bench`, `npm run verify`).

### Fixed
- **Conversational CJK Recall Noise (`core/store/tokenize.ts`)**: Filtered zero-signal conversational Chinese bigrams/trigrams (`继续`, `优化`, `帮我看看`, `下一步`, etc.) so short conversational prompts no longer trigger unrelated rules (pinned at 0% FP in `bench-recall.mjs` and `bench-seed-recall.mjs`).
- **Shared-Library Repeat Suppression (`core/store/turn-state.ts`, `core/store/index.ts`)**: Extended turn repeat-suppression signatures to cover shared-library rules (`shared.sqlite`) by prescription digest, fixing infinite per-turn re-injection when `rankedOwn` is empty.
- **Mid-Turn Duplicate `PreInvocation` Suppression (`core/store/turn-state.ts`, `zcode/src/hooks/user-prompt-submit.ts`)**: Added SQLite-backed `claimPromptTurn` / `clearPromptTurn` turn locks so hosts that emit `PreInvocation` before every tool-loop step inside one user turn inject at most once per user message.
- **Session Injection Accumulation (`core/store/episodes.ts`)**: `recordInjection` now unions unexpired deliveries within the active TTL window instead of overwriting earlier turn-start/priming injections during `PreToolUse`.
- **Passive Read Tool Isolation (`core/runtime.ts`)**: `PreToolUse` on passive read/search tools (`Read`, `Glob`, `Grep`) now enforces `strictToolMatch` so reading files never misfires or inflates `hit_count` on `Bash`/`Edit` antibodies.

## [2.1.0] - 2026-11-18

### Added
- **10-Environment Multi-Agent Ecosystem**: Extended `immune connect` to wire **Gemini CLI** (`~/.gemini/settings.json`), **Cursor** (`~/.cursor/hooks.json` + sidecar MCP), **Windsurf**, **Claude Desktop**, and **Cline** alongside **Claude Code**, **Codex CLI**, **Google Antigravity**, **ZCode**, and **DSH**, plus zero-arg `connect --remove`.
- **Composite GitHub Action (`action.yml`) & Upgraded `ci-check`**: 3-line PR pitfall gate with hunk line-number parsing, GitHub `::warning` / `::error` file+line annotations, `$GITHUB_STEP_SUMMARY` Markdown reports, managed-block self-skip, and Decision #17 CLI flag boundary safety (`--force` vs `--force-with-lease`).
- **9 Builtin Seed Packs (54 Rules)**: Added `rust-cargo` (6 rules) and `go-mod` (6 rules) with automatic `Cargo.toml` / `go.mod` stack prewarming.
- **20 MCP Server Tools**: Added `immune_doctor` and `immune_ci_check`; `immune_learn` now records `prescription_source = 'human'`.
- **CLI & Dual-UI Polish**: Added `immune` binary alias, non-mutating `--help` / `--version` pre-dispatch, `--json` across inspection commands, `?lang=en|zh-CN` toggle, `Export JSON`, and fixed `Workspaces` tab rendering.

### Fixed
- **Strict Workspace Scope & Hygiene Parity**: Quarantined inline JS/Python dumps, browser tool dumps, and media filenames; structurally locked `prescription_source = 'rule'` to workspace scope (`universalEligible = false`); unified `distillBatch()` hygiene gates; routed hook SQLite paths via `event.cwd` / `workspacePaths` / `workspace_roots`.
- **Append-Only Receipt Chain & Seed Cleanup**: Preserved `delivery_receipts` SHA-256 chain integrity on `removeAntibody()`, fixed windowed `summarizeReceipts()` verification, and cleaned orphan `seed_packs` rows.
- **Manifest Parity**: Synced all 6 manifests (8 version fields) and fixed root `package.json` `dsh.client.inject` (`@deepseek-ai/dsh-client-ui-settings`).

## [2.0.0] - 2026-11-16

### Added
- **Unified `ImmuneRuntime` (`core/runtime.ts`)**: Consolidated host lifecycle state machine across DSH and Hook adapters with shared `1–60 s` drain budget clamp.
- **5-Dimension Quality Rubric & Workspace Isolation (`core/rubric.ts`, `core/hygiene.ts`)**: Path abstraction (`<repo>`/`<path>`), `advice` / `tactic` / `quarantined` grading, and one-command `immune hygiene` repair.
- **Red-3 Failure Triage & SHA-256 Delivery Receipts (`core/triage.ts`, `core/receipts.ts`)**: 5-bucket post-injection triage, `[CRITICAL · ignored N×]` salience escalation, and tamper-evident delivery receipts.
- **Whole-Disk Asset Ingestion & Magpie Telemetry (`core/disk-ingest.ts`, `core/audit/magpie.ts`)**: Local repository/skill mining and read-only multi-model gateway correlation.
