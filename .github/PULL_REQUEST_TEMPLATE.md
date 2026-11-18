## Summary

<!-- What problem does this solve, and how? -->

## Verification Checklist

- [ ] Read relevant invariants in [AGENTS.md](../AGENTS.md) (especially if touching `core/`, hooks, or manifests)
- [ ] `npm run build` and `node scripts/verify-dist-integrity.mjs` pass (`dist/` artifacts committed)
- [ ] `npm test` passes with new regression test(s) covering the change
- [ ] `node scripts/bench-recall.mjs` and `node scripts/bench-seed-recall.mjs` pass
- [ ] Zero third-party runtime dependencies added (`node:sqlite` + Node built-ins only)
- [ ] If bumping version: all 6 manifests updated and `node scripts/check-versions.mjs` passes
