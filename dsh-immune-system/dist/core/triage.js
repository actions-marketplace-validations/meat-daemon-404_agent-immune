import { matchGenericLesson } from './lessons.js';
import { isNoiseFailure } from './coverage.js';
const TRANSIENT_FLAKE_RE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|rate.?limit|\b429\b|\b503\b|temporarily unavailable|network error|timed out|超时|限流/i;
/**
 * Classify a post-injection failure before anti-rot blames the rule.
 */
export function triagePostInjectionFailure(rule, failureText, _toolName, currentScope = '*') {
    if (failureText && (isNoiseFailure(failureText) || TRANSIENT_FLAKE_RE.test(failureText))) {
        return {
            bucket: 'flake_or_transient',
            shouldPenalize: false,
            shouldQuarantine: false,
            escalateSurface: false,
            reason: 'transient/network/abort noise; rule not blamed',
        };
    }
    const ruleScope = rule.project_scope ?? '*';
    if (ruleScope !== '*' && currentScope !== '*' && ruleScope !== currentScope) {
        return {
            bucket: 'wrong_scope_leak',
            shouldPenalize: false,
            shouldQuarantine: true,
            escalateSurface: false,
            reason: `scope mismatch (rule=${ruleScope}, workspace=${currentScope})`,
        };
    }
    const isGeneric = matchGenericLesson(rule.symptom) !== null;
    const isHighHitHealthy = rule.hit_count >= 10 && rule.fail_count < rule.hit_count * 0.12;
    if ((isGeneric && rule.fail_count < 6) || isHighHitHealthy) {
        return {
            bucket: 'ignored_by_agent',
            shouldPenalize: !isGeneric, // generic rules stay protected up to 6 ignores; high-hit tracks ratio
            shouldQuarantine: false,
            escalateSurface: true,
            reason: isGeneric
                ? 'generic invariant ignored by agent — escalate warning instead of retiring'
                : 'high-hit rule ignored once — escalate delivery surface',
        };
    }
    return {
        bucket: 'stale_or_bad_advice',
        shouldPenalize: true,
        shouldQuarantine: false,
        escalateSurface: false,
        reason: (rule.probation_at ?? 0) > 0
            ? 'rule on env probation failed again'
            : 'rule applied on target and still failed',
    };
}
/** Append a Red-3 triage audit row (best-effort, bounded). */
export function recordTriageEvent(db, entry) {
    try {
        db.prepare(`INSERT INTO triage_events (rule_id, session_id, tool_name, bucket, reason, action_taken, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(entry.ruleId, entry.sessionId ?? '', entry.toolName ?? '', entry.bucket, entry.reason.slice(0, 240), entry.actionTaken.slice(0, 120), Date.now());
    }
    catch {
        // Telemetry must never break hook execution.
    }
}
/** Read-only summary of Red-3 triage telemetry across the store. */
export function summarizeTriage(db, limit = 20) {
    const counts = db
        .prepare('SELECT bucket, COUNT(*) AS n FROM triage_events GROUP BY bucket')
        .all();
    const byBucket = {};
    let totalEvents = 0;
    for (const row of counts) {
        const n = Number(row.n);
        byBucket[row.bucket] = n;
        totalEvents += n;
    }
    const ignoredRows = db
        .prepare(`SELECT id, trigger_pattern, ignored_count, hit_count
         FROM antibodies
        WHERE ignored_count > 0
        ORDER BY ignored_count DESC, hit_count DESC
        LIMIT 10`)
        .all();
    const quarantinedRow = db
        .prepare("SELECT COUNT(*) AS n FROM antibodies WHERE status = 'quarantined'")
        .get();
    const probationRow = db
        .prepare("SELECT COUNT(*) AS n FROM antibodies WHERE status = 'active' AND probation_at > 0")
        .get();
    const recentEvents = db
        .prepare('SELECT * FROM triage_events ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit);
    return {
        totalEvents,
        byBucket,
        ignoredRules: ignoredRows.map((r) => ({
            id: r.id,
            trigger: r.trigger_pattern,
            ignoredCount: r.ignored_count,
            hitCount: r.hit_count,
        })),
        quarantinedCount: Number(quarantinedRow.n),
        probationCount: Number(probationRow.n),
        recentEvents,
    };
}
