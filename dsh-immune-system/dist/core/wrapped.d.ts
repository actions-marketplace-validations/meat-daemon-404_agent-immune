/**
 * Shareable "Agent Pitfall Wrapped" SVG scorecard, README badge, & Markdown generator.
 *
 * Renders a 1200x630 dark-mode social card SVG, a shields.io-style live SVG badge,
 * or a viral GitHub README / PR summary Markdown snippet with zero external dependencies.
 */
export interface WrappedNemesis {
    readonly label: string;
    readonly count: number;
}
export interface WrappedInput {
    readonly title?: string;
    readonly subtitle?: string;
    readonly totalCalls: number;
    readonly repeatFailures: number;
    readonly avoidableTokens: number;
    readonly activeRules: number;
    readonly totalInjections: number;
    readonly hosts?: ReadonlyArray<string>;
    readonly topNemeses?: ReadonlyArray<WrappedNemesis>;
    readonly generatedAt?: string;
    readonly judgeAgreementPct?: number;
}
/** Escape XML/SVG text nodes so user rules or paths never break SVG rendering. */
export declare function escapeSvgText(raw: string): string;
/** Format large numbers compactly (e.g. 20100 -> "20.1k", 1420000 -> "1.42M"). */
export declare function formatCompactNumber(value: number): string;
/**
 * Compute an overall 0-100 Immunity Score from active rules, injections, and repeat failure rate.
 */
export declare function computeImmunityScore(input: WrappedInput): number;
/**
 * Render a shields.io-compatible flat SVG badge showing the live Immunity Score and active antibody count.
 */
export declare function renderImmunityBadgeSvg(input: WrappedInput): string;
/**
 * Render a ready-to-paste GitHub Markdown scorecard snippet for READMEs, PR comments, and CI Step Summaries.
 */
export declare function renderWrappedMarkdown(input: WrappedInput): string;
/**
 * Render a standalone 1200x630 SVG scorecard ready for GitHub READMEs, PRs, and X/Twitter.
 */
export declare function renderWrappedSvg(input: WrappedInput): string;
