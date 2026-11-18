/**
 * Distillation prompt and its strict output parser.
 *
 * Nothing here trusts model output: the parser accepts JSON with or without a
 * code fence and rejects anything that is not the expected shape.
 */
import type { DistillResult } from './types.js';
export declare const DISTILL_PROMPT = "You extract one reusable rule from a coding agent's failed-then-fixed attempt.\n\nYou are given a FAILED tool call and a later SUCCESSFUL tool call of the same tool.\n\nOutput strictly JSON, no prose, no markdown fence.\n\nSkip the episode when it has no cross-session value. Output {\"skip\": true} when the\nfailure was caused only by:\n- a transient network blip, timeout, rate limit or 5xx\n- a one-off typo in the agent's own command\n- a sandbox or permission denial that will recur identically regardless of approach\n- a missing binary that the environment provisions elsewhere\n\nOtherwise output exactly:\n{\"trigger_pattern\": \"...\", \"symptom\": \"...\", \"prescription\": \"...\", \"root_cause\": \"missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other\", \"scope\": \"universal|project\"}\n\nRules:\n- trigger_pattern: the concrete things that should make an agent recall this rule.\n  Use file names, package names, commands, env vars, API names or error keywords.\n  Space separated, at most 8 items, no sentences.\n- symptom: one sentence, at most 35 characters, the wrong instinct that caused the failure.\n- prescription: one sentence, at most 60 characters, the verified correct move.\n- scope: \"universal\" when the lesson transfers across repositories without local paths;\n  \"project\" when tied to a specific repo script or config file.\n- The success trace may end with a \"repair actions:\" line \u2014 those are the edits\n  that actually fixed the problem. The prescription should state the FIX (for\n  example \"edit tsconfig.json before building\"), not restate the retried command.\n- Error codes (ERR_*, EACCES, HTTP 404) are strong trigger tokens; include the\n  code verbatim when it discriminates this failure from others.\n- Write the rule so a DIFFERENT model or agent can follow it. Strip\n  vendor-specific phrasing and NEVER include machine-local absolute paths,\n  IP addresses, secrets, tokens, or hostnames in any field.\n- Write symptom and prescription in the language the agent was working in.\n- Be specific. \"be careful\" is not a prescription.";
export declare const BATCH_DISTILL_PROMPT = "You extract reusable rules from several failed-then-fixed attempts at once.\n\nYou are given a JSON array of episodes: [{ id, failedTrace, fixedTrace, humanHint? }].\n\nOutput strictly a JSON ARRAY with one object per input id, no prose, no markdown fence:\n[{\"id\": 1, \"trigger_pattern\": \"...\", \"symptom\": \"...\", \"prescription\": \"...\", \"root_cause\": \"missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other\", \"scope\": \"universal|project\"},\n {\"id\": 2, \"skip\": true}]\n\nSkip an episode ({\"id\": N, \"skip\": true}) when it has no cross-session value:\ntransient network blips, timeouts, rate limits, one-off typos in the agent's own\ncommand, sandbox or permission denials that recur identically, or missing binaries\nthe environment provisions elsewhere.\n\nField rules are the same as single-episode distillation:\n- trigger_pattern: file names, package names, commands, env vars, error keywords;\n  space separated, at most 8 items, no sentences.\n- symptom: one sentence, at most 35 characters, the wrong instinct.\n- prescription: one sentence, at most 60 characters, the verified correct move.\n- A fixedTrace may end with a \"repair actions:\" line \u2014 the prescription should\n  state the FIX those edits made, not restate the retried command. Error codes\n  (ERR_*, EACCES, HTTP 404) are strong trigger tokens; include them verbatim.\n- Write the rule so a DIFFERENT model or agent can follow it: keep the action,\n  drop vendor-specific banners and internal tool names, and name the vendor\n  explicitly when the fix only works for it.\n- Write in the language the agent was working in.\n- Never include secrets, tokens, or hostnames.\n\nEvery input id must appear exactly once in the output.";
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
export declare function buildBatchInput(episodes: readonly BatchEpisode[]): string;
/**
 * Parse a batch response into per-id results.
 *
 * Anything the model failed to answer for is simply absent from the map, and the
 * caller falls back to the deterministic rule for those items — a partial answer
 * must never cost a queued episode.
 */
export declare function parseBatchOutput(raw: string, expectedIds: readonly number[], toolName: string): Map<number, DistillResult>;
/** Build the user-side payload for one failure/success pair. */
export declare function buildDistillInput(failureTrace: string, successTrace: string, humanHint?: string): string;
/** Parse and validate a distillation response. */
export declare function parseDistillOutput(raw: string, toolName?: string): DistillResult;
export declare const CRITIQUE_DISTILL_PROMPT = "You are a quality critic repairing a weak pitfall rule drafted by another model.\n\nThe draft rule scored poorly on our quality rubric because it leaked a machine-local path, copied raw command arguments, or lacked an imperative fix.\n\nOutput strictly JSON matching:\n{\"trigger_pattern\": \"...\", \"symptom\": \"...\", \"prescription\": \"...\", \"root_cause\": \"missing_prerequisite|env_or_path|api_or_schema_drift|stale_read|config_mismatch|command_syntax|other\", \"scope\": \"universal|project\"}\n\nRequirements:\n- Replace any machine paths (C:\\..., /Users/..., /home/...) with abstract concepts or <repo>/...\n- Keep prescription under 60 chars as ONE actionable instruction any agent can follow.\n- Include at least 3 concrete discriminating trigger tokens (error codes, tools, API names).";
export declare function buildCritiqueInput(draft: {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
}, issues: readonly string[], failureTrace: string, successTrace: string): string;
