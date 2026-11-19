import { type DiagnosableRule, type PitfallDomainId } from './diagnose.js';
export interface FragileScar {
    readonly trigger_pattern: string;
    readonly prescription: string;
    readonly hits: number;
    readonly fails: number;
    readonly survivalPct: number;
    readonly clinicalAction: string;
}
export interface AutopsyBucket {
    readonly domain: PitfallDomainId;
    readonly causeTitle: string;
    readonly savedLoops: number;
    readonly tokensRescued: number;
    readonly exampleTrigger: string | null;
}
export interface AutopsyReport {
    readonly activeRules: number;
    readonly savedLoops: number;
    readonly tokensRescued: number;
    readonly usdSaved: number;
    readonly minutesReclaimed: number;
    readonly narrative: string;
    readonly buckets: ReadonlyArray<AutopsyBucket>;
    readonly fragileScars: ReadonlyArray<FragileScar>;
}
export declare function runPitfallAutopsy(rules: ReadonlyArray<DiagnosableRule>, opts?: {
    tokensPerLoop?: number;
    usdPerMillionTokens?: number;
    secondsPerLoop?: number;
}): AutopsyReport;
export declare function renderAutopsyTerminal(report: AutopsyReport): string;
export declare function renderAutopsyMarkdown(report: AutopsyReport): string;
