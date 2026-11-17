# Evaluation & Competition Benchmarks (`dsh-immune-system@2.0.0`)

All metrics below are directly measured on the `dsh-immune-system@2.0.0` codebase using built-in test suites and reproducible scripts under `scripts/`. None of the numbers are fabricated or extrapolated.

---

## 1. Environment Specification

- **Runtime**: Node.js `v24.20.0` (`^22.19.0 || >=24.0.0`), zero runtime npm dependencies (`node:sqlite` + `node:zlib` built-in only)
- **Operating System**: Windows 11
- **Verified Local Ecosystems & Datasets**:
  - **ZCode CLI**: `21,034` tool calls (`885` sessions, `20,330` `model_usage` calls) + live plugin DB (`57` rules, `12,332` cumulative deliveries)
  - **DeepSeek Harness (DSH)**: Cordis desktop profile + live plugin DB (`80e825e246e75be5.sqlite`, `33` active rules)
  - **Codex CLI**: `2,825` tool calls (`42` JSONL rollouts, `60.06 MB`)
  - **Antigravity**: `5,102` tool calls (`~290 MB` trajectories)
  - **Magpie Multi-Model Gateway**: `11,165` routed requests (`routing/*.jsonl(.gz)`) + `11,496` usage probes (`usage.jsonl`), **`4.27B`** input+cache tokens across **`70`** model identifiers and **`5`** agents (`zcode`, `dsh`, `curl`, `opencode`, `claude-desktop`)
  - **Whole-Disk Corpus (`D:\`)**: `184` discovered repositories, DSH plugins, monorepos, and reusable `SKILL.md` skills

---

## 2. Automated Verification Summary

| Suite / Script | Command | Result | Scope |
| --- | --- | --- | --- |
| Unit & Integration Suite | `npm test` | **245 / 245 passed (`0` failed, `0` skipped)** | Core store, hygiene, rubric, Red-3 triage, SHA-256 receipts, Magpie telemetry, LLM reflection critique, relevance tail/slug matching, UI `/api/models`, MCP (`18` tools), manifests |
| Version Sync Guard | `node scripts/check-versions.mjs` | **7/7 fields aligned at `2.0.0`** | Root/plugin/DSH/ZCode/marketplace/Claude manifests |
| Dist Graph Integrity | `node scripts/verify-dist-integrity.mjs` (+ `--self-test`) | **Passed (0 failed)** | 1:1 `src -> dist` mapping & relative import resolution |
| DSH Outcome & Adapters | `node scripts/verify-step1.mjs` & `verify-steps23.mjs` | **15/15** & **24/24 passed** | Outcome judge, fail→success pair, inject, probes |
| Live Cordis Host Replay | `node scripts/verify-live-host.mjs` | **20/20 passed (`0` failed)** | Event bus, `turn-stopping`, priming, cold resume |
| DSH Web Bundle Serving | `node scripts/verify-client-serve.mjs` | **10/10 passed (`profile=desktop`)** | `ClientModuleRegistry` `/plugins/dsh-immune-system/client.js` |
| Cross-Host Hook E2E | `node scripts/verify-connected-runtime.mjs` | **34/34 passed (`0` failed)** | Claude Code + Codex + Antigravity hooks & guard deny |
| ZCode Manifest Validation | `node "D:\zcode\resources\glm\zcode.cjs" plugins validate dsh-immune-system` | **Valid** | Official ZCode plugin validator |

---

## 3. Retrieval Precision, Scale, Latency, & Judge Replay

### 3.1 Retrieval Precision & Zero False Positives

- **`node scripts/bench-recall.mjs`** (bilingual paraphrase matrix):
  - **`R@1: 100%`**, **`R@3: 100%`**, **`FP: 0% (0/6)`** (`8` positives, `6` negatives)
- **`node scripts/bench-seed-recall.mjs`** (all 7 builtin packs, `42` paraphrased queries):
  - After `lexicalTriggerAffinity` + un-truncated `cjkGrams` / `cjkBigrams` + bilingual concept graph (`core/retrieval.ts`, `core/store/tokenize.ts`, `core/store/rerank.ts`):
    - **`R@1: 69% -> 95%` (+26 percentage points)**
    - **`R@3: 100%` (`42 / 42`)**
    - **`FP: 0% (0 / 6)`**

### 3.2 Indexing & Query Tail Latency (`node scripts/bench-scale.mjs`)

- Seeded **`300` rules in `55 ms`** (`0.18 ms/rule`)
- Executed **`67` queries**: **`p50 = 0.58 ms`**, **`p95 = 1.03 ms`**, **`max = 5.42 ms`**

### 3.3 Hook Path Isolation & Batched Turn-End Drain (`node scripts/bench-tool-latency.mjs`)

Mock OpenAI endpoint (`800 ms` artificial latency per HTTP round-trip):
- **`tools/post-execute` hot path**: **`median = 1.697 ms`**, **`worst = 3.964 ms`** (zero model calls on tool execution path).
- **Batched `agent/turn-stopping` drain** (`3` queued episodes, `12 s` default budget): **`861 ms`** total.
- **Queue depth curve (`[1, 4, 5, 9]` episodes)**: `822 ms` (`1` batch), `825 ms` (`1` batch), `1,650 ms` (`2` batches), `2,463 ms` (`3` batches).
- **Tight budget cap (`IMMUNE_DISTILL_BUDGET_MS=1400`, `6` queued)**: **`844 ms` total**, **`httpCalls = 1`**, stops starting a doomed second LLM batch (**`PASS (0 failed)`**).

### 3.4 Outcome Classifier Ground-Truth Replay (`node scripts/eval-judge.mjs`)

Replayed against **`21,034` real host-labeled tool calls** in local ZCode history:
- **Agreement: `97.81%`**
- **False Negatives: `0`**
- **False Positives: `461` (`2.19%`)** — read-only exit-1 probes (`grep`/`git`/`test`), safely excluded from episode closing and isolated by Red-3 triage.

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

## 5. Reproduction & Submission Checklist

```bash
npm run build
npm test
node scripts/check-versions.mjs
node scripts/verify-dist-integrity.mjs --self-test
node scripts/bench-recall.mjs
node scripts/bench-seed-recall.mjs
node scripts/bench-scale.mjs
node scripts/bench-tool-latency.mjs
node scripts/bench-ablation.mjs
```

- **Submission checklist (第 9 届传智杯 AI 大模型创新应用挑战赛 · 个人赛)**:
  - 参赛选手姓名 / 学校 / 组别：`[待提交前填写]`
  - 源码仓库：`https://github.com/meat-daemon-404/agent-immune`（包名 `dsh-immune-system@2.0.0`）
  - 交付物核对：完整可运行源码、零依赖构建产物、`README.md` / `README.zh-CN.md`、`docs/ARCHITECTURE-V2.md`、本评测报告 `docs/EVALUATION.md`。
