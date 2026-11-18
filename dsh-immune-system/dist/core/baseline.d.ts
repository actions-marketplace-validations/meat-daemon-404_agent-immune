export type BaselineLevel = 'widely' | 'newly';
export interface BaselineDetection {
    level: BaselineLevel;
    source: string | null;
    reason: string;
}
/**
 * Inspect workspace browser/runtime constraints (.browserslistrc, package.json, tsconfig.json).
 * Returns 'widely' when legacy or broad compatibility targets are configured, otherwise 'newly'.
 */
export declare function detectProjectBaselineDetail(cwd: string): BaselineDetection;
export declare function detectProjectBaseline(cwd: string): BaselineLevel;
/** Keep only rules compatible with the active project baseline target. */
export declare function filterRulesByBaseline<T extends {
    baseline?: BaselineLevel;
}>(rules: readonly T[], baseline: BaselineLevel): T[];
/** Infer whether external guidance text explicitly requires Baseline Newly Available APIs. */
export declare function inferRuleBaseline(text: string): BaselineLevel;
export declare function parseBaselineFlag(value: string | undefined): BaselineLevel | undefined;
