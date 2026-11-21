/**
 * Streaming reader for Magpie local AI gateway telemetry (`~/.config/magpie/`).
 *
 * Strictly read-only, strictly non-credential: only inspects `usage.jsonl` and
 * compressed daily routing logs (`routing/*.jsonl` / `.jsonl.gz`), never reading
 * provider secrets or caller key stores.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const DEFAULT_CACHE_TTL_MS = 30_000;
let defaultCache = null;
function normalizeGatewayError(err, status) {
    const s = typeof err === 'string' ? err.trim() : '';
    if (/canceled/i.test(s) || status === 499)
        return 'canceled by agent';
    if (/TLS handshake timeout/i.test(s))
        return 'TLS handshake timeout';
    if (/socket connection was closed|ECONNRESET/i.test(s))
        return 'upstream socket closed (502)';
    if (/rate.?limit|429|quota/i.test(s))
        return 'rate limit / quota (429)';
    if (/timeout|timed out/i.test(s))
        return 'upstream timeout';
    if (typeof status === 'number' && status >= 400)
        return `HTTP ${status}`;
    return s ? s.slice(0, 64) : 'unknown gateway error';
}
function medianNum(xs) {
    if (xs.length === 0)
        return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2));
}
export function scanMagpieTelemetry(opts = {}) {
    const useDefaultCache = !opts.magpieDir && opts.maxRoutingFiles === undefined && !opts.noCache;
    if (useDefaultCache && defaultCache && Date.now() - defaultCache.ts < DEFAULT_CACHE_TTL_MS) {
        return defaultCache.report;
    }
    const configDir = opts.magpieDir ?? join(homedir(), '.config', 'magpie');
    const usageFile = join(configDir, 'usage.jsonl');
    const routingDir = join(configDir, 'routing');
    const hasUsage = existsSync(usageFile);
    const hasRouting = existsSync(routingDir);
    if (!hasUsage && !hasRouting) {
        return {
            present: false,
            configDir,
            usageRequests: 0,
            routingRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheReadTokens: 0,
            cacheHitRatePct: 0,
            failures: 0,
            retryRecovered: 0,
            canceled: 0,
            distinctModels: 0,
            distinctFolders: 0,
            byModel: [],
            byAgent: [],
            topFailures: [],
        };
    }
    let usageRequests = 0;
    let routingRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let usageFailures = 0;
    let routingFailures = 0;
    let retryRecovered = 0;
    let canceled = 0;
    const folders = new Set();
    const usageModelMap = new Map();
    const routingModelMap = new Map();
    const agentMap = new Map();
    const usageErrMap = new Map();
    const routingErrMap = new Map();
    const bumpModel = (target, model, failed, recovered, inTok, outTok, cacheTok, msVal, ttftVal) => {
        const key = model.trim() || 'unknown';
        const cur = target.get(key) ?? {
            requests: 0,
            failures: 0,
            retryRecovered: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            ms: [],
            ttft: [],
        };
        cur.requests += 1;
        if (failed)
            cur.failures += 1;
        if (recovered)
            cur.retryRecovered += 1;
        cur.inputTokens += inTok;
        cur.outputTokens += outTok;
        cur.cacheReadTokens += cacheTok;
        if (typeof msVal === 'number' && msVal > 0 && msVal < 300_000)
            cur.ms.push(msVal);
        if (typeof ttftVal === 'number' && ttftVal > 0 && ttftVal < 120_000)
            cur.ttft.push(ttftVal);
        target.set(key, cur);
    };
    if (hasUsage) {
        try {
            const raw = readFileSync(usageFile, 'utf8');
            for (const line of raw.split('\n')) {
                if (!line.trim())
                    continue;
                try {
                    const obj = JSON.parse(line);
                    usageRequests += 1;
                    const inTok = Number(obj.in ?? 0) || 0;
                    const outTok = Number(obj.out ?? 0) || 0;
                    const cacheTok = Number(obj.cache_read ?? 0) || 0;
                    totalInputTokens += inTok;
                    totalOutputTokens += outTok;
                    totalCacheReadTokens += cacheTok;
                    const status = typeof obj.status === 'number' ? obj.status : 0;
                    const err = typeof obj.err === 'string' ? obj.err : '';
                    const failed = status >= 400 || Boolean(err);
                    if (failed) {
                        usageFailures += 1;
                        const reason = normalizeGatewayError(err, status);
                        usageErrMap.set(reason, (usageErrMap.get(reason) ?? 0) + 1);
                    }
                    if (typeof obj.model === 'string' && obj.model.trim()) {
                        bumpModel(usageModelMap, obj.model, failed, false, inTok, outTok, cacheTok, obj.ms);
                    }
                }
                catch {
                    // ignore malformed log line
                }
            }
        }
        catch {
            // ignore unreadable usage file
        }
    }
    if (hasRouting) {
        let files = [];
        try {
            files = readdirSync(routingDir)
                .filter((f) => f.endsWith('.jsonl') || f.endsWith('.jsonl.gz'))
                .sort()
                .slice(-(opts.maxRoutingFiles ?? 45));
        }
        catch {
            files = [];
        }
        for (const file of files) {
            try {
                const full = join(routingDir, file);
                const text = file.endsWith('.gz')
                    ? gunzipSync(readFileSync(full)).toString('utf8')
                    : readFileSync(full, 'utf8');
                for (const line of text.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const obj = JSON.parse(line);
                        routingRequests += 1;
                        if (typeof obj.folder === 'string' && obj.folder.trim()) {
                            folders.add(obj.folder.trim().toLowerCase());
                        }
                        const status = typeof obj.status === 'number' ? obj.status : 200;
                        const tries = Array.isArray(obj.tries) ? obj.tries : [];
                        const ok = obj.done !== false && status < 400 && !obj.error;
                        const recovered = ok && tries.length > 1;
                        if (status === 499 || /canceled/i.test(String(obj.error ?? '')))
                            canceled += 1;
                        if (!ok) {
                            routingFailures += 1;
                            const reason = normalizeGatewayError(obj.error, status);
                            routingErrMap.set(reason, (routingErrMap.get(reason) ?? 0) + 1);
                        }
                        if (recovered)
                            retryRecovered += 1;
                        const inTok = Number(obj.tokens ?? 0) || 0;
                        const outTok = Number(obj.out ?? 0) || 0;
                        if (typeof obj.model === 'string' && obj.model.trim()) {
                            bumpModel(routingModelMap, obj.model, !ok, recovered, inTok, outTok, 0, obj.ms, obj.ttft);
                        }
                        const agent = typeof obj.agent === 'string' && obj.agent.trim() ? obj.agent.trim() : 'unknown';
                        const aCur = agentMap.get(agent) ?? { requests: 0, failures: 0, retryRecovered: 0 };
                        aCur.requests += 1;
                        if (!ok)
                            aCur.failures += 1;
                        if (recovered)
                            aCur.retryRecovered += 1;
                        agentMap.set(agent, aCur);
                    }
                    catch {
                        // ignore partial line
                    }
                }
            }
            catch {
                // ignore corrupted gzip chunk
            }
        }
    }
    // Avoid double-counting requests/failures when both `usage.jsonl` and `routing/`
    // exist: prefer `routing/` as the authoritative per-model source (it tracks
    // retries, agents, and TTFT) while preserving cache-read metrics from `usage.jsonl`.
    const modelMap = routingRequests > 0 ? routingModelMap : usageModelMap;
    if (routingRequests > 0) {
        for (const [model, u] of usageModelMap.entries()) {
            const existing = modelMap.get(model);
            if (existing) {
                existing.cacheReadTokens = Math.max(existing.cacheReadTokens, u.cacheReadTokens);
            }
            else {
                modelMap.set(model, u);
            }
        }
    }
    const failures = routingRequests > 0 ? routingFailures : usageFailures;
    const errMap = routingRequests > 0 ? routingErrMap : usageErrMap;
    const promptDenom = totalInputTokens + totalCacheReadTokens;
    const cacheHitRatePct = promptDenom > 0 ? Number(((totalCacheReadTokens * 100) / promptDenom).toFixed(1)) : 0;
    const byModel = [...modelMap.entries()]
        .map(([model, m]) => ({
        model,
        requests: m.requests,
        failures: m.failures,
        retryRecovered: m.retryRecovered,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        medianMs: medianNum(m.ms),
        medianTtftMs: medianNum(m.ttft),
    }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 15);
    const byAgent = [...agentMap.entries()]
        .map(([agent, a]) => ({ agent, ...a }))
        .sort((a, b) => b.requests - a.requests);
    const topFailures = [...errMap.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    const report = {
        present: hasUsage || hasRouting,
        configDir,
        usageRequests,
        routingRequests,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        cacheHitRatePct,
        failures,
        retryRecovered,
        canceled,
        distinctModels: modelMap.size,
        distinctFolders: folders.size,
        byModel,
        byAgent,
        topFailures,
    };
    if (useDefaultCache) {
        defaultCache = { ts: Date.now(), report };
    }
    return report;
}
/** Lightweight cached summary for UI badges & API status headers. */
export function scanMagpieSummary(opts = {}) {
    const report = scanMagpieTelemetry(opts);
    return {
        present: report.present,
        routingRequests: report.routingRequests,
        usageRequests: report.usageRequests,
        cacheHitRatePct: report.cacheHitRatePct,
        retryRecovered: report.retryRecovered,
        canceled: report.canceled,
        distinctModels: report.distinctModels,
    };
}
