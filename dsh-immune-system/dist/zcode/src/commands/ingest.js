import { resolve } from 'node:path';
import { auditHistory, renderAuditReport } from '../../../core/audit.js';
import { scanMagpieTelemetry } from '../../../core/audit/magpie.js';
import { backfill } from '../../../core/backfill.js';
import { detectProjectBaselineDetail, filterRulesByBaseline, parseBaselineFlag } from '../../../core/baseline.js';
import { ingestDiskCorpus } from '../../../core/disk-ingest.js';
import { readLlmConfig } from '../../../core/llm.js';
import { BUILTIN_PACKS } from '../../../core/packs.js';
import { ingestSkillPaths, normalizeSkillPackId } from '../../../core/skill-ingest.js';
import { drainJobs } from '../drain.js';
import { selfMarkers } from '../root-marker.js';
import { flagValue, parseSeedCliArgs } from './shared.js';
export function cmdSeed(store, args) {
    const flags = parseSeedCliArgs(args, ['--baseline']);
    const packId = flags.positional[0];
    const remove = flags.booleans.has('--remove');
    const baselineRaw = flags.values.get('--baseline');
    const explicitBaseline = parseBaselineFlag(baselineRaw);
    if (baselineRaw !== undefined && !explicitBaseline) {
        process.stderr.write(`seed: invalid --baseline "${baselineRaw}" (expected widely or newly)\n`);
        return 2;
    }
    if (!packId) {
        const counts = store.seededPackCounts();
        const detected = detectProjectBaselineDetail(process.cwd());
        process.stdout.write(`Builtin seed packs (immune seed <id> [--baseline widely|newly] [--remove], project baseline: ${detected.level}` +
            (detected.source ? ` from ${detected.source}` : '') +
            '):\n');
        for (const pack of BUILTIN_PACKS) {
            const installed = counts.get(pack.id) ?? 0;
            process.stdout.write(`  ${pack.id.padEnd(14)} ${String(installed).padStart(2)}/${pack.rules.length} seeded · ` +
                `${pack.label} — ${pack.description}\n`);
        }
        const skillPacks = [...counts.entries()].filter(([id]) => id.startsWith('skill:'));
        if (skillPacks.length > 0) {
            process.stdout.write('Ingested skill packs (`immune ingest-skill <path...> [--remove]`):\n');
            for (const [id, count] of skillPacks) {
                process.stdout.write(`  ${id.padEnd(20)} ${count} rule(s) indexed on demand\n`);
            }
        }
        return 0;
    }
    const pack = BUILTIN_PACKS.find((candidate) => candidate.id === packId);
    if (!pack && !packId.startsWith('skill:')) {
        process.stderr.write(`seed: unknown pack "${packId}". Builtin packs: ${BUILTIN_PACKS.map((p) => p.id).join(', ')}\n`);
        return 2;
    }
    if (remove) {
        const targetId = pack ? pack.id : packId;
        const report = store.removeSeedPack(targetId);
        const kept = report.keptChanged + report.keptProven;
        process.stdout.write(`removed ${report.removed} seeded rule(s) from ${targetId}` +
            (kept > 0
                ? ` · kept ${kept} (changed or proven since seeding, evidence preserved)\n`
                : '\n'));
        return 0;
    }
    if (!pack) {
        process.stderr.write(`seed: use \`immune ingest-skill <path> --pack ${packId}\` to install external skills\n`);
        return 2;
    }
    const hasBaselineRules = pack.rules.some((rule) => rule.baseline === 'newly');
    const activeBaseline = explicitBaseline ?? (hasBaselineRules ? detectProjectBaselineDetail(process.cwd()).level : 'newly');
    const filteredRules = filterRulesByBaseline(pack.rules, activeBaseline);
    const skippedBaseline = pack.rules.length - filteredRules.length;
    const report = store.seedPack(pack.id, filteredRules);
    const baselineNote = hasBaselineRules || explicitBaseline
        ? ` (baseline: ${activeBaseline}${skippedBaseline > 0 ? `, filtered ${skippedBaseline} newly-only` : ''})`
        : '';
    process.stdout.write(`seeded ${pack.id}${baselineNote}: ${report.inserted} rule(s) added · ${report.alreadySeeded} already seeded\n`);
    return 0;
}
export function cmdIngestSkill(store, args) {
    const flags = parseSeedCliArgs(args, ['--pack', '--baseline']);
    const remove = flags.booleans.has('--remove');
    const packOpt = flags.values.get('--pack');
    const baselineRaw = flags.values.get('--baseline');
    const explicitBaseline = parseBaselineFlag(baselineRaw);
    if (baselineRaw !== undefined && !explicitBaseline) {
        process.stderr.write(`ingest-skill: invalid --baseline "${baselineRaw}" (expected widely or newly)\n`);
        return 2;
    }
    if (remove) {
        const rawPack = packOpt ?? flags.positional[0];
        if (!rawPack) {
            process.stderr.write('usage: immune ingest-skill --remove --pack <name>\n');
            return 2;
        }
        const packId = normalizeSkillPackId(rawPack);
        const report = store.removeSeedPack(packId);
        const kept = report.keptChanged + report.keptProven;
        process.stdout.write(`removed ${report.removed} ingested rule(s) from ${packId}` +
            (kept > 0 ? ` · kept ${kept} (changed or proven, evidence preserved)\n` : '\n'));
        return 0;
    }
    if (flags.positional.length === 0) {
        process.stderr.write('usage: immune ingest-skill <path...> [--pack <name>] [--baseline widely|newly] [--remove]\n');
        return 2;
    }
    const report = ingestSkillPaths(store, flags.positional, {
        ...(packOpt ? { pack: packOpt } : {}),
        ...(explicitBaseline ? { baseline: explicitBaseline } : {}),
    });
    if (report.filesRead === 0) {
        process.stderr.write(`ingest-skill: no readable .md/.mdx/.txt guidance files found in: ${flags.positional.join(', ')}\n`);
        return 2;
    }
    process.stdout.write(`ingested ${report.packId}: ${report.inserted} rule(s) indexed on demand · ` +
        `${report.alreadySeeded} already indexed (${report.parsed} parsed from ${report.filesRead} file(s), ` +
        `baseline: ${report.baseline}` +
        (report.baselineFiltered > 0 ? `, filtered ${report.baselineFiltered} newly-only` : '') +
        ')\n');
    return 0;
}
export function cmdIngestDisk(store, args) {
    const flags = parseSeedCliArgs(args, ['--max-projects', '--max-rules', '--depth']);
    const roots = flags.positional.length > 0 ? flags.positional : [process.cwd()];
    const dryRun = flags.booleans.has('--dry-run');
    const includeCodexSkills = !flags.booleans.has('--no-codex-skills');
    const maxProjects = Number(flags.values.get('--max-projects') ?? '150');
    const maxRules = Number(flags.values.get('--max-rules') ?? '12');
    const maxDepth = Number(flags.values.get('--depth') ?? '3');
    const report = ingestDiskCorpus(store, {
        roots,
        dryRun,
        includeCodexSkills,
        maxProjects: Number.isFinite(maxProjects) && maxProjects > 0 ? maxProjects : 150,
        maxRulesPerProject: Number.isFinite(maxRules) && maxRules > 0 ? maxRules : 12,
        maxDepth: Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 3,
    });
    process.stdout.write(`ingest-disk (${report.dryRun ? 'dry-run' : 'applied'}) roots=[${report.roots.join(', ')}]:\n` +
        `  projects scanned: ${report.projectsScanned} · profiles saved: ${report.profilesRecorded}\n` +
        `  rules extracted: ${report.rulesExtracted} (${report.universalRules} universal, ${report.scopedRules} workspace-scoped) · ` +
        `inserted/merged: ${report.rulesInserted} · skipped low-rubric: ${report.skippedLowQuality}\n`);
    for (const p of report.projects.slice(0, 20)) {
        process.stdout.write(`  [${p.kind.padEnd(10)}] ${p.name.padEnd(26)} ${p.rules} rule(s) · stacks=[${p.stacks.join(',')}] · ${p.scopeId}\n`);
    }
    if (report.projects.length > 20) {
        process.stdout.write(`  ... and ${report.projects.length - 20} more project(s)\n`);
    }
    return 0;
}
export function cmdWorkspaces(store, args = []) {
    const profiles = store.listWorkspaceProfiles();
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(profiles, null, 2)}\n`);
        return 0;
    }
    if (profiles.length === 0) {
        process.stdout.write('no workspace profiles recorded yet — run `immune ingest-disk <root>`\n');
        return 0;
    }
    process.stdout.write(`workspace profiles (${profiles.length}):\n`);
    for (const p of profiles) {
        process.stdout.write(`  ${p.name.padEnd(26)} ${p.scope_id} · ${p.source} · baseline=${p.baseline} · rules=${p.rules_count} · [${p.stack}]\n`);
    }
    return 0;
}
export function cmdBackfillAsync(store, args, onDone) {
    const dbRaw = flagValue(args, '--db');
    const daysRaw = flagValue(args, '--days');
    const sessionRaw = flagValue(args, '--session');
    const budgetRaw = flagValue(args, '--budget-ms');
    const maxRaw = flagValue(args, '--max');
    const report = backfill(store, {
        sourceDb: dbRaw ? resolve(dbRaw) : undefined,
        days: daysRaw !== undefined ? Number(daysRaw) : 120,
        sessionId: sessionRaw,
        ...(maxRaw !== undefined ? { max: Number(maxRaw) } : {}),
        selfMarkers: selfMarkers(),
    });
    const budget = budgetRaw !== undefined ? Number(budgetRaw) : 60_000;
    const noLlm = args.includes('--no-llm');
    const llm = noLlm ? null : readLlmConfig();
    let drained = 0;
    (async () => {
        for (;;) {
            const r = await drainJobs(store, Number.isFinite(budget) ? budget : 60_000, { llm });
            drained += r.processed;
            if (store.pendingJobCount() === 0 || r.processed === 0)
                break;
        }
    })()
        .then(() => {
        const s = store.stats();
        const path = llm === null
            ? 'deterministic rule path'
            : `${s.llmDistilled} by the model · ${s.llmFallbacks} degraded`;
        process.stdout.write(`scanned ${report.scanned} calls · ${report.failures} failures · ` +
            `${report.paired} paired (${report.superseded} superseded) · ` +
            `${report.enqueued} enqueued (${report.skippedSelf} self-noise skipped)\n` +
            `distilled ${drained} episode(s) — ${path} · ` +
            `${store.pendingJobCount()} left queued\n`);
    })
        .catch((error) => {
        process.stderr.write(`backfill drain failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    })
        .finally(onDone);
}
export function cmdAudit(store, args, onAsyncDone) {
    const daysRaw = flagValue(args, '--days');
    const sourceRaw = flagValue(args, '--source');
    const maxRaw = flagValue(args, '--max');
    const budgetRaw = flagValue(args, '--budget-ms');
    const dryRun = args.includes('--dry-run');
    const source = sourceRaw ?? 'auto';
    if (!['auto', 'zcode', 'codex', 'claude-code', 'antigravity'].includes(source)) {
        process.stderr.write(`audit: unknown source "${source}"\n`);
        return { asyncStarted: false, code: 2 };
    }
    const days = args.includes('--all-time')
        ? 3650
        : daysRaw !== undefined && Number.isFinite(Number(daysRaw))
            ? Number(daysRaw)
            : 30;
    const report = auditHistory(store, {
        days,
        source: source,
        ...(maxRaw !== undefined ? { max: Number(maxRaw) } : {}),
        dryRun,
        selfMarkers: selfMarkers(),
    });
    if (dryRun && args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return { asyncStarted: false, code: 0 };
    }
    process.stdout.write(`${renderAuditReport(report, days, dryRun)}\n`);
    if (args.includes('--magpie') || args.includes('--all-time')) {
        const mg = scanMagpieTelemetry();
        if (mg.present) {
            process.stdout.write(`magpie gateway telemetry: ${mg.routingRequests} routed · ${mg.usageRequests} usage probes · ` +
                `cache hit ${mg.cacheHitRatePct}% · retry-recovered ${mg.retryRecovered} · canceled ${mg.canceled} · ${mg.distinctModels} models\n`);
        }
    }
    if (dryRun)
        return { asyncStarted: false, code: 0 };
    const noLlm = args.includes('--no-llm');
    const llm = noLlm ? null : readLlmConfig();
    const budget = budgetRaw !== undefined ? Number(budgetRaw) : 60_000;
    let drained = 0;
    (async () => {
        for (;;) {
            const r = await drainJobs(store, Number.isFinite(budget) ? budget : 60_000, { llm });
            drained += r.processed;
            if (store.pendingJobCount() === 0 || r.processed === 0)
                break;
        }
    })()
        .then(() => {
        const s = store.stats();
        const path = llm === null
            ? 'deterministic rule path'
            : `${s.llmDistilled} by the model · ${s.llmFallbacks} degraded`;
        process.stdout.write(`distilled ${drained} episode(s) — ${path} · ${store.pendingJobCount()} left queued\n`);
    })
        .catch((error) => {
        process.stderr.write(`audit drain failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    })
        .finally(onAsyncDone);
    return { asyncStarted: true, code: 0 };
}
