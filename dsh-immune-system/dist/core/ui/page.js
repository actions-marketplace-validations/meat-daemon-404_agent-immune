import { LABELS } from './labels.js';
import { DASHBOARD_CSS } from './styles.js';
import { formatBudget, renderHtmlShell } from './template.js';
import { renderClientScript } from './client-script.js';
export function renderPage(options) {
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
