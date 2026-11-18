export interface MagpieModelStat {
    model: string;
    requests: number;
    failures: number;
    retryRecovered: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    medianMs: number | null;
    medianTtftMs: number | null;
}
export interface MagpieFailureFamily {
    reason: string;
    count: number;
}
export interface MagpieTelemetryReport {
    present: boolean;
    configDir: string;
    usageRequests: number;
    routingRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    cacheHitRatePct: number;
    failures: number;
    retryRecovered: number;
    canceled: number;
    distinctModels: number;
    distinctFolders: number;
    byModel: MagpieModelStat[];
    byAgent: Array<{
        agent: string;
        requests: number;
        failures: number;
        retryRecovered: number;
    }>;
    topFailures: MagpieFailureFamily[];
}
export interface MagpieGatewaySummary {
    present: boolean;
    routingRequests: number;
    usageRequests: number;
    cacheHitRatePct: number;
    retryRecovered: number;
    canceled: number;
    distinctModels: number;
}
export declare function scanMagpieTelemetry(opts?: {
    magpieDir?: string;
    maxRoutingFiles?: number;
    noCache?: boolean;
}): MagpieTelemetryReport;
/** Lightweight cached summary for UI badges & API status headers. */
export declare function scanMagpieSummary(opts?: {
    magpieDir?: string;
    noCache?: boolean;
}): MagpieGatewaySummary;
