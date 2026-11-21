/**
 * Decide whether a PostToolUse payload represents a failed call.
 *
 * Why this exists: `PostToolUseFailure` is dispatched only when the tool
 * *handler throws* (the executor's catch block). A shell command that exits
 * non-zero usually returns normally, so relying on that event alone would miss
 * exactly the failures this plugin is built to learn from.
 *
 * So PostToolUse is classified here instead, and the two paths converge.
 */
/** Check for a numeric shell exit code in explicit spellings without mistaking HTTP status codes. */
function exitCodeOf(response) {
    if (typeof response !== 'object' || response === null)
        return null;
    const raw = response;
    for (const key of ['exitCode', 'exit_code']) {
        const value = raw[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && /^-?\d+$/.test(value))
            return Number(value);
    }
    const looksHttp = 'ok' in raw || 'headers' in raw || 'statusText' in raw || 'body' in raw || 'data' in raw;
    if (!looksHttp) {
        for (const key of ['code', 'status']) {
            const value = raw[key];
            const num = typeof value === 'number' && Number.isFinite(value)
                ? value
                : typeof value === 'string' && /^-?\d+$/.test(value)
                    ? Number(value)
                    : null;
            // Exclude HTTP 2xx/3xx status codes (200..399) from generic `status`/`code` keys.
            if (num !== null && (num < 200 || num >= 400))
                return num;
        }
    }
    return null;
}
/**
 * Markers that strongly indicate a failure in captured output.
 *
 * Deliberately narrow: a successful build log can contain the word "error", so
 * only specific shapes count. A false positive here would record a healthy call
 * as a pitfall.
 */
const FAILURE_MARKERS = /\bexit (?:code|status)\s*[:=]?\s*[1-9]\d*\b|ENOENT|EACCES|EPERM|ECONNREFUSED|command not found|is not recognized as an internal|Traceback \(most recent call last\)|npm ERR!|\bfatal:\s|^Error:|Cannot find module/im;
const SANDBOX_DENIED = /\[sandbox:\s*file access denied under [^\]\n]+ mode\]|\bUPLOAD_NEEDS_PERMISSION\b|permission denied by user|rejected by user/i;
const TIMED_OUT = /\n\[timed out after \d+ms\]/i;
/** Classify one successful-looking tool result as failure or success. */
export function classifyOutcome(event) {
    const response = event.tool_response ?? event.toolResponse;
    const preview = typeof event.tool_result_preview === 'string' ? event.tool_result_preview : '';
    const topError = typeof event.error === 'string' ? event.error.trim() : '';
    const body = preview ||
        (typeof response === 'string' ? response : '') ||
        (() => {
            try {
                return JSON.stringify(response ?? '');
            }
            catch {
                return '';
            }
        })();
    if (SANDBOX_DENIED.test(body) || SANDBOX_DENIED.test(topError)) {
        return { failed: true, sandboxDenied: true, text: (body && body !== '""' ? body : '') || topError };
    }
    // Antigravity PostToolUse carries top-level `error: "..."` when the tool
    // execution fails, with no `tool_response` wrapper.
    if (topError.length > 0) {
        return { failed: true, text: (body && body !== '""' ? body : '') || topError };
    }
    const timedOut = (typeof response === 'object' &&
        response !== null &&
        response.timedOut === true) ||
        TIMED_OUT.test(body);
    if (timedOut) {
        return { failed: true, text: body || 'timed out' };
    }
    const exit = exitCodeOf(response);
    if (exit !== null) {
        return { failed: exit !== 0, text: body || `exit code ${exit}` };
    }
    if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
        const obj = response;
        if (obj.is_error === true || obj.isError === true || obj.error || obj.ok === false) {
            return { failed: true, text: body || String(obj.error ?? 'error') };
        }
        // AGENTS.md #13: a non-empty structured payload from a content/API tool
        // (Read, Grep, HTTP fetch) without shell output fields is already a verdict;
        // do not scan file contents or response data for `Error:` words.
        const keys = Object.keys(obj);
        const hasShellOutputField = 'stdout' in obj || 'stderr' in obj || 'output' in obj || 'command' in obj || 'interrupted' in obj;
        if (keys.length > 0 && !hasShellOutputField) {
            return { failed: false, text: body };
        }
    }
    if (FAILURE_MARKERS.test(body))
        return { failed: true, text: body };
    return { failed: false, text: body };
}
