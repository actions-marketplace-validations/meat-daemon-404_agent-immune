export const TRACE_CLAMP = 1_200;
export const TOP_FAMILIES = 5;
export const MIN_FAMILY_COUNT = 2;
export const MIN_TOKEN_SAMPLES = 30;
export function clampText(text, max = 2_000) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
export function medianOf(values) {
    if (values.length < MIN_TOKEN_SAMPLES)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return Number.isFinite(median) && median > 0
        ? { median: Math.round(median), samples: sorted.length }
        : null;
}
export function emptySource(source, note) {
    return {
        source,
        present: false,
        ...(note !== undefined ? { note } : {}),
        scanned: 0,
        failures: 0,
        paired: 0,
        superseded: 0,
        enqueued: 0,
        skippedSelf: 0,
        byTool: [],
        topFailures: [],
        medianRequestTokens: null,
        medianSamples: 0,
    };
}
