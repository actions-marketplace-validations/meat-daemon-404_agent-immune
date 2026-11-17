/**
 * Standalone dashboard page composer.
 * Assembles modular labels, styles, template, and embedded client controller
 * into one offline self-contained HTML response (`AGENTS.md #14`).
 */
import type { EvolutionStats } from './query.js';
import { LABELS } from './labels.js';
import { DASHBOARD_CSS } from './styles.js';
import { formatBudget, renderHtmlShell } from './template.js';
import { renderClientScript } from './client-script.js';

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

export function renderPage(options: PageOptions): string {
  const labels = LABELS[options.locale];
  const budget = formatBudget(options.budgetMs ?? 12_000);
  const script = renderClientScript(options.token, labels, budget);
  return renderHtmlShell({
    locale: options.locale,
    dbPath: options.dbPath,
    token: options.token,
    css: DASHBOARD_CSS,
    labels,
    evolution: options.evolution,
    script,
  });
}
