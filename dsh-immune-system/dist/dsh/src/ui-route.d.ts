import type { ImmuneStore } from '../../core/store/index.js';
export declare const UI_ROUTE_PREFIX = "/plugins/dsh-immune-system/api";
/**
 * `getBudgetMs` lets the host half report the *session's* effective budget
 * (which `/immune --budget` can override) instead of just the env default.
 */
export declare function registerImmuneUiRoute(ctx: unknown, store: ImmuneStore, getBudgetMs?: () => number): void;
