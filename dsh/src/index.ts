/**
 * DSH plugin entry — thin Cordis adapter over `core/runtime.ts`.
 *
 * Shares `ImmuneRuntime` with ZCode/Claude/Codex/Antigravity so pairing,
 * Red-3 triage, workspace scoping, and turn-end distillation cannot drift.
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ImmuneStore } from '../../core/store/index.js';
import { stuckHypothesisText } from '../../core/store/stuck.js';
import { renderSkillMarkdown } from '../../core/export.js';
import { formatShareViolations, shareSanityCheck } from '../../core/share-guard.js';
import { isSubstantiveHint } from '../../core/distiller.js';
import { strings } from '../../core/i18n.js';
import { ImmuneRuntime, clampBudgetMs, resolveDrainBudgetMs } from '../../core/runtime.js';
import { hydrateTeamRules, maybeSyncTeamRulesAfterDrain } from '../../core/team-sync.js';
import { registerImmuneUiRoute } from './ui-route.js';
import {
  DSH_EVENTS,
  PLUGIN_NAME,
  createPluginMessage,
  makeLogger,
  normaliseToolEvent,
  textOf,
  type DshCommandResult,
  type DshContentBlock,
  type DshContext,
  type DshPostToolDecision,
  type DshPreStepDecision,
  type DshPreToolDecision,
  type DshSessionEvent,
  type DshUserMessage,
  type NormalisedToolEvent,
} from './dsh-adapter.js';

export const name = PLUGIN_NAME;
export const inject = ['commands'];
export { PLUGIN_NAME, DSH_EVENTS, normaliseToolEvent } from './dsh-adapter.js';

const t = strings();

function resolveStorePath(): string {
  const explicit = process.env.IMMUNE_DB_PATH?.trim();
  if (explicit) return explicit;
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const projectKey = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 16);
  const dir = join(home, 'storages', 'dsh-immune-system');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${projectKey}.sqlite`);
}

function selfMarkers(): string[] {
  const explicit = process.env.IMMUNE_DB_PATH?.trim();
  if (explicit) return [explicit];
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return [join(home, 'storages', 'dsh-immune-system')];
}

const lastPrompts = new Map<string, string>();
const lastInjectedTurn = new Map<string, number>();
const MAX_TRACKED_SESSIONS = 256;

function rememberPrompt(sessionId: string, text: string): void {
  if (!text) return;
  lastPrompts.delete(sessionId);
  lastPrompts.set(sessionId, text);
  if (lastPrompts.size <= MAX_TRACKED_SESSIONS) return;
  const oldest = lastPrompts.keys().next().value;
  if (oldest !== undefined) {
    lastPrompts.delete(oldest);
    lastInjectedTurn.delete(oldest);
  }
}

interface MemoryBlock {
  trigger_pattern: string;
  symptom: string;
  prescription: string;
  ignored_count?: number;
}

interface PromptMessage {
  source?: { kind?: string };
  content?: ReadonlyArray<DshContentBlock>;
}

function sanitize(value: string): string {
  return value.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function renderMemory(
  blocks: ReadonlyArray<MemoryBlock>,
  preamble: string,
  maxChars: number,
): string {
  if (blocks.length === 0) return '';
  const body = blocks
    .map(
      (b, i) =>
        `${i + 1}. ${(b.ignored_count ?? 0) >= 2 ? `[CRITICAL · ignored ${b.ignored_count}×] ` : ''}` +
        `[${t.trigger}: ${sanitize(b.trigger_pattern)}] ${t.avoid}: ${sanitize(b.symptom)} -> ${t.do}: ${sanitize(b.prescription)}`,
    )
    .join('\n');
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
  return ['<immune_memory>', preamble, clipped, '</immune_memory>'].join('\n');
}

function traceFor(event: NormalisedToolEvent, outcome: string): string {
  let input: string;
  try {
    input = JSON.stringify(event.toolInput ?? {});
  } catch {
    input = String(event.toolInput);
  }
  return `tool=${event.toolName} input=${input} ${outcome}`;
}

let budgetOverrideMs: number | null = null;
function drainBudgetMs(): number {
  return budgetOverrideMs ?? resolveDrainBudgetMs();
}

export function readWebTabState(registry: unknown): string {
  const clientPath = (registry as { clientPath?: (id: string) => string | undefined } | undefined)
    ?.clientPath;
  if (typeof clientPath !== 'function') return 'not loaded';
  try {
    return clientPath.call(registry, PLUGIN_NAME) === undefined ? 'not registered' : 'registered';
  } catch {
    return 'error';
  }
}

function describeWebTab(ctx: DshContext): string {
  const get = ctx.get;
  if (typeof get !== 'function') return 'unknown';
  try {
    return readWebTabState(get.call(ctx, 'clientModules'));
  } catch {
    return 'unknown';
  }
}

function reportWebTabWhenComposed(ctx: DshContext, log: ReturnType<typeof makeLogger>): void {
  const injectFn = ctx.inject;
  if (typeof injectFn !== 'function') return;
  try {
    injectFn.call(ctx, ['clientModules'], (child: unknown) => {
      const registry = (child as { clientModules?: unknown } | undefined)?.clientModules;
      let logged = false;
      const report = (): void => {
        if (logged) return;
        logged = true;
        log.info(`[immune] web tab: ${readWebTabState(registry)}`);
      };
      const onGraphChanged = (registry as { onGraphChanged?: (cb: () => void) => unknown } | undefined)
        ?.onGraphChanged;
      if (typeof onGraphChanged === 'function') {
        try {
          onGraphChanged.call(registry, report);
        } catch {
          // ignore
        }
      }
      report();
    });
  } catch {
    // ignore
  }
}

function insertAt(
  decisionMessages: ReadonlyArray<PromptMessage>,
  claimed: ReadonlyArray<PromptMessage>,
): number {
  const lastClaimedIndex = decisionMessages.findLastIndex((message) => claimed.includes(message));
  return lastClaimedIndex < 0 ? decisionMessages.length : lastClaimedIndex + 1;
}

export function apply(ctx: DshContext): void {
  try {
    startPlugin(ctx);
  } catch (error) {
    makeLogger(ctx).warn(
      `[immune] disabled for this session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function startPlugin(ctx: DshContext): void {
  const log = makeLogger(ctx);
  const store = new ImmuneStore({ dbPath: resolveStorePath() });
  try {
    startPluginWithStore(ctx, store, log);
  } catch (error) {
    try {
      store.close();
    } catch {
      // ignore close failure on abort
    }
    throw error;
  }
}

function startPluginWithStore(
  ctx: DshContext,
  store: ImmuneStore,
  log: ReturnType<typeof makeLogger>,
): void {
  const runtime = new ImmuneRuntime(store);
  log.info(`[immune] storage: ${store.dbPath}`);

  registerImmuneUiRoute(ctx, store, () => drainBudgetMs());
  reportWebTabWhenComposed(ctx, log);

  ctx.on('session/event', (session, event: DshSessionEvent) => {
    if (event.type !== 'user/message') return;
    const message = event.data as PromptMessage;
    if (message.source?.kind !== 'user') return;
    const text = textOf(message.content ?? []);
    rememberPrompt(session.header.id, text);
    if (isSubstantiveHint(text)) store.attachHumanHint(session.header.id, text);
  });

  ctx.on(DSH_EVENTS.sessionStart, ({ agent, source }) => {
    const workspace = process.cwd();
    try {
      hydrateTeamRules(store, workspace);
    } catch {
      // Best-effort team rule hydration; never break session-start.
    }
    const top = runtime.sessionStart({ sessionId: agent.id, source, workspace, prewarm: true });
    const block = renderMemory(top, t.promptPreamble, 1400);
    if (block) agent.inject(createPluginMessage(block));
    log.info(`[immune] session-start (${source}): ${store.listAll(false).length} active antibody/queries`);
  });

  ctx.on(DSH_EVENTS.preStep, async ({ agent, messages, turn, step }, next): Promise<DshPreStepDecision> => {
    const decision = await next();
    if (decision.kind === 'reject' || step !== 1 || lastInjectedTurn.get(agent.id) === turn) {
      return decision;
    }
    const prompt = lastHumanPrompt(decision.messages) || lastPrompts.get(agent.id) || '';
    if (!prompt) return decision;

    const hits = runtime.userPrompt({
      sessionId: agent.id,
      prompt,
      workspace: process.cwd(),
      suppressRepeats: true,
    });
    const block = renderMemory(hits, t.promptPreamble, 1400);
    const streak = store.topProbeStreak(agent.id, 3);
    const thrash = streak
      ? `探针提示 / probe note: 上一回合对 ${streak.signature} 连续探测了 ${streak.count} 次 — 一条精确命令（grep -n 关键词、单次 Read）通常一步到位。`
      : null;
    const stuck = store.topStuck(agent.id, 2);
    const stuckNote = stuck ? stuckHypothesisText(stuck.signature) : null;
    if (stuck) store.markHypothesized(agent.id, stuck.signature);

    const advisories = [thrash, stuckNote].filter(Boolean) as string[];
    const advisoryBlock = advisories.length > 0 ? advisories.join('\n') : null;
    const combined =
      advisoryBlock && block
        ? `${block}\n${advisoryBlock}`
        : advisoryBlock
          ? `<immune_memory>\n${advisoryBlock}\n</immune_memory>`
          : block;
    if (!combined) return decision;

    lastInjectedTurn.set(agent.id, turn);
    const desired: DshUserMessage = createPluginMessage(combined);
    return {
      kind: 'enter',
      messages: decision.messages.toSpliced(insertAt(decision.messages, messages), 0, desired),
    };
  });

  ctx.on(DSH_EVENTS.preToolExecute, async (exec, next): Promise<DshPreToolDecision> => {
    const guard = runtime.evaluateLiveGuard({
      sessionId: exec?.agent?.id ?? '',
      toolName: exec?.name ?? 'Bash',
      toolInput: exec?.arguments ?? {},
      workspace: process.cwd(),
    });
    if (guard) {
      if (guard.shouldDeny) {
        return { kind: 'deny', reason: guard.banner };
      }
      if (guard.shouldAsk) {
        return { kind: 'ask', reason: guard.banner };
      }
    }
    return next();
  });

  ctx.on(DSH_EVENTS.postToolExecute, async (exec, result, next): Promise<DshPostToolDecision> => {
    const downstream = await next();
    const event = normaliseToolEvent(exec, result);
    if (!event) return downstream;

    const outcome = event.ok ? `result=${event.resultText}` : `error=${event.errorText}`;
    runtime.postToolUse({
      sessionId: event.sessionId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      failed: !event.ok,
      sandboxDenied: event.sandboxDenied,
      trace: traceFor(event, outcome),
      workspace: process.cwd(),
      selfMarkers: selfMarkers(),
    });
    return downstream;
  });

  ctx.on(DSH_EVENTS.turnStopping, async (ev?: { agent?: { id?: string } }) => {
    const workspace = process.cwd();
    const sid = ev?.agent?.id ?? '';
    if (sid) {
      try {
        runtime.settleTurn(sid, workspace);
      } catch {
        // Best-effort turn receipt settlement.
      }
    }
    await runtime.drain({
      budgetMs: drainBudgetMs(),
      selfMarkers: selfMarkers(),
      runPostDrainHooks: true,
    });
    try {
      maybeSyncTeamRulesAfterDrain(store, workspace);
    } catch {
      // Best-effort team rule sync.
    }
  });

  ctx.effect(
    () => () => {
      store.close();
    },
    `${PLUGIN_NAME}: close antibody store`,
  );

  registerCommands(ctx, store);
}

function registerCommands(ctx: DshContext, store: ImmuneStore): void {
  ctx.commands.register({
    name: 'immune',
    description: 'List the pitfall antibodies this project has learned',
    input: { hint: '--all · --budget [ms] · --hygiene · --triage' },
    handler: ({ rawInput }): DshCommandResult => {
      const args = rawInput.trim().split(/\s+/).filter(Boolean);

      if (args.includes('--hygiene')) {
        const report = store.repairHygiene({ dryRun: !args.includes('--apply') });
        return {
          kind: 'success',
          text:
            `hygiene (${report.dryRun ? 'dry-run' : 'applied'}): scanned ${report.scanned} · ` +
            `active ${report.activeBefore} -> ${report.activeAfter} · ` +
            `quarantined ${report.quarantined} · scoped ${report.scoped} · restored ${report.restored}`,
        };
      }

      if (args.includes('--triage')) {
        const tri = store.triageSummary();
        return {
          kind: 'success',
          text:
            `red-3 triage: ${tri.totalEvents} event(s) · quarantined ${tri.quarantinedCount} · probation ${tri.probationCount}\n` +
            Object.entries(tri.byBucket)
              .map(([k, v]) => `  ${k}: ${v}`)
              .join('\n'),
        };
      }

      if (args.includes('--budget')) {
        const raw = args[args.indexOf('--budget') + 1];
        if (raw === 'auto' || raw === 'reset' || raw === 'env') {
          budgetOverrideMs = null;
          return { kind: 'success', text: `distill budget reset to ${drainBudgetMs()} ms (env IMMUNE_DISTILL_BUDGET_MS / default)` };
        }
        const value = Number(raw ?? '');
        if (raw === undefined || !Number.isFinite(value) || value <= 0) {
          const source = budgetOverrideMs === null ? 'env IMMUNE_DISTILL_BUDGET_MS / default' : 'session override';
          return {
            kind: 'success',
            text: `distill budget: ${drainBudgetMs()} ms (${source})\nset with: /immune --budget <ms>  ·  clamped to 1000–60000`,
          };
        }
        budgetOverrideMs = clampBudgetMs(value);
        return {
          kind: 'success',
          text: `distill budget set to ${budgetOverrideMs} ms for this session (in-memory; a restart falls back to the env var)`,
        };
      }

      const rows = store.listAll(args.includes('--all'));
      const s = store.stats();
      const size = s.dbBytes == null ? '?' : `${Math.max(1, Math.round(s.dbBytes / 1024))} KiB`;
      const footer =
        `\n\n— distill budget ${drainBudgetMs()} ms · queued ${store.pendingJobCount()} · blocked ${s.suppressedRepeats}` +
        ` · quarantined ${s.quarantined} · ${size} · web tab ${describeWebTab(ctx)} · db ${store.dbPath}`;
      if (rows.length === 0) return { kind: 'success', text: t.noAntibodies + footer };
      const text = rows
        .map((a) => {
          const repair =
            Array.isArray(a.repair_path) && a.repair_path.length > 0
              ? `\n  ${t.repairedBy}${a.repair_path.join(' | ')}`
              : '';
          return `#${a.id} [hits ${a.hit_count}/fails ${a.fail_count}] ${a.status} (${a.quality_grade ?? 'advice'} · ${a.rubric_score ?? 70}/100)\n  ${t.trigger}: ${a.trigger_pattern}\n  ${t.avoid}: ${a.symptom}\n  ${t.do}: ${a.prescription}${repair}`;
        })
        .join('\n\n');
      return { kind: 'success', text: text + footer };
    },
  });

  ctx.commands.register({
    name: 'immune-forget',
    description:
      'Remove antibodies: <id>, --last (undo the previous turn), --prune (retire never-hit, >14d), --purge (delete them)',
    input: { hint: '<id> | --last | --prune | --purge' },
    handler: ({ rawInput }): DshCommandResult => {
      const args = rawInput.trim().split(/\s+/).filter(Boolean);
      if (args.includes('--last')) {
        const id = store.forgetLast();
        return { kind: 'success', text: id === null ? t.notFound : `${t.forgot} #${id}` };
      }
      if (args.includes('--prune') || args.includes('--purge')) {
        const purge = args.includes('--purge');
        const window = 14 * 24 * 60 * 60 * 1000;
        const changed = purge ? store.pruneZombies(window) : store.retireZombies(window);
        const label = purge ? t.purged : t.pruned;
        return {
          kind: 'success',
          text:
            changed.length === 0
              ? t.noZombies
              : `${label} ${changed.length}: ${changed.map((n) => `#${n}`).join(' ')}`,
        };
      }
      const id = Number(args[0]);
      if (!Number.isInteger(id) || id <= 0) {
        return { kind: 'error', text: `${t.notFound} — usage: <id> | --last | --prune | --purge` };
      }
      return {
        kind: 'success',
        text: store.remove(id) ? `${t.forgot} #${id}` : `${t.notFound} #${id}`,
      };
    },
  });

  ctx.commands.register({
    name: 'immune-learn',
    description: 'Teach a rule directly: <trigger> | [symptom] | <prescription>',
    input: { hint: '<trigger> | [symptom] | <prescription>' },
    handler: ({ rawInput }): DshCommandResult => {
      const text = rawInput.trim();
      const hasPipes = text.includes('|');
      const segments = hasPipes
        ? text.split('|').map((part) => part.trim())
        : (() => {
            const tokens = text.split(/\s+/);
            const first = tokens[0] ?? '';
            const rest = tokens.slice(1).join(' ');
            return rest ? [first, rest] : [first];
          })();
      const trigger = segments[0] ?? '';
      const prescription = segments[segments.length - 1] ?? '';
      const symptom = segments.length >= 3 ? segments.slice(1, -1).join(' | ') : '';
      if (!trigger || !prescription || segments.length > 3) {
        return {
          kind: 'error',
          text:
            `${t.notFound} — expected: <trigger> | [symptom] | <prescription>\n` +
            `example: pnpm-lock.yaml 这个仓库 | npm 装依赖报错 | 用 pnpm 不要用 npm`,
        };
      }
      const id = store.insert({
        trigger_pattern: trigger,
        symptom: symptom || '(manual rule)',
        prescription,
        tool_name: null,
        prescription_source: 'human',
      });
      return { kind: 'success', text: id === null ? t.notFound : `${t.learned} #${id}` };
    },
  });

  ctx.commands.register({
    name: 'immune-export',
    description: 'Export proven antibodies as a project-pitfalls skill',
    handler: (): DshCommandResult => {
      const rows = store.exportable(3);
      if (rows.length === 0) return { kind: 'success', text: t.noExport };
      const violations = shareSanityCheck(rows);
      if (violations.length > 0) {
        return { kind: 'error', text: formatShareViolations(violations) };
      }
      const md = renderSkillMarkdown(rows, { minHits: 3 });
      return { kind: 'success', text: `${t.exported} ${rows.length}\n\n${md}` };
    },
  });
}

function lastHumanPrompt(messages: ReadonlyArray<PromptMessage>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.source?.kind !== 'user') continue;
    const content: ReadonlyArray<DshContentBlock> | undefined = message.content;
    if (!content) continue;
    const text = content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}
