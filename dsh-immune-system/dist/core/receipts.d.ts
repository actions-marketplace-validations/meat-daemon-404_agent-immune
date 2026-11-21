import type { DatabaseSync } from 'node:sqlite';
import type { DeliveryReceipt } from './types.js';
export type ReceiptOutcome = DeliveryReceipt['outcome'];
/** Conservative default token-saving estimate per verified held delivery when no measured retry median exists. */
export declare const DEFAULT_HELD_TOKENS_EST = 420;
/**
 * Append one chained delivery receipt inside `BEGIN IMMEDIATE` so concurrent
 * hook processes serialize their digest link and never fork the SHA-256 chain.
 */
export declare function recordDeliveryReceipt(db: DatabaseSync, entry: {
    ruleId: number;
    sessionId: string;
    model: string;
    projectScope?: string;
    outcome: ReceiptOutcome;
    tokensEst?: number;
}): void;
/**
 * Emit verified `'held'` receipts at turn close for antibodies that were
 * delivered in `sessionId` during the current window and were NOT followed
 * by a `'failed'` receipt or already credited `'held'` in that window.
 *
 * Returns how many new `'held'` receipts were appended.
 */
export declare function recordHeldReceiptsForSession(db: DatabaseSync, opts: {
    sessionId: string;
    ruleIds: ReadonlyArray<number>;
    model: string;
    projectScope?: string;
    tokensPerHold?: number;
    windowMs?: number;
}): number;
export interface ReceiptSummary {
    total: number;
    byOutcome: Record<string, number>;
    byModel: Array<{
        model: string;
        total: number;
        failed: number;
        held: number;
    }>;
    estimatedTokensSaved: number;
    chainValid: boolean;
    latestDigest: string;
}
/** Verify digest chain integrity over recent receipts and summarize ROI. */
export declare function summarizeReceipts(db: DatabaseSync, verifyLimit?: number): ReceiptSummary;
