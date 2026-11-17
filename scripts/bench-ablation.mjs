/**
 * Real-data v1 -> v2.1 ablation, dual host DB cleanup, counterfactual replay,
 * whole-disk D:\ ingestion, and Magpie gateway benchmark harness.
 *
 * Strictly non-destructive: uses SQLite WAL backup snapshots into a temp folder
 * and reads local telemetry read-only without mutating live databases.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditHistory } from '../dsh-immune-system/dist/core/audit.js';
import { scanMagpieTelemetry } from '../dsh-immune-system/dist/core/audit/magpie.js';
import { normaliseFailure, isNoiseFailure } from '../dsh-immune-system/dist/core/coverage.js';
import { ingestDiskCorpus } from '../dsh-immune-system/dist/core/disk-ingest.js';
import { classifyRuleQuality } from '../dsh-immune-system/dist/core/hygiene.js';
import { isRelated } from '../dsh-immune-system/dist/core/relevance.js';
import { BUILTIN_PACKS } from '../dsh-immune-system/dist/core/packs.js';
import { scoreAntibodyRubric } from '../dsh-immune-system/dist/core/rubric.js';
import { ImmuneStore } from '../dsh-immune-system/dist/core/store/index.js';
import { ImmuneRuntime } from '../dsh-immune-system/dist/core/runtime.js';

const HOME = process.env.USERPROFILE || process.env.HOME || '';

async function snapshotHygieneBench(label, dbPath, probeWorkspace = 'proj:unrelated-benchmark-repo:00000000', tmpRoot) {
  if (!dbPath || !existsSync(dbPath)) return null;
  const snapPath = join(tmpRoot, `${label}-snapshot.sqlite`);
  const srcStore = new ImmuneStore({ dbPath });
  await srcStore.backupTo(snapPath);
  srcStore.close();

  const store = new ImmuneStore({ dbPath: snapPath });
  const beforeAll = store.listAll(true);
  const beforeActive = beforeAll.filter((r) => r.status === 'active');
  const beforeGarbage = beforeActive.filter((r) => classifyRuleQuality(r).grade === 'quarantined').length;
  const beforeRubrics = beforeActive.map((r) => scoreAntibodyRubric(r).total);
  const avgBefore = beforeRubrics.length
    ? Number((beforeRubrics.reduce((a, b) => a + b, 0) / beforeRubrics.length).toFixed(1))
    : 0;

  const probeQueries = [
    'Write 修改 文件 失败',
    'pwsh read file error',
    'mcp__playwright__browser_navigate error',
    'bash grep search error',
  ];
  let leakedBefore = 0;
  for (const q of probeQueries) {
    const hits = store.peek(q, 3, probeWorkspace);
    leakedBefore += hits.filter((r) => classifyRuleQuality(r).grade === 'quarantined').length;
  }

  const t0 = Date.now();
  const hygiene = store.repairHygiene({ dryRun: false });
  const hygieneMs = Date.now() - t0;

  const afterAll = store.listAll(true);
  const afterActive = afterAll.filter((r) => r.status === 'active');
  const afterQuarantined = afterAll.filter((r) => r.status === 'quarantined');
  const afterGarbage = afterActive.filter((r) => classifyRuleQuality(r).grade === 'quarantined').length;
  const afterRubrics = afterActive.map((r) => r.rubric_score ?? scoreAntibodyRubric(r).total);
  const avgAfter = afterRubrics.length
    ? Number((afterRubrics.reduce((a, b) => a + b, 0) / afterRubrics.length).toFixed(1))
    : 0;

  let leakedAfter = 0;
  for (const q of probeQueries) {
    const hits = store.peek(q, 3, probeWorkspace);
    leakedAfter += hits.filter((r) => classifyRuleQuality(r).grade === 'quarantined').length;
  }
  store.close();

  return {
    label,
    totalRules: beforeAll.length,
    before: {
      active: beforeActive.length,
      retired: beforeAll.filter((r) => r.status === 'retired').length,
      quarantined: 0,
      garbageActive: beforeGarbage,
      garbageRatePct: beforeActive.length ? Number(((beforeGarbage * 100) / beforeActive.length).toFixed(1)) : 0,
      avgActiveRubric: avgBefore,
      probeLeaksIntoUnrelatedRepo: leakedBefore,
    },
    after: {
      active: afterActive.length,
      retired: afterAll.filter((r) => r.status === 'retired').length,
      quarantined: afterQuarantined.length,
      garbageActive: afterGarbage,
      garbageRatePct: afterActive.length ? Number(((afterGarbage * 100) / afterActive.length).toFixed(1)) : 0,
      avgActiveRubric: avgAfter,
      probeLeaksIntoUnrelatedRepo: leakedAfter,
      restoredRules: hygiene.restored,
      scopedRules: hygiene.scoped,
      symptomsCleaned: hygiene.symptomsCleaned,
      hygieneMs,
    },
  };
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'immune-ablation-'));

try {
  // [1] Dual Live DB Ablation (ZCode Plugin DB + DSH Runtime DB)
  const zcodePluginDb =
    process.env.IMMUNE_BENCH_DB ||
    join(HOME, '.zcode', 'cli', 'plugins', 'data', 'dsh-immune-system@dev-dsh-plugin-immune', 'immune.sqlite');
  const dshPluginDb = join(HOME, '.dsh', 'storages', 'dsh-immune-system', '80e825e246e75be5.sqlite');

  const dualResults = [
    await snapshotHygieneBench('zcode-live-db', zcodePluginDb, 'proj:unrelated-benchmark-repo:00000000', tmpRoot),
    await snapshotHygieneBench('dsh-live-db', dshPluginDb, 'proj:unrelated-benchmark-repo:00000000', tmpRoot),
  ].filter(Boolean);

  console.log('\n=== [1] Dual Live Host Plugin DB Ablation (Non-Destructive Snapshots) ===');
  console.log(JSON.stringify(dualResults, null, 2));

  // [2] Whole-Disk Asset Ingestion (D:\)
  const diskStore = new ImmuneStore({ dbPath: join(tmpRoot, 'disk-ingest.sqlite') });
  const roots = existsSync('D:\\') ? ['D:\\'] : [process.cwd()];
  const tDisk0 = Date.now();
  const diskReport = ingestDiskCorpus(diskStore, { roots, maxDepth: 3, maxProjects: 300, dryRun: false });
  const diskMs = Date.now() - tDisk0;
  const ingestedRules = diskStore.listAll(true);
  const avgDiskRubric = ingestedRules.length
    ? Number(
        (
          ingestedRules.reduce((s, r) => s + (r.rubric_score ?? scoreAntibodyRubric(r).total), 0) /
          ingestedRules.length
        ).toFixed(1),
      )
    : 0;
  const byKind = {};
  for (const p of diskReport.projects) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;

  console.log('\n=== [2] Whole-Disk Asset Ingestion ===');
  console.log(
    JSON.stringify(
      {
        roots,
        elapsedMs: diskMs,
        projectsScanned: diskReport.projectsScanned,
        profilesRecorded: diskReport.profilesRecorded,
        byKind,
        rulesExtracted: diskReport.rulesExtracted,
        universalRules: diskReport.universalRules,
        scopedRules: diskReport.scopedRules,
        avgRubric: avgDiskRubric,
      },
      null,
      2,
    ),
  );

  // [3] All-Time 4-Host Streaming History Audit + Counterfactual Replay
  const replayStore = new ImmuneStore({ dbPath: join(tmpRoot, 'replay.sqlite') });
  const tAudit0 = Date.now();
  const auditAllTime = auditHistory(replayStore, { dryRun: false, days: 365 });
  const auditMs = Date.now() - tAudit0;

  // Replay all queued paired episodes chronologically using ImmuneRuntime (rule distiller)
  // AND check causal recurrence interception rate across the 467+ real episodes!
  const jobs = replayStore.db
    .prepare('SELECT id, tool_name, failure_trace, success_trace, project_scope FROM distill_jobs ORDER BY id ASC')
    .all();

  const cfStore = new ImmuneStore({ dbPath: join(tmpRoot, 'counterfactual.sqlite') });
  const cfRuntime = new ImmuneRuntime(cfStore);
  const warmStore = new ImmuneStore({ dbPath: join(tmpRoot, 'counterfactual-warm.sqlite') });
  try {
    for (const pack of BUILTIN_PACKS) {
      warmStore.seedPack(pack.id, pack.rules);
    }
    for (const r of ingestedRules) {
      if (r.status === 'active' && (r.project_scope ?? '*') === '*') {
        warmStore.insert({
          trigger_pattern: r.trigger_pattern,
          symptom: r.symptom,
          prescription: r.prescription,
          tool_name: r.tool_name,
          project_scope: '*',
          prescription_source: 'seed',
          origin: r.origin,
        });
      }
    }
    const warmRuntime = new ImmuneRuntime(warmStore);

    let causalReplays = 0;
    let counterfactualMatches = 0;
    let warmMatches = 0;
    let warmAllMatches = 0;
    let repeatFamilyFailures = 0;
    const seenFamilies = new Set();

    for (const job of jobs) {
      if (isNoiseFailure(job.failure_trace)) continue;
      causalReplays += 1;
      const fam = `${job.tool_name}:${normaliseFailure(job.failure_trace).slice(0, 60)}`;
      const isRepeat = seenFamilies.has(fam);
      if (isRepeat) repeatFamilyFailures += 1;

      // Counterfactual check: before episode executes at step t, would rules distilled at < t warn the agent?
      const priorHits = cfStore
        .peek(job.failure_trace, 3, '*')
        .filter((r) => isRelated(r.trigger_pattern, job.failure_trace, job.tool_name));
      if (isRepeat && priorHits.length > 0) counterfactualMatches += 1;

      const warmHits = warmStore
        .peek(job.failure_trace, 3, '*')
        .filter((r) => isRelated(r.trigger_pattern, job.failure_trace, job.tool_name));
      if (warmHits.length > 0) warmAllMatches += 1;
      if (isRepeat && warmHits.length > 0) warmMatches += 1;

      seenFamilies.add(fam);
      cfStore.enqueueJob(job.tool_name, job.failure_trace, job.success_trace, [], '', [], '', '*');
      warmStore.enqueueJob(job.tool_name, job.failure_trace, job.success_trace, [], '', [], '', '*');
      await cfRuntime.drain({ budgetMs: 2_000, llm: null, runPostDrainHooks: false });
      await warmRuntime.drain({ budgetMs: 2_000, llm: null, runPostDrainHooks: false });
    }

    const repeatInterceptPct =
      repeatFamilyFailures > 0 ? Number(((counterfactualMatches * 100) / repeatFamilyFailures).toFixed(1)) : 0;
    const warmRepeatPct =
      repeatFamilyFailures > 0 ? Number(((warmMatches * 100) / repeatFamilyFailures).toFixed(1)) : 0;
    const warmAllPct =
      causalReplays > 0 ? Number(((warmAllMatches * 100) / causalReplays).toFixed(1)) : 0;

    console.log('\n=== [3] All-Time Multi-Host Audit (days=365) & Counterfactual Replay ===');
    console.log(
      JSON.stringify(
        {
          auditElapsedMs: auditMs,
          totalScanned: auditAllTime.totals.scanned,
          totalFailures: auditAllTime.totals.failures,
          totalPaired: auditAllTime.totals.paired,
          enqueuedForReplay: auditAllTime.totals.enqueued,
          skippedSelf: auditAllTime.totals.skippedSelf,
          sources: auditAllTime.sources.map((s) => ({
            source: s.source,
            present: s.present,
            scanned: s.scanned,
            failures: s.failures,
            paired: s.paired,
            medianRequestTokens: s.medianRequestTokens,
          })),
          counterfactual: {
            causalEpisodesReplayed: causalReplays,
            activeRulesFormed: cfStore.listAll(false).length,
            repeatFamilyFailures,
            interceptedBeforeRepeat: counterfactualMatches,
            repeatPreventionPct: repeatInterceptPct,
            warmStartPriorsLoaded: BUILTIN_PACKS.reduce((s, p) => s + p.rules.length, 0) + ingestedRules.filter((r) => (r.project_scope ?? '*') === '*').length,
            warmStartRepeatIntercepted: warmMatches,
            warmStartRepeatPreventionPct: warmRepeatPct,
            warmStartAllEpisodesCovered: warmAllMatches,
            warmStartAllEpisodesPct: warmAllPct,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    try { warmStore.close(); } catch {}
    try { cfStore.close(); } catch {}
    try { replayStore.close(); } catch {}
    try { diskStore.close(); } catch {}
  }

  // [4] Magpie Local Gateway Telemetry Survey
  const magpie = scanMagpieTelemetry();
  console.log('\n=== [4] Magpie Multi-Model Gateway Telemetry ===');
  console.log(
    JSON.stringify(
      magpie.present
        ? {
            present: true,
            routingRequests: magpie.routingRequests,
            usageRequests: magpie.usageRequests,
            totalInputTokens: magpie.totalInputTokens,
            totalOutputTokens: magpie.totalOutputTokens,
            totalCacheReadTokens: magpie.totalCacheReadTokens,
            cacheHitRatePct: magpie.cacheHitRatePct,
            retryRecovered: magpie.retryRecovered,
            canceled: magpie.canceled,
            distinctModels: magpie.distinctModels,
            distinctFolders: magpie.distinctFolders,
            topAgents: magpie.byAgent,
            topModels: magpie.byModel.slice(0, 5),
            topFailures: magpie.topFailures.slice(0, 5),
          }
        : { present: false },
      null,
      2,
    ),
  );
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
