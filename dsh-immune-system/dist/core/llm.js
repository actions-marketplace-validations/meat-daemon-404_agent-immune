/**
 * Minimal OpenAI-compatible client used by the distiller.
 *
 * The endpoint is user-configured, so it is validated before use: only http(s)
 * is allowed and loopback, private, link-local, CGNAT and reserved addresses are
 * refused. That blocks the common SSRF shape where a value smuggled into config
 * (or a poisoned env var) points the agent's outbound request at internal
 * services or cloud metadata endpoints.
 *
 * Local inference servers are also loopback by definition. Set
 * IMMUNE_ALLOW_PRIVATE_ENDPOINT=1 to opt in deliberately; the default is deny.
 */
import { redactOutbound, redactUrl } from './redact.js';
/** Read configuration from the environment; null when no model is configured. */
export function readLlmConfig(env = process.env) {
    const magpieModel = env.IMMUNE_MAGPIE_MODEL?.trim();
    const ollamaModel = env.IMMUNE_OLLAMA_MODEL?.trim();
    const endpoint = env.IMMUNE_LLM_BASE_URL?.trim() ||
        (magpieModel ? (env.IMMUNE_MAGPIE_URL?.trim() || 'http://127.0.0.1:3425/v1') : '') ||
        (ollamaModel ? 'http://127.0.0.1:11434/v1' : '');
    const model = env.IMMUNE_LLM_MODEL?.trim() || magpieModel || ollamaModel || '';
    if (!endpoint || !model)
        return null;
    const timeout = Number(env.IMMUNE_LLM_TIMEOUT_MS ?? '');
    const maxTokens = Number(env.IMMUNE_LLM_MAX_TOKENS ?? '');
    // Reasoning models (SenseNova 6.8, o1-style, most free gateways) reject
    // `temperature`. Omit it unless the operator asks for it explicitly.
    const temperature = Number(env.IMMUNE_LLM_TEMPERATURE ?? '');
    return {
        endpoint,
        apiKey: env.IMMUNE_LLM_API_KEY?.trim() ?? env.IMMUNE_MAGPIE_API_KEY?.trim() ?? '',
        model,
        allowPrivate: env.IMMUNE_ALLOW_PRIVATE_ENDPOINT === '1' ||
            Boolean((magpieModel || ollamaModel) && !env.IMMUNE_LLM_BASE_URL?.trim()),
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 8_000,
        ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
        ...(Number.isFinite(temperature) && temperature >= 0 ? { temperature } : {}),
    };
}
/** Parse an IPv4 literal into octets, or null when it is not one. */
function ipv4Octets(host) {
    const parts = host.split('.');
    if (parts.length !== 4)
        return null;
    const nums = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part))
            return null;
        const n = Number(part);
        if (n > 255)
            return null;
        nums.push(n);
    }
    return nums;
}
function isPrivateV4([a = 0, b = 0]) {
    if (a === 0)
        return true; // "this network"
    if (a === 10)
        return true;
    if (a === 127)
        return true; // loopback
    if (a === 169 && b === 254)
        return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true; // CGNAT
    if (a === 192 && b === 0)
        return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19))
        return true; // benchmarking
    if (a >= 224)
        return true; // multicast and reserved
    return false;
}
function isPrivateV6(host) {
    const h = host.toLowerCase();
    if (h === '::1' ||
        h === '::' ||
        h === '0:0:0:0:0:0:0:0' ||
        h === '0:0:0:0:0:0:0:1') {
        return true;
    }
    if (/^fe[89ab][0-9a-f]?:/i.test(h))
        return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/i.test(h) || h.startsWith('fc') || h.startsWith('fd'))
        return true; // unique local fc00::/7
    if (h.startsWith('ff'))
        return true; // multicast ff00::/8
    if (h.startsWith('100:'))
        return true; // RFC 6666 discard 100::/64
    if (h.startsWith('64:ff9b:'))
        return true; // NAT64 well-known/local prefixes
    if (h.startsWith('::ffff:')) {
        const tail = h.slice('::ffff:'.length);
        const mapped = ipv4Octets(tail);
        if (mapped)
            return isPrivateV4(mapped);
        // Node's WHATWG URL normalises ::ffff:127.0.0.1 to ::ffff:7f00:1.
        const hexPair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
        if (hexPair) {
            const hi = Number.parseInt(hexPair[1], 16);
            const lo = Number.parseInt(hexPair[2], 16);
            return isPrivateV4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
        }
        return true;
    }
    // Legacy IPv4-compatible IPv6 (e.g. ::127.0.0.1 or ::7f00:1).
    if (h.startsWith('::')) {
        const tail = h.slice(2);
        const compat = ipv4Octets(tail);
        if (compat)
            return isPrivateV4(compat);
        const hexPair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
        if (hexPair) {
            const hi = Number.parseInt(hexPair[1], 16);
            const lo = Number.parseInt(hexPair[2], 16);
            return isPrivateV4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
        }
    }
    return false;
}
/**
 * Validate an endpoint URL, throwing when it is not an acceptable target.
 * Returns the parsed URL so callers do not re-parse.
 */
export function assertSafeEndpoint(raw, allowPrivate = false) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`invalid endpoint URL: ${redactUrl(raw)}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`endpoint must use http or https, got ${url.protocol}`);
    }
    // Strip IPv6 brackets and DNS trailing dots (`localhost.`, `foo.local.`, `metadata.google.internal.`).
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
    if (!host)
        throw new Error('endpoint has no host');
    if (allowPrivate)
        return url;
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error('endpoint host is loopback (localhost)');
    }
    if (host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host === 'metadata.goog' ||
        host === 'metadata' ||
        host === 'instance-data') {
        throw new Error(`endpoint host is a private name: ${host}`);
    }
    const v4 = ipv4Octets(host);
    if (v4 && isPrivateV4(v4)) {
        throw new Error(`endpoint host is a private or reserved address: ${host}`);
    }
    if (!v4 && host.includes(':')) {
        if (isPrivateV6(host))
            throw new Error(`endpoint host is a private or reserved address: ${host}`);
    }
    return url;
}
/**
 * Process-wide rate-limit gate.
 *
 * Public-beta gateways enforce a very low requests-per-minute budget; a burst
 * of calls (a batch drain, a backfill loop) burns it in one go and every
 * subsequent call fails. When a rate limit is observed the gate parks every
 * later call until it expires, so one process self-throttles instead of
 * hammering the endpoint.
 */
let cooldownUntil = 0;
/** Smallest gap between two calls, in ms (IMMUNE_LLM_MIN_INTERVAL_MS). */
export function minCallIntervalMs(env = process.env) {
    const raw = Number(env.IMMUNE_LLM_MIN_INTERVAL_MS ?? '');
    return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 0;
}
/** Seconds to wait from a Retry-After header, or null when absent/bad. */
function retryAfterMs(response) {
    const raw = response.headers.get('retry-after');
    if (!raw)
        return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0)
        return Math.min(300_000, seconds * 1000);
    const when = Date.parse(raw);
    return Number.isFinite(when) ? Math.max(0, Math.min(300_000, when - Date.now())) : null;
}
/** True when a response body describes a rate limit, whatever the status. */
function looksRateLimited(status, bodyText) {
    if (status === 429)
        return true;
    return /rate.?limit|exceeds.*(?:tpm|rpm)|too many requests/i.test(bodyText);
}
/** Abortable sleep so turn-end budgets and cancellation never hang on backoff/cooldown timers. */
function sleepAbortable(ms, signal) {
    if (ms <= 0)
        return Promise.resolve();
    if (signal?.aborted) {
        return Promise.reject(new Error('aborted while waiting for rate-limit/backoff timer'));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('aborted while waiting for rate-limit/backoff timer'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
async function waitForGate(signal) {
    const wait = cooldownUntil - Date.now();
    if (wait <= 0)
        return;
    if (signal?.aborted)
        throw new Error('aborted before rate-limit cooldown ended');
    await sleepAbortable(wait, signal);
}
/** Backoff ladder in ms; overridable for tests via IMMUNE_LLM_BACKOFF_MS. */
function backoffLadder(env = process.env) {
    const raw = env.IMMUNE_LLM_BACKOFF_MS?.trim();
    if (raw) {
        const parsed = raw
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((v) => Number.isFinite(v) && v >= 0);
        if (parsed.length > 0)
            return parsed;
    }
    return [4_000, 12_000, 30_000, 60_000];
}
/** One chat completion. Throws on transport error, timeout, or non-2xx. */
export async function chat(cfg, system, user, signal) {
    const base = assertSafeEndpoint(cfg.endpoint, cfg.allowPrivate);
    const url = new URL(base.toString());
    if (!url.pathname.endsWith('/chat/completions')) {
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    }
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey)
        headers.authorization = `Bearer ${cfg.apiKey}`;
    const body = JSON.stringify({
        model: cfg.model,
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
        ...(cfg.maxTokens !== undefined ? { max_tokens: cfg.maxTokens } : {}),
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
    });
    // Up to four attempts with exponential backoff on a rate limit; the
    // caller's AbortSignal still bounds the total wait. 401/403 never retry.
    const backoff = backoffLadder();
    for (let attempt = 0;; attempt += 1) {
        await waitForGate(signal);
        const gap = minCallIntervalMs();
        if (gap > 0)
            await sleepAbortable(gap, signal);
        const timeout = AbortSignal.timeout(cfg.timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        // Never auto-follow HTTP 3xx redirects: a public allowlisted endpoint
        // redirecting to 169.254.169.254 or 127.0.0.1 would otherwise bypass SSRF validation.
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body,
            signal: combined,
            redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`model endpoint returned redirect ${response.status} (redirects refused for SSRF safety)`);
        }
        if (response.ok) {
            const data = (await response.json());
            const bodyErr = data.error;
            if (bodyErr !== undefined) {
                const text = `${String(bodyErr.type ?? '')} ${String(bodyErr.message ?? '')}`;
                if (looksRateLimited(0, text) && attempt < backoff.length) {
                    cooldownUntil = Date.now() + (backoff[attempt] ?? 60_000);
                    continue;
                }
                throw new Error(`model endpoint error: ${redactOutbound(text).slice(0, 200)}`);
            }
            const content = data.choices?.[0]?.message?.content;
            return typeof content === 'string' ? content : '';
        }
        const errBody = await response.text().catch(() => '');
        const permanent = response.status === 401 || response.status === 403;
        const rateLimited = looksRateLimited(response.status, errBody);
        // Retry transient server/timeout responses (408/503/504), never permanent 400/404/422.
        const retryable = !permanent &&
            (response.status === 408 || response.status === 503 || response.status === 504);
        if (rateLimited && attempt < backoff.length) {
            // Honour the server's own hint when it gives one; otherwise back off
            // progressively and park the whole process on the gate.
            const hinted = retryAfterMs(response);
            const wait = hinted ?? backoff[attempt] ?? 60_000;
            cooldownUntil = Date.now() + wait;
            continue;
        }
        if (retryable && attempt < 2) {
            await sleepAbortable(backoff[attempt] ?? 12_000, signal);
            continue;
        }
        throw new Error(`model endpoint returned ${response.status}: ${redactOutbound(errBody).slice(0, 200)}`);
    }
}
