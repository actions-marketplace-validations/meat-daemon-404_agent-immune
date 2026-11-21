const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
/** Terminal columns a string occupies; CJK glyphs are double width. */
export function width(text) {
    let total = 0;
    for (const ch of text)
        total += WIDE.test(ch) ? 2 : 1;
    return total;
}
export function pad(value, columns) {
    const used = width(value);
    return used >= columns ? value : value + ' '.repeat(columns - used);
}
/** Clamp to a column budget without splitting a double-width glyph. */
export function clamp(value, columns) {
    if (width(value) <= columns)
        return value;
    let out = '';
    let used = 0;
    for (const ch of value) {
        const w = WIDE.test(ch) ? 2 : 1;
        if (used + w > columns - 1)
            break;
        out += ch;
        used += w;
    }
    return `${out}…`;
}
export function parseSeedCliArgs(args, valueFlags) {
    const valueSet = new Set(valueFlags);
    const positional = [];
    const values = new Map();
    const booleans = new Set();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === undefined)
            continue;
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf('=');
        if (eq > 0) {
            const flag = arg.slice(0, eq);
            if (valueSet.has(flag))
                values.set(flag, arg.slice(eq + 1));
            continue;
        }
        if (valueSet.has(arg) && i + 1 < args.length) {
            const nextVal = args[++i];
            if (nextVal !== undefined)
                values.set(arg, nextVal);
            continue;
        }
        booleans.add(arg);
    }
    return { positional, values, booleans };
}
/** Read `--flag value` or `--flag=value`; stops scanning past `--` separator. */
export function flagValue(args, flag) {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === undefined)
            continue;
        if (arg === '--')
            break;
        if (arg.startsWith(prefix)) {
            const val = arg.slice(prefix.length).trim();
            return val.length > 0 ? val : undefined;
        }
        if (arg === flag) {
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith('--') && next.trim().length > 0) {
                return next.trim();
            }
            return undefined;
        }
    }
    return undefined;
}
/**
 * Extract positional arguments while skipping known value-taking flags
 * (`--flag value` and `--flag=value`) and honoring `--` end-of-options.
 */
export function positionalArgs(args, valueFlags = []) {
    const valueSet = new Set(valueFlags);
    const out = [];
    let afterSep = false;
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === undefined)
            continue;
        if (afterSep) {
            out.push(arg);
            continue;
        }
        if (arg === '--') {
            afterSep = true;
            continue;
        }
        if (arg.startsWith('-')) {
            const eq = arg.indexOf('=');
            if (eq < 0 && valueSet.has(arg)) {
                const next = args[i + 1];
                if (next !== undefined && !next.startsWith('--')) {
                    i += 1;
                }
            }
            continue;
        }
        out.push(arg);
    }
    return out;
}
export function hasHelpFlag(args) {
    return args.includes('--help') || args.includes('-h');
}
function useColor() {
    return Boolean(process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb');
}
export const style = {
    bold: (s) => (useColor() ? `\x1b[1m${s}\x1b[22m` : s),
    dim: (s) => (useColor() ? `\x1b[2m${s}\x1b[22m` : s),
    cyan: (s) => (useColor() ? `\x1b[36m${s}\x1b[39m` : s),
    green: (s) => (useColor() ? `\x1b[32m${s}\x1b[39m` : s),
    yellow: (s) => (useColor() ? `\x1b[33m${s}\x1b[39m` : s),
};
const COMMAND_HELP = {
    demo: 'immune demo\n  Run an end-to-end distill -> score -> recall -> inject simulation entirely in memory.',
    mcp: 'immune mcp\n  Start the zero-dependency JSON-RPC 2.0 MCP server over stdio (27 tools, 5 live resources, 3 workflow prompts).',
    connect: 'immune connect [host] [--status] [--refresh] [--remove] [--json]\n' +
        '  Auto-detect and wire coding agents (claude-code, codex, antigravity, gemini-cli, cursor, vscode, windsurf, zed, roo-code, claude-desktop, cline, opencode, kiro).\n' +
        '  With no host, wires all detected agents. Pass --remove to uninstall cleanly.',
    doctor: 'immune doctor [--json]\n  Verify Node engine, SQLite+FTS5 trigram/CJK, hook paths, hygiene, and drain budget.',
    ui: 'immune ui [--port <port>]\n  Start the local-only offline Web Dashboard on 127.0.0.1 (default port 7788).',
    list: 'immune list [--all] [--json]\n  List active pitfall antibodies (--all includes retired and quarantined rows).',
    search: 'immune search <query>\n  Read-only FTS5 + bilingual concept search without inflating hit counters.',
    explain: 'immune explain "<query>" [--tool Bash|Edit] [--limit 5] [--json]\n  Read-only recall simulator: inspect concept expansions, score breakdowns, and rendered <immune_memory>.',
    learn: 'immune learn <trigger> [symptom] <prescription>\n  Teach a rule directly with human provenance.',
    forget: 'immune forget <id> | --last | --prune | --purge\n  Delete or retire rules by ID, newest active, or 14-day zero-hit zombies.',
    stats: 'immune stats [--json]\n  Show rule counts, deliveries, model survival breakdown, and avoided token estimates.',
    hygiene: 'immune hygiene [--dry-run] [--json]\n  Score rules on the 5-dim rubric, abstract paths, lock workspace scope, and quarantine dumps.',
    triage: 'immune triage [--json]\n  Show Red-3 failure triage buckets (flake, scope leak, ignored-by-agent, stale advice).',
    receipts: 'immune receipts [--json]\n  Verify the tamper-evident SHA-256 delivery receipt hash chain.',
    models: 'immune models [--json]\n  Show per-model rule survival rates, adaptive escalations, and Magpie gateway telemetry.',
    coverage: 'immune coverage [--days <n>] [--top <n>] [--db <path>] [--json]\n  Compare host failure history against known vs injected vs uncovered clusters.',
    detours: 'immune detours\n  List sessions that probed the same target 4+ times read-only before fixing.',
    rewrite: 'immune rewrite [--dry-run] [--max <n>] [--id <a,b>]\n  Rewrite echo-grade command dumps into concise imperative advice via configured LLM.',
    consolidate: 'immune consolidate [--dry-run]\n  Merge near-duplicate rules (>=70% similarity, shared trigger & symptom) while preserving counters.',
    seed: 'immune seed [<pack>] [--baseline widely|newly] [--remove]\n  List or install 12 builtin starter packs (git-safety, node-ts, python-uv, rust-cargo, go-mod, docker, modern-web, dsh-ecosystem, patrol-triage, sql-migrations, nextjs-react, windows-shell).',
    'ingest-skill': 'immune ingest-skill <path...> [--pack <name>] [--baseline widely|newly] [--remove]\n  Index external SKILL.md / Markdown playbooks into FTS5 for zero-bloat on-demand recall.',
    'ingest-disk': 'immune ingest-disk [<root...>] [--dry-run] [--depth <n>] [--max-projects <n>] [--max-rules <n>] [--no-codex-skills]\n  Discover repositories & skills under root directories (defaults to cwd) and extract scoped/universal rules.',
    workspaces: 'immune workspaces [--json]\n  List discovered workspace profiles, tech stacks, Baselines, and rule counts.',
    audit: 'immune audit [--dry-run] [--days <n>|--all-time] [--source auto|zcode|codex|claude-code|antigravity] [--max <n>] [--budget-ms <n>] [--magpie] [--no-llm] [--json]\n  Replay local agent histories to surface repeat failure families and bootstrap rules.',
    backfill: 'immune backfill [--days <n>] [--max <n>] [--budget-ms <n>] [--session <id>] [--no-llm] [--db <path>]\n  Backfill historical ZCode episodes into the library.',
    export: 'immune export [minHits] [outPath]\n  Export proven share-safe rules (default hits >= 3) as a portable SKILL.md.',
    'export-json': 'immune export-json [outPath]\n  Export a share-gated JSON library snapshot for team or cross-machine sync.',
    'import-json': 'immune import-json <snapshot.json>\n  Merge a JSON library snapshot into the current database.',
    'sync-doc': 'immune sync-doc [--out <file>] [--min-hits <n>]\n  Sync proven rules into AGENTS.md (or existing CLAUDE.md) inside <!-- immune:generated --> markers.',
    guard: 'immune guard "<command>" [--tool Bash|Edit|Write] [--strict] [--hook] [--hook-host claude-code|cursor|antigravity|gemini-cli|generic] [--markdown] [--json]\n  immune guard --log [--limit N] [--json]\n  Pre-flight blast-radius interceptor: score (0-100), block, or safely rewrite destructive agent commands, or audit recent live interceptions.',
    vaccinate: 'immune vaccinate [--check] [--apply] [--refresh] [--lockfile <path>] [--markdown] [--json]\n  Scan Workspace DNA manifests and compile, verify, or apply a declarative .immune/vaccine.lock.json for zero-shot immunity.',
    federate: 'immune federate [<rules.jsonl...>] [--out <bundle.jsonl>] [--min-consensus <0-100>] [--svg] [--markdown] [--json]\n  Federate antibodies across workspaces/agents and promote corroborated clusters into Universal Swarm Laws.',
    autopsy: 'immune autopsy [--markdown] [--json]\n  Run a forensic post-mortem on prevented debug loops, rescued tokens, API dollar savings, and fragile scars.',
    diagnose: 'immune diagnose [--svg] [--out <file>] [--markdown] [--json]\n  Analyze your agent failure persona, 5-domain immunity radar, and prescribed seed booster + prompt vaccine.',
    'compile-rules': 'immune compile-rules [--target all|cursor|copilot|windsurf|cline|claude] [--min-hits <n>] [--dry-run] [--json]\n  Transpile learned SQLite antibodies into native Cursor .mdc rules (with inferred file globs), Copilot, Windsurf, Cline, and CLAUDE.md.',
    wrapped: 'immune wrapped [out.svg] [--out <file>] [--hosts <a,b>] [--badge] [--markdown] [--stdout] [--json]\n  Render a 1200x630 dark-mode Pitfall Scorecard SVG, shields.io badge, or Markdown summary with your Immunity Score (0-100).',
    'team-sync': 'immune team-sync [file] [--path <file>] [--import | --check | --dedupe] [--min-hits <n>] [--json]\n  Export, import, validate, or heal Git-native deterministically sorted team rules (.immune/rules.jsonl).',
    'ci-check': 'immune ci-check [--diff <patch>] [--doc <file>] [--json] [--github] [--warn-only]\n  Stateless PR gate: scan git diff added lines against committed AGENTS.md / CLAUDE.md pitfall rules.',
    'git-hook': 'immune git-hook [--install | --remove | --status] [--warn-only] [--json]\n  Install or remove a non-destructive .git/hooks/pre-commit pitfall scanner over staged diffs.',
    completions: 'immune completions <bash|zsh|fish|powershell>\n  Print a shell tab-completion script for immune and dsh-immune-system.',
    backup: 'immune backup [outPath]\n  Write a consistent SQLite WAL backup snapshot via node:sqlite backup API.',
    prune: 'immune prune\n  Clean expired pending failure states and session injection windows.',
};
export function renderCommandHelp(command) {
    const entry = COMMAND_HELP[command];
    return entry ? `${entry}\n` : null;
}
export function renderMainHelp(version) {
    const h = (text) => style.bold(style.cyan(text));
    const c = (cmd) => style.green(cmd.padEnd(28));
    return [
        `${style.bold('agent-immune')} (${style.dim(`dsh-immune-system v${version}`)}) — Self-evolving pitfall immunity for coding agents`,
        '',
        `${h('Usage')}`,
        `  immune <command> [options]`,
        `  npx dsh-immune-system <command> [options]`,
        '',
        `${h('Quickstart & Hosts')}`,
        `  ${c('demo')}Run a 30-second in-memory distill -> recall -> inject showcase`,
        `  ${c('mcp')}Start the stdio JSON-RPC 2.0 MCP server (26 tools, zero deps)`,
        `  ${c('connect [host]')}Wire hooks/MCP into 11 hosts (Claude Code, Codex, Cursor, Antigravity, VS Code, Zed, ...)`,
        `  ${c('doctor')}Verify Node engine, SQLite+FTS5, hook paths, hygiene & budgets`,
        `  ${c('ui [--port 7788]')}Launch the local-only offline Web Dashboard (127.0.0.1)`,
        '',
        `${h('Inspect & Manage Library')}`,
        `  ${c('list [--all]')}List learned antibodies (--all includes retired & quarantined)`,
        `  ${c('search <query>')}Search antibodies read-only without inflating hit counts`,
        `  ${c('explain "<query>"')}Simulate recall & inspect scoring weights read-only`,
        `  ${c('learn <trig> [sym] <do>')}Teach a pitfall rule directly`,
        `  ${c('forget <id>|--last|--prune')}Remove a rule or retire/purge zero-hit zombies`,
        `  ${c('stats')}Deliveries, model survival breakdown & avoided token estimate`,
        '',
        `${h('Quality, Triage & Telemetry (v2)')}`,
        `  ${c('hygiene [--dry-run]')}Score rules (0-100), abstract paths, scope tactics & quarantine dumps`,
        `  ${c('triage')}Inspect Red-3 failure triage buckets & escalated rules`,
        `  ${c('receipts')}Verify the SHA-256 tamper-evident delivery receipt chain`,
        `  ${c('models')}Per-model survival rates & local Magpie gateway analytics`,
        `  ${c('coverage [--days 30]')}Find uncovered failure blind spots in host logs`,
        `  ${c('rewrite / consolidate')}Rewrite command dumps via LLM or merge duplicate lessons`,
        '',
        `${h('Cold-Start, Team Sync & CI Gate')}`,
        `  ${c('audit [--dry-run]')}Mine ZCode, Codex, Claude Code & Antigravity history for pitfalls`,
        `  ${c('seed [<pack>]')}Install 9 builtin packs (git-safety, node-ts, python-uv, rust-cargo, go-mod, ...)`,
        `  ${c('ingest-skill <path...>')}Index SKILL.md / Markdown playbooks on demand into FTS5`,
        `  ${c('ingest-disk [<root...>]')}Discover repos & skills and extract scoped/universal rules`,
        `  ${c('guard "<command>"')}Pre-flight blast-radius guard & automatic safe command rewriter (v3.0)`,
        `  ${c('vaccinate [--apply]')}Compile Workspace DNA into a zero-shot .immune/vaccine.lock.json (v3.0)`,
        `  ${c('federate [<files...>]')}Federate multi-repo swarm antibodies into Universal Swarm Laws (v3.0)`,
        `  ${c('diagnose [--markdown]')}Diagnose agent failure archetype, 5-domain radar & prompt vaccine`,
        `  ${c('autopsy [--markdown]')}Forensic post-mortem on rescued tokens, API $ saved & fragile scars`,
        `  ${c('compile-rules [--target]')}Transpile rules to Cursor .mdc, Copilot, Windsurf, Cline & CLAUDE.md`,
        `  ${c('wrapped [out.svg]')}Render a shareable 1200x630 SVG Pitfall Scorecard & Immunity Score`,
        `  ${c('team-sync [--import]')}Sync Git-native zero-conflict .immune/rules.jsonl across branches`,
        `  ${c('sync-doc / export')}Sync rules into AGENTS.md / CLAUDE.md or export SKILL.md`,
        `  ${c('ci-check [--github]')}Scan PR diffs against committed pitfall rules (GitHub Actions ready)`,
        `  ${c('git-hook [--install]')}Wire a non-destructive local .git/hooks/pre-commit pitfall gate`,
        `  ${c('completions <shell>')}Output shell completions (bash, zsh, fish, powershell)`,
        `  ${c('backup [path]')}Consistent WAL-safe SQLite snapshot`,
        '',
        `${style.dim('Run `immune <command> --help` for command-specific flags, or `--json` on read commands.')}`,
        '',
    ].join('\n');
}
