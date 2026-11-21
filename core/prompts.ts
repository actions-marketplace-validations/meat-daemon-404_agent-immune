/**
 * Distillation prompt and its strict output parser.
 *
 * Nothing here trusts model output: the parser accepts JSON with or without a
 * code fence and rejects anything that is not the expected shape.
 */
import type { DistillResult } from './types.js';
import { redactOutbound } from './redact.js';

export const DISTILL_PROMPT = `You extract one reusable rule from a coding agent's failed-then-fixed attempt.

You are given a FAILED tool call and a later SUCCESSFUL tool call of the same tool.

Output strictly JSON, no prose, no markdown fence.

Skip the episode when it has no cross-session value. Output {"skip": true} when the
failure was caused only by:
- a transient network blip, timeout, rate limit or 5xx
- a one-off typo in the agent's own command
- a sandbox or permission denial that will recur identically regardless of approach
- a missing binary that the environment provisions elsewhere

Otherwise output exactly:
{"trigger_pattern": "...", "symptom": "...", "prescription": "...", "root_cause": "missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other", "scope": "universal|project"}

Rules:
- trigger_pattern: the concrete things that should make an agent recall this rule.
  Use file names, package names, commands, env vars, API names or error keywords.
  Space separated, at most 8 items, no sentences.
- symptom: one sentence, at most 35 characters, the wrong instinct that caused the failure.
- prescription: one sentence, at most 60 characters, the verified correct move.
- scope: "universal" when the lesson transfers across repositories without local paths;
  "project" when tied to a specific repo script or config file.
- The success trace may end with a "repair actions:" line — those are the edits
  that actually fixed the problem. The prescription should state the FIX (for
  example "edit tsconfig.json before building"), not restate the retried command.
- Error codes (ERR_*, EACCES, HTTP 404) are strong trigger tokens; include the
  code verbatim when it discriminates this failure from others.
- Write the rule so a DIFFERENT model or agent can follow it. Strip
  vendor-specific phrasing and NEVER include machine-local absolute paths,
  IP addresses, secrets, tokens, or hostnames in any field.
- Write symptom and prescription in the language the agent was working in.
- Be specific. "be careful" is not a prescription.`;

export const BATCH_DISTILL_PROMPT = `You extract reusable rules from several failed-then-fixed attempts at once.

You are given a JSON array of episodes: [{ id, failedTrace, fixedTrace, humanHint? }].

Output strictly a JSON ARRAY with one object per input id, no prose, no markdown fence:
[{"id": 1, "trigger_pattern": "...", "symptom": "...", "prescription": "...", "root_cause": "missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other", "scope": "universal|project"},
 {"id": 2, "skip": true}]

Skip an episode ({"id": N, "skip": true}) when it has no cross-session value:
transient network blips, timeouts, rate limits, one-off typos in the agent's own
command, sandbox or permission denials that recur identically, or missing binaries
the environment provisions elsewhere.

Field rules are the same as single-episode distillation:
- trigger_pattern: file names, package names, commands, env vars, error keywords;
  space separated, at most 8 items, no sentences.
- symptom: one sentence, at most 35 characters, the wrong instinct.
- prescription: one sentence, at most 60 characters, the verified correct move.
- A fixedTrace may end with a "repair actions:" line — the prescription should
  state the FIX those edits made, not restate the retried command. Error codes
  (ERR_*, EACCES, HTTP 404) are strong trigger tokens; include them verbatim.
- Write the rule so a DIFFERENT model or agent can follow it: keep the action,
  drop vendor-specific banners and internal tool names, and name the vendor
  explicitly when the fix only works for it.
- Write in the language the agent was working in.
- Never include secrets, tokens, or hostnames.

Every input id must appear exactly once in the output.`;

/** One episode in a batch request. */
export interface BatchEpisode {
  id: number;
  toolName: string;
  failedTrace: string;
  fixedTrace: string;
  humanHint?: string;
  /** Observed repair chain (ROADMAP 1.3): rides in the payload, not the trace. */
  repairs?: string[];
  projectScope?: string;
  workspaceRoot?: string;
}

/** Build the batch payload: a JSON array, as the prompt asks for. */
export function buildBatchInput(episodes: readonly BatchEpisode[]): string {
  return JSON.stringify(
    episodes.map((episode) => ({
      id: episode.id,
      failedTrace: redactOutbound(episode.failedTrace),
      fixedTrace: redactOutbound(episode.fixedTrace),
      ...(episode.humanHint ? { humanHint: redactOutbound(episode.humanHint) } : {}),
      ...(episode.repairs && episode.repairs.length > 0
        ? { repairs: episode.repairs.map((step) => redactOutbound(step)) }
        : {}),
    })),
    null,
    1,
  );
}

/**
 * Parse a batch response into per-id results.
 *
 * Anything the model failed to answer for is simply absent from the map, and the
 * caller falls back to the deterministic rule for those items — a partial answer
 * must never cost a queued episode.
 */
export function parseBatchOutput(
  raw: string,
  expectedIds: readonly number[],
  toolName: string,
): Map<number, DistillResult> {
  const out = new Map<number, DistillResult>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;

  const allowed = new Set(expectedIds);
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'number' ? obj.id : Number.NaN;
    // Refuse ids the model invented: an echo of a made-up id must not create a
    // rule that no episode produced.
    if (!Number.isInteger(id) || !allowed.has(id)) continue;
    out.set(id, resultFromObject(obj, toolName));
  }
  return out;
}

const VALID_ROOT_CAUSES = new Set([
  'missing_prerequisite',
  'env_or_path',
  'api_or_schema_drift',
  'stale_read',
  'config_mismatch',
  'command_syntax',
  'flake',
  'other',
]);

/** Shared field extraction for one distilled object. */
function resultFromObject(obj: Record<string, unknown>, toolName: string): DistillResult {
  if (obj.skip === true) return { ok: false, reason: 'skip' };
  const trigger = field(obj.trigger_pattern, 240);
  const prescription = field(obj.prescription, 240);
  if (!trigger || !prescription) {
    return { ok: false, reason: 'invalid', detail: 'missing trigger_pattern or prescription' };
  }
  const rawCause = typeof obj.root_cause === 'string' ? obj.root_cause.trim() : '';
  const root_cause = VALID_ROOT_CAUSES.has(rawCause) ? (rawCause as import('./types.js').RootCauseType) : undefined;
  const scope = obj.scope === 'universal' ? '*' : undefined;
  return {
    ok: true,
    antibody: {
      trigger_pattern: trigger,
      symptom: field(obj.symptom, 240) ?? '(no symptom recorded)',
      prescription,
      tool_name: toolName,
      prescription_source: 'llm',
      ...(root_cause ? { root_cause } : {}),
      ...(scope ? { project_scope: scope } : {}),
    },
  };
}

function escapePromptTags(text: string): string {
  return text.replace(/<\/?(?:failed_call|successful_call|human_explanation|draft_rule|rubric_issues|evidence)\b[^>]*>/gi, '[tag]');
}

/** Build the user-side payload for one failure/success pair. */
export function buildDistillInput(
  failureTrace: string,
  successTrace: string,
  humanHint = '',
): string {
  const safeFailure = escapePromptTags(redactOutbound(failureTrace));
  const safeSuccess = escapePromptTags(redactOutbound(successTrace));
  const safeHint = humanHint.trim() ? escapePromptTags(redactOutbound(humanHint.trim())) : '';
  const parts = [
    '<failed_call>',
    safeFailure,
    '</failed_call>',
    '',
    '<successful_call>',
    safeSuccess,
    '</successful_call>',
  ];
  if (safeHint) {
    // The human's correction is the highest-signal input available: it states
    // the rule outright instead of leaving the model to infer it from a diff.
    parts.push(
      '',
      '<human_explanation>',
      safeHint,
      '</human_explanation>',
      'The human said this after the failure. If it states the actual rule, the',
      'prescription must follow it rather than a guess at what changed.',
    );
  }
  return parts.join('\n');
}

/** Strip a surrounding markdown fence, if the model added one. */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines.length < 2) return trimmed;
  const body = lines.slice(1);
  const last = body[body.length - 1];
  if (last !== undefined && last.trim().startsWith('```')) body.pop();
  return body.join('\n').trim();
}

/** Clamp a free-text field and refuse anything empty after trimming. */
function field(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/** Parse and validate a distillation response. */
export function parseDistillOutput(raw: string, toolName?: string): DistillResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, reason: 'invalid', detail: 'not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'invalid', detail: 'not a JSON object' };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.skip === true) return { ok: false, reason: 'skip' };

  const trigger = field(obj.trigger_pattern, 240);
  const prescription = field(obj.prescription, 240);
  if (!trigger || !prescription) {
    return { ok: false, reason: 'invalid', detail: 'missing trigger_pattern or prescription' };
  }
  // Symptom is helpful but not essential; keep the rule when it is absent.
  const symptom = field(obj.symptom, 240) ?? '(no symptom recorded)';
  const rawCause = typeof obj.root_cause === 'string' ? obj.root_cause.trim() : '';
  const root_cause = VALID_ROOT_CAUSES.has(rawCause) ? (rawCause as import('./types.js').RootCauseType) : undefined;
  const scope = obj.scope === 'universal' ? '*' : undefined;

  return {
    ok: true,
    antibody: {
      trigger_pattern: trigger,
      symptom,
      prescription,
      tool_name: toolName ?? null,
      prescription_source: 'llm',
      ...(root_cause ? { root_cause } : {}),
      ...(scope ? { project_scope: scope } : {}),
    },
  };
}

export const CRITIQUE_DISTILL_PROMPT = `You are a quality critic repairing a weak pitfall rule drafted by another model.

The draft rule scored poorly on our quality rubric because it leaked a machine-local path, copied raw command arguments, or lacked an imperative fix.

Output strictly JSON matching:
{"trigger_pattern": "...", "symptom": "...", "prescription": "...", "root_cause": "missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other", "scope": "universal|project"}

Requirements:
- Replace any machine paths (C:\\..., /Users/..., /home/...) with abstract concepts or <repo>/...
- Keep prescription under 60 chars as ONE actionable instruction any agent can follow.
- Include at least 3 concrete discriminating trigger tokens (error codes, tools, API names).`;

export function buildCritiqueInput(
  draft: { trigger_pattern: string; symptom: string; prescription: string },
  issues: readonly string[],
  failureTrace: string,
  successTrace: string,
): string {
  return [
    '<draft_rule>',
    escapePromptTags(redactOutbound(JSON.stringify(draft))),
    '</draft_rule>',
    '<rubric_issues>',
    escapePromptTags(issues.join('; ') || 'low portability or actionability'),
    '</rubric_issues>',
    '<evidence>',
    escapePromptTags(redactOutbound(failureTrace).slice(0, 600)),
    '---',
    escapePromptTags(redactOutbound(successTrace).slice(0, 600)),
    '</evidence>',
  ].join('\n');
}
