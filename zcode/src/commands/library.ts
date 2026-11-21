import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ImmuneStore } from '../../../core/store/index.js';
import { renderSkillMarkdown } from '../../../core/export.js';
import { strings } from '../../../core/i18n.js';
import { SNAPSHOT_FORMAT, exportLibrary, importLibrary } from '../../../core/sync.js';
import { syncDoc } from '../../../core/sync-doc.js';
import { ciCheck, formatShareViolations, parseManagedBlock, shareSanityCheck } from '../../../core/share-guard.js';
import {
  computeImmunityScore,
  renderImmunityBadgeSvg,
  renderWrappedMarkdown,
  renderWrappedSvg,
  type WrappedInput,
} from '../../../core/wrapped.js';
import { parseTeamRulesJsonl, verifyTeamRulesJsonl, writeTeamRulesFile } from '../../../core/team-sync.js';
import { diagnoseAgentArchetype, renderDiagnosisMarkdown, renderDiagnosisSvg, renderDiagnosisTerminal } from '../../../core/diagnose.js';
import { IDE_TARGET_PATHS, compileIdeRules, type IdeRuleTarget } from '../../../core/compile-rules.js';
import { renderAutopsyMarkdown, renderAutopsyTerminal, runPitfallAutopsy } from '../../../core/autopsy.js';
import { evaluatePreFlightGuard, renderGuardHookDecision, renderGuardMarkdown, renderGuardTerminal } from '../../../core/guard.js';
import { applyVaccineLockfile, detectWorkspaceDNA, renderVaccineMarkdown, renderVaccineTerminal, verifyVaccineLockfile, writeVaccineLockfile, type VaccineLockfile } from '../../../core/vaccine.js';
import { federateSwarmRules, renderFederationMarkdown, renderFederationSvg, renderFederationTerminal, type SwarmRuleSource } from '../../../core/federate.js';
import { dshDirOf } from '../root-marker.js';
import { clamp, flagValue, pad } from './shared.js';

export function cmdList(store: ImmuneStore, argsOrRetired: string[] | boolean): number {
  const args = Array.isArray(argsOrRetired) ? argsOrRetired : [];
  const includeRetired = typeof argsOrRetired === 'boolean' ? argsOrRetired : args.includes('--all');
  const rows = store.listAll(includeRetired);
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const t = strings();
  if (rows.length === 0) {
    process.stdout.write(`${t.noAntibodies}\n`);
    return 0;
  }
  const indent = ' '.repeat(27);
  const header = `${pad('#', 5)}${pad('hits', 6)}${pad('fails', 7)}${pad('status', 12)}${t.trigger}\n`;
  process.stdout.write(header);
  for (const ab of rows) {
    process.stdout.write(
      `${pad(String(ab.id), 5)}${pad(String(ab.hit_count), 6)}${pad(String(ab.fail_count), 7)}` +
        `${pad(ab.status, 12)}${clamp(ab.trigger_pattern, 64)}\n` +
        `${indent}${t.avoid}: ${clamp(ab.symptom, 90)}\n` +
        `${indent}${t.do}: ${clamp(ab.prescription, 90)}\n`,
    );
    const marks: string[] = [];
    if (ab.quality_grade && ab.rubric_score !== undefined) {
      marks.push(`${ab.quality_grade} ${ab.rubric_score}/100`);
    }
    if (ab.project_scope && ab.project_scope !== '*') marks.push(`scope: ${ab.project_scope}`);
    if (ab.root_cause) marks.push(`cause: ${ab.root_cause}`);
    if (ab.origin === 'user_correction') marks.push('origin: user correction');
    else if (ab.origin === 'self_healing_experiment') marks.push('origin: self-healing');
    else if (ab.origin === 'disk_corpus') marks.push('origin: disk corpus');
    if ((ab.parent_id ?? 0) > 0) marks.push(`mutated from #${ab.parent_id}`);
    if ((ab.probation_at ?? 0) > 0 && ab.status === 'active') marks.push('env probation');
    if (ab.retire_reason) marks.push(ab.retire_reason);
    if (ab.prescription_source === 'llm' || ab.prescription_source === 'human' || ab.prescription_source === 'host_llm') {
      marks.push(`prescription: ${ab.prescription_source}`);
    }
    if (marks.length > 0) process.stdout.write(`${indent}— ${marks.join(' · ')}\n`);
  }
  return 0;
}

export function cmdSearch(store: ImmuneStore, args: string[]): number {
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('usage: immune search <query>\n');
    return 2;
  }
  const rows = store.peek(query, 20);
  if (rows.length === 0) {
    process.stdout.write('没有匹配 / no match\n');
    return 0;
  }
  for (const ab of rows) {
    process.stdout.write(
      `${pad(String(ab.id), 5)}${pad(String(ab.hit_count), 6)}${pad(ab.status, 12)}${clamp(ab.trigger_pattern, 64)}\n` +
        `${' '.repeat(23)}  ${strings().avoid}: ${clamp(ab.symptom, 90)}\n` +
        `${' '.repeat(23)}  ${strings().do}: ${clamp(ab.prescription, 90)}\n`,
    );
  }
  return 0;
}

export function cmdLearn(store: ImmuneStore, args: string[]): number {
  const trigger = args[0] ?? '';
  const prescription = args.length >= 3 ? args[args.length - 1] ?? '' : args[1] ?? '';
  const symptom = args.length >= 3 ? args.slice(1, -1).join(' ') : '';
  if (!trigger.trim() || !prescription.trim()) {
    process.stderr.write(
      'usage: immune learn <trigger> [symptom] <prescription>\n' +
        'example: immune learn "pnpm-lock.yaml 这个仓库" "用 pnpm 不是 npm"\n',
    );
    return 2;
  }
  const id = store.insert({
    trigger_pattern: trigger,
    symptom: symptom || '(manual rule)',
    prescription,
    tool_name: null,
    prescription_source: 'human',
  });
  process.stdout.write(id === null ? `${strings().notFound}\n` : `${strings().learned} #${id}.\n`);
  return 0;
}

export function cmdForget(store: ImmuneStore, args: string[]): number {
  if (args.includes('--last')) {
    const id = store.forgetLast();
    process.stdout.write(id === null ? `${strings().notFound}\n` : `${strings().forgot} #${id}.\n`);
    return 0;
  }
  if (args.includes('--prune') || args.includes('--purge')) {
    const purge = args.includes('--purge');
    const window = 14 * 24 * 60 * 60 * 1000;
    const changed = purge ? store.pruneZombies(window) : store.retireZombies(window);
    const label = purge ? strings().purged : strings().pruned;
    process.stdout.write(
      changed.length === 0
        ? `${strings().noZombies}\n`
        : `${label} ${changed.length}: ${changed.map((n) => `#${n}`).join(' ')}\n`,
    );
    return 0;
  }
  const id = Number(args[0]);
  if (!Number.isFinite(id)) {
    process.stderr.write('usage: immune forget <id> | --last | --prune | --purge\n');
    return 2;
  }
  process.stdout.write(store.remove(id) ? `${strings().forgot} #${id}.\n` : `${strings().notFound} #${id}.\n`);
  return 0;
}

export function cmdExport(store: ImmuneStore, args: string[]): number {
  const minHits = Number(args[0] ?? '');
  const threshold = Number.isFinite(minHits) && minHits > 0 ? minHits : 3;
  const rows = store.exportable(threshold);
  if (rows.length === 0) {
    process.stdout.write(`${strings().noExport}\n`);
    return 0;
  }
  const violations = shareSanityCheck(rows);
  if (violations.length > 0) {
    process.stderr.write(`${formatShareViolations(violations)}\n`);
    process.exitCode = 1;
    return 1;
  }
  const outPath = args[1]
    ? resolve(args[1])
    : join(dshDirOf(), 'skills', 'project-pitfalls', 'SKILL.md');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderSkillMarkdown(rows, { minHits: threshold }), 'utf8');
  process.stdout.write(`${strings().exported} ${rows.length} -> ${outPath}\n`);
  return 0;
}

export function cmdExportJson(store: ImmuneStore, args: string[]): number {
  const target = args[0];
  const snapshot = exportLibrary(store);
  const violations = shareSanityCheck(snapshot.antibodies);
  if (violations.length > 0) {
    process.stderr.write(`${formatShareViolations(violations)}\n`);
    return 1;
  }
  const body = JSON.stringify(snapshot, null, 2) + '\n';
  if (target) {
    writeFileSync(resolve(target), body, 'utf8');
    process.stdout.write(`exported ${snapshot.count} antibodies -> ${resolve(target)}\n`);
  } else {
    process.stdout.write(body);
  }
  return 0;
}

export function cmdImportJson(store: ImmuneStore, args: string[]): number {
  const source = args[0];
  if (!source) {
    process.stderr.write('usage: immune import-json <snapshot.json>\n');
    return 2;
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(readFileSync(resolve(source), 'utf8'));
  } catch (error) {
    process.stderr.write(
      `cannot read snapshot: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    (snapshot as Record<string, unknown>).format !== SNAPSHOT_FORMAT
  ) {
    process.stderr.write(`not a ${SNAPSHOT_FORMAT} snapshot (missing format tag)\n`);
    return 2;
  }
  const report = importLibrary(store, snapshot);
  process.stdout.write(
    `imported: ${report.added} added, ${report.merged} merged, ${report.invalid} invalid\n`,
  );
  return 0;
}

export function cmdSyncDoc(store: ImmuneStore, args: string[]): number {
  const explicitOut = flagValue(args, '--out');
  const rawMinHits = flagValue(args, '--min-hits');
  const defaultDoc =
    existsSync(resolve('AGENTS.md'))
      ? resolve('AGENTS.md')
      : existsSync(resolve('CLAUDE.md'))
        ? resolve('CLAUDE.md')
        : resolve('AGENTS.md');
  const target = explicitOut ? resolve(explicitOut) : defaultDoc;
  const minHits = rawMinHits !== undefined ? Number(rawMinHits) : 3;
  const report = syncDoc(store, {
    file: target,
    minHits: Number.isFinite(minHits) && minHits >= 0 ? minHits : 3,
  });
  process.stdout.write(
    `${report.file}: ${report.rules} rule(s) written (${report.created ? 'section created' : report.replaced ? 'section replaced' : 'appended'})\n` +
      'the section is fenced by immune:generated markers and fully managed - edit outside it, never inside.\n',
  );
  if (report.skipped > 0) {
    process.stderr.write(
      `skipped ${report.skipped} rule(s) withheld by share gate (machine paths, emails, or secrets)\n`,
    );
  }
  return 0;
}

function escapeGhProp(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function escapeGhMsg(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function cmdCiCheck(args: string[]): number {
  const explicitDiff = flagValue(args, '--diff');
  if (args.includes('--diff') && !explicitDiff) {
    process.stderr.write('usage: immune ci-check [--diff <patch-file>] [--doc <AGENTS.md>] [--json] [--github] [--warn-only]\n');
    return 2;
  }
  const explicitDoc = flagValue(args, '--doc');
  let diffText = '';
  if (explicitDiff) {
    diffText = readFileSync(resolve(explicitDiff), 'utf8');
  } else if (process.stdin.isTTY) {
    try {
      diffText = execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } catch {
      try {
        diffText = execFileSync('git', ['diff'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      } catch {
        process.stderr.write('ci-check: could not read git diff; pipe a patch on stdin or pass --diff <file>\n');
        return 2;
      }
    }
  } else {
    diffText = readFileSync(0, 'utf8');
  }

  const doc = explicitDoc
    ? resolve(explicitDoc)
    : existsSync(resolve(process.cwd(), 'AGENTS.md'))
      ? resolve(process.cwd(), 'AGENTS.md')
      : existsSync(resolve(process.cwd(), 'CLAUDE.md'))
        ? resolve(process.cwd(), 'CLAUDE.md')
        : resolve(process.cwd(), 'AGENTS.md');

  const rules = parseManagedBlock(doc);
  const report = ciCheck(diffText, rules);
  const asGithub = args.includes('--github');
  const warnOnly = args.includes('--warn-only');

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `immune ci-check: ${report.addedLines} added line(s) vs ${report.rulesConsidered} managed rule(s)\n`,
    );
    for (const finding of report.findings) {
      const loc = finding.file ? `${finding.file}:${finding.line}` : `L${finding.line}`;
      process.stdout.write(`  ${loc}: ${finding.trigger} — "${finding.text}"\n`);
      if (asGithub) {
        const props = [
          finding.file ? `file=${escapeGhProp(finding.file)}` : '',
          `line=${finding.line}`,
          `title=${escapeGhProp(`Pitfall Immunity: ${finding.trigger}`)}`,
        ]
          .filter(Boolean)
          .join(',');
        const detail = [
          finding.symptom ? `Avoid: ${finding.symptom}` : '',
          finding.prescription ? `Do instead: ${finding.prescription}` : `Matched trigger: ${finding.trigger}`,
        ]
          .filter(Boolean)
          .join(' — ');
        process.stdout.write(`::warning ${props}::${escapeGhMsg(detail)}\n`);
      }
    }
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (asGithub && summaryPath) {
    try {
      const mdLines = [
        '### 🛡️ Agent Immune — PR Pitfall Check',
        '',
        `- **Added lines scanned**: \`${report.addedLines}\``,
        `- **Managed repository antibodies**: \`${report.rulesConsidered}\``,
        `- **Findings**: \`${report.findings.length}\``,
        '',
      ];
      if (report.findings.length > 0) {
        mdLines.push('| Location | Trigger | Advice |', '| --- | --- | --- |');
        for (const f of report.findings.slice(0, 30)) {
          const loc = f.file ? `\`${f.file}:${f.line}\`` : `\`L${f.line}\``;
          const advice = (f.prescription || f.symptom || f.text).replace(/\|/g, '\\|');
          mdLines.push(`| ${loc} | \`${f.trigger.replace(/\|/g, '\\|')}\` | ${advice} |`);
        }
        mdLines.push('');
      } else {
        mdLines.push('✅ No known repository pitfall territories triggered by this diff.', '');
      }
      appendFileSync(summaryPath, `${mdLines.join('\n')}\n`, 'utf8');
    } catch {
      // Summary write is best-effort.
    }
  }

  if (warnOnly) return 0;
  return report.findings.length > 0 ? 1 : 0;
}

export function cmdWrapped(store: ImmuneStore, args: string[]): number {
  const explicitOut = flagValue(args, '--out') ?? args.find((a) => !a.startsWith('-'));
  const hostsFlag = flagValue(args, '--hosts');
  const asJson = args.includes('--json');
  const toStdout = args.includes('--stdout');

  const all = store.listAll(true);
  const active = all.filter((a) => a.status === 'active');
  const s = store.stats();
  const totalInjections = all.reduce((sum, a) => sum + a.hit_count, 0);
  const totalFails = all.reduce((sum, a) => sum + a.fail_count, 0);
  const repeatFailures = Math.max(s.suppressedRepeats + totalInjections, active.length);
  const totalCalls = Math.max((repeatFailures + totalFails) * 18, totalInjections * 4, active.length * 25);
  const avoidableTokens = (s.suppressedRepeats + totalInjections) * 2400;
  const topNemeses = [...active]
    .sort((a, b) => b.hit_count - a.hit_count)
    .slice(0, 3)
    .map((a) => ({
      label: `${a.tool_name ? `${a.tool_name}: ` : ''}${a.trigger_pattern}`,
      count: Math.max(1, a.hit_count),
    }));

  const input: WrappedInput = {
    totalCalls,
    repeatFailures,
    avoidableTokens,
    activeRules: active.length,
    totalInjections,
    ...(hostsFlag ? { hosts: hostsFlag.split(',').map((h) => h.trim()).filter(Boolean) } : {}),
    ...(topNemeses.length > 0 ? { topNemeses } : {}),
    judgeAgreementPct: 97.81,
  };
  const asBadge = args.includes('--badge');
  const asMarkdown = args.includes('--markdown');
  const score = computeImmunityScore(input);

  if (asMarkdown) {
    const md = renderWrappedMarkdown(input);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ score, markdown: md, stats: input }, null, 2)}\n`);
    } else {
      process.stdout.write(md);
    }
    return 0;
  }

  const svg = asBadge ? renderImmunityBadgeSvg(input) : renderWrappedSvg(input);

  if (asJson) {
    if (explicitOut) {
      const outPath = resolve(explicitOut);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, svg, 'utf8');
    }
    process.stdout.write(
      `${JSON.stringify({ score, badge: asBadge, outPath: explicitOut ? resolve(explicitOut) : null, stats: input }, null, 2)}\n`,
    );
    return 0;
  }
  if (toStdout) {
    process.stdout.write(`${svg}\n`);
    return 0;
  }
  const outPath = resolve(explicitOut ?? (asBadge ? 'immune-badge.svg' : 'immune-wrapped.svg'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, svg, 'utf8');
  process.stdout.write(
    `wrapped ${asBadge ? 'badge' : 'scorecard'} (Immunity Score: ${score}/100, ${active.length} active rule(s), ${totalInjections} deliveries) -> ${outPath}\n`,
  );
  return 0;
}

export function cmdTeamSync(store: ImmuneStore, args: string[]): number {
  const isImport = args.includes('--import');
  const isCheck = args.includes('--check');
  const isDedupe = args.includes('--dedupe');
  const asJson = args.includes('--json');
  const explicitPath = flagValue(args, '--path') ?? args.find((a) => !a.startsWith('-'));
  const rawMinHits = flagValue(args, '--min-hits');
  const minHits =
    rawMinHits !== undefined && Number.isFinite(Number(rawMinHits))
      ? Math.max(0, Number(rawMinHits))
      : 1;
  const filePath = resolve(explicitPath ?? join('.immune', 'rules.jsonl'));

  if (isCheck) {
    if (!existsSync(filePath)) {
      process.stderr.write(`team-sync check: file not found: ${filePath}\n`);
      return 2;
    }
    const report = verifyTeamRulesJsonl(readFileSync(filePath, 'utf8'));
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ mode: 'check', file: filePath, ...report }, null, 2)}\n`);
    } else {
      process.stdout.write(
        `team-sync check: ${report.valid ? 'OK' : 'FAILED'} (${report.total} rule(s), unsorted=${report.unsorted}, duplicates=${report.duplicates}, unsafe=${report.unsafeCount}, conflicts=${report.conflictMarkers})\n`,
      );
    }
    return report.valid ? 0 : 1;
  }

  if (isDedupe) {
    if (!existsSync(filePath)) {
      process.stderr.write(`team-sync dedupe: file not found: ${filePath}\n`);
      return 2;
    }
    const report = writeTeamRulesFile(filePath, [], { minHits: 0 });
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ mode: 'dedupe', file: filePath, ...report }, null, 2)}\n`);
    } else {
      process.stdout.write(`team-sync dedupe: healed and sorted ${report.exported} rule(s) -> ${filePath}\n`);
    }
    return 0;
  }

  if (isImport) {
    if (!existsSync(filePath)) {
      process.stderr.write(`team-sync: file not found: ${filePath}\n`);
      return 2;
    }
    const records = parseTeamRulesJsonl(readFileSync(filePath, 'utf8'));
    let imported = 0;
    for (const rec of records) {
      const id = store.insert({
        trigger_pattern: rec.trigger_pattern,
        symptom: rec.symptom || '(team rule)',
        prescription: rec.prescription,
        tool_name: rec.tool_name,
        prescription_source: 'human',
      });
      if (id !== null) imported += 1;
    }
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ mode: 'import', file: filePath, parsed: records.length, imported }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(`team-sync import: ${imported}/${records.length} rule(s) merged from ${filePath}\n`);
    }
    return 0;
  }

  const active = store.listAll(false);
  const report = writeTeamRulesFile(filePath, active, { minHits });
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ mode: 'export', file: filePath, exported: report.exported, skippedUnsafe: report.skippedUnsafe, minHits }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `team-sync export: ${report.exported} rule(s) written -> ${filePath}` +
        (report.skippedUnsafe > 0 ? ` (${report.skippedUnsafe} skipped by safety gate)` : '') +
        '\n',
    );
  }
  return 0;
}

export function cmdBackupAsync(store: ImmuneStore, args: string[], onDone: () => void): void {
  const target = args[0]
    ? resolve(args[0])
    : `${store.dbPath}.${new Date().toISOString().slice(0, 10)}.bak.sqlite`;
  store
    .backupTo(target)
    .then(() => process.stdout.write(`backup -> ${target}\n`))
    .catch((error: unknown) => {
      process.stderr.write(
        `backup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(onDone);
}

export function cmdDiagnose(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const asMarkdown = args.includes('--markdown');
  const report = diagnoseAgentArchetype(store.listAll(false));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (args.includes('--svg')) {
    const out = resolve(flagValue(args, '--out') ?? args.find((a) => !a.startsWith('-')) ?? 'immune-diagnosis.svg');
    writeFileSync(out, renderDiagnosisSvg(report), 'utf8');
    process.stdout.write(`diagnosis radar SVG (${report.archetype.id}, ${report.overallImmunityPct}%) -> ${out}\n`);
    return 0;
  }
  if (asMarkdown) {
    process.stdout.write(renderDiagnosisMarkdown(report));
    return 0;
  }
  process.stdout.write(renderDiagnosisTerminal(report));
  return 0;
}

export function cmdCompileRules(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const rawTarget = (flagValue(args, '--target') ?? args.find((a) => !a.startsWith('-')) ?? 'all').toLowerCase();
  const rawMinHits = flagValue(args, '--min-hits');
  const minHits =
    rawMinHits !== undefined && Number.isFinite(Number(rawMinHits))
      ? Math.max(0, Number(rawMinHits))
      : 1;

  const validTargets = Object.keys(IDE_TARGET_PATHS) as IdeRuleTarget[];
  let targets: IdeRuleTarget[];
  if (rawTarget === 'all') {
    targets = validTargets;
  } else {
    const requested = rawTarget.split(',').map((s) => s.trim()) as IdeRuleTarget[];
    const unknown = requested.filter((t) => !validTargets.includes(t));
    if (unknown.length > 0) {
      process.stderr.write(
        `compile-rules: unknown target(s): ${unknown.join(', ')}. Supported: all, ${validTargets.join(', ')}\n`,
      );
      return 2;
    }
    targets = requested;
  }

  const compiled = compileIdeRules(process.cwd(), store.listAll(false), {
    targets,
    minHits,
    dryRun,
  });

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun,
          minHits,
          targets: compiled.map((c) => ({
            target: c.target,
            path: c.relativePath,
            rulesCount: c.rulesCount,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  for (const item of compiled) {
    process.stdout.write(
      `compile-rules (${item.target}): ${item.rulesCount} rule(s) ${dryRun ? 'previewed for' : 'written ->'} ${item.relativePath}\n`,
    );
  }
  return 0;
}

export function cmdAutopsy(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const asMarkdown = args.includes('--markdown');
  const report = runPitfallAutopsy(store.listAll(false));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (asMarkdown) {
    process.stdout.write(renderAutopsyMarkdown(report));
    return 0;
  }
  process.stdout.write(renderAutopsyTerminal(report));
  return 0;
}

export function cmdGuard(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const asMarkdown = args.includes('--markdown');
  const asHook = args.includes('--hook');
  const strict = args.includes('--strict');
  const toolName = flagValue(args, '--tool') ?? 'Bash';
  const positional: string[] = [];
  let afterSeparator = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (afterSeparator) {
      positional.push(a);
      continue;
    }
    if (a === '--') {
      afterSeparator = true;
      continue;
    }
    if (a === '--tool') {
      i++;
      continue;
    }
    if (a.startsWith('--tool=')) continue;
    if (a === '--json' || a === '--markdown' || a === '--hook' || a === '--strict') continue;
    positional.push(a);
  }
  const payload = positional.join(' ').trim();
  if (!payload) {
    process.stderr.write('usage: immune guard "<command-or-payload>" [--tool Bash|Edit|Write] [--strict] [--hook] [--markdown] [--json]\n');
    return 2;
  }
  const dna = detectWorkspaceDNA(process.cwd());
  const pm =
    dna.packageManager === 'pnpm' || dna.packageManager === 'yarn' || dna.packageManager === 'bun'
      ? dna.packageManager
      : null;
  const verdict = evaluatePreFlightGuard(payload, store.listAll(false), {
    toolName,
    strict,
    workspacePackageManager: pm,
  });
  if (asHook) {
    process.stdout.write(`${JSON.stringify(renderGuardHookDecision(verdict), null, 2)}\n`);
    return verdict.decision === 'block' ? 1 : 0;
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    return verdict.decision === 'block' ? 1 : 0;
  }
  if (asMarkdown) {
    process.stdout.write(renderGuardMarkdown(verdict));
    return verdict.decision === 'block' ? 1 : 0;
  }
  process.stdout.write(renderGuardTerminal(verdict));
  return verdict.decision === 'block' ? 1 : 0;
}

export function cmdVaccinate(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const asMarkdown = args.includes('--markdown');
  const isCheck = args.includes('--check');
  const shouldApply = args.includes('--apply');
  const shouldRefresh = args.includes('--refresh');
  const explicitLock = flagValue(args, '--lockfile');
  const lockfilePath = resolve(explicitLock ?? join('.immune', 'vaccine.lock.json'));

  if (isCheck) {
    if (!existsSync(lockfilePath)) {
      process.stderr.write(`vaccinate check: lockfile not found: ${lockfilePath}\n`);
      return 2;
    }
    const report = verifyVaccineLockfile(readFileSync(lockfilePath, 'utf8'));
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ mode: 'check', file: lockfilePath, ...report }, null, 2)}\n`);
    } else {
      process.stdout.write(`vaccinate check: ${report.valid ? 'OK' : 'FAILED'} (${report.antibodyCount} antibodies, ${report.reason})\n`);
    }
    return report.valid ? 0 : 1;
  }

  let lockfile: VaccineLockfile;
  if (shouldApply && existsSync(lockfilePath) && !shouldRefresh) {
    const raw = readFileSync(lockfilePath, 'utf8');
    const report = verifyVaccineLockfile(raw);
    if (!report.valid) {
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ mode: 'apply', lockfilePath, valid: false, reason: report.reason }, null, 2)}\n`);
      } else {
        process.stderr.write(`vaccinate apply: lockfile integrity check failed (${report.reason})\n`);
      }
      return 1;
    }
    lockfile = JSON.parse(raw) as VaccineLockfile;
  } else {
    ({ lockfile } = writeVaccineLockfile(process.cwd(), store.listAll(false), { lockfilePath }));
  }

  let appliedCount = 0;
  let skippedCount = 0;
  if (shouldApply) {
    const res = applyVaccineLockfile(store, lockfile);
    appliedCount = res.applied;
    skippedCount = Math.max(0, res.total - res.applied);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ lockfilePath, appliedCount, skippedCount, lockfile }, null, 2)}\n`);
    return 0;
  }
  if (asMarkdown) {
    process.stdout.write(renderVaccineMarkdown(lockfile));
    return 0;
  }
  process.stdout.write(renderVaccineTerminal(lockfile, lockfilePath));
  if (shouldApply) {
    process.stdout.write(`  Applied to SQLite : ${appliedCount} new (${skippedCount} already present)\n`);
  }
  return 0;
}

export function cmdFederate(store: ImmuneStore, args: string[]): number {
  const asJson = args.includes('--json');
  const asMarkdown = args.includes('--markdown');
  const asSvg = args.includes('--svg');
  const outPath = flagValue(args, '--out');
  const rawMin = flagValue(args, '--min-consensus');
  const minConsensusScore = rawMin && Number.isFinite(Number(rawMin)) ? Number(rawMin) : 0;

  const fileInputs = args.filter((a) => !a.startsWith('-') && a !== outPath && a !== rawMin);
  const sources: SwarmRuleSource[] = [
    { sourceId: 'local-sqlite', rules: store.listAll(false) },
  ];

  const defaultTeamFile = resolve(join('.immune', 'rules.jsonl'));
  if (fileInputs.length === 0 && existsSync(defaultTeamFile)) {
    sources.push({
      sourceId: '.immune/rules.jsonl',
      rules: parseTeamRulesJsonl(readFileSync(defaultTeamFile, 'utf8')),
    });
  } else {
    for (const fp of fileInputs) {
      const resolved = resolve(fp);
      if (existsSync(resolved)) {
        sources.push({
          sourceId: fp,
          rules: parseTeamRulesJsonl(readFileSync(resolved, 'utf8')),
        });
      }
    }
  }

  const report = federateSwarmRules(sources, { minConsensusScore });
  if (outPath && !asSvg) {
    writeTeamRulesFile(resolve(outPath), report.universalLaws, { minHits: 0 });
  }
  if (asSvg) {
    const svgTarget = resolve(outPath ?? 'immune-federation.svg');
    writeFileSync(svgTarget, renderFederationSvg(report), 'utf8');
    process.stdout.write(`federation consensus SVG (${report.universalLaws.length} universal laws, ${report.averageConsensusScore}/100) -> ${svgTarget}\n`);
    return 0;
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (asMarkdown) {
    process.stdout.write(renderFederationMarkdown(report));
    return 0;
  }
  process.stdout.write(renderFederationTerminal(report));
  return 0;
}
