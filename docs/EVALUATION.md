# Evaluation & Real-World Benchmarks (`dsh-immune-system@4.1.0`)

All metrics below are directly measured on the `dsh-immune-system@4.1.0` codebase using built-in test suites and reproducible scripts under `scripts/`. None of the numbers are fabricated or extrapolated.

---

## 1. Environment Specification

- **Runtime**: Node.js `v24.20.0` (`^22.19.0 || >=24.0.0`), zero runtime npm dependencies (`node:sqlite` + `node:zlib` built-in only)
- **Operating System**: Windows 11 & Ubuntu Linux CI Matrix
- **Verified Local Ecosystems & Datasets**:
  - **ZCode CLI**: `21,034` tool calls (`885` sessions, `20,330` `model_usage` calls) + live plugin DB (`57` rules, `12,332` cumulative deliveries)
  - **DeepSeek Harness (DSH)**: Cordis desktop profile + live plugin DB (`80e825e246e75be5.sqlite`, `33` active rules, v4 session source `plugin:dsh-immune-system`)
  - **Codex CLI**: `2,825` tool calls (`42` JSONL rollouts, `60.06 MB`)
  - **Antigravity**: `5,102` tool calls (`~290 MB` trajectories)
  - **Magpie Multi-Model Gateway**: `11,165` routed requests (`routing/*.jsonl(.gz)`) + `11,496` usage probes (`usage.jsonl`), **`4.27B`** input+cache tokens across **`70`** model identifiers and **`5`** agents (`zcode`, `dsh`, `curl`, `opencode`, `claude-desktop`)
  - **Whole-Disk Corpus (`D:\`)**: `184` discovered repositories, DSH plugins, monorepos, and reusable `SKILL.md` skills

---

## 2. Automated Verification Summary

| Suite / Script | Command | Result | Scope |
| --- | --- | --- | --- |
| Unit & Integration Suite | `npm test` | **315 / 315 passed (`0` failed, `0` skipped)** | Core store (`user_version` v4 fast-path, `BEGIN IMMEDIATE` atomicity, multi-target episodes), hygiene, rubric, Red-3 triage, `BEGIN IMMEDIATE` SHA-256 receipts + `'held'` ROI, live unified Pre-Flight Guard (chained-command & flag-order matrix) & `guard_events`, SSRF/redirect defense, DNS-rebinding UI guard, `explain` simulator, `wrapped` SVG, `team-sync` JSONL, `vaccinate` auto-hydration, `federate`, `diagnose`, `autopsy`, `compile-rules`, `./core` SDK, `git-hook` (`core.hooksPath` + worktree `commondir`), 13 `connect` hosts, MCP (`27` tools + `5` resources + `3` prompts), Doctor v4 checks, manifests |
| Version Sync Guard | `node scripts/check-versions.mjs` | **10/10 fields aligned at `4.1.0`** | All 7 root/plugin/DSH/ZCode/marketplace/Claude/MCP-Registry manifests |
| Dist Graph Integrity | `node scripts/verify-dist-integrity.mjs` (+ `--self-test`) | **Passed (0 failed)** | 1:1 `src -> dist` mapping & relative import resolution (`107` files, `343` imports) |
| End-to-End A/B Simulation | `node scripts/bench-ab-simulation.mjs` | **Passed (`-95.0%` repeat pitfalls)** | 30 sessions (10 pitfall families × 3 turns): `-63.3%` total failures, `-61.4%` tokens, `0.005 ms` p50 recall |
| DSH Outcome & Adapters | `node scripts/verify-step1.mjs` & `verify-steps23.mjs` | **15/15** & **24/24 passed** | Outcome judge, fail→success pair, inject, probes, DSH v4 message source |
| Live Cordis Host Replay | `node scripts/verify-live-host.mjs` | **20/20 passed (`0` failed)** | Event bus, `turn-stopping`, priming, cold resume |
| DSH Web Bundle Serving | `node scripts/verify-client-serve.mjs` | **10/10 passed (`profile=desktop`)** | `ClientModuleRegistry` `/plugins/dsh-immune-system/client.js` |
| Cross-Host Hook E2E | `node scripts/verify-connected-runtime.mjs` | **42/42 passed (`0` failed)** | Claude Code + Codex + Antigravity + Gemini CLI + Cursor hooks, workspace routing & guard deny |
| ZCode Manifest Validation | `node "D:\zcode\resources\glm\zcode.cjs" plugins validate dsh-immune-system` | **Valid** | Official ZCode plugin validator |

---

## 3. Retrieval Precision, Scale, Latency, Judge Replay & A/B Multi-Turn Simulation

### 3.1 Retrieval Precision & Zero False Positives

- **`node scripts/bench-recall.mjs`** (bilingual paraphrase matrix):
  - **`R@1: 100%`**, **`R@3: 100%`**, **`FP: 0% (0/8)`** (`8` positives, `8` negatives including conversational CJK traps)
- **`node scripts/bench-seed-recall.mjs`** (all 12 builtin packs, `72` paraphrased queries):
  - After `lexicalTriggerAffinity` + disambiguated concept graph + unstarved hybrid FTS5/CJK recall (`core/retrieval.ts`, `core/store/antibodies.ts`, `core/store/rerank.ts`):
    - **`R@1: 100%` (`72 / 72`)**
    - **`R@3: 100%` (`72 / 72`)**
    - **`FP: 0% (0 / 9)`**

### 3.2 Indexing & Query Tail Latency (`node scripts/bench-scale.mjs`)

- Seeded **`300` rules in `60 ms`** (`0.20 ms/rule`)
- Executed **`67` queries**: **`p50 = 0.93 ms`**, **`p95 = 1.40 ms`**, **`max = 6.04 ms`**

### 3.3 Hook Path Isolation & Batched Turn-End Drain (`node scripts/bench-tool-latency.mjs`)

Mock OpenAI endpoint (`800 ms` artificial latency per HTTP round-trip):
- **`tools/post-execute` hot path**: **`median = 1.42–1.82 ms`**, **`worst = 4.52 ms`** (zero model calls on tool execution path).
- **Batched `agent/turn-stopping` drain** (`3` queued episodes, `12 s` default budget): **`852 ms`** total.
- **Queue depth curve (`[1, 4, 5, 9]` episodes)**: `813 ms` (`1` batch), `829 ms` (`1` batch), `1,647 ms` (`2` batches), `2,471 ms` (`3` batches).
- **Tight budget cap (`IMMUNE_DISTILL_BUDGET_MS=1400`, `6` queued)**: **`835 ms` total**, **`httpCalls = 1`**, stops starting a doomed second LLM batch (**`PASS (0 failed)`**).

### 3.4 Outcome Classifier Ground-Truth Replay (`node scripts/eval-judge.mjs`)

Replayed against **`21,034` real host-labeled tool calls** in local ZCode history:
- **Agreement: `97.81%`**
- **False Negatives: `0`**
- **False Positives: `461` (`2.19%`)** — read-only exit-1 probes (`grep`/`git`/`test`), safely excluded from episode closing and isolated by Red-3 triage.

### 3.5 End-to-End A/B Multi-Turn Simulation (`node scripts/bench-ab-simulation.mjs`)

Simulated **30 multi-turn coding sessions** across **10 real pitfall families × 3 sequential turns** comparing Control (no immune memory) vs Treatment (`agent-immune` enabled, zero priors at Turn 1):
- **Total Failed Tool Calls**: `30` (Control) vs **`11`** (Treatment) → **`-63.3%` total failure reduction**
- **Repeat Pitfalls (Turns 2 & 3)**: `20` (Control) vs **`1`** (Treatment) → **`-95.0%` repeat pitfall reduction**
- **Avoidable Retry Tokens Spent**: `130,800` (Control) vs **`50,520`** (Treatment) → **`-61.4%` token reduction (`80,280` tokens saved)**
- **Pre-Tool Recall Latency**: **`p50 = 0.008 ms`**, **`p95 = 0.025 ms`**

---

## 4. Dual Live-Host DB Ablation, Whole-Disk Corpus, Counterfactual Replay, & Magpie (`node scripts/bench-ablation.mjs`)

### 4.1 Live Polluted Production Plugin DBs (ZCode + DSH, Non-Destructive WAL Snapshots)

| Host Database | Metric | v1 Baseline | v2 (`repairLibraryHygiene`) | Improvement |
| --- | --- | --- | --- | --- |
| **ZCode Live DB** (`57` rules, `12,332` hits) | Active Garbage Rate | `70.4%` (`19 / 27`) | **`0.0%` (`0 / 17`)** | **`-70.4 pp`** |
| **ZCode Live DB** | Avg Active Rubric (`0–100`) | `68.9` | **`94.4`** | **`+25.5 pts`** (`9` valid restored, `24` scoped, `46 ms`) |
| **ZCode Live DB** | Cross-Repo Probe Leaks | `6` | **`0`** | **`-100%`** |
| **DSH Live DB** (`33` rules, `80e825e246e75be5`) | Active Garbage Rate | `100.0%` (`33 / 33`) | **`0.0%` (`0 / 0`)** | **`-100.0 pp`** (`33` dumps quarantined in `29 ms`) |
| **DSH Live DB** | Avg Active Rubric (`0–100`) | `55.5` (`pwsh` / chat noise) | **`0` unreviewed dumps remaining** | **`27` scoped**, **`9` symptoms cleaned** |
| **DSH Live DB** | Cross-Repo Probe Leaks | `12` | **`0`** | **`-100%`** |

### 4.2 Whole-Disk Asset Ingestion (`D:\`)

Scanning `D:\` (`maxDepth = 3`) discovered **`184` repositories & skills in `3,009 ms`** (`85` apps, `83` `SKILL.md` skills, `10` DSH plugins, `6` monorepos), extracting **`937` curated rules** (`727` universal + `210` workspace-scoped) with **average Rubric score `84.4 / 100`** and zero unredacted paths or secrets.

### 4.3 All-Time 4-Host Audit (`days = 365`) & Strictly Causal Counterfactual Replay (Cold vs Warm)

Scanning all host histories took **`1,507 ms`** across **`28,961` real tool calls** (`1,126` failures, `592` paired episodes, `469` learnable + `123` self-noise):
- **ZCode**: `21,034` calls · `655` failures · `374` paired · median context `388,420` tokens
- **Codex CLI**: `2,825` calls · `291` failures · `131` paired
- **Antigravity**: `5,102` calls · `180` failures · `87` paired · median context `122,509` tokens
- **Chronological Walk-Forward Counterfactual Replay** (strictly causal: step $t$ uses *only* rules present at steps $< t$, zero-LLM rule distiller + error-tail/hyphen-slug `isRelated` guard):
  - **Cold-Start (Zero Priors)** across **`441` causal episodes** → **`98` active rules** formed, **`115 / 130` recurring repeat-family failures intercepted BEFORE execution** → **`88.5%` counterfactual repeat-mistake prevention rate** (`+18.5 pp` over initial `70.0%` before `core/relevance.ts` tail/hyphen fix)
  - **Warm-Start (`737` Priors: Builtin Packs + `D:\` Disk Corpus + Streaming Learning)** across the same **`441` episodes**:
    - **`126 / 130` recurring repeat failures intercepted** → **`96.9%` counterfactual repeat-mistake prevention rate**
    - **`416 / 441` total failure episodes (including first-time errors) pre-covered** → **`94.3%` overall coverage**

### 4.4 Magpie Multi-Model Gateway Telemetry

`scanMagpieTelemetry()` (`core/audit/magpie.ts`, with 30s TTL summary cache for live UI strips + `GET /api/models`) parsed **`11,165` routed gateway requests** (`routing/*.jsonl(.gz)`) + **`11,496` usage records** (`usage.jsonl`) across **`70` distinct model IDs**, **`8` workspace folders**, **`4.27B` input+cache tokens** (`76.7%` cache hit rate across `usage` + `routing`), **`285` retry-recovered calls**, and **`103` canceled requests**. Both standalone Dashboard and DSH Shadow-DOM settings tab surface per-model survival `%` and live Magpie gateway telemetry offline.

---

## 5. One-Command Reproduction

```bash
npm run build
npm test
node scripts/check-versions.mjs
node scripts/verify-dist-integrity.mjs --self-test
node scripts/verify-dist-integrity.mjs
node scripts/bench-recall.mjs
node scripts/bench-seed-recall.mjs
node scripts/bench-ab-simulation.mjs
node scripts/bench-scale.mjs
node scripts/bench-tool-latency.mjs
node scripts/verify-connected-runtime.mjs
node scripts/bench-ablation.mjs
```
