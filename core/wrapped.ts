/**
 * Shareable "Agent Pitfall Wrapped" SVG scorecard, README badge, & Markdown generator.
 *
 * Renders a 1200x630 dark-mode social card SVG, a shields.io-style live SVG badge,
 * or a viral GitHub README / PR summary Markdown snippet with zero external dependencies.
 */

export interface WrappedNemesis {
  readonly label: string;
  readonly count: number;
}

export interface WrappedInput {
  readonly title?: string;
  readonly subtitle?: string;
  readonly totalCalls: number;
  readonly repeatFailures: number;
  readonly avoidableTokens: number;
  readonly activeRules: number;
  readonly totalInjections: number;
  readonly hosts?: ReadonlyArray<string>;
  readonly topNemeses?: ReadonlyArray<WrappedNemesis>;
  readonly generatedAt?: string;
  readonly judgeAgreementPct?: number;
}

/** Escape XML/SVG text nodes so user rules or paths never break SVG rendering. */
export function escapeSvgText(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format large numbers compactly (e.g. 20100 -> "20.1k", 1420000 -> "1.42M"). */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (value >= 1_000) return value.toLocaleString('en-US');
  return String(Math.round(value));
}

/**
 * Compute an overall 0-100 Immunity Score from active rules, injections, and repeat failure rate.
 */
export function computeImmunityScore(input: WrappedInput): number {
  const calls = Math.max(1, input.totalCalls);
  const repeatRate = Math.min(1, Math.max(0, input.repeatFailures / calls));
  const baseFromLowRepeat = Math.round((1 - Math.min(1, repeatRate * 5)) * 55);
  const ruleMaturity = Math.min(25, Math.round(Math.log2(1 + Math.max(0, input.activeRules)) * 4.5));
  const deliveryProof = Math.min(20, Math.round(Math.log10(1 + Math.max(0, input.totalInjections)) * 5.2));
  return Math.max(10, Math.min(100, baseFromLowRepeat + ruleMaturity + deliveryProof));
}

/**
 * Render a shields.io-compatible flat SVG badge showing the live Immunity Score and active antibody count.
 */
export function renderImmunityBadgeSvg(input: WrappedInput): string {
  const score = computeImmunityScore(input);
  const color = score >= 85 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444';
  const leftText = 'agent-immune';
  const rightText = `${score}/100 · ${formatCompactNumber(input.activeRules)} rules`;
  const leftWidth = 92;
  const rightWidth = Math.max(96, rightText.length * 6 + 18);
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapeSvgText(`${leftText}: ${rightText}`)}">
  <title>${escapeSvgText(`${leftText}: ${rightText}`)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#1e293b"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${Math.round(leftWidth / 2)}" y="14">${escapeSvgText(leftText)}</text>
    <text x="${leftWidth + Math.round(rightWidth / 2)}" y="14" font-weight="bold">${escapeSvgText(rightText)}</text>
  </g>
</svg>`;
}

/**
 * Render a ready-to-paste GitHub Markdown scorecard snippet for READMEs, PR comments, and CI Step Summaries.
 */
export function renderWrappedMarkdown(input: WrappedInput): string {
  const score = computeImmunityScore(input);
  const grade = score >= 85 ? '🟢 High Immunity' : score >= 65 ? '🟡 Moderate Immunity' : '🔴 Building Immunity';
  const repeatPct =
    input.totalCalls > 0 ? `${((input.repeatFailures / input.totalCalls) * 100).toFixed(1)}%` : '0.0%';
  const nemeses = (input.topNemeses ?? []).slice(0, 3);
  const nemesisLines =
    nemeses.length > 0
      ? nemeses.map((n, idx) => `| #${idx + 1} | \`${n.label.replace(/\|/g, '\\|')}\` | ${formatCompactNumber(n.count)} |`).join('\n')
      : '| #1 | `(no recurring nemeses recorded)` | 0 |';

  return [
    `### 🛡️ Agent Pitfall Immunity Scorecard — **${score}/100** (${grade})`,
    '',
    '| Metric | Audited Value |',
    '| :--- | :--- |',
    `| **Active Antibodies** | **${formatCompactNumber(input.activeRules)}** rules (\`${formatCompactNumber(input.totalInjections)}\` preventive deliveries) |`,
    `| **Audited Tool Calls** | \`${formatCompactNumber(input.totalCalls)}\` calls (\`${formatCompactNumber(input.repeatFailures)}\` repeat pitfalls · \`${repeatPct}\`) |`,
    `| **Avoidable Retry Tokens** | \`${formatCompactNumber(input.avoidableTokens)}\` tokens |`,
    '',
    '#### Top Recurring Agent Nemeses',
    '',
    '| Rank | Failure Pattern | Occurrences |',
    '| :--- | :--- | :--- |',
    nemesisLines,
    '',
    '> Powered by [**agent-immune** (`dsh-immune-system`)](https://github.com/meat-daemon-404/agent-immune) — local SQLite + FTS5 self-evolving coding agent memory.',
    '',
  ].join('\n');
}

/**
 * Render a standalone 1200x630 SVG scorecard ready for GitHub READMEs, PRs, and X/Twitter.
 */
export function renderWrappedSvg(input: WrappedInput): string {
  const score = computeImmunityScore(input);
  const title = escapeSvgText(input.title ?? 'AGENT PITFALL IMMUNITY SCORECARD');
  const subtitle = escapeSvgText(
    input.subtitle ?? 'Local SQLite + FTS5 Self-Evolving Memory for Coding Agents',
  );
  const dateStr = escapeSvgText((input.generatedAt ?? new Date().toISOString()).slice(0, 10));
  const hosts = (input.hosts && input.hosts.length > 0
    ? input.hosts
    : ['Claude Code', 'Cursor', 'Codex', 'Windsurf', 'Zed', 'VS Code']
  )
    .slice(0, 6)
    .map(escapeSvgText)
    .join(' · ');

  const nemeses = (input.topNemeses && input.topNemeses.length > 0
    ? input.topNemeses
    : [
        { label: 'Edit: Target file not read in session before edit', count: 142 },
        { label: 'Bash: Interactive prompt / missing non-TTY flag', count: 98 },
        { label: 'TypeScript: Cross-OS path separator mismatch', count: 64 },
      ]
  ).slice(0, 3);

  const scoreColor = score >= 85 ? '#34d399' : score >= 65 ? '#fbbf24' : '#f87171';
  const repeatPct =
    input.totalCalls > 0 ? `${((input.repeatFailures / input.totalCalls) * 100).toFixed(1)}%` : '0.0%';

  const nemesisRows = nemeses
    .map((item, idx) => {
      const y = 418 + idx * 46;
      const label = escapeSvgText(item.label.length > 68 ? `${item.label.slice(0, 65)}...` : item.label);
      const count = escapeSvgText(`${formatCompactNumber(item.count)}x`);
      return `
    <g transform="translate(56, ${y})">
      <rect width="730" height="36" rx="8" fill="#111827" stroke="#1f2937" stroke-width="1"/>
      <text x="16" y="23" fill="#f87171" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">#${idx + 1}</text>
      <text x="48" y="23" fill="#e5e7eb" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">${label}</text>
      <text x="712" y="23" fill="#9ca3af" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" text-anchor="end">${count}</text>
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#030712"/>
      <stop offset="50%" stop-color="#0b1120"/>
      <stop offset="100%" stop-color="#091526"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="50%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="24" y="24" width="1152" height="582" rx="20" fill="none" stroke="#1e293b" stroke-width="2"/>
  <rect x="24" y="24" width="1152" height="6" rx="3" fill="url(#accent)"/>

  <!-- Header -->
  <text x="56" y="78" fill="#34d399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" font-weight="700" letter-spacing="2">${title}</text>
  <text x="56" y="114" fill="#f9fafb" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="30" font-weight="800">${subtitle}</text>
  <text x="56" y="142" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">Hosts: ${hosts}  ·  Snapshot: ${dateStr}</text>

  <!-- 4 KPI Cards -->
  <g transform="translate(56, 174)">
    <rect width="256" height="156" rx="14" fill="url(#card)" stroke="#1e293b" stroke-width="1.5"/>
    <text x="22" y="38" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="13" font-weight="600">AUDITED TOOL CALLS</text>
    <text x="22" y="96" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800">${escapeSvgText(formatCompactNumber(input.totalCalls))}</text>
    <text x="22" y="130" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">Across connected agent sessions</text>
  </g>

  <g transform="translate(332, 174)">
    <rect width="256" height="156" rx="14" fill="url(#card)" stroke="#1e293b" stroke-width="1.5"/>
    <text x="22" y="38" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="13" font-weight="600">REPEAT PITFALLS</text>
    <text x="22" y="96" fill="#f87171" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800">${escapeSvgText(formatCompactNumber(input.repeatFailures))}</text>
    <text x="22" y="130" fill="#fca5a5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">${escapeSvgText(repeatPct)} repeat failure ratio</text>
  </g>

  <g transform="translate(608, 174)">
    <rect width="256" height="156" rx="14" fill="url(#card)" stroke="#1e293b" stroke-width="1.5"/>
    <text x="22" y="38" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="13" font-weight="600">AVOIDABLE RETRY TOKENS</text>
    <text x="22" y="96" fill="#fbbf24" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800">${escapeSvgText(formatCompactNumber(input.avoidableTokens))}</text>
    <text x="22" y="130" fill="#fde68a" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">Burned in preventable loops</text>
  </g>

  <g transform="translate(884, 174)">
    <rect width="260" height="156" rx="14" fill="url(#card)" stroke="#10b981" stroke-width="1.5"/>
    <text x="22" y="38" fill="#6ee7b7" font-family="system-ui, sans-serif" font-size="13" font-weight="700">ACTIVE ANTIBODIES</text>
    <text x="22" y="96" fill="#34d399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800">${escapeSvgText(formatCompactNumber(input.activeRules))}</text>
    <text x="22" y="130" fill="#a7f3d0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">${escapeSvgText(formatCompactNumber(input.totalInjections))} preventive injections</text>
  </g>

  <!-- Nemeses List -->
  <text x="56" y="394" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14" font-weight="700" letter-spacing="1">TOP RECURRING AGENT NEMESES</text>
  ${nemesisRows}

  <!-- Immunity Score Badge -->
  <g transform="translate(824, 372)">
    <rect width="320" height="176" rx="16" fill="url(#card)" stroke="#1e293b" stroke-width="1.5"/>
    <text x="160" y="42" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="1.5">IMMUNITY SCORE</text>
    <text x="160" y="114" fill="${scoreColor}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="64" font-weight="800" text-anchor="middle">${score}<tspan font-size="26" fill="#64748b">/100</tspan></text>
    <text x="160" y="150" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" text-anchor="middle">npx dsh-immune-system wrapped</text>
  </g>

  <!-- Footer -->
  <text x="56" y="582" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">github.com/meat-daemon-404/agent-immune  ·  Zero-cloud SQLite + FTS5 pitfall memory</text>
  <text x="1144" y="582" fill="#34d399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" text-anchor="end">dsh-immune-system</text>
</svg>`;
}
