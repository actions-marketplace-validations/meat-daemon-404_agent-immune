# Changelog

All notable changes to **agent-immune** (`dsh-immune-system`) are documented in this file.

## [3.0.1] - 2026-11-21

### Fixed
- **Preserve Existing Lockfile in `immune vaccinate --apply` (`zcode/src/commands/library.ts`)**: When `.immune/vaccine.lock.json` already exists on disk (e.g. a fresh clone with team-committed proven scars), `immune vaccinate --apply` now verifies its SHA-256 integrity and applies it directly without overwriting the lockfile from an empty local SQLite store. Refuses tampered lockfiles (`exit 1`); pass `--refresh` to regenerate explicitly.
- **Prevent `--tool` Value Leakage in `immune guard` (`zcode/src/commands/library.ts`)**: Excluded the value following `--tool` (and `--tool=...`) when building the command payload and preserved command-level flags (e.g. `--force`) so `immune guard --tool Bash "git push origin main --force"` evaluates and rewrites cleanly without a spurious tool-name prefix.
- **TypeScript 5.9 Build & Publish Workflow (`core/guard.ts`, `.github/workflows/npm-publish.yml`)**: Annotated `candidateRewrite: string | null` to eliminate `TS7022`, normalized `package.json` `repository.url` (`git+https://...`), and upgraded `npm-publish.yml` actions to `v7`.

## [3.0.0] - 2026-11-20

### Added
- **Pre-Flight Blast-Radius Guard & Safe Command Rewriter (`immune guard`, `core/guard.ts`)**: Active pre-execution policy and antibody interceptor evaluating proposed `Bash` / `Edit` / `Write` payloads before execution. Computes a `0–100` Blast-Radius Score (`allow` | `warn` | `rewrite` | `block`), blocks catastrophic commands (`rm -rf /`, `rm -rf .git`, destructive `DROP TABLE` / `TRUNCATE` DDL, hardcoded API credentials), automatically rewrites high-friction pitfalls (`git push --force` → `--force-with-lease`, `prisma migrate dev` → `prisma migrate deploy`, `chmod 777` → `755`, `npm install` in `pnpm`/`yarn`/`bun`-locked workspaces), and emits Claude Code / Cursor hook protocol JSON (`--hook`).
- **Declarative Vaccine Lockfile & Workspace DNA Auto-Immunization (`immune vaccinate`, `core/vaccine.ts`)**: Solves Day-0 cold-start by scanning repository manifest markers (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `uv.lock`, `pyproject.toml`, `Dockerfile`, `.github/workflows`) into a deterministic **Workspace DNA** profile, synthesizing zero-day stack antibodies, and compiling a SHA-256 integrity-verified `.immune/vaccine.lock.json` (`--check`, `--apply`, `--markdown`, `--json`).
- **Multi-Workspace Swarm Federation & Antibody Consensus Engine (`immune federate`, `core/federate.ts`)**: Aggregates and clusters semantically equivalent antibodies across multiple repositories and coding agents (`Claude Code`, `Cursor`, `Codex`, `Gemini CLI`, `Windsurf`), filters out machine paths and secrets via `isTeamShareSafe`, computes a **Swarm Consensus Score (`0–100`)**, promotes multi-repo corroborated lessons into **Universal Swarm Laws**, and renders 880×440 dark-mode Swarm Consensus SVGs (`--svg`).
- **Agent Pitfall Archetype Diagnosis, Forensic Autopsy & IDE Rosetta Compiler (`immune diagnose`, `immune autopsy`, `immune compile-rules`)**: 5-domain immunity radar and 6 failure personas (`core/diagnose.ts`), forensic token/API-dollar/spinner-minute ROI ledger and Fragile Scars watchlist (`core/autopsy.ts`), and 1-command transpilation into Cursor `.mdc` (with inferred globs), GitHub Copilot, Windsurf, Cline, and `CLAUDE.md` (`core/compile-rules.ts`).

## [2.3.0] - 2026-11-19

### Added
- **GitHub Marketplace Composite Action (`action.yml`)**: Drop `uses: meat-daemon-404/agent-immune@main` into any GitHub Actions workflow to run `ci-check`, validate `.immune/rules.jsonl` (`team-sync-check`), or publish an Immunity Scorecard to `$GITHUB_STEP_SUMMARY` (`mode: wrapped`).
- **Live README Badge & PR Summary Generator (`immune wrapped --badge` / `--markdown`)**: Added `renderImmunityBadgeSvg()` and `renderWrappedMarkdown()` in `core/wrapped.ts` to emit shields.io-compatible SVG badges and copy-paste Markdown tables for pull requests and READMEs.
- **Git Merge Conflict Auto-Healer & CI Verifier (`immune team-sync --check` / `--dedupe`)**: Added `verifyTeamRulesJsonl()` in `core/team-sync.ts` and automatic `<<<<<<<`/`=======`/`>>>>>>>` conflict marker stripping so `.immune/rules.jsonl` merge conflicts heal deterministically in one command.
- **Shareable Pitfall Scorecard SVG (`immune wrapped`, `core/wrapped.ts`, `assets/wrapped-preview.svg`)**: Zero-dependency 1200×630 dark-mode SVG generator computing a `0–100` Immunity Score, audited call/failure/token KPIs, and top recurring agent nemeses with strict XML entity escaping.
- **Git-Native Zero-Conflict Team Sync (`immune team-sync`, `core/team-sync.ts`)**: Deterministic SHA-256 hash-sorted `.immune/rules.jsonl` serializer and importer with built-in path, email, and credential filtering (`isTeamShareSafe`) for conflict-free multi-branch Git collaboration.
- **MCP Ecosystem Registry Manifests (`server.json`, `smithery.yaml`, `glama.json`)**: Official MCP Registry (`io.github.meat-daemon-404/agent-immune`), Smithery one-click configuration, and Glama discovery metadata, pinned in CI by the 7-manifest / 10-field `scripts/check-versions.mjs` gate.
- **End-to-End A/B Multi-Turn Simulation Benchmark (`scripts/bench-ab-simulation.mjs`)**: Reproducible 30-session A/B benchmark across 10 recurring pitfall families × 3 turns (`-63.3%` total failures, `-95.0%` repeat pitfalls, `-61.4%` avoidable retry tokens, `0.008 ms` p50 recall latency), wired directly into GitHub Actions CI.
- **Read-Only Explainable Recall Simulator (`immune explain`, `/api/explain`, `immune_explain` MCP #21, Dashboard Tab)**: Inspect exact bilingual concept-graph expansions, per-signal scoring breakdowns (`bm25 × hit × path × lexical × rubric × decay`), and rendered `<immune_memory>` previews across terminal CLI, REST API, standalone Web Dashboard, and MCP without ever inflating hit counts.
- **Zero-Config TypeScript SDK Entry (`dsh-immune-system/core`)**: Enabled `.d.ts` type declarations (`tsconfig.json` `declaration: true`) and exported `ImmuneStore`, `ImmuneRuntime`, `explainRecall`, `ciCheck`, `connectHost`, `BUILTIN_PACKS`, `renderWrappedSvg`, `computeImmunityScore`, `serializeTeamRulesJsonl`, `parseTeamRulesJsonl`, `writeTeamRulesFile`, `hydrateTeamRules`, `maybeSyncTeamRulesAfterDrain`, and `redact` under `./core`.
- **11-Host Ecosystem Expansion (`connect` for VS Code, Zed, Roo Code)**: Added `vscode` (`Code/User/mcp.json` under `servers`), `zed` (`zed/settings.json` under `context_servers`), and `roo-code` alongside all 8 existing environments (total **13 environments** including DSH & ZCode).

### Fixed
- **DSH 0.2.2 Session Persistence Format v4 (`dsh/src/dsh-adapter.ts`, #4)**: Updated `createPluginMessage()` to stamp producer-owned `source: { kind: 'plugin:dsh-immune-system' }` required by DSH 0.2.2+ v4 session persistence.
- **Cross-OS Workspace Path Scoping (`core/hygiene.ts`)**: Routed Windows drive paths (`D:\...`) and POSIX paths (`/Users/...`) through `node:path` `win32` / `posix` explicitly so foreign OS paths scope and abstract deterministically across Linux and Windows CI runners.

### Improved
- **9-Pack Retrieval Calibration (`R@1 = 100%`)**: Disambiguated Python `uv run` lockfile vs `pyproject/requirements.txt` and Docker `.dockerignore` concept edges in `core/retrieval.ts`, lifting `scripts/bench-seed-recall.mjs` across all **54 builtin rules** from **R@1 94% → 100%** (`R@3 100%`, `FP 0%`).
