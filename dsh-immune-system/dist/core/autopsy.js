/**
 * Forensic Session Autopsy & Token Burn Ledger (`immune autopsy`).
 *
 * Translates raw SQLite antibody counters into human-meaningful engineering
 * metrics: prevented debug loops, rescued tokens, estimated frontier API dollar
 * savings, minutes of developer life reclaimed from watching terminal spinners,
 * forensic root-cause distribution, and fragile scars that models still ignore.
 */
import { classifyRuleDomain } from './diagnose.js';
import { formatCompactNumber } from './wrapped.js';
const CAUSE_TITLES = {
    filesystem: 'Context Amnesia (Mutating files before reading)',
    shell: 'Non-TTY CLI Traps (Interactive prompts & flags)',
    toolchain: 'Lockfile & Package Manager Drift (npm vs pnpm/uv)',
    types: 'Compiler & Borrow-Checker Brawls (E0502 / NodeNext / nil)',
    git_ci: 'Git History & CI GateCollisions (--force / hooks)',
};
/**
 * Run a forensic post-mortem autopsy over a project's antibody library.
 */
export function runPitfallAutopsy(rules, opts = {}) {
    const tokensPerLoop = opts.tokensPerLoop ?? 2400;
    const usdPerMillion = opts.usdPerMillionTokens ?? 15;
    const secondsPerLoop = opts.secondsPerLoop ?? 45;
    const active = rules.filter((r) => !r.status || r.status === 'active');
    const savedLoops = active.reduce((sum, r) => sum + Math.max(0, r.hit_count ?? 0), 0);
    const tokensRescued = savedLoops * tokensPerLoop;
    const usdSaved = Number(((tokensRescued / 1_000_000) * usdPerMillion).toFixed(2));
    const minutesReclaimed = Math.round((savedLoops * secondsPerLoop) / 60);
    const byDomain = {
        filesystem: { loops: 0, example: null },
        shell: { loops: 0, example: null },
        toolchain: { loops: 0, example: null },
        types: { loops: 0, example: null },
        git_ci: { loops: 0, example: null },
    };
    const fragileScars = [];
    for (const r of active) {
        const dom = classifyRuleDomain(r);
        const hits = Math.max(0, r.hit_count ?? 0);
        const fails = Math.max(0, r.fail_count ?? 0);
        byDomain[dom].loops += hits;
        if (!byDomain[dom].example && r.trigger_pattern.trim()) {
            byDomain[dom].example = r.trigger_pattern.trim();
        }
        if (fails > 0) {
            const total = Math.max(1, hits + fails);
            const survivalPct = Math.round((hits / total) * 100);
            const clinicalAction = fails >= 2
                ? 'Escalate to [CRITICAL] salience or run `immune rewrite` to sharpen imperative verb'
                : 'Monitor next delivery; narrow trigger tokens if recalled out-of-scope';
            fragileScars.push({
                trigger_pattern: r.trigger_pattern,
                prescription: r.prescription,
                hits,
                fails,
                survivalPct,
                clinicalAction,
            });
        }
    }
    fragileScars.sort((a, b) => b.fails - a.fails || a.survivalPct - b.survivalPct);
    const buckets = Object.keys(CAUSE_TITLES)
        .map((domain) => ({
        domain,
        causeTitle: CAUSE_TITLES[domain],
        savedLoops: byDomain[domain].loops,
        tokensRescued: byDomain[domain].loops * tokensPerLoop,
        exampleTrigger: byDomain[domain].example,
    }))
        .sort((a, b) => b.savedLoops - a.savedLoops);
    const narrative = savedLoops > 0
        ? `Your agent has intercepted ${formatCompactNumber(savedLoops)} repeat pitfall encounters across ${active.length} active scar-tissue rules — rescuing ~${formatCompactNumber(tokensRescued)} retry tokens (~$${usdSaved.toFixed(2)} in frontier API burn and ~${minutesReclaimed} min of staring at terminal spinners).`
        : `Your library currently holds ${active.length} active antibodies with 0 recorded intercepts yet. Run \`npx dsh-immune-system audit\` or \`npx dsh-immune-system seed\` to pre-immunize your workspace.`;
    return {
        activeRules: active.length,
        savedLoops,
        tokensRescued,
        usdSaved,
        minutesReclaimed,
        narrative,
        buckets,
        fragileScars: fragileScars.slice(0, 5),
    };
}
/** Render a candid, human-readable terminal autopsy report. */
export function renderAutopsyTerminal(report) {
    const lines = [
        `╔══════════════════════════════════════════════════════════════════════════╗`,
        `║  🔬 FORENSIC PITFALL AUTOPSY & TOKEN BURN LEDGER                         ║`,
        `╚══════════════════════════════════════════════════════════════════════════╝`,
        `  ${report.narrative}`,
        '',
        `  💰 Reclaimed Engineering ROI:`,
        `    • Prevented Retry Loops   : ${formatCompactNumber(report.savedLoops)} loops`,
        `    • Rescued Context Tokens  : ${formatCompactNumber(report.tokensRescued)} tokens`,
        `    • Est. Frontier API Saved : $${report.usdSaved.toFixed(2)} USD`,
        `    • Human Spinner Time Saved: ~${report.minutesReclaimed} minutes`,
        '',
        `  🧬 Root-Cause Autopsy Breakdown:`,
    ];
    for (const b of report.buckets) {
        const ex = b.exampleTrigger ? ` (e.g. "${b.exampleTrigger.slice(0, 34)}")` : '';
        lines.push(`    • ${b.causeTitle.padEnd(50)} ${String(b.savedLoops).padStart(4)}x  (~${formatCompactNumber(b.tokensRescued)} tok)${ex}`);
    }
    if (report.fragileScars.length > 0) {
        lines.push('', `  🩹 Fragile Scars (Rules Still Ignored or Failing Post-Injection):`);
        for (const f of report.fragileScars) {
            lines.push(`    • [${f.survivalPct}% survival · ${f.hits} hits / ${f.fails} fails] ${f.trigger_pattern}`, `      Rx: ${f.clinicalAction}`);
        }
    }
    else {
        lines.push('', `  ✅ Zero Fragile Scars: Every injected antibody held up without post-delivery failure.`);
    }
    lines.push('');
    return lines.join('\n');
}
/** Render a shareable GitHub Markdown autopsy report. */
export function renderAutopsyMarkdown(report) {
    const bucketRows = report.buckets
        .map((b) => `| **${b.causeTitle}** | \`${formatCompactNumber(b.savedLoops)}x\` | \`~${formatCompactNumber(b.tokensRescued)}\` | ${b.exampleTrigger ? `\`${b.exampleTrigger.replace(/\|/g, '\\|')}\`` : '—'} |`)
        .join('\n');
    const lines = [
        `### 🔬 Forensic Pitfall Autopsy & Token Burn Ledger`,
        '',
        `> ${report.narrative}`,
        '',
        '| ROI Dimension | Audited Savings |',
        '| :--- | :--- |',
        `| **Prevented Debug Loops** | **${formatCompactNumber(report.savedLoops)}** repeat failures intercepted |`,
        `| **Rescued Retry Tokens** | \`~${formatCompactNumber(report.tokensRescued)}\` tokens |`,
        `| **Est. Frontier API Burn Saved** | **$${report.usdSaved.toFixed(2)} USD** |`,
        `| **Developer Spinner Time Reclaimed** | **~${report.minutesReclaimed} minutes** |`,
        '',
        '#### 🧬 Forensic Root-Cause Distribution',
        '',
        '| Failure Root Cause | Intercepted Loops | Tokens Rescued | Signature Trigger |',
        '| :--- | :--- | :--- | :--- |',
        bucketRows,
        '',
    ];
    if (report.fragileScars.length > 0) {
        lines.push('#### 🩹 Fragile Scars Watchlist (Post-Injection Relapses)', '', '| Trigger | Survival Rate | Hits / Fails | Clinical Recommendation |', '| :--- | :--- | :--- | :--- |', ...report.fragileScars.map((f) => `| \`${f.trigger_pattern.replace(/\|/g, '\\|')}\` | **${f.survivalPct}%** | ${f.hits} / ${f.fails} | ${f.clinicalAction} |`), '');
    }
    return lines.join('\n');
}
