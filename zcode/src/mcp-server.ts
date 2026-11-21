/**
 * MCP server — the library as tools, reachable from any MCP-capable agent.
 *
 * The strongest lesson from surveying prior art (pro-workflow, 2.9k★): the
 * memory is only worth as much as the number of agents that can reach it.
 * "MCP works across every agent with the same setup" — one stdio server makes
 * the antibody library usable from Codex, Cursor, Cline and the rest, not just
 * the two hosts this plugin binds directly.
 *
 * Zero dependencies, JSON-RPC 2.0 over stdio, line-delimited. Implementations:
 *   initialize            → protocol handshake
 *   tools/list            → the tools below (library CRUD plus the read-only
 *                           audit preview and seed-pack listing)
 *   tools/call            → dispatch, text content back
 *   ping                  → liveness
 * Anything else answers method-not-found, and notifications are ignored.
 *
 * Every tool is read-heavy by design; the two mutations (learn / forget) mirror
 * the CLI exactly, including zombie semantics.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ImmuneStore } from '../../core/store/index.js';
import { renderSkillMarkdown } from '../../core/export.js';
import { ciCheck, formatShareViolations, parseManagedBlock, shareSanityCheck } from '../../core/share-guard.js';
import { auditHistory, renderAuditReport } from '../../core/audit.js';
import { BUILTIN_PACKS } from '../../core/packs.js';
import { REWRITE_PROMPT } from '../../core/rewrite.js';
import { HOST_REWRITE_BATCH, applyHostRewrites, hostRewriteCandidates } from '../../core/host-rewrite.js';
import { ingestDiskCorpus } from '../../core/disk-ingest.js';
import { scanMagpieTelemetry } from '../../core/audit/magpie.js';
import { explainRecall } from '../../core/explain.js';
import { evaluatePreFlightGuard } from '../../core/guard.js';
import { compileVaccineLockfile, detectWorkspaceDNA, verifyVaccineLockfile } from '../../core/vaccine.js';
import { diagnoseAgentArchetype } from '../../core/diagnose.js';
import { runPitfallAutopsy } from '../../core/autopsy.js';
import { federateSwarmRules, type SwarmRuleSource } from '../../core/federate.js';
import { parseTeamRulesJsonl } from '../../core/team-sync.js';
import { redactOutbound } from '../../core/redact.js';
import { computeImmunityScore } from '../../core/wrapped.js';
import { packageVersion } from '../../core/version.js';
import { runDoctor } from './doctor.js';

const SERVER_INFO = { name: 'dsh-immune-system', version: packageVersion() };

const TOOLS = [
  {
    name: 'immune_list',
    description:
      'List pitfall antibodies this project has learned. Each has a trigger (when it applies), a symptom (the wrong instinct) and a prescription (the verified fix).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional full-text filter over trigger/symptom/prescription.' },
        includeRetired: { type: 'boolean', description: 'Include retired rules. Default false.' },
        limit: { type: 'number', description: 'Max rows. Default 50.' },
      },
    },
  },
  {
    name: 'immune_stats',
    description: 'Counts: active/retired rules, total injections, queued distillation jobs, database path.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_export',
    description:
      'Render the proven rules (hits >= threshold) as a SKILL.md document and return its text. Save the text to share the library with teammates or commit it.',
    inputSchema: {
      type: 'object',
      properties: {
        minHits: { type: 'number', description: 'Minimum hit count. Default 3.' },
        title: { type: 'string', description: 'Skill title. Default "project-pitfalls".' },
      },
    },
  },
  {
    name: 'immune_learn',
    description:
      'Teach a rule directly, without waiting for a failed-then-fixed episode. Use for conventions the agent keeps getting wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        trigger: { type: 'string', description: 'When the rule applies: file names, commands, error keywords. Space separated.' },
        symptom: { type: 'string', description: 'The wrong instinct, one line.' },
        prescription: { type: 'string', description: 'The verified correct move, one line.' },
      },
      required: ['trigger', 'prescription'],
    },
  },
  {
    name: 'immune_forget',
    description:
      'Remove a rule by id (from immune_list). Physical delete; prefer immune_retire when unsure.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Antibody id.' } },
      required: ['id'],
    },
  },
  {
    name: 'immune_retire',
    description: 'Stop injecting a rule without deleting it. Reversible with immune_restore.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'immune_restore',
    description: 'Put a retired rule back into rotation.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'immune_audit',
    description:
      'Health check over this machine\'s session history (ZCode db, Codex rollouts, Claude Code transcripts, Antigravity transcripts): replays the failed-then-fixed pairing and reports per-tool failures, repeat offenders and the avoidable token estimate. READ-ONLY preview — run `immune audit` in a terminal to actually distil (an MCP-only host has no turn-end drain, so enqueued jobs would sit stuck).',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look back this many days. Default 30.' },
      },
    },
  },
  {
    name: 'immune_seed_packs',
    description:
      'List the 9 builtin seed packs (git-safety, node-ts, python-uv, rust-cargo, go-mod, docker, modern-web, dsh-ecosystem, patrol-triage) and any on-demand ingested `skill:*` packs with per-pack seeded counts. Install with `immune seed <id>` or `immune ingest-skill <path>` in a terminal; this tool never writes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_detours',
    description:
      'List recent convergent detours: sessions that probed one target 4+ times read-only before the successful command landed. Telemetry / review candidates — the engine never mints a shortcut rule from these (that stays on the LLM rewrite path). READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Rows to show. Default 20.' } },
    },
  },
  {
    name: 'immune_rewrite_candidates',
    description:
      'Read-only: echo-grade rules waiting to be rewritten into advice (most-delivered first). You are the model — rewrite each currentPrescription into ONE imperative sentence (see the returned prompt) and call immune_rewrite_apply with the results. Decision #28: a model writes advice; here that model is YOU.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Candidates to show. Default 3, max 10.' } },
    },
  },
  {
    name: 'immune_rewrite_apply',
    description:
      'Apply host-delegated rewrites: [{ id, prescription }] from your immune_rewrite_candidates pass. Guards: one pass per 12h, at most 3 rules, the rule must still be echo-grade, and the replacement wording must be advice (a command dump is refused). Provenance records host_llm.',
    inputSchema: {
      type: 'object',
      properties: {
        rewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'number' }, prescription: { type: 'string' } },
            required: ['id', 'prescription'],
          },
        },
      },
      required: ['rewrites'],
    },
  },
  {
    name: 'immune_hygiene',
    description:
      'Run or preview library hygiene repair: quarantines echo-grade garbage, abstracts machine-specific paths into portable templates, and stamps project_scope isolation boundaries. Defaults to dryRun=true.',
    inputSchema: {
      type: 'object',
      properties: { dryRun: { type: 'boolean', description: 'Preview without modifying DB. Default true.' } },
    },
  },
  {
    name: 'immune_triage',
    description:
      'Inspect Red-3 Triage failure buckets (flake_or_transient, wrong_scope_leak, ignored_by_agent, stale_or_bad_advice, coverage_blindspot) recorded after rule deliveries. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Recent triage events to include. Default 20.' } },
    },
  },
  {
    name: 'immune_receipts',
    description:
      'Verify and summarize the tamper-evident SHA-256 delivery/outcome receipt chain across sessions and models. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max recent receipts to audit. Default 500.' } },
    },
  },
  {
    name: 'immune_workspaces',
    description:
      'List discovered local workspace profiles (project_scope, repo_root, detected tech stacks, rule counts). READ-ONLY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_ingest_disk',
    description:
      'Discover repositories, skills, and engineering docs under explicit root directories (e.g. ["D:\\\\"]) and ingest high-rubric scoped/universal pitfalls. Defaults to dryRun=true.',
    inputSchema: {
      type: 'object',
      properties: {
        roots: { type: 'array', items: { type: 'string' }, description: 'Directories to scan.' },
        dryRun: { type: 'boolean', description: 'Preview without mutating DB. Default true.' },
        maxProjects: { type: 'number', description: 'Cap discovered projects. Default 60.' },
      },
      required: ['roots'],
    },
  },
  {
    name: 'immune_models',
    description:
      'Analyze per-model antibody survival rates, repeated-ignore adaptive escalation rules, and local Magpie gateway routing telemetry. READ-ONLY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_doctor',
    description:
      'Run installation health checks: Node engine, SQLite+FTS5 trigram/CJK recall probe, connected hook paths, rule hygiene, and distillation budget. READ-ONLY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_ci_check',
    description:
      'Scan a git diff patch against the repository\'s committed AGENTS.md / CLAUDE.md pitfall rules before opening a PR. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Unified git diff text to scan.' },
        doc: { type: 'string', description: 'Optional path to AGENTS.md or CLAUDE.md.' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'immune_explain',
    description:
      'Explain why a prompt or error trace matches specific antibodies (shows bilingual concept expansion, BM25 rank, lexical/path/rubric multipliers, and exact <immune_memory> preview). READ-ONLY: never inflates hit_count.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Error trace, command, or natural-language question.' },
        toolName: { type: 'string', description: 'Optional tool name tie-breaker (e.g. Bash, Edit).' },
        limit: { type: 'number', description: 'Max candidates to return (1-10, default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'immune_guard',
    description:
      'Pre-Flight Blast-Radius Guard (v3): evaluate a proposed Bash/Edit/Write command against destructive signatures, workspace lockfile drift, secret literals, and learned antibodies. Returns 0-100 score, decision (allow|warn|rewrite|block), and safe command rewrite. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'string', description: 'Proposed shell command or edit payload to check before execution.' },
        toolName: { type: 'string', description: 'Tool name (default "Bash").' },
        strict: { type: 'boolean', description: 'Promote warnings/rewrites to block. Default false.' },
        workspace: { type: 'string', description: 'Optional workspace directory for lockfile drift detection (defaults to cwd).' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'immune_vaccinate',
    description:
      'Scan repository Workspace DNA (package manager, stacks, recommended packs), verify an existing .immune/vaccine.lock.json, or preview synthesized zero-day antibodies. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace directory to scan (defaults to cwd).' },
        checkLockfile: { type: 'boolean', description: 'Verify existing .immune/vaccine.lock.json SHA-256 integrity if present.' },
      },
    },
  },
  {
    name: 'immune_diagnose',
    description:
      'Diagnose agent failure persona, 5-domain immunity radar, recommended booster packs, and copy-paste system-prompt vaccine from active rules. READ-ONLY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_autopsy',
    description:
      'Run a forensic post-mortem autopsy: prevented debug loops, rescued retry tokens, estimated API dollar savings, root-cause buckets, and Fragile Scars watchlist. READ-ONLY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'immune_federate',
    description:
      'Cluster semantically equivalent share-safe antibodies across local SQLite and optional .immune/rules.jsonl files, computing Swarm Consensus Scores (0-100) and Universal Swarm Laws. READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Optional paths to .immune/rules.jsonl files.' },
        minConsensusScore: { type: 'number', description: 'Filter clusters below this score (0-100, default 0).' },
      },
    },
  },
  {
    name: 'immune_guard_log',
    description:
      'Inspect recent live Pre-Flight Blast-Radius Guard interceptions (redacted command previews, decisions, policy IDs, blast scores, and safe rewrites). READ-ONLY.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max recent guard events to return (1-200, default 25).' },
      },
    },
  },
];

export const RESOURCES = [
  {
    uri: 'immune://library/active',
    name: 'Active Pitfall Antibodies',
    description: 'Redacted JSON snapshot of active pitfall antibodies in the current project store.',
    mimeType: 'application/json',
  },
  {
    uri: 'immune://stats/summary',
    name: 'Immunity Telemetry Summary',
    description: 'Live counts, SHA-256 receipt chain status, Red-3 triage summary, and Pre-Flight Guard totals.',
    mimeType: 'application/json',
  },
  {
    uri: 'immune://workspace/dna',
    name: 'Workspace DNA & Vaccine Lockfile',
    description: 'Detected stack markers, package manager, recommended packs, and .immune/vaccine.lock.json verification.',
    mimeType: 'application/json',
  },
  {
    uri: 'immune://guard/events',
    name: 'Pre-Flight Guard Audit Ledger',
    description: 'Recent live Pre-Flight Guard interceptions (redacted) and policy breakdown.',
    mimeType: 'application/json',
  },
  {
    uri: 'immune://insights/report',
    name: 'Diagnosis & Forensic Autopsy Report',
    description: 'Real-telemetry Immunity Score, Agent Pitfall Archetype, 5-domain radar, and Forensic Autopsy.',
    mimeType: 'application/json',
  },
] as const;

export const PROMPTS = [
  {
    name: 'immune_review_pitfalls',
    description: 'Inject relevant workspace pitfall antibodies and a pre-flight safety checklist before editing or running risky commands.',
    arguments: [
      { name: 'query', description: 'Optional task, file path, or error keyword to filter relevant antibodies.', required: false },
      { name: 'limit', description: 'Maximum number of antibodies to include (default 8).', required: false },
    ],
  },
  {
    name: 'immune_triage_failure',
    description: 'Build a structured Red-3 root-cause triage prompt for a failing command or stack trace, grounded in existing antibodies.',
    arguments: [
      { name: 'error', description: 'The error message or failing command trace.', required: true },
      { name: 'tool', description: 'Optional tool name (Bash, Edit, Write).', required: false },
    ],
  },
  {
    name: 'immune_rewrite_echoes',
    description: 'Prepare a host-delegated rewrite prompt for up to 3 echo-grade antibodies so the host model can upgrade them into clean advice.',
    arguments: [],
  },
] as const;

function positiveInt(raw: unknown, fallback: number, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.min(max, Math.trunc(raw))
    : fallback;
}

/** Dispatch one tools/call. Kept pure-ish so tests can call it without stdio. */
export function callTool(store: ImmuneStore, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'immune_list': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const includeRetired = args.includeRetired === true;
      const limit = positiveInt(args.limit, 50, 200);

      let rows = query
        ? store.peek(query, limit)
        : store.listAll(includeRetired).slice(0, limit);
      if (query && includeRetired) {
        // peek reads active only through findMatches; merge retired matches so
        // the filter stays honest without duplicating the query machinery.
        const extra = store
          .listAll(true)
          .filter((a) => a.status === 'retired')
          .filter((a) => `${a.trigger_pattern} ${a.symptom} ${a.prescription}`.toLowerCase().includes(query.toLowerCase()))
          .slice(0, limit);
        const have = new Set(rows.map((r) => r.id));
        rows = [...rows, ...extra.filter((r) => !have.has(r.id))].slice(0, limit);
      }

      if (rows.length === 0) return 'No antibodies match.';
      return rows
        .map(
          (a) =>
            `#${a.id} [${a.status}] hits ${a.hit_count}/fails ${a.fail_count}\n` +
            `  trigger: ${a.trigger_pattern}\n  avoid: ${a.symptom}\n  do: ${a.prescription}` +
            (Array.isArray(a.repair_path) && a.repair_path.length > 0
              ? `\n  repaired by: ${a.repair_path.join(' | ')}`
              : ''),
        )
        .join('\n\n');
    }

    case 'immune_stats': {
      const all = store.listAll(true) as Array<{ status: string; hit_count: number }>;
      const s = store.stats();
      const sharedCount = store.sharedAntibodies(1000).length;
      return (
        `active: ${s.active}\n` +
        `retired: ${s.retired}\n` +
        `quarantined: ${s.quarantined}\n` +
        `shared: ${sharedCount}\n` +
        `injections: ${all.reduce((sum: number, a: { hit_count: number }) => sum + a.hit_count, 0)}\n` +
        `repeats suppressed: ${s.suppressedRepeats}\n` +
        `queued distill jobs: ${store.pendingJobCount()}\n` +
        `database: ${store.dbPath}`
      );
    }

    case 'immune_export': {
      const minHits = positiveInt(args.minHits, 3, 10_000);
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'project-pitfalls';
      const rows = store.exportable(minHits);
      if (rows.length === 0) {
        return `No rule has reached ${minHits} hits yet; nothing worth sharing.`;
      }
      const violations = shareSanityCheck(rows);
      if (violations.length > 0) {
        return formatShareViolations(violations);
      }
      const md = renderSkillMarkdown(rows, { minHits, title });
      return `Exported ${rows.length} rules as SKILL.md:\n\n${md}`;
    }

    case 'immune_learn': {
      const trigger = typeof args.trigger === 'string' ? args.trigger : '';
      const symptom = typeof args.symptom === 'string' ? args.symptom : '';
      const prescription = typeof args.prescription === 'string' ? args.prescription : '';
      if (!trigger.trim() || !prescription.trim()) {
        return 'error: trigger and prescription are required (symptom optional but recommended).';
      }
      const id = store.insert({
        trigger_pattern: trigger,
        symptom: symptom || '(manual rule)',
        prescription,
        tool_name: null,
        prescription_source: 'human',
      });
      return id === null ? 'error: could not store the rule (duplicate prescription?).' : `learned as #${id}.`;
    }

    case 'immune_forget': {
      const id = typeof args.id === 'number' ? args.id : Number.NaN;
      if (!Number.isInteger(id) || id <= 0) return 'error: id must be a positive integer.';
      return store.remove(id) ? `deleted #${id}.` : `no antibody #${id}.`;
    }

    case 'immune_retire': {
      const id = typeof args.id === 'number' ? args.id : Number.NaN;
      if (!Number.isInteger(id) || id <= 0) return 'error: id must be a positive integer.';
      return store.setStatus(id, 'retired') ? `retired #${id}.` : `no antibody #${id}.`;
    }

    case 'immune_restore': {
      const id = typeof args.id === 'number' ? args.id : Number.NaN;
      if (!Number.isInteger(id) || id <= 0) return 'error: id must be a positive integer.';
      return store.setStatus(id, 'active') ? `restored #${id}.` : `no antibody #${id}.`;
    }

    case 'immune_audit': {
      // Always a dry-run: an MCP-only host has no Stop hook to drain enqueued
      // jobs, so the applying pass belongs to the terminal CLI.
      const days = typeof args.days === 'number' && Number.isFinite(args.days) && args.days > 0
        ? Math.trunc(args.days)
        : 30;
      try {
        const report = auditHistory(store, { days, dryRun: true });
        return renderAuditReport(report, days, true);
      } catch (error) {
        return `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case 'immune_seed_packs': {
      const counts = store.seededPackCounts();
      const lines = BUILTIN_PACKS.map((pack) => {
        const installed = counts.get(pack.id) ?? 0;
        return `${pack.id.padEnd(12)} ${String(installed).padStart(2)}/${pack.rules.length} seeded · ${pack.label} — ${pack.description}`;
      });
      const skillLines = [...counts.entries()]
        .filter(([id]) => id.startsWith('skill:'))
        .map(([id, n]) => `${id.padEnd(20)} ${n} rule(s) indexed on demand`);
      const extra = skillLines.length > 0 ? `\n\nIngested skill packs:\n${skillLines.join('\n')}` : '';
      return `Builtin seed packs (install with \`immune seed <id>\` in a terminal; this tool never writes):\n${lines.join('\n')}${extra}`;
    }

    case 'immune_detours': {
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
        ? Math.min(100, Math.trunc(args.limit))
        : 20;
      const rows = store.recentDetours(limit);
      if (rows.length === 0) {
        return 'no convergent detours recorded (4+ same-target probes before the fix). Telemetry only — `immune rewrite` is the minting path.';
      }
      const lines = rows.map((row) => {
        const when = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ');
        return `${when}  ${String(row.probes).padStart(2)} probes  ${row.signature}`;
      });
      return `convergent detours (telemetry — \`immune rewrite\` is the minting path):\n${lines.join('\n')}`;
    }

    case 'immune_rewrite_candidates': {
      // You are the model: hand the host the same contract the endpoint-LLM
      // rewrite path uses (Decision #28), with the candidates attached.
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
        ? Math.min(10, Math.trunc(args.limit))
        : HOST_REWRITE_BATCH;
      const candidates = hostRewriteCandidates(store, limit);
      if (candidates.length === 0) {
        return 'no echo-grade rules are waiting — the library is clean.';
      }
      return [
        REWRITE_PROMPT,
        '',
        'Rewrite EACH of the following, then call immune_rewrite_apply with',
        '[{ "id": <id>, "prescription": "<your one imperative sentence>" }]:',
        JSON.stringify(candidates, null, 1),
      ].join('\n');
    }

    case 'immune_rewrite_apply': {
      const raw = Array.isArray(args.rewrites) ? args.rewrites : [];
      const rewrites = raw
        .filter(
          (item): item is { id: number; prescription: string } =>
            typeof item === 'object' && item !== null &&
            typeof (item as Record<string, unknown>).id === 'number' &&
            typeof (item as Record<string, unknown>).prescription === 'string',
        )
        .map((item) => ({ id: item.id as number, prescription: item.prescription as string }));
      if (rewrites.length === 0) {
        return 'error: rewrites must be [{ id, prescription }] with both fields present.';
      }
      const outcome = applyHostRewrites(store, rewrites);
      const lines = outcome.results.map((result) => {
        if (result.status === 'rewritten') {
          return `#${result.id} rewritten: "${result.from.slice(0, 60)}" -> "${result.to.slice(0, 60)}"`;
        }
        return `#${result.id} ${result.status}: ${result.detail}`;
      });
      return `applied ${outcome.appliedCount}/${rewrites.length}` +
        (outcome.cooldownUntil ? ` · next delegated pass after ${new Date(outcome.cooldownUntil).toISOString()}` : '') +
        `\n${lines.join('\n')}`;
    }

    case 'immune_hygiene': {
      const dryRun = args.dryRun !== false;
      const rep = store.repairHygiene({ dryRun });
      return JSON.stringify(rep, null, 2);
    }

    case 'immune_triage': {
      const limit = positiveInt(args.limit, 20, 200);
      return JSON.stringify(store.triageSummary(limit), null, 2);
    }

    case 'immune_receipts': {
      const limit = positiveInt(args.limit, 500, 2000);
      return JSON.stringify(store.receiptSummary(limit), null, 2);
    }

    case 'immune_workspaces': {
      return JSON.stringify(store.listWorkspaceProfiles(), null, 2);
    }

    case 'immune_ingest_disk': {
      const roots = Array.isArray(args.roots)
        ? args.roots.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        : [];
      if (roots.length === 0) return 'error: roots must be a non-empty array of directory paths.';
      const dryRun = args.dryRun !== false;
      const maxProjects = positiveInt(args.maxProjects, 60, 200);
      const report = ingestDiskCorpus(store, { roots, dryRun, maxProjects });
      return JSON.stringify(report, null, 2);
    }

    case 'immune_models': {
      const magpie = scanMagpieTelemetry();
      const intel = store.modelImmunity(magpie);
      return JSON.stringify(
        {
          ...intel,
          magpieGateway: magpie.present
            ? {
                routingRequests: magpie.routingRequests,
                usageRequests: magpie.usageRequests,
                cacheHitRatePct: magpie.cacheHitRatePct,
                retryRecovered: magpie.retryRecovered,
                distinctModels: magpie.distinctModels,
                byModel: magpie.byModel.slice(0, 8),
                topFailures: magpie.topFailures,
              }
            : null,
        },
        null,
        2,
      );
    }

    case 'immune_doctor': {
      const checks = runDoctor(store);
      const failed = checks.filter((c) => !c.ok).length;
      return JSON.stringify({ ok: failed === 0, passed: checks.length - failed, total: checks.length, checks }, null, 2);
    }

    case 'immune_ci_check': {
      const diff = typeof args.diff === 'string' ? args.diff : '';
      const explicitDoc = typeof args.doc === 'string' && args.doc.trim() ? resolve(args.doc.trim()) : null;
      const doc =
        explicitDoc ??
        (existsSync(resolve(process.cwd(), 'AGENTS.md'))
          ? resolve(process.cwd(), 'AGENTS.md')
          : resolve(process.cwd(), 'CLAUDE.md'));
      const rules = parseManagedBlock(doc);
      return JSON.stringify(ciCheck(diff, rules), null, 2);
    }

    case 'immune_explain': {
      const query = typeof args.query === 'string' ? args.query : '';
      const toolName = typeof args.toolName === 'string' && args.toolName.trim() ? args.toolName.trim() : undefined;
      const limit = positiveInt(args.limit, 5, 10);
      return JSON.stringify(explainRecall(store, query, { toolName, limit }), null, 2);
    }

    case 'immune_guard': {
      const payload = typeof args.payload === 'string' ? args.payload : '';
      if (!payload.trim()) return 'error: payload is required.';
      const toolName = typeof args.toolName === 'string' && args.toolName.trim() ? args.toolName.trim() : 'Bash';
      const strict = args.strict === true;
      const ws = typeof args.workspace === 'string' && args.workspace.trim() ? resolve(args.workspace.trim()) : process.cwd();
      const dna = detectWorkspaceDNA(ws);
      const pm =
        dna.packageManager === 'pnpm' ||
        dna.packageManager === 'yarn' ||
        dna.packageManager === 'bun' ||
        dna.packageManager === 'uv'
          ? dna.packageManager
          : null;
      const verdict = evaluatePreFlightGuard(payload, store.listAll(false), {
        toolName,
        strict,
        workspacePackageManager: pm,
      });
      return JSON.stringify(verdict, null, 2);
    }

    case 'immune_vaccinate': {
      const ws = typeof args.workspace === 'string' && args.workspace.trim() ? resolve(args.workspace.trim()) : process.cwd();
      const lockPath = join(ws, '.immune', 'vaccine.lock.json');
      if (args.checkLockfile === true) {
        if (!existsSync(lockPath)) {
          return JSON.stringify({ exists: false, file: lockPath, valid: false, reason: 'lockfile not found' }, null, 2);
        }
        const report = verifyVaccineLockfile(readFileSync(lockPath, 'utf8'));
        return JSON.stringify({ exists: true, file: lockPath, ...report }, null, 2);
      }
      const preview = compileVaccineLockfile(ws, store.listAll(false));
      return JSON.stringify({ workspace: ws, lockfilePath: lockPath, preview }, null, 2);
    }

    case 'immune_diagnose': {
      return JSON.stringify(diagnoseAgentArchetype(store.listAll(false)), null, 2);
    }

    case 'immune_autopsy': {
      return JSON.stringify(runPitfallAutopsy(store.listAll(false)), null, 2);
    }

    case 'immune_federate': {
      const rawFiles = Array.isArray(args.files)
        ? args.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        : [];
      const minConsensusScore =
        typeof args.minConsensusScore === 'number' && Number.isFinite(args.minConsensusScore)
          ? Math.max(0, Math.min(100, args.minConsensusScore))
          : 0;
      const sources: SwarmRuleSource[] = [{ sourceId: 'local-sqlite', rules: store.listAll(false) }];
      for (const fp of rawFiles) {
        const abs = resolve(fp);
        if (!existsSync(abs)) return `error: file not found: ${abs}`;
        sources.push({ sourceId: fp, rules: parseTeamRulesJsonl(readFileSync(abs, 'utf8')) });
      }
      return JSON.stringify(federateSwarmRules(sources, { minConsensusScore }), null, 2);
    }

    case 'immune_guard_log': {
      const limit = positiveInt(args.limit, 25, 200);
      return JSON.stringify(store.guardEventSummary(limit), null, 2);
    }

    default:
      return `error: unknown tool ${name}`;
  }
}

/** Read one MCP resource URI (strictly read-only; never bumps hit counts). */
export function readResource(
  store: ImmuneStore,
  uri: string,
  workspace = process.cwd(),
): { uri: string; mimeType: string; text: string } | null {
  switch (uri) {
    case 'immune://library/active': {
      const rows = store.listAll(false).slice(0, 100).map((r) => ({
        id: r.id,
        tool_name: r.tool_name,
        trigger_pattern: redactOutbound(r.trigger_pattern),
        symptom: redactOutbound(r.symptom),
        prescription: redactOutbound(r.prescription),
        hit_count: r.hit_count,
        fail_count: r.fail_count,
        rubric_score: r.rubric_score ?? 70,
        project_scope: r.project_scope ?? '*',
      }));
      return { uri, mimeType: 'application/json', text: JSON.stringify({ count: rows.length, antibodies: rows }, null, 2) };
    }
    case 'immune://stats/summary': {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            stats: store.stats(),
            receipts: store.receiptSummary(500),
            triage: store.triageSummary(20),
            guard: store.guardEventSummary(15),
          },
          null,
          2,
        ),
      };
    }
    case 'immune://workspace/dna': {
      const dna = detectWorkspaceDNA(workspace);
      const lockPath = join(workspace, '.immune', 'vaccine.lock.json');
      const lockfile = existsSync(lockPath)
        ? { exists: true, ...verifyVaccineLockfile(readFileSync(lockPath, 'utf8')) }
        : { exists: false, valid: false, reason: 'lockfile not found' };
      return { uri, mimeType: 'application/json', text: JSON.stringify({ dna, lockfile }, null, 2) };
    }
    case 'immune://guard/events': {
      return { uri, mimeType: 'application/json', text: JSON.stringify(store.guardEventSummary(50), null, 2) };
    }
    case 'immune://insights/report': {
      const active = store.listAll(false);
      const receipts = store.receiptSummary(500);
      const stats = store.stats();
      const totalInjections = active.reduce((s, r) => s + r.hit_count, 0);
      const heldCount = receipts.byOutcome.held ?? 0;
      const failedCount = receipts.byOutcome.failed ?? 0;
      const totalObserved = heldCount + failedCount + stats.suppressedRepeats;
      const immunityScore = computeImmunityScore({
        totalCalls: Math.max(totalObserved, totalInjections),
        repeatFailures: stats.suppressedRepeats + heldCount,
        avoidableTokens: receipts.estimatedTokensSaved,
        activeRules: active.length,
        totalInjections,
      });
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            immunityScore,
            receipts,
            diagnosis: diagnoseAgentArchetype(active),
            autopsy: runPitfallAutopsy(active),
          },
          null,
          2,
        ),
      };
    }
    default:
      return null;
  }
}

/** Render one MCP prompt template with live read-only workspace pitfalls. */
export function getPrompt(
  store: ImmuneStore,
  name: string,
  args: Record<string, unknown> = {},
): { description: string; messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } | null {
  switch (name) {
    case 'immune_review_pitfalls': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const rawLimit = Number(args.limit ?? 8);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(20, Math.trunc(rawLimit)) : 8;
      const rows = query ? store.peek(query, limit) : store.listAll(false).slice(0, limit);
      const bullets =
        rows.length > 0
          ? rows
              .map(
                (r, idx) =>
                  `${idx + 1}. [${redactOutbound(r.trigger_pattern)}] Avoid: ${redactOutbound(r.symptom)} -> Do: ${redactOutbound(r.prescription)}`,
              )
              .join('\n')
          : '(No matching project pitfalls recorded yet.)';
      return {
        description: 'Pre-flight pitfall review checklist for the current workspace',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Review these verified workspace pitfall antibodies before modifying files or running destructive shell commands:\n\n${bullets}\n\n` +
                `Confirm your proposed plan avoids every pitfall above and uses safe non-destructive commands.`,
            },
          },
        ],
      };
    }
    case 'immune_triage_failure': {
      const errorText = typeof args.error === 'string' ? args.error.trim() : '';
      if (!errorText) return null;
      const tool = typeof args.tool === 'string' && args.tool.trim() ? args.tool.trim() : 'Bash';
      const matches = store.peek(`${tool} ${errorText}`, 5);
      const related =
        matches.length > 0
          ? matches
              .map(
                (r) =>
                  `- #${r.id} [${redactOutbound(r.trigger_pattern)}]: Avoid "${redactOutbound(r.symptom)}" -> Do "${redactOutbound(r.prescription)}"`,
              )
              .join('\n')
          : '- (No existing antibody matched this error.)';
      return {
        description: 'Red-3 root-cause triage workflow for a failing tool call',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Apply Red-3 Triage to this ${tool} failure:\n\`\`\`\n${redactOutbound(errorText).slice(0, 1500)}\n\`\`\`\n\n` +
                `Matching known antibodies:\n${related}\n\n` +
                `Classify the failure into one of the 5 Red-3 buckets (flake_or_transient, wrong_scope_leak, ignored_by_agent, stale_or_bad_advice, coverage_blindspot) and state the minimal verified fix.`,
            },
          },
        ],
      };
    }
    case 'immune_rewrite_echoes': {
      const candidates = hostRewriteCandidates(store, HOST_REWRITE_BATCH);
      const listText =
        candidates.length > 0
          ? candidates
              .map(
                (c) =>
                  `- #${c.id} (${c.tool_name ?? 'any'}, hits=${c.hit_count}): trigger="${c.trigger_pattern}" | symptom="${c.symptom}" | current="${c.prescription}"`,
              )
              .join('\n')
          : '(No echo-grade antibodies currently need rewriting.)';
      return {
        description: 'Host-delegated rewrite pass for echo-grade antibodies',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `${REWRITE_PROMPT}\n\nCandidates (max ${HOST_REWRITE_BATCH}):\n${listText}\n\n` +
                `After drafting concise model-neutral advice for each candidate, call \`immune_apply_rewrite\` with \`{ rewrites: [{ id, prescription }] }\`.`,
            },
          },
        ],
      };
    }
    default:
      return null;
  }
}

/** Run the stdio loop. Resolves when stdin closes. */
export function runMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const store = new ImmuneStore(env.IMMUNE_DB_PATH ? { dbPath: env.IMMUNE_DB_PATH } : {});

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    const write = (payload: unknown): void => {
      process.stdout.write(JSON.stringify(payload) + '\n');
    };

    rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(text);
      } catch {
        return; // A stray non-JSON line must not kill the server.
      }
      const params = (message.params ?? {}) as {
        protocolVersion?: unknown;
        name?: unknown;
        arguments?: unknown;
      };
      const id = message.id;
      if (id === undefined || id === null) return; // notification: no response

      const method = typeof message.method === 'string' ? message.method : '';
      switch (method) {
        case 'initialize':
          write({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion:
                typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: SERVER_INFO,
            },
          });
          break;

        case 'tools/list':
          write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
          break;

        case 'resources/list':
          write({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
          break;

        case 'resources/read': {
          const uri = typeof (params as { uri?: unknown }).uri === 'string' ? (params as { uri: string }).uri : '';
          const resource = uri ? readResource(store, uri) : null;
          if (!resource) {
            write({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `unknown resource uri: ${uri || '(none)'}` },
            });
            break;
          }
          write({ jsonrpc: '2.0', id, result: { contents: [resource] } });
          break;
        }

        case 'prompts/list':
          write({ jsonrpc: '2.0', id, result: { prompts: PROMPTS } });
          break;

        case 'prompts/get': {
          const promptName = typeof params.name === 'string' ? params.name : '';
          const promptArgs = (params.arguments ?? {}) as Record<string, unknown>;
          if (!promptName || !PROMPTS.some((p) => p.name === promptName)) {
            write({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `unknown prompt: ${promptName || '(none)'}` },
            });
            break;
          }
          const rendered = getPrompt(store, promptName, promptArgs);
          if (!rendered) {
            write({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `missing required arguments for prompt: ${promptName}` },
            });
            break;
          }
          write({ jsonrpc: '2.0', id, result: rendered });
          break;
        }

        case 'ping':
          write({ jsonrpc: '2.0', id, result: {} });
          break;

        case 'tools/call': {
          const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
          const name = typeof params.name === 'string' ? params.name : '';
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          if (!name || !TOOLS.some((t) => t.name === name)) {
            write({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `unknown tool: ${name || '(none)'}` },
            });
            break;
          }
          try {
            const text = callTool(store, name, args);
            const isError = text.startsWith('error:');
            write({
              jsonrpc: '2.0',
              id,
              result: isError
                ? { content: [{ type: 'text', text }], isError: true }
                : { content: [{ type: 'text', text }] },
            });
          } catch (error) {
            write({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
              },
            });
          }
          break;
        }

        default:
          write({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `method not found: ${method}` },
          });
      }
    });

    rl.on('close', () => {
      store.close();
      resolve();
    });
  });
}

function isDirectEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const selfPath = realpathSync(fileURLToPath(import.meta.url));
    const entryPath = realpathSync(argv1);
    return process.platform === 'win32'
      ? selfPath.toLowerCase() === entryPath.toLowerCase()
      : selfPath === entryPath;
  } catch {
    return import.meta.url === pathToFileURL(argv1).href;
  }
}

// Entry-point guard: running this file as a process starts the stdio loop;
// importing it (the tests) only gets callTool without a live server.
if (isDirectEntry()) {
  void runMcpServer();
}
