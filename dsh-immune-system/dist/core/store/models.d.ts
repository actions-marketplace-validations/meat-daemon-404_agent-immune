/**
 * Model attribution for rule deliveries.
 *
 * The hook payload does not carry a model name — ZCode sends session_id,
 * permission_mode, tool_name and the tool input, nothing else. The host does
 * record it, on every `model_usage` row (`session_id` + `model_id`), so the
 * first delivery of a session pays one read-only lookup against the host
 * database and caches the answer in `session_models`. Everything after that is
 * a primary-key read in our own database.
 *
 * Why bother: it turns "does this lesson survive a model switch" from an
 * opinion into a query — a rule delivered under two models is the evidence
 * that its prescription is a general action rather than one model's tic.
 * `IMMUNE_MODEL_NAME` overrides the lookup, which is what a non-ZCode host or
 * a test uses.
 */
import { DatabaseSync } from 'node:sqlite';
export declare const UNKNOWN_MODEL = "unknown";
/**
 * Some hosts record `auto` when the provider picked the model for them. It is
 * a routing label, not a model: two deliveries under "auto" say nothing about
 * cross-model generality, and a rule that only ever saw "auto" must not look
 * like it survived a switch.
 */
export declare function isInformativeModel(model: string): boolean;
export interface ModelRow {
    model: string;
    hits: number;
    fails: number;
    /** Distinct rules delivered under this model. */
    rules: number;
}
/** Where the host keeps model usage. Only the default is ZCode's. */
export declare function hostDbPath(env?: NodeJS.ProcessEnv): string;
/**
 * The model that served the most recent request of this session.
 *
 * Returns '' when the host database is absent, encrypted, locked or has no
 * usage row yet — the caller stores `unknown` and asks again later. Every
 * failure path is swallowed on purpose: attribution must never break a hook.
 */
export declare function lookupHostModel(sessionId: string, env?: NodeJS.ProcessEnv): string;
/** Resolve and cache the model for a session. Always returns a usable label. */
export declare function resolveModel(db: DatabaseSync, sessionId: string, env?: NodeJS.ProcessEnv, now?: number): string;
/** Count one delivery of each rule under this model. */
export declare function recordModelHits(db: DatabaseSync, model: string, ruleIds: number[], now?: number): void;
/** Count a delivery that did not prevent the failure (anti-rot penalty). */
export declare function recordModelFails(db: DatabaseSync, model: string, ruleIds: number[], now?: number): void;
/** Per-model totals, busiest first. */
export declare function modelBreakdown(db: DatabaseSync): ModelRow[];
/**
 * Rules proven under more than one model. This is the measurable form of
 * "the prescription is general": the same trigger recalled and held while a
 * different model was driving.
 */
export declare function crossModelRuleCount(db: DatabaseSync): number;
