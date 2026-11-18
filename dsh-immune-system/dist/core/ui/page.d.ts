/**
 * Standalone dashboard page composer.
 * Assembles modular labels, styles, template, and embedded client controller
 * into one offline self-contained HTML response (`AGENTS.md #14`).
 */
import type { EvolutionStats } from './query.js';
export interface PageOptions {
    token: string;
    /** Display language for labels. import type — no runtime edge to query.js */
    locale: 'zh-CN' | 'en';
    /** Shown in the header so it is obvious which database is open. */
    dbPath: string;
    /** Effective turn-end distillation budget, for the KPI card. */
    budgetMs?: number;
    /** ROADMAP 3.3: evolution telemetry strip (omitted -> no strip). */
    evolution?: EvolutionStats;
}
export declare function renderPage(options: PageOptions): string;
