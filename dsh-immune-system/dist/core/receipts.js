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
/** Append one chained delivery receipt (best-effort; never throws on hook paths). */
export function recordDeliveryReceipt(db, entry) {
    try {
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
    }
    catch {
        // Non-fatal telemetry.
    }
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
    const byOutcome = {};
    const models = new Map();
    let estimatedTokensSaved = 0;
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
        byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
        const m = models.get(row.model) ?? { total: 0, failed: 0, held: 0 };
        m.total += 1;
        if (row.outcome === 'failed')
            m.failed += 1;
        if (row.outcome === 'held' || row.outcome === 'delivered')
            m.held += 1;
        models.set(row.model, m);
        if (row.outcome === 'held')
            estimatedTokensSaved += row.tokens_est;
    }
    return {
        total,
        byOutcome,
        byModel: [...models.entries()]
            .map(([model, stats]) => ({ model, ...stats }))
            .sort((a, b) => b.total - a.total),
        estimatedTokensSaved,
        chainValid,
        latestDigest: rows.at(-1)?.digest ?? 'genesis',
    };
}
