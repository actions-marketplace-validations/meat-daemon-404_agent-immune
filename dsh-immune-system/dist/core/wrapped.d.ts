export interface WrappedNemesis {
    readonly label: string;
    readonly count: number;
}
export interface WrappedInput {
    readonly totalCalls: number;
    readonly repeatFailures: number;
    readonly avoidableTokens: number;
    readonly activeRules: number;
    readonly totalInjections: number;
    readonly hosts?: ReadonlyArray<string>;
    readonly topNemeses?: ReadonlyArray<WrappedNemesis>;
    readonly judgeAgreementPct?: number;
}
/** Strictly escape XML special characters so user/trace text never breaks SVG. */
export declare function escapeSvgText(raw: string): string;
/** Format large integers compactly (e.g. 20100 -> "20.1k", 1420000 -> "1.42M"). */
export declare function formatCompactNumber(value: number): string;
/**
 * Compute a bounded 0..100 Immunity Score from active rules, injections, and
 * observed repeat-failure coverage.
 */
export declare function computeImmunityScore(input: WrappedInput): number;
/** Render a 1200x630 OpenGraph-ready SVG scorecard. */
export declare function renderWrappedSvg(input: WrappedInput): string;
