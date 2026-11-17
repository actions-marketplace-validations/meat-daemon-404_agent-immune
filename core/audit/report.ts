import { BACKFILL_TOOLS, pairSession } from '../backfill.js';
import { isSelfEpisode } from '../selfnoise.js';
import { redactAndClamp } from '../redact.js';
import type { ImmuneStore } from '../store/index.js';
import { ROUND_TRIPS_PER_REPEAT } from '../value.js';
import { deriveProjectScope } from '../hygiene.js';
import {
  emptySource,
  MIN_FAMILY_COUNT,
  TOP_FAMILIES,
  TRACE_CLAMP,
  type AuditFailureFamily,
  type AuditReport,
  type AuditSession,
  type AuditSourceName,
  type AuditSourceReport,
  type AuditToolStat,
} from './types.js';

export function runSource(
  source: AuditSourceName,
  sessions: AuditSession[],
  store: ImmuneStore,
  opts: { cap: number | null; dryRun: boolean; selfMarkers: string[] },
): AuditSourceReport {
  const report = emptySource(source);
  report.present = true;
  const toolIndex = new Map<string, AuditToolStat>();
  const families = new Map<string, AuditFailureFamily>();

  const bumpTool = (tool: string): AuditToolStat => {
    const existing = toolIndex.get(tool);
    if (existing) return existing;
    const created: AuditToolStat = { tool, scanned: 0, failures: 0, paired: 0 };
    toolIndex.set(tool, created);
    return created;
  };

  for (const session of sessions) {
    const stats = pairSession(session.calls, session.parts, (fail, success, repairs) => {
      if (opts.cap !== null && report.enqueued >= opts.cap) return;
      const failPart = session.parts.get(fail.tool_call_id);
      const successPart = session.parts.get(success.tool_call_id);
      const failureTrace = redactAndClamp(
        `tool=${fail.tool_name} input=${JSON.stringify(failPart?.input ?? {})} error=${fail.error_message ?? 'unknown'}`,
        TRACE_CLAMP,
      );
      const successTrace = redactAndClamp(
        `tool=${success.tool_name} input=${JSON.stringify(successPart?.input ?? {})} result=ok`,
        TRACE_CLAMP,
      );
      if (isSelfEpisode(`${failureTrace} ${successTrace}`, opts.selfMarkers)) {
        report.skippedSelf += 1;
        return;
      }
      if (!opts.dryRun) {
        const scope = session.cwd ? deriveProjectScope(session.cwd) : '*';
        store.enqueueJob(
          success.tool_name,
          failureTrace,
          successTrace,
          [],
          '',
          repairs,
          '',
          scope,
          session.cwd ?? '',
        );
      }
      report.enqueued += 1;
      bumpTool(success.tool_name).paired += 1;
    });
    report.scanned += session.calls.length;
    report.failures += stats.failures;
    report.paired += stats.paired;
    report.superseded += stats.superseded;

    for (const call of session.calls) {
      if (!BACKFILL_TOOLS.has(call.tool_name)) continue;
      const stat = bumpTool(call.tool_name);
      stat.scanned += 1;
      if (call.status !== 'error') continue;
      stat.failures += 1;
      const firstLine = (call.error_message ?? 'unknown').split('\n')[0] ?? 'unknown';
      const normalized = firstLine.replace(/\s+/g, ' ').trim();
      const key = `${call.tool_name}|${normalized.toLowerCase().slice(0, 80)}`;
      const family = families.get(key);
      if (family) family.count += 1;
      else families.set(key, { tool: call.tool_name, error: normalized.slice(0, 80), count: 1 });
    }
  }

  report.byTool = [...toolIndex.values()].sort(
    (a, b) => b.failures - a.failures || b.scanned - a.scanned,
  );
  report.topFailures = [...families.values()]
    .filter((family) => family.count >= MIN_FAMILY_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_FAMILIES);
  return report;
}

function formatTokensShort(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function renderAuditReport(report: AuditReport, days: number, dryRun: boolean): string {
  const lines: string[] = [`immune audit — last ${days} day(s)`];
  for (const source of report.sources) {
    if (!source.present) {
      lines.push(`[${source.source}] absent · ${source.note ?? 'no data'}`);
      continue;
    }
    lines.push(
      `[${source.source}] scanned ${source.scanned} · ${source.failures} failures · ` +
        `${source.paired} paired (${source.superseded} superseded) · ` +
        `${source.enqueued} enqueued (${source.skippedSelf} self-noise skipped)` +
        (source.note ? ` · ${source.note}` : ''),
    );
    const tools = source.byTool.slice(0, 4);
    if (tools.length > 0) {
      lines.push(`  by tool: ${tools.map((stat) => `${stat.tool} ${stat.failures}f/${stat.scanned}`).join(' · ')}`);
    }
    if (source.topFailures.length > 0) {
      lines.push('  repeat offenders:');
      for (const family of source.topFailures) {
        lines.push(`    ${family.count}× [${family.tool}] ${family.error}`);
      }
    }
    if (source.medianRequestTokens !== null && source.paired > 0) {
      const waste = source.paired * source.medianRequestTokens * ROUND_TRIPS_PER_REPEAT;
      lines.push(
        `  tokens: median request ${formatTokensShort(source.medianRequestTokens)} ` +
          `(${source.medianSamples} samples) — ${source.paired} episodes ≈ ${formatTokensShort(waste)} tokens`,
      );
    }
  }
  lines.push(
    `scan total: ${report.totals.scanned} calls · ${report.totals.failures} failures · ` +
      `${report.totals.paired} failed-then-fixed episodes`,
  );
  if (dryRun) {
    lines.push('dry run: nothing enqueued, nothing distilled — drop --dry-run to apply');
  }
  return lines.join('\n');
}
