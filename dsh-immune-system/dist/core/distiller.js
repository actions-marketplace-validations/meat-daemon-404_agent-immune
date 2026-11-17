import { BATCH_DISTILL_PROMPT, CRITIQUE_DISTILL_PROMPT, DISTILL_PROMPT, buildBatchInput, buildCritiqueInput, buildDistillInput, parseBatchOutput, parseDistillOutput, } from './prompts.js';
import { chat, readLlmConfig } from './llm.js';
import { extractError, extractInvocation } from './trace.js';
import { normalizeKeyword, meaningfulTokens } from './keywords.js';
import { matchGenericLesson } from './lessons.js';
import { abstractMachinePaths, canonicalizeSymptom, classifyRuleQuality } from './hygiene.js';
import { inferRootCause } from './rubric.js';
/** Failures with no reuse value: the retry usually just works. */
const TRANSIENT = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|rate.?limit|\b429\b|\b503\b|temporarily unavailable|network error|timed out|超时|网络|限流|请稍后/i;
const FILE_RE = /[\w@./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|kt|yml|yaml|toml|css|scss|html|vue|svelte)\b/g;
const ENV_RE = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const ARG_RE = /"(?:command|file_path|path|notebook_path|pattern|query|url|script|cmd|CommandLine|TargetFile|AbsolutePath|Path)"\s*:\s*"((?:[^"\\]|\\.){2,200})"/g;
/** POSIX-style errno and package-manager codes worth matching exactly. */
const ERRNOS = new Set([
    'EACCES', 'EPERM', 'EEXIST', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EISDIR',
    'EMFILE', 'ENFILE', 'EBUSY', 'EINVAL', 'EXDEV', 'ECONNREFUSED',
    'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTEMPTY', 'ELOOP', 'EAGAIN',
    'ESRCH', 'ENOTFOUND', 'ERESOLVE',
]);
/** Error codes are the most discriminating trigger tokens a trace carries. */
const ERROR_CODE_RE = /\b(ERR_[A-Z0-9_]{3,})\b/g;
const ERRNO_RE = /\b(E[A-Z]{4,})\b/g;
const HTTP_CODE_RE = /\b(?:HTTP|status)\s*(?:code)?\s*[:=]?\s*(\d{3})\b/gi;
/** ROADMAP 2.5a: TypeScript's diagnostic namespace (TS2304) ranks with ERR_*. */
const TS_CODE_RE = /\bTS(\d{4,})\b/g;
/** Pull up to `max` distinct, useful trigger keywords out of the two traces. */
export function extractKeywords(text, max = 8) {
    const found = [];
    const push = (raw) => {
        const token = normalizeKeyword(raw);
        if (!token)
            return;
        if (found.some((f) => f.toLowerCase() === token.toLowerCase()))
            return;
        found.push(token);
    };
    // Error codes first: they outrank every other token for recall precision.
    // Curated errnos (so EMAIL can never match), the unambiguous ERR_ prefix,
    // and HTTP/status codes only with their context word (a bare 404 is a count).
    for (const m of text.matchAll(ERROR_CODE_RE))
        if (m[1])
            push(m[1]);
    for (const m of text.matchAll(ERRNO_RE))
        if (m[1] && ERRNOS.has(m[1]))
            push(m[1]);
    for (const m of text.matchAll(HTTP_CODE_RE))
        if (m[1])
            push(`HTTP${m[1]}`);
    for (const m of text.matchAll(TS_CODE_RE))
        if (m[0])
            push(m[0]);
    // Commands contribute their meaningful words, not their first word (`cd`,
    // `sudo`), and not their flags.
    for (const m of text.matchAll(ARG_RE)) {
        if (!m[1])
            continue;
        for (const token of meaningfulTokens(m[1], 2))
            push(token);
    }
    for (const m of text.matchAll(FILE_RE))
        if (m[0])
            push(m[0]);
    for (const m of text.matchAll(ENV_RE))
        if (m[0])
            push(m[0]);
    return found.slice(0, max);
}
/** First meaningful line of a trace, cleaned for use as a symptom. */
function firstLine(trace, max = 80) {
    const cleaned = trace
        .replace(/\\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
/**
 * Trailing evidence line the live loop appends to a success trace when a
 * repair chain exists ("repair actions: Edit pytest.ini | Edit conftest.py").
 * The explicit list wins when a caller carries it separately (history paths).
 */
const REPAIR_LINE_RE = /\nrepair actions: (.+)\s*$/;
export function repairEvidenceOf(successTrace, repairs = []) {
    if (repairs.length > 0)
        return repairs.join(' | ').slice(0, 200);
    return successTrace.match(REPAIR_LINE_RE)?.[1]?.trim().slice(0, 200) ?? '';
}
/**
 * Whether a human message is worth storing as a hint.
 *
 * "继续" or "ok" is a turn, not an explanation — attaching it would become a
 * useless prescription ("do: continue"). Only substantive text qualifies.
 */
export function isSubstantiveHint(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 10)
        return false;
    if (/^(继续|好的|好|行|可以|ok|okay|yes|y|go on|continue|thanks|谢谢)[。.!！]?$/i.test(clean)) {
        return false;
    }
    return true;
}
/**
 * Deterministic fallback: build a rule straight from the failed and successful
 * invocations without calling a model.
 */
export function ruleDistill(toolName, failureTrace, successTrace, humanHint = '', repairs = [], opts = {}) {
    if (TRANSIENT.test(failureTrace)) {
        return { ok: false, reason: 'skip', detail: 'transient failure' };
    }
    // Defensive pin for AGENTS.md #24: retirement is not repair evidence.
    if (/^previous rule \(retired\b/i.test(successTrace.trim())) {
        return { ok: false, reason: 'skip', detail: 'retirement is not a repair' };
    }
    const keywords = extractKeywords(`${failureTrace} ${successTrace}`);
    if (keywords.length === 0) {
        return { ok: false, reason: 'skip', detail: 'no reusable trigger found' };
    }
    // A trigger is a recall key, not a document: abstract machine paths and cap length.
    const trigger = abstractMachinePaths(`${toolName} ${keywords.join(' ')}`, opts.workspaceRoot)
        .trim()
        .slice(0, 160);
    const error = extractError(failureTrace);
    const fallbackSymptom = failureTrace.trimStart().startsWith('tool=')
        ? ''
        : firstLine(failureTrace, 120);
    const rawSymptom = canonicalizeSymptom(error || fallbackSymptom || 'the first attempt failed', opts.workspaceRoot);
    // Generic invariant pitfalls merge globally into a single universal rule.
    const lesson = matchGenericLesson(rawSymptom);
    if (lesson) {
        return {
            ok: true,
            antibody: {
                trigger_pattern: lesson.trigger,
                symptom: lesson.symptom,
                prescription: lesson.prescription,
                tool_name: toolName,
                project_scope: '*',
                quality_grade: 'advice',
                root_cause: inferRootCause(lesson.symptom, lesson.prescription, repairs),
            },
        };
    }
    const symptom = rawSymptom;
    const invocation = extractInvocation(successTrace);
    const hint = isSubstantiveHint(humanHint) ? abstractMachinePaths(humanHint.trim(), opts.workspaceRoot) : '';
    const cleanInvocation = invocation ? abstractMachinePaths(invocation, opts.workspaceRoot) : '';
    const prescription = hint
        ? hint.slice(0, 200)
        : cleanInvocation
            ? `${toolName}: ${cleanInvocation}`
            : firstLine(abstractMachinePaths(successTrace, opts.workspaceRoot), 120) ||
                'use the retried invocation that succeeded';
    const evidence = repairEvidenceOf(successTrace, repairs);
    const withEvidence = evidence
        ? `${prescription} (after: ${abstractMachinePaths(evidence, opts.workspaceRoot)})`
        : prescription;
    const rootCause = inferRootCause(symptom, withEvidence, repairs);
    const verdict = classifyRuleQuality({
        trigger_pattern: trigger,
        symptom,
        prescription: withEvidence,
        tool_name: toolName,
        repair_path: repairs,
        prescription_source: hint ? 'human' : 'rule',
    });
    return {
        ok: true,
        antibody: {
            trigger_pattern: trigger,
            symptom,
            prescription: withEvidence,
            tool_name: toolName,
            prescription_source: hint ? 'human' : 'rule',
            project_scope: verdict.universalEligible ? '*' : (opts.projectScope ?? '*'),
            quality_grade: verdict.grade,
            rubric_score: verdict.score,
            root_cause: rootCause,
            ...(verdict.grade === 'quarantined' ? { status: 'quarantined' } : {}),
        },
    };
}
/**
 * Distil one episode into an antibody.
 *
 * Uses the configured model when available and silently degrades to the
 * deterministic rule when the model is missing, slow, or returns junk.
 */
export async function distillEpisode(toolName, failureTrace, successTrace, opts = {}) {
    const hint = opts.humanHint ?? '';
    const fallback = (reason) => {
        const ruled = ruleDistill(toolName, failureTrace, successTrace, hint, opts.repairs, {
            projectScope: opts.projectScope,
            workspaceRoot: opts.workspaceRoot,
        });
        if (!ruled.ok)
            return ruled;
        return { ...ruled, source: 'rule', ...(reason ? { degradedReason: reason } : {}) };
    };
    const llm = opts.llm === undefined ? readLlmConfig() : opts.llm;
    if (!llm)
        return fallback();
    try {
        const raw = await chat(llm, DISTILL_PROMPT, buildDistillInput(failureTrace, successTrace, hint), opts.signal);
        const parsed = parseDistillOutput(raw, toolName);
        if (!parsed.ok)
            return fallback(`model output unparseable: ${parsed.detail ?? parsed.reason}`);
        // The model path is normalised with the same curated table, so both paths
        // converge on one generic rule per generic pitfall.
        const lesson = matchGenericLesson(parsed.antibody.symptom);
        if (lesson) {
            return {
                ok: true,
                source: 'llm',
                antibody: {
                    trigger_pattern: lesson.trigger,
                    symptom: lesson.symptom,
                    prescription: lesson.prescription,
                    tool_name: toolName,
                    project_scope: '*',
                    quality_grade: 'advice',
                    rubric_score: 95,
                    root_cause: inferRootCause(lesson.symptom, lesson.prescription, opts.repairs),
                },
            };
        }
        let candidate = {
            ...parsed.antibody,
            trigger_pattern: abstractMachinePaths(parsed.antibody.trigger_pattern, opts.workspaceRoot),
            symptom: canonicalizeSymptom(parsed.antibody.symptom, opts.workspaceRoot),
            prescription: abstractMachinePaths(parsed.antibody.prescription, opts.workspaceRoot),
        };
        let verdict = classifyRuleQuality(candidate);
        // Agentic self-reflection pass: when a first-draft LLM rule is quarantined or scores below 68
        // on the rubric, feed its specific issues back into CRITIQUE_DISTILL_PROMPT once.
        if (opts.reflect !== false && (verdict.grade === 'quarantined' || verdict.score < 68) && !opts.signal?.aborted) {
            try {
                const refinedRaw = await chat(llm, CRITIQUE_DISTILL_PROMPT, buildCritiqueInput(candidate, verdict.issues, failureTrace, successTrace), opts.signal);
                const refined = parseDistillOutput(refinedRaw, toolName);
                if (refined.ok) {
                    const next = {
                        ...refined.antibody,
                        trigger_pattern: abstractMachinePaths(refined.antibody.trigger_pattern, opts.workspaceRoot),
                        symptom: canonicalizeSymptom(refined.antibody.symptom, opts.workspaceRoot),
                        prescription: abstractMachinePaths(refined.antibody.prescription, opts.workspaceRoot),
                    };
                    const nextVerdict = classifyRuleQuality(next);
                    if (nextVerdict.score > verdict.score) {
                        candidate = next;
                        verdict = nextVerdict;
                    }
                }
            }
            catch {
                // Critique is best-effort; retain original LLM candidate on timeout/error.
            }
        }
        return {
            ok: true,
            source: 'llm',
            antibody: {
                ...candidate,
                quality_grade: verdict.grade,
                rubric_score: verdict.score,
                root_cause: candidate.root_cause || inferRootCause(candidate.symptom, candidate.prescription, opts.repairs),
                project_scope: verdict.universalEligible ? '*' : (candidate.project_scope ?? opts.projectScope ?? '*'),
                ...(verdict.grade === 'quarantined' ? { status: 'quarantined' } : {}),
            },
        };
    }
    catch (error) {
        // Model unreachable or misconfigured: the rule-based path keeps the loop
        // alive, and the reason travels with the result so the caller can count it.
        return fallback(error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160));
    }
}
/** Apply the curated generic table to a model-produced rule. */
function normaliseLesson(result, toolName) {
    if (!result.ok)
        return result;
    const lesson = matchGenericLesson(result.antibody.symptom);
    if (!lesson)
        return result;
    return {
        ok: true,
        // Provenance of the ORIGINAL answer survives the curated-table rewrite.
        ...(result.source ? { source: result.source } : {}),
        antibody: {
            trigger_pattern: lesson.trigger,
            symptom: lesson.symptom,
            prescription: lesson.prescription,
            tool_name: toolName,
        },
    };
}
/**
 * Distil several episodes in ONE model request.
 *
 * The queue drains at turn end under a time budget, so the per-request latency
 * is what limits throughput: batching four episodes turns four round trips into
 * one. Everything that could go wrong degrades to the deterministic rule per
 * episode, so a malformed or partial batch never loses work.
 *
 * Returns a map keyed by episode id; every input id is present.
 */
export async function distillBatch(episodes, opts = {}) {
    const results = new Map();
    if (episodes.length === 0)
        return results;
    const perEpisode = async () => {
        for (const episode of episodes) {
            results.set(episode.id, await distillEpisode(episode.toolName, episode.failedTrace, episode.fixedTrace, {
                llm: opts.llm,
                signal: opts.signal,
                humanHint: episode.humanHint ?? '',
                repairs: episode.repairs ?? [],
                projectScope: episode.projectScope,
                workspaceRoot: episode.workspaceRoot,
            }));
        }
        return results;
    };
    const llm = opts.llm === undefined ? readLlmConfig() : opts.llm;
    // One episode is not a batch: the single-episode prompt carries more context
    // per request, and it is the path the existing tests pin.
    if (!llm || episodes.length < 2)
        return perEpisode();
    try {
        const raw = await chat(llm, BATCH_DISTILL_PROMPT, buildBatchInput(episodes), opts.signal);
        const parsed = parseBatchOutput(raw, episodes.map((episode) => episode.id), 'batch');
        for (const episode of episodes) {
            const answer = parsed.get(episode.id);
            // The model declined: respect it.
            if (answer && !answer.ok && answer.reason === 'skip') {
                results.set(episode.id, answer);
                continue;
            }
            if (answer?.ok) {
                // The batch response carries ids, not tool names — re-stamp it, and let
                // the curated generic table normalise it exactly as the single path does.
                // `source` must travel too: the runtime counter is the only evidence an
                // operator has that the model path actually ran.
                const stamped = {
                    ok: true,
                    source: 'llm',
                    antibody: { ...answer.antibody, tool_name: episode.toolName },
                };
                results.set(episode.id, normaliseLesson(stamped, episode.toolName));
                continue;
            }
            // Missing or malformed for this id: the deterministic rule fills the gap
            // so no queued episode is lost. Counted as a degradation with its reason.
            const filled = ruleDistill(episode.toolName, episode.failedTrace, episode.fixedTrace, episode.humanHint, episode.repairs ?? [], { projectScope: episode.projectScope, workspaceRoot: episode.workspaceRoot });
            results.set(episode.id, filled.ok ? { ...filled, source: 'rule', degradedReason: 'batch answer missing for id' } : filled);
        }
        return results;
    }
    catch {
        // Transport or parse failure: everything falls back to the rule path.
        return perEpisode();
    }
}
