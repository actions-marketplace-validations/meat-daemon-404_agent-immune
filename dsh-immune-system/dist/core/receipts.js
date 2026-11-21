/**
 * Verifiable delivery receipt ledger (v2), inspired by `D:\PAT-HOT\beacon`.
 *
 * Each rule delivery/outcome writes a lightweight chained SHA-256 receipt so
 * model attribution, cross-model survival, and token savings are cryptographically
 * auditable rather than unverified aggregate counters.
 */
import { createHash } from 'node:crypto';
function computeDigest(prevDigest, payload) {
    const raw = [
        prevDigest,
        payload.ruleId,
        payload.sessionId,
        payload.model,
        payload.projectScope,
        payload.outcome,
        payload.tokensEst,
        payload.createdAt,
    ].join('|');
    return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}
/** Conservative default token-saving estimate per verified held delivery when no measured retry median exists. */
export const DEFAULT_HELD_TOKENS_EST = 420;
/**
 * Append one chained delivery receipt inside `BEGIN IMMEDIATE` so concurrent
 * hook processes serialize their digest link and never fork the SHA-256 chain.
 */
export function recordDeliveryReceipt(db, entry) {
    let began = false;
    try {
        try {
            db.exec('BEGIN IMMEDIATE');
            began = true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Only proceed inline when caller ALREADY holds a transaction; on
            // SQLITE_BUSY/lock contention bail out rather than forking the chain.
            if (!/within a transaction/i.test(msg))
                return;
        }
        const last = db
            .prepare('SELECT digest FROM delivery_receipts ORDER BY id DESC LIMIT 1')
            .get();
        const prevDigest = last?.digest ?? 'genesis';
        const createdAt = Date.now();
        const projectScope = entry.projectScope ?? '*';
        const tokensEst = Math.max(0, Math.trunc(entry.tokensEst ?? 0));
        const digest = computeDigest(prevDigest, {
            ruleId: entry.ruleId,
            sessionId: entry.sessionId,
            model: entry.model,
            projectScope,
            outcome: entry.outcome,
            tokensEst,
            createdAt,
        });
        db.prepare(`INSERT INTO delivery_receipts
         (rule_id, session_id, model, project_scope, outcome, tokens_est, digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.ruleId, entry.sessionId, entry.model, projectScope, entry.outcome, tokensEst, digest, createdAt);
        if (began)
            db.exec('COMMIT');
    }
    catch {
        if (began) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // ignore
            }
        }
        // Non-fatal telemetry.
    }
}
/**
 * Emit verified `'held'` receipts at turn close for antibodies that were
 * delivered in `sessionId` during the current window and were NOT followed
 * by a `'failed'` receipt or already credited `'held'` in that window.
 *
 * Executed inside ONE `BEGIN IMMEDIATE` transaction so concurrent turn-end
 * hooks cannot double-credit the same held receipt or fork the SHA-256 chain.
 * Returns how many new `'held'` receipts were appended.
 */
export function recordHeldReceiptsForSession(db, opts) {
    const uniqueIds = [...new Set(opts.ruleIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (!opts.sessionId || uniqueIds.length === 0)
        return 0;
    const since = Date.now() - (opts.windowMs ?? 30 * 60 * 1000);
    const tokensEst = Math.max(0, Math.trunc(opts.tokensPerHold ?? DEFAULT_HELD_TOKENS_EST));
    let credited = 0;
    let began = false;
    try {
        try {
            db.exec('BEGIN IMMEDIATE');
            began = true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/within a transaction/i.test(msg))
                return 0;
        }
        const priorStmt = db.prepare(`SELECT 1 FROM delivery_receipts
        WHERE session_id = ? AND rule_id = ? AND created_at >= ? AND outcome IN ('failed', 'held')
        LIMIT 1`);
        for (const ruleId of uniqueIds) {
            const exists = priorStmt.get(opts.sessionId, ruleId, since);
            if (exists !== undefined)
                continue;
            recordDeliveryReceipt(db, {
                ruleId,
                sessionId: opts.sessionId,
                model: opts.model,
                projectScope: opts.projectScope ?? '*',
                outcome: 'held',
                tokensEst,
            });
            credited += 1;
        }
        if (began)
            db.exec('COMMIT');
    }
    catch {
        if (began) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // ignore
            }
        }
        return 0;
    }
    return credited;
}
/** Verify digest chain integrity over recent receipts and summarize ROI. */
export function summarizeReceipts(db, verifyLimit = 500) {
    const totalRow = db.prepare('SELECT COUNT(*) AS n FROM delivery_receipts').get();
    const total = Number(totalRow.n);
    const cap = Math.max(1, Math.trunc(verifyLimit));
    let rows;
    let prev = 'genesis';
    if (total <= cap) {
        rows = db
            .prepare('SELECT * FROM delivery_receipts ORDER BY id ASC')
            .all();
    }
    else {
        const desc = db
            .prepare('SELECT * FROM delivery_receipts ORDER BY id DESC LIMIT ?')
            .all(cap);
        rows = desc.reverse();
        const firstId = rows[0]?.id;
        if (firstId !== undefined) {
            const prior = db
                .prepare('SELECT digest FROM delivery_receipts WHERE id < ? ORDER BY id DESC LIMIT 1')
                .get(firstId);
            prev = prior?.digest ?? 'genesis';
        }
    }
    let chainValid = true;
    for (const row of rows) {
        const expected = computeDigest(prev, {
            ruleId: row.rule_id,
            sessionId: row.session_id,
            model: row.model,
            projectScope: row.project_scope,
            outcome: row.outcome,
            tokensEst: row.tokens_est,
            createdAt: row.created_at,
        });
        if (expected !== row.digest)
            chainValid = false;
        prev = row.digest;
    }
    // Aggregate outcomes, per-model breakdown, and total verified held tokens
    // across ALL receipts via SQL so totals stay exact once `total > verifyLimit`
    // and `'delivered'` receipts are never conflated with `'held'` outcomes.
    const byOutcome = {};
    const outcomeRows = db
        .prepare('SELECT outcome, COUNT(*) AS n FROM delivery_receipts GROUP BY outcome')
        .all();
    for (const r of outcomeRows) {
        byOutcome[r.outcome] = Number(r.n);
    }
    const savedRow = db
        .prepare("SELECT COALESCE(SUM(tokens_est), 0) AS s FROM delivery_receipts WHERE outcome = 'held'")
        .get();
    const estimatedTokensSaved = Number(savedRow?.s ?? 0);
    const modelRows = db
        .prepare(`SELECT model,
              COUNT(*) AS total,
              SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN outcome = 'held' THEN 1 ELSE 0 END) AS held
         FROM delivery_receipts
        GROUP BY model
        ORDER BY total DESC`)
        .all();
    return {
        total,
        byOutcome,
        byModel: modelRows.map((m) => ({
            model: m.model,
            total: Number(m.total),
            failed: Number(m.failed),
            held: Number(m.held),
        })),
        estimatedTokensSaved,
        chainValid,
        latestDigest: rows.at(-1)?.digest ?? 'genesis',
    };
}
