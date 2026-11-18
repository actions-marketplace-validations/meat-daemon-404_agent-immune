/**
 * HTML template helpers for the offline standalone dashboard.
 */
import type { EvolutionStats } from './query.js';
import type { Labels } from './labels.js';
export declare function esc(value: string): string;
export declare function formatBudget(ms: number): string;
export declare function evoStrip(evo: EvolutionStats, t: Labels): string;
export declare function renderHtmlShell(params: {
    locale: 'zh-CN' | 'en';
    dbPath: string;
    token: string;
    css: string;
    labels: Labels;
    evolution?: EvolutionStats;
    script: string;
}): string;
