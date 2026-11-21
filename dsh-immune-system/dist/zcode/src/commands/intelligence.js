import { resolve } from 'node:path';
import { readLlmConfig } from '../../../core/llm.js';
import { ROUND_TRIPS_PER_REPEAT, estimateAvoided, formatTokens } from '../../../core/value.js';
import { coverage } from '../../../core/coverage.js';
import { echoCandidates, rewriteEchoes } from '../../../core/rewrite.js';
import { CONSOLIDATE_SIMILARITY, consolidateRules, findConsolidationCandidates, findLessonGroups, } from '../../../core/consolidate.js';
import { sleepReviewGroupsOf } from '../../../core/sleep-consolidate.js';
import { scanMagpieTelemetry } from '../../../core/audit/magpie.js';
import { explainRecall } from '../../../core/explain.js';
import { flagValue } from './shared.js';
export function cmdStats(store, args = []) {
    const all = store.listAll(true);
    const active = all.filter((a) => a.status === 'active');
    const retired = all.filter((a) => a.status === 'retired');
    const quarantined = all.filter((a) => a.status === 'quarantined');
    const hits = all.reduce((sum, a) => sum + a.hit_count, 0);
    const fails = all.reduce((sum, a) => sum + a.fail_count, 0);
    const s = store.stats();
    const guardInterceptions = store.guardEventSummary(1).total;
    const byModel = store.modelBreakdown().filter((r) => r.model !== 'unknown');
    const cross = store.crossModelRules();
    const avoided = estimateAvoided(s.suppressedRepeats);
    const sleepGroups = sleepReviewGroupsOf(store);
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify({
            total: all.length,
            active: active.length,
            retired: retired.length,
            quarantined: quarantined.length,
            injections: hits,
            fails,
            held: Math.max(0, hits - fails),
            suppressedRepeats: s.suppressedRepeats,
            guardInterceptions,
            queuedJobs: store.pendingJobCount(),
            llmDistilled: s.llmDistilled,
            llmFallbacks: s.llmFallbacks,
            byModel,
            crossModelRules: cross,
            avoided,
            sleepReviewGroups: sleepGroups,
            dbPath: store.dbPath,
        }, null, 2)}\n`);
        return 0;
    }
    const heldLine = hits > 0
        ? `held up: ${Math.max(0, hits - fails)} of ${hits} injections (${Math.round((fails / hits) * 100)}% blamed for a later failure)\n`
        : '';
    const model = s.llmDistilled > 0 || s.llmFallbacks > 0
        ? `model distillation: ${s.llmDistilled} from the model, ${s.llmFallbacks} degraded to the rule path\n`
        : '';
    const attribution = byModel.length > 0
        ? 'by model:\n' +
            byModel
                .slice(0, 6)
                .map((r) => `  ${r.model}: ${r.hits} deliveries, ${r.fails} failed, ${r.rules} rule(s)\n`)
                .join('') +
            (cross > 0 ? `cross-model rules: ${cross} (held under more than one model)\n` : '')
        : '';
    const valueLine = avoided
        ? `value: ${avoided.suppressed} suppressed repeat(s) ≈ ${formatTokens(avoided.avoidedTokens)} tokens not spent ` +
            `(median round-trip ${formatTokens(avoided.medianRequestTokens)} × ${ROUND_TRIPS_PER_REPEAT}, ${avoided.samples} samples)\n`
        : '';
    const sleepLine = sleepGroups > 0
        ? `sleep review: ${sleepGroups} cluster(s) of 5+ same-lesson rules — run \`immune consolidate --dry-run\`\n`
        : '';
    const qLine = quarantined.length > 0 ? `, quarantined ${quarantined.length}` : '';
    const guardLine = guardInterceptions > 0 ? `pre-flight guard interceptions: ${guardInterceptions}\n` : '';
    process.stdout.write(`antibodies: ${all.length} (active ${active.length}, retired ${retired.length}${qLine})\n` +
        `injections: ${hits}\n` +
        heldLine +
        `repeats suppressed: ${s.suppressedRepeats}\n` +
        guardLine +
        `queued distill jobs: ${store.pendingJobCount()}\n` +
        model +
        attribution +
        valueLine +
        sleepLine +
        `database: ${store.dbPath}\n`);
    return 0;
}
export function cmdDetours(store) {
    const rows = store.recentDetours(20);
    if (rows.length === 0) {
        process.stdout.write('no convergent detours recorded (4+ same-target probes before the fix)\n');
        return 0;
    }
    process.stdout.write('convergent detours (telemetry — `immune rewrite` is the minting path):\n');
    for (const row of rows) {
        const when = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ');
        process.stdout.write(`  ${when}  ${String(row.probes).padStart(2)} probes  ${row.signature}\n`);
    }
    return 0;
}
export function cmdCoverage(store, args) {
    const daysRaw = flagValue(args, '--days');
    const topRaw = flagValue(args, '--top');
    const dbRaw = flagValue(args, '--db');
    const daysNum = daysRaw !== undefined ? Number(daysRaw) : 30;
    const topNum = topRaw !== undefined ? Number(topRaw) : 10;
    const report = coverage(store, {
        days: Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 30,
        top: Number.isFinite(topNum) && topNum > 0 ? Math.trunc(topNum) : 10,
        ...(dbRaw ? { sourceDb: resolve(dbRaw) } : {}),
    });
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
    }
    if (report.failures === 0) {
        process.stdout.write('no host errors found - set IMMUNE_HOST_DB if this host keeps them elsewhere\n');
        return 0;
    }
    const judged = report.failures - report.noise;
    const pct = judged > 0 ? Math.round((report.covered / judged) * 100) : 0;
    process.stdout.write(`coverage: last ${report.days} days · ${judged} judgeable failure(s) · ` +
        `${report.covered} known (${pct}%) · ${report.deliverable} still injected · ` +
        `${report.uncovered} uncovered` +
        (report.noise > 0 ? ` · ${report.noise} ignored as noise` : '') +
        '\n');
    if (report.covered > report.deliverable) {
        process.stdout.write(`  ${report.covered - report.deliverable} failure(s) match a retired rule: ` +
            'the advice exists but is not injected (see `immune list --all`)\n');
    }
    if (report.clusters.length > 0) {
        process.stdout.write('top uncovered signatures:\n');
        for (const cluster of report.clusters) {
            process.stdout.write(`  ${cluster.count}× ${cluster.tool}  ${cluster.signature} ` +
                `(${cluster.sessions} session(s))\n`);
        }
    }
    return 0;
}
export function cmdConsolidate(store, args) {
    const candidates = findConsolidationCandidates(store);
    const near = findLessonGroups(store).filter((group) => group.maxSimilarity < CONSOLIDATE_SIMILARITY &&
        !candidates.some((c) => group.rules.some((r) => r.id === c.keepId)));
    if (candidates.length === 0) {
        process.stdout.write('No duplicate lessons found.\n');
        if (near.length > 0) {
            process.stdout.write('Same symptom, different wording (manual review, not merged):\n');
            for (const group of near) {
                process.stdout.write(`  ${group.symptom.slice(0, 50)} · ` +
                    group.rules.map((r) => `#${r.id}(h${r.hits})`).join(' ') +
                    ` · max ${Math.round(group.maxSimilarity * 100)}%\n`);
            }
        }
        return 0;
    }
    process.stdout.write(`Duplicate lesson pair(s): ${candidates.length}\n`);
    for (const c of candidates) {
        process.stdout.write(`  keep #${c.keepId} (h${c.keepHits}) <- retire #${c.retireId} (h${c.retireHits}) ` +
            `[${Math.round(c.similarity * 100)}%] ${c.keepPrescription}\n`);
    }
    if (args.includes('--dry-run')) {
        process.stdout.write('Dry run: no rules changed. Run without --dry-run to apply.\n');
        return 0;
    }
    const result = consolidateRules(store, candidates);
    process.stdout.write(`Consolidated ${result.retired} duplicate rule(s); retired rows remain recoverable.\n`);
    return 0;
}
export function cmdHygiene(store, args) {
    const dryRun = args.includes('--dry-run');
    const r = store.repairHygiene({ dryRun });
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        return 0;
    }
    process.stdout.write(`immune hygiene (${r.dryRun ? 'dry-run' : 'applied'}): scanned ${r.scanned} · ` +
        `active ${r.activeBefore} -> ${r.activeAfter} · ` +
        `quarantined ${r.quarantined} · scoped ${r.scoped} · restored ${r.restored} · cleaned ${r.symptomsCleaned}\n` +
        `  garbage rate: ${(r.garbageRateBefore * 100).toFixed(1)}% -> ${(r.garbageRateAfter * 100).toFixed(1)}%\n`);
    for (const c of r.changes.slice(0, 25)) {
        process.stdout.write(`  #${c.id} [${c.action}] ${c.detail}\n`);
    }
    if (r.changes.length > 25) {
        process.stdout.write(`  ... and ${r.changes.length - 25} more\n`);
    }
    return 0;
}
export function cmdTriage(store, args = []) {
    const tri = store.triageSummary();
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(tri, null, 2)}\n`);
        return 0;
    }
    process.stdout.write(`red-3 triage: ${tri.totalEvents} event(s) · quarantined ${tri.quarantinedCount} · probation ${tri.probationCount}\n`);
    for (const [bucket, count] of Object.entries(tri.byBucket)) {
        process.stdout.write(`  ${bucket.padEnd(22)} ${count}\n`);
    }
    if (tri.ignoredRules.length > 0) {
        process.stdout.write('ignored-by-agent rules (escalate rather than retire):\n');
        for (const r of tri.ignoredRules) {
            process.stdout.write(`  #${r.id} ignored ${r.ignoredCount}× (hits ${r.hitCount}) · ${r.trigger.slice(0, 64)}\n`);
        }
    }
    return 0;
}
export function cmdReceipts(store, args = []) {
    const r = store.receiptSummary();
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        return 0;
    }
    const heldTotal = r.byOutcome.held ?? 0;
    const failedTotal = r.byOutcome.failed ?? 0;
    process.stdout.write(`delivery receipts: ${r.total} (${heldTotal} held, ${failedTotal} failed, ~${formatTokens(r.estimatedTokensSaved)} tokens saved) · chain ${r.chainValid ? 'VERIFIED' : 'BROKEN'} · latest ${r.latestDigest}\n`);
    for (const m of r.byModel.slice(0, 8)) {
        process.stdout.write(`  ${m.model}: ${m.total} total (${m.held} held, ${m.failed} failed)\n`);
    }
    return 0;
}
export function cmdModels(store, args = []) {
    const magpie = scanMagpieTelemetry();
    const report = store.modelImmunity(magpie);
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ ...report, magpie: magpie.present ? magpie : null }, null, 2)}\n`);
        return 0;
    }
    process.stdout.write(`model immunity: ${report.models.length} tracked model(s) · cross-model proven ${report.crossModelProven}\n`);
    for (const m of report.models.slice(0, 10)) {
        const gw = m.gatewayRequests ? ` · magpie ${m.gatewayRequests} req (${m.gatewayFailures ?? 0} fail)` : '';
        process.stdout.write(`  ${m.model}: ${m.deliveries} deliveries, ${m.fails} fail (${m.survivalRatePct}% survival, ${m.distinctRules} rules)${gw}\n`);
    }
    if (magpie.present) {
        process.stdout.write(`magpie gateway telemetry: ${magpie.routingRequests} routed · ${magpie.usageRequests} usage probes · ` +
            `cache hit ${magpie.cacheHitRatePct}% · retry-recovered ${magpie.retryRecovered} · ${magpie.distinctModels} models\n`);
    }
    if (report.escalatedRules.length > 0) {
        process.stdout.write(`adaptive escalation candidates (ignored >= 2× or high-hit repeat fails): ${report.escalatedRules.length}\n`);
        for (const r of report.escalatedRules.slice(0, 5)) {
            process.stdout.write(`  #${r.id} ignored ${r.ignoredCount}× · fail ${r.failCount}/${r.hitCount} · ${r.trigger.slice(0, 60)}\n`);
        }
    }
    return 0;
}
export function cmdExplain(store, args) {
    const asJson = args.includes('--json');
    const rawLimit = flagValue(args, '--limit');
    const limit = rawLimit !== undefined && Number(rawLimit) > 0 ? Math.min(10, Number(rawLimit)) : 5;
    const toolName = flagValue(args, '--tool');
    const queryParts = [];
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--json')
            continue;
        if (a === '--limit' || a === '--tool') {
            i += 1;
            continue;
        }
        if (a.startsWith('--limit=') || a.startsWith('--tool='))
            continue;
        queryParts.push(a);
    }
    const query = queryParts.join(' ').trim();
    if (!query) {
        process.stderr.write('usage: immune explain "<query>" [--tool Bash|Edit] [--limit 5] [--json]\n');
        return 2;
    }
    const report = explainRecall(store, query, { limit, toolName });
    if (asJson) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
    }
    process.stdout.write(`explain query: "${report.query}" (scope ${report.projectScope})\n`);
    if (report.addedConcepts.length > 0) {
        process.stdout.write(`  concept expansion: +${report.addedConcepts.join(', ')}\n`);
    }
    if (report.candidates.length === 0) {
        process.stdout.write('  matched candidates: 0\n');
        return 0;
    }
    process.stdout.write(`  matched candidates: ${report.candidates.length}\n`);
    for (const c of report.candidates) {
        const b = c.breakdown;
        const prefix = c.source === 'shared' ? 'S#' : '#';
        process.stdout.write(`  ${prefix}${c.id} score=${b.finalScore} [bm25=${b.baseRelevance} hit×${b.hitMultiplier} path×${b.pathAffinityBoost} lex×${b.lexicalMultiplier} rub×${b.rubricMultiplier} decay×${b.timeDecay}]\n` +
            `     trigger: ${c.trigger_pattern}\n` +
            `     do:      ${c.prescription}\n`);
    }
    if (report.renderedBlock) {
        process.stdout.write(`\n${report.renderedBlock}\n`);
    }
    return 0;
}
export function cmdRewriteSyncOrAsync(store, args, onAsyncFinish) {
    const maxRaw = flagValue(args, '--max');
    const max = maxRaw !== undefined ? Number(maxRaw) : 0;
    const idRaw = flagValue(args, '--id');
    const ids = idRaw
        ? idRaw
            .split(',')
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
        : [];
    const dryRun = args.includes('--dry-run');
    const llm = readLlmConfig();
    if (!llm) {
        const candidates = echoCandidates(store);
        process.stdout.write(`no model configured (IMMUNE_LLM_BASE_URL / IMMUNE_LLM_MODEL); ` +
            `${candidates.length} echo-grade rule(s) would be rewritten:\n` +
            candidates
                .map((a) => `  #${a.id} h${a.hit_count} ${a.prescription.slice(0, 70)}\n`)
                .join(''));
        return { asyncStarted: false, code: 0 };
    }
    rewriteEchoes(store, { llm, max, dryRun, ids })
        .then((report) => {
        process.stdout.write(`rewrite: ${report.candidates} candidate(s) · ${report.rewritten} rewritten · ` +
            `${report.skipped} skipped · ${report.failed} failed${report.dryRun ? ' (dry run)' : ''}\n`);
        for (const item of report.items) {
            const tail = item.to
                ? ` -> ${item.to}`
                : item.detail
                    ? ` (${item.detail})`
                    : '';
            process.stdout.write(`  #${item.id} ${item.status}${tail}\n`);
        }
    })
        .catch((error) => {
        process.stderr.write(`rewrite failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    })
        .finally(onAsyncFinish);
    return { asyncStarted: true, code: 0 };
}
