/**
 * Agent Pitfall Archetype & 5-Domain Immunity Radar Diagnosis (`immune diagnose`).
 *
 * Analyzes an agent's learned antibody library and failure distribution across
 * five engineering domains, assigns a vivid technical failure persona, and
 * prescribes a targeted seed-pack "booster shot" + 3-line system-prompt vaccine.
 */
const ARCHETYPES = {
    'blind-surgeon': {
        id: 'blind-surgeon',
        title: '⚡ The Blind Surgeon (Unread-File Mutator)',
        tagline: 'Operates on files before reading surrounding context or verifying exact line slices.',
        diagnosis: 'Your agent frequently triggers Edit/Write failures from stale line contexts, unverified file paths, or cross-OS path separators.',
        recommendedPacks: ['node-ts', 'dsh-ecosystem'],
        vaccinePrompt: 'VACCINE: Always Read target file lines in the current session before calling Edit/Write, and normalize path separators via path.posix/win32.',
    },
    'shell-trapper': {
        id: 'shell-trapper',
        title: '🐚 The Interactive Shell Trapper (Non-TTY Gambler)',
        tagline: 'Launches interactive CLI wizards and unguarded background daemons in non-TTY shells.',
        diagnosis: 'Your agent repeatedly hits hangs or non-zero exits on CLI tools expecting TTY input (prisma migrate dev, git rebase -i, npm init).',
        recommendedPacks: ['patrol-triage', 'docker'],
        vaccinePrompt: 'VACCINE: Always pass non-interactive flags (--yes, --non-interactive, CI=true) in Bash commands and never run interactive TUI pagers.',
    },
    'lockfile-rebel': {
        id: 'lockfile-rebel',
        title: '🔀 The Lockfile Rebel (Toolchain Anarchist)',
        tagline: 'Mixes npm, pnpm, yarn, pip, and uv across strictly locked workspaces.',
        diagnosis: 'Your agent triggers dependency drift by invoking the wrong package manager or mutating lockfiles without checking workspace markers first.',
        recommendedPacks: ['node-ts', 'python-uv', 'modern-web'],
        vaccinePrompt: 'VACCINE: Inspect lockfiles (pnpm-lock.yaml, uv.lock, Cargo.lock) before running package commands; never mix npm/pip into locked workspaces.',
    },
    'type-gladiator': {
        id: 'type-gladiator',
        title: '🦀 The Borrow & Type Gladiator (Compiler Brawler)',
        tagline: 'Fights the borrow checker, ESM .js imports, and typed-nil interfaces through brute-force retries.',
        diagnosis: 'Your agent burns tokens retrying compile/type errors (Rust E0502/Send, Go typed-nil, or TypeScript NodeNext .js extensions).',
        recommendedPacks: ['rust-cargo', 'go-mod', 'node-ts'],
        vaccinePrompt: 'VACCINE: Use explicit .js extensions in NodeNext TypeScript imports, avoid holding non-Send guards across .await, and check concrete nil before interface assignment.',
    },
    'env-drifter': {
        id: 'env-drifter',
        title: '🐳 The Environment Drifter (Container & Config Nomad)',
        tagline: 'Assumes local env vars, ports, and build contexts exist identically inside containers and SSR runtimes.',
        diagnosis: 'Your agent hits runtime crashes from uncopied Docker build artifacts, missing Vite loadEnv(), or Next.js App Router server/client boundaries.',
        recommendedPacks: ['docker', 'modern-web'],
        vaccinePrompt: 'VACCINE: Verify .dockerignore before COPY, use loadEnv() in vite.config.ts, and import useRouter from next/navigation in App Router.',
    },
    'immunized-sentinel': {
        id: 'immunized-sentinel',
        title: '🛡️ The Immunized Sentinel (Zero-Repeat Veteran)',
        tagline: 'Battle-hardened across all 5 engineering domains with high preventive recall coverage.',
        diagnosis: 'Your agent library has balanced, high-hit antibodies across filesystem, shell, toolchain, type-system, and Git/CI boundaries.',
        recommendedPacks: ['git-safety', 'patrol-triage'],
        vaccinePrompt: 'VACCINE: Maintain `.immune/rules.jsonl` via `immune team-sync` and enforce `immune ci-check` in CI to keep repeat pitfalls near 0%.',
    },
};
export function classifyRuleDomain(rule) {
    const tool = (rule.tool_name ?? '').toLowerCase();
    const text = `${rule.trigger_pattern} ${rule.symptom} ${rule.prescription}`.toLowerCase();
    if (/(?:git |rebase|force-with-lease|commit|branch|pre-commit|ci-check|github|pr |pull request)/.test(text)) {
        return 'git_ci';
    }
    if (/(?:cargo|rustc|e0502|borrow|tokio|goroutine|go\.mod|tsconfig|typescript|nodenext|\.d\.ts|type error)/.test(text)) {
        return 'types';
    }
    if (/(?:pnpm|yarn|npm install|uv |pip |venv|pyproject|requirements\.txt|lockfile|package\.json|vite|next\/|docker)/.test(text)) {
        return 'toolchain';
    }
    if (tool === 'edit' || tool === 'write' || /(?:read file|not read|path|enoent|eexist|indent|whitespace|win32|posix)/.test(text)) {
        return 'filesystem';
    }
    return 'shell';
}
function renderBar(pct, width = 12) {
    const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}
/**
 * Compute a full 5-domain radar breakdown and archetype diagnosis from a rule list.
 */
export function diagnoseAgentArchetype(rules) {
    const active = rules.filter((r) => !r.status || r.status === 'active');
    const counts = {
        filesystem: { rules: 0, hits: 0, fails: 0 },
        shell: { rules: 0, hits: 0, fails: 0 },
        toolchain: { rules: 0, hits: 0, fails: 0 },
        types: { rules: 0, hits: 0, fails: 0 },
        git_ci: { rules: 0, hits: 0, fails: 0 },
    };
    for (const r of active) {
        const dom = classifyRuleDomain(r);
        counts[dom].rules += 1;
        counts[dom].hits += Math.max(1, r.hit_count ?? 1);
        counts[dom].fails += Math.max(0, r.fail_count ?? 0);
    }
    const domainMeta = [
        { id: 'filesystem', label: 'Filesystem & Edit Precision' },
        { id: 'shell', label: 'Shell & Non-TTY Execution' },
        { id: 'toolchain', label: 'Toolchain & Lockfile Discipline' },
        { id: 'types', label: 'Type Systems & Compilation' },
        { id: 'git_ci', label: 'Git History & CI Safety' },
    ];
    const radar = domainMeta.map(({ id, label }) => {
        const c = counts[id];
        const coverageBoost = Math.min(60, Math.round(Math.log2(1 + c.rules) * 18));
        const hitProof = Math.min(35, Math.round(Math.log2(1 + c.hits) * 8));
        const failPenalty = Math.min(30, c.fails * 6);
        const immunityPct = Math.max(15, Math.min(99, 20 + coverageBoost + hitProof - failPenalty));
        return {
            id,
            label,
            ruleCount: c.rules,
            totalHits: c.hits,
            immunityPct,
        };
    });
    const totalHits = radar.reduce((s, a) => s + a.totalHits, 0);
    const overallImmunityPct = Math.round(radar.reduce((s, a) => s + a.immunityPct, 0) / Math.max(1, radar.length));
    const sortedByPressure = [...radar].sort((a, b) => b.totalHits - a.totalHits || a.immunityPct - b.immunityPct);
    const dominantDomain = sortedByPressure[0]?.id ?? 'filesystem';
    let archetypeId;
    if (active.length >= 18 && overallImmunityPct >= 82) {
        archetypeId = 'immunized-sentinel';
    }
    else if (dominantDomain === 'filesystem') {
        archetypeId = 'blind-surgeon';
    }
    else if (dominantDomain === 'shell') {
        archetypeId = 'shell-trapper';
    }
    else if (dominantDomain === 'toolchain') {
        archetypeId = 'lockfile-rebel';
    }
    else if (dominantDomain === 'types') {
        archetypeId = 'type-gladiator';
    }
    else {
        archetypeId = 'env-drifter';
    }
    return {
        activeRules: active.length,
        totalHits,
        overallImmunityPct,
        dominantDomain,
        archetype: ARCHETYPES[archetypeId],
        radar,
    };
}
/** Render a terminal-friendly diagnostic card with ASCII radar bars. */
export function renderDiagnosisTerminal(report) {
    const lines = [
        `╔══════════════════════════════════════════════════════════════════════════╗`,
        `║  🧬 AGENT PITFALL ARCHETYPE & 5-DOMAIN IMMUNITY RADAR                   ║`,
        `╚══════════════════════════════════════════════════════════════════════════╝`,
        `  Persona       : ${report.archetype.title}`,
        `  Tagline       : ${report.archetype.tagline}`,
        `  Overall Radar : ${renderBar(report.overallImmunityPct, 16)} ${report.overallImmunityPct}% (${report.activeRules} rules · ${report.totalHits} hits)`,
        '',
        `  5-Domain Immunity Breakdown:`,
    ];
    for (const axis of report.radar) {
        const labelPad = axis.label.padEnd(33);
        const bar = renderBar(axis.immunityPct, 12);
        const pctPad = `${axis.immunityPct}%`.padStart(4);
        lines.push(`    • ${labelPad} ${bar} ${pctPad}  (${axis.ruleCount} rules, ${axis.totalHits} hits)`);
    }
    lines.push('', `  Clinical Diagnosis:`, `    ${report.archetype.diagnosis}`, '', `  Recommended Booster Shot:`, `    $ npx dsh-immune-system seed ${report.archetype.recommendedPacks.join(' ')}`, '', `  System-Prompt Vaccine:`, `    ${report.archetype.vaccinePrompt}`, '');
    return lines.join('\n');
}
/** Render a shareable GitHub Markdown diagnostic report. */
export function renderDiagnosisMarkdown(report) {
    const rows = report.radar
        .map((a) => `| **${a.label}** | \`${renderBar(a.immunityPct, 10)}\` **${a.immunityPct}%** | ${a.ruleCount} | ${a.totalHits} |`)
        .join('\n');
    return [
        `### 🧬 Agent Pitfall Archetype: **${report.archetype.title}**`,
        '',
        `> *${report.archetype.tagline}*`,
        '',
        `- **Overall Domain Immunity**: **${report.overallImmunityPct}%** (\`${report.activeRules}\` active antibodies · \`${report.totalHits}\` intercepted pitfalls)`,
        `- **Clinical Diagnosis**: ${report.archetype.diagnosis}`,
        `- **Recommended Seed Booster**: \`npx dsh-immune-system seed ${report.archetype.recommendedPacks.join(' ')}\``,
        '',
        '| Engineering Domain | Immunity Radar | Active Rules | Prevented Hits |',
        '| :--- | :--- | :--- | :--- |',
        rows,
        '',
        '#### 💉 Prescribed System-Prompt Vaccine',
        '',
        '```text',
        report.archetype.vaccinePrompt,
        '```',
        '',
    ].join('\n');
}
function escXml(raw) {
    return String(raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Render a standalone 880x440 dark-mode SVG card for the Agent Pitfall Archetype & 5-Domain Radar. */
export function renderDiagnosisSvg(report) {
    const rows = report.radar
        .map((axis, idx) => {
        const y = 172 + idx * 38;
        const barWidth = Math.max(12, Math.round((axis.immunityPct / 100) * 320));
        const color = axis.immunityPct >= 80 ? '#34d399' : axis.immunityPct >= 60 ? '#38bdf8' : '#fbbf24';
        return `
    <g transform="translate(40, ${y})">
      <text x="0" y="16" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">${escXml(axis.label)}</text>
      <rect x="280" y="2" width="320" height="16" rx="8" fill="#1e293b"/>
      <rect x="280" y="2" width="${barWidth}" height="16" rx="8" fill="${color}"/>
      <text x="616" y="16" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">${axis.immunityPct}%</text>
      <text x="670" y="16" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">(${axis.ruleCount}r · ${axis.totalHits}h)</text>
    </g>`;
    })
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 440" width="880" height="440" role="img" aria-label="${escXml(report.archetype.title)}">
  <defs>
    <linearGradient id="dbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#030712"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="880" height="440" rx="18" fill="url(#dbg)" stroke="#1e293b" stroke-width="2"/>
  <text x="40" y="48" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700" letter-spacing="1.5">AGENT PITFALL ARCHETYPE &amp; 5-DOMAIN IMMUNITY RADAR</text>
  <text x="40" y="82" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="800">${escXml(report.archetype.title)}</text>
  <text x="40" y="108" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14">${escXml(report.archetype.tagline)}</text>
  <text x="40" y="146" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">Overall Domain Immunity: ${report.overallImmunityPct}% (${report.activeRules} active rules · ${report.totalHits} intercepted pitfalls)</text>
  ${rows}
  <rect x="40" y="370" width="800" height="44" rx="8" fill="#111827" stroke="#1f2937"/>
  <text x="54" y="397" fill="#a7f3d0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${escXml(report.archetype.vaccinePrompt.slice(0, 108))}</text>
</svg>`;
}
