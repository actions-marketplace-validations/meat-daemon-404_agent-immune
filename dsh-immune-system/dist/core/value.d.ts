export interface AvoidedEstimate {
    /** Repeats the suppression window caught, as counted by the plugin. */
    suppressed: number;
    /** Median tokens of one completed request in this project. */
    medianRequestTokens: number;
    /** How many requests the median is based on. */
    samples: number;
    /** suppressed × median × ROUND_TRIPS_PER_REPEAT. */
    avoidedTokens: number;
}
/** A suppressed repeat removes the failing attempt and the retry that follows. */
export declare const ROUND_TRIPS_PER_REPEAT = 2;
/**
 * Estimate avoided tokens from the host's own usage rows.
 *
 * Returns null when the host database is unavailable, has too little history,
 * or the plugin counted no suppressions — in each case printing a number would
 * be fiction.
 */
export declare function estimateAvoided(suppressed: number, env?: NodeJS.ProcessEnv): AvoidedEstimate | null;
/** 2_400_000 -> "2.4M"; small counts stay exact. */
export declare function formatTokens(tokens: number): string;
