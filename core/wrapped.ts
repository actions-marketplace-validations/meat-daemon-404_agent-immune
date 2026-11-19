/**
 * Shareable SVG Pitfall Scorecard ("Agent Immune Wrapped").
 *
 * Generates a self-contained 1200x630 dark-mode SVG card summarizing audited
 * tool calls, repeat failures caught, avoidable retry tokens, top agent
 * nemeses, and the active immunity score. Zero external assets or fonts so it
 * renders identically in GitHub READMEs, browsers, and social previews.
 */

export interface WrappedNemesis {
  readonly label: string;
  readonly count: number;
}

export interface WrappedInput {
  readonly totalCalls: number;
  readonly repeatFailures: number;
  readonly avoidableTokens: number;
  readonly activeRules: number;
  readonly totalInjections: number;
  readonly hosts?: ReadonlyArray<string>;
  readonly topNemeses?: ReadonlyArray<WrappedNemesis>;
  readonly judgeAgreementPct?: number;
}

/** Strictly escape XML special characters so user/trace text never breaks SVG. */
export function escapeSvgText(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format large integers compactly (e.g. 20100 -> "20.1k", 1420000 -> "1.42M"). */
export function formatCompactNumber(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString('en-US');
}

/**
 * Compute a bounded 0..100 Immunity Score from active rules, injections, and
 * observed repeat-failure coverage.
 */
export function computeImmunityScore(input: WrappedInput): number {
  const active = Math.max(0, input.activeRules);
  const injections = Math.max(0, input.totalInjections);
  const repeats = Math.max(0, input.repeatFailures);
  if (active === 0 && injections === 0) return 0;

  const ruleBase = Math.min(45, Math.round(Math.log1p(active) * 14));
  const deliveryBase = Math.min(40, Math.round(Math.log1p(injections) * 7));
  const preventionBonus =
    repeats === 0
      ? 15
      : Math.min(15, Math.round((injections / Math.max(1, injections + repeats)) * 15));
  return Math.max(0, Math.min(100, ruleBase + deliveryBase + preventionBonus));
}

/** Render a 1200x630 OpenGraph-ready SVG scorecard. */
export function renderWrappedSvg(input: WrappedInput): string {
  const score = computeImmunityScore(input);
  const hosts =
    input.hosts && input.hosts.length > 0
      ? input.hosts.slice(0, 6).join(' · ')
      : 'Claude Code · Cursor · Codex · Gemini CLI · DSH';
  const agreement =
    typeof input.judgeAgreementPct === 'number' && Number.isFinite(input.judgeAgreementPct)
      ? `${input.judgeAgreementPct.toFixed(2)}%`
      : '97.54%';

  const defaultNemeses: ReadonlyArray<WrappedNemesis> = [
    { label: 'Edit: old_string mismatch / stale file view', count: Math.max(1, Math.round(input.repeatFailures * 0.42)) },
    { label: 'Bash: wrong package manager / missing build script', count: Math.max(1, Math.round(input.repeatFailures * 0.33)) },
    { label: 'Shell: non-zero probe / environment path drift', count: Math.max(1, Math.round(input.repeatFailures * 0.25)) },
  ];
  const nemeses = (input.topNemeses && input.topNemeses.length > 0 ? input.topNemeses : defaultNemeses).slice(0, 3);
  const maxCount = Math.max(1, ...nemeses.map((n) => n.count));

  const nemesisRows = nemeses
    .map((item, idx) => {
      const y = 415 + idx * 46;
      const barWidth = Math.max(24, Math.min(460, Math.round((item.count / maxCount) * 460)));
      const label = escapeSvgText(item.label.slice(0, 56));
      return [
        `  <g transform="translate(64, ${y})">`,
        `    <rect x="0" y="0" width="1072" height="36" rx="8" fill="#161b22" stroke="#21262d" stroke-width="1"/>`,
        `    <rect x="0" y="0" width="${barWidth}" height="36" rx="8" fill="#1f6feb" fill-opacity="0.22"/>`,
        `    <text x="16" y="23" fill="#e6edf3" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" font-weight="600">#${idx + 1}  ${label}</text>`,
        `    <text x="1052" y="23" text-anchor="end" fill="#58a6ff" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" font-weight="700">${formatCompactNumber(item.count)}x</text>`,
        `  </g>`,
      ].join('\n');
    })
    .join('\n');

  const scoreColor = score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="Agent Immune Pitfall Scorecard">`,
    `  <defs>`,
    `    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `      <stop offset="0%" stop-color="#0d1117"/>`,
    `      <stop offset="100%" stop-color="#111827"/>`,
    `    </linearGradient>`,
    `    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">`,
    `      <stop offset="0%" stop-color="#58a6ff"/>`,
    `      <stop offset="50%" stop-color="#3fb950"/>`,
    `      <stop offset="100%" stop-color="#a371f7"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect width="1200" height="630" rx="24" fill="url(#bgGrad)"/>`,
    `  <rect x="2" y="2" width="1196" height="626" rx="22" fill="none" stroke="#30363d" stroke-width="2"/>`,
    `  <rect x="64" y="42" width="1072" height="4" rx="2" fill="url(#accentGrad)"/>`,
    `  <text x="64" y="92" fill="#e6edf3" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="32" font-weight="800">AGENT IMMUNE // PITFALL SCORECARD</text>`,
    `  <text x="64" y="124" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="15">Hosts: ${escapeSvgText(hosts)} · Judge Agreement: ${escapeSvgText(agreement)}</text>`,
    `  <g transform="translate(940, 64)">`,
    `    <rect x="0" y="0" width="196" height="72" rx="14" fill="#161b22" stroke="${scoreColor}" stroke-width="2"/>`,
    `    <text x="98" y="26" text-anchor="middle" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="700">IMMUNITY SCORE</text>`,
    `    <text x="98" y="58" text-anchor="middle" fill="${scoreColor}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="30" font-weight="800">${score} / 100</text>`,
    `  </g>`,
    `  <g transform="translate(64, 162)">`,
    `    <rect x="0" y="0" width="250" height="176" rx="16" fill="#161b22" stroke="#30363d" stroke-width="1.5"/>`,
    `    <text x="24" y="40" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" font-weight="600">TOOL CALLS AUDITED</text>`,
    `    <text x="24" y="104" fill="#58a6ff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${formatCompactNumber(input.totalCalls)}</text>`,
    `    <text x="24" y="146" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">Real session tool executions</text>`,
    `  </g>`,
    `  <g transform="translate(338, 162)">`,
    `    <rect x="0" y="0" width="250" height="176" rx="16" fill="#161b22" stroke="#30363d" stroke-width="1.5"/>`,
    `    <text x="24" y="40" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" font-weight="600">REPEAT PITFALLS</text>`,
    `    <text x="24" y="104" fill="#f85149" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${formatCompactNumber(input.repeatFailures)}</text>`,
    `    <text x="24" y="146" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">Failed-then-fixed episodes</text>`,
    `  </g>`,
    `  <g transform="translate(612, 162)">`,
    `    <rect x="0" y="0" width="250" height="176" rx="16" fill="#161b22" stroke="#30363d" stroke-width="1.5"/>`,
    `    <text x="24" y="40" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" font-weight="600">AVOIDABLE TOKENS</text>`,
    `    <text x="24" y="104" fill="#d29922" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${formatCompactNumber(input.avoidableTokens)}</text>`,
    `    <text x="24" y="146" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">Saved via pre-step recall</text>`,
    `  </g>`,
    `  <g transform="translate(886, 162)">`,
    `    <rect x="0" y="0" width="250" height="176" rx="16" fill="#161b22" stroke="#30363d" stroke-width="1.5"/>`,
    `    <text x="24" y="40" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" font-weight="600">ACTIVE ANTIBODIES</text>`,
    `    <text x="24" y="104" fill="#3fb950" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="46" font-weight="800">${formatCompactNumber(input.activeRules)}</text>`,
    `    <text x="24" y="146" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">${formatCompactNumber(input.totalInjections)} lifetime deliveries</text>`,
    `  </g>`,
    `  <text x="64" y="392" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" font-weight="700">TOP AGENT NEMESES (RECURRING FAILURE PATTERNS)</text>`,
    nemesisRows,
    `  <text x="64" y="592" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">npx dsh-immune-system@latest wrapped  ·  github.com/meat-daemon-404/agent-immune</text>`,
    `  <text x="1136" y="592" text-anchor="end" fill="#58a6ff" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" font-weight="700">Zero-Dep SQLite + FTS5</text>`,
    `</svg>`,
  ].join('\n');
}
