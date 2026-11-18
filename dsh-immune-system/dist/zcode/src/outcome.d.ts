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
export interface Outcome {
    failed: boolean;
    sandboxDenied?: boolean;
    /** Text used for the stored trace and for relevance checks. */
    text: string;
}
/** Classify one successful-looking tool result as failure or success. */
export declare function classifyOutcome(event: Record<string, unknown>): Outcome;
