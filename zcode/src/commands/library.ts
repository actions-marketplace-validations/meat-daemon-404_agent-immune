import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ImmuneStore } from '../../../core/store/index.js';
import { renderSkillMarkdown } from '../../../core/export.js';
import { strings } from '../../../core/i18n.js';
import { SNAPSHOT_FORMAT, exportLibrary, importLibrary } from '../../../core/sync.js';
import { syncDoc } from '../../../core/sync-doc.js';
import { ciCheck, formatShareViolations, parseManagedBlock, shareSanityCheck } from '../../../core/share-guard.js';
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
