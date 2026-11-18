# Contributing

Thanks for considering a contribution. This project is maintained with an
unusual discipline (it documents its own invariants in
[AGENTS.md](AGENTS.md) — every one of the 42+ entries is backed by a real
incident or benchmark), and the gates below are what keep it honest.

## Setup

```bash
npm install
npm run build
npm test
```

Node 22.19+ or 24+ (the plugin runs on `node:sqlite`; zero runtime dependencies).

## The gates

A change is done when ALL of these pass:

1. `npm run build` + `node scripts/verify-dist-integrity.mjs` — TypeScript compile + 1:1 dist import check
2. `node scripts/check-versions.mjs` — all 6 manifests (8 version fields) agree
3. `npm test` — unit & integration tests (`node:test`)
4. `node scripts/bench-recall.mjs` — retrieval gate (R@3, false-positive rate)
5. `node scripts/bench-seed-recall.mjs` — content gate across all 9 builtin seed packs (54 rules)
6. `node scripts/verify-connected-runtime.mjs` — vendored multi-host hooks end-to-end
7. `node scripts/verify-step1.mjs` — outcome classification contract
8. `node scripts/verify-steps23.mjs` — full loop on a fake Cordis host
9. `node scripts/bench-tool-latency.mjs` — drain cost curve (~40 s)
10. `node scripts/bench-scale.mjs` — index/match latency at 300 rules
11. `node scripts/verify-live-host.mjs` — real Cordis event bus (needs a local DSH checkout; machine-only)

CI runs 1–8 on Linux (Node 22 + 24) and Windows (Node 24) for every push and PR.
If an acceptance script fails after your change, treat it as your regression until proven otherwise.

## House rules (the short list)

- **Read [AGENTS.md](AGENTS.md) before proposing a "simplification".** Several
  obvious-looking improvements have been tried and reverted; the file records
  why.
- **Zero runtime dependencies** — `node:sqlite` and Node built-ins only.
- **All cross-event state lives in SQLite** — hooks are separate processes.
- **The npm layout has a doubled `dsh-immune-system/` prefix, on purpose.**
  Probe the prefixed paths when verifying an install.
- **Bump all six manifests together** (`scripts/check-versions.mjs` gates it).
- Guard patterns live in code, never in the database, and every pattern ships
  with its false-positive matrix — including the command its own advice
  recommends.

## Reporting a bug

Run `npx dsh-immune-system doctor` (or `immune doctor`) and paste the output
into the issue template — it answers most setup questions in advance.
