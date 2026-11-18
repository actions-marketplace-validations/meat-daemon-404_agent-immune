import type { DatabaseSync } from 'node:sqlite';
import type { DeliveryReceipt } from './types.js';
export type ReceiptOutcome = DeliveryReceipt['outcome'];
/** Append one chained delivery receipt (best-effort; never throws on hook paths). */
export declare function recordDeliveryReceipt(db: DatabaseSync, entry: {
    ruleId: number;
    sessionId: string;
    model: string;
    projectScope?: string;
    outcome: ReceiptOutcome;
    tokensEst?: number;
}): void;
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
