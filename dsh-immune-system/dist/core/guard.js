/**
 * v3.0 Pre-Flight Blast-Radius Guard & Destructive Command Interceptor (`immune guard`).
 *
 * Evaluates proposed agent tool invocations (Bash, Edit, Write, Git, SQL)
 * BEFORE execution against built-in catastrophic blast-radius signatures,
 * workspace lockfile constraints, and high-confidence learned antibodies.
 * Computes a 0-100 Blast-Radius Score, emits a deterministic safe command
 * rewrite when possible, and formats hook protocol decisions for Claude Code,
 * Cursor, Codex, and CI gates.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.js';
import { signals } from './relevance.js';
import { cjkBigrams } from './store/tokenize.js';
import { isShellToolName } from './tools.js';
import { packageVersion } from './version.js';
const MAX_GUARD_PAYLOAD_LEN = 8192;
function isShellTool(toolName) {
    return isShellToolName(toolName);
}
/** Lightweight lockfile probe (<0.05 ms) for live PreToolUse lockfile-drift guard. */
export function detectWorkspacePackageManager(workspace) {
    if (!workspace)
        return null;
    try {
        if (existsSync(join(workspace, 'pnpm-lock.yaml')))
            return 'pnpm';
        if (existsSync(join(workspace, 'yarn.lock')))
            return 'yarn';
        if (existsSync(join(workspace, 'bun.lock')) || existsSync(join(workspace, 'bun.lockb')))
            return 'bun';
        if (existsSync(join(workspace, 'uv.lock')))
            return 'uv';
    }
    catch {
        // Ignore unreadable directories.
    }
    return null;
}
const NON_SQL_PROSE_CMD = /^\s*(?:git\s+(?:commit|tag|log|notes|branch)\b|grep\b|egrep\b|fgrep\b|rg\b|ag\b|ack\b|findstr\b|Select-String\b|echo\b|printf\b|Write-Output\b)/i;
const SQL_DDL_RE = /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)\s+(?:IF\s+EXISTS\s+)?[`"'\w]|TRUNCATE\s+(?:TABLE\s+)?[`"'\w])/i;
/** Mask single/double-quoted string bodies with spaces so flag checks ignore commit messages. */
function maskQuotedText(input) {
    return input.replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);
}
function escapeMdCell(value) {
    return value.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|').trim();
}
export const BUILTIN_GUARD_POLICIES = [
    {
        id: 'destructive-rm-root',
        title: 'Catastrophic Recursive Delete (Root / Home / .git)',
        severity: 'critical',
        blastRadiusScore: 100,
        defaultDecision: 'block',
        shellOnly: true,
        pattern: /\brm\s+(?:-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)[a-zA-Z]*|(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive)\s+(?:-[a-zA-Z]*f[a-zA-Z]*|--force)|(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\s+(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive))(?:\s+--no-preserve-root)?\s+["']?(?:\/\*?|~\/?\*?|\$\{?HOME\}?\/?\*?|\.git\/?|\*)["']?(?=$|[\s;&|\r\n])/i,
        reason: 'Recursive forced deletion targeting root (/), home (~), wildcard (*), or .git repository metadata.',
        prescription: 'Scope deletion to a verified build subdir (e.g. rm -rf ./dist) after checking git status.',
    },
    {
        id: 'git-force-push',
        title: 'Unleased Force Push Overwriting Remote History',
        severity: 'high',
        blastRadiusScore: 88,
        defaultDecision: 'rewrite',
        shellOnly: true,
        pattern: /\bgit(?:\s+-C\s+\S+)?\s+push\b[^\r\n;&|]*?\s(?:--force(?!-)|-f)(?=$|[\s;&|\r\n])/i,
        reason: 'Raw git push --force overwrites remote commits pushed by teammates or CI workflows.',
        prescription: 'Use git push --force-with-lease so Git aborts if the remote ref advanced.',
        rewrite: (payload) => payload.replace(/\bgit(?:\s+-C\s+\S+)?\s+push\b[^\r\n;&|]*/gi, (seg) => {
            if (/--force-with-lease/i.test(seg))
                return seg;
            return seg.replace(/\s(?:--force(?!-)|-f)(?=$|[\s;&|\r\n])/gi, ' --force-with-lease');
        }),
    },
    {
        id: 'git-reset-hard',
        title: 'Unstashed git reset --hard Working-Tree Wipe',
        severity: 'high',
        blastRadiusScore: 82,
        defaultDecision: 'rewrite',
        shellOnly: true,
        pattern: /\bgit(?:\s+-C\s+\S+)?\s+reset\b[^\r\n;&|]*\s--hard\b/i,
        negativePattern: /\bgit\s+stash(?:\s+(?:push|save)\b|\s*(?:&&|;|\r?\n|$))/i,
        reason: 'git reset --hard permanently destroys uncommitted working-tree and staged changes.',
        prescription: 'Snapshot dirty state with git stash push -u before running git reset --hard.',
        rewrite: (payload) => {
            const replacement = 'git stash push -u -m "immune-pre-reset" && $&';
            const re = /\bgit(?:\s+-C\s+\S+)?\s+reset\b[^\r\n;&|]*\s--hard\b[^\r\n;&|]*/i;
            if (/\|\|/.test(payload)) {
                return payload.replace(re, `( ${replacement} )`);
            }
            return payload.replace(re, replacement);
        },
    },
    {
        id: 'git-clean-force',
        title: 'Destructive Untracked File Deletion (git clean -f)',
        severity: 'high',
        blastRadiusScore: 78,
        defaultDecision: 'warn',
        shellOnly: true,
        pattern: /\bgit(?:\s+-C\s+\S+)?\s+clean\b[^\r\n;&|]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force\b)/i,
        negativePattern: /\bgit(?:\s+-C\s+\S+)?\s+clean\b[^\r\n;&|]*(?:\s-[a-zA-Z]*n[a-zA-Z]*\b|\s--dry-run\b)/i,
        reason: 'git clean -f permanently deletes untracked files (and -x deletes ignored .env/build artifacts).',
        prescription: 'Preview deletions with git clean -n or git status before cleaning specific paths.',
    },
    {
        id: 'git-discard-worktree',
        title: 'Whole-Worktree Discard (git checkout / restore .)',
        severity: 'high',
        blastRadiusScore: 76,
        defaultDecision: 'warn',
        shellOnly: true,
        pattern: /\bgit(?:\s+-C\s+\S+)?\s+(?:checkout|restore)(?:\s+--)?\s+\.(?=$|[\s"'&;|\r\n])/i,
        reason: 'git checkout/restore . discards every unstaged edit across the entire repository.',
        prescription: 'Run git stash push -u first, or restore only a specific file via git restore <file>.',
    },
    {
        id: 'sql-destructive-ddl',
        title: 'Unfiltered Destructive SQL DDL (DROP / TRUNCATE)',
        severity: 'critical',
        blastRadiusScore: 95,
        defaultDecision: 'block',
        shellOnly: true,
        pattern: SQL_DDL_RE,
        customMatch: (payload) => {
            if (!SQL_DDL_RE.test(payload))
                return false;
            // Allow quoted DDL mentions inside non-SQL search/VCS/echo commands
            // (e.g. `git commit -m "fix DROP TABLE"`, `grep "DROP TABLE" migrations/`),
            // while still blocking `psql -c "DROP TABLE users;"` and unquoted SQL.
            if (NON_SQL_PROSE_CMD.test(payload) && !SQL_DDL_RE.test(maskQuotedText(payload))) {
                return false;
            }
            return true;
        },
        reason: 'Direct destructive SQL DDL detected outside a reviewed migration rollback transaction.',
        prescription: 'Generate a versioned reversible migration file and test against a disposable branch DB first.',
    },
    {
        id: 'raw-disk-dd',
        title: 'Raw Block-Device Overwrite / Filesystem Format (dd / mkfs)',
        severity: 'critical',
        blastRadiusScore: 100,
        defaultDecision: 'block',
        shellOnly: true,
        pattern: /(?:\bdd\b[^\r\n;&|]*\bof=\/dev\/(?:sd|nvme|hd|vd|xvd|disk)\w*|\bmkfs(?:\.[a-z0-9]+)?\b[^\r\n;&|]*\/dev\/\w+)/i,
        reason: 'Writing raw bytes or formatting a /dev/ block device causes irreversible disk data loss.',
        prescription: 'Verify target path against lsblk/diskutil and target an image file rather than a live host device.',
    },
    {
        id: 'pipe-to-shell',
        title: 'Unverified Remote Script Piped Directly to Shell (curl | sh)',
        severity: 'high',
        blastRadiusScore: 86,
        defaultDecision: 'warn',
        shellOnly: true,
        pattern: /\b(?:curl|wget)\b[^\r\n;&|]*\|\s*(?:sudo\s+)?(?:(?:\/usr)?\/bin\/)?(?:ba|z|da|a)?sh\b/i,
        reason: 'Piping remote HTTP output directly into a shell executes unreviewed code with current user/sudo privileges.',
        prescription: 'Download the script to a file first, inspect or verify its SHA-256 checksum, then execute it.',
    },
    {
        id: 'non-tty-prisma-dev',
        title: 'Interactive Non-TTY Trap (prisma migrate dev)',
        severity: 'high',
        blastRadiusScore: 76,
        defaultDecision: 'rewrite',
        shellOnly: true,
        pattern: /\bprisma\s+migrate\s+dev\b/i,
        negativePattern: /--create-only/i,
        reason: 'prisma migrate dev prompts interactively in non-TTY agent shells and hangs indefinitely.',
        prescription: 'Pass --create-only to generate migrations non-interactively, or run prisma migrate deploy in CI.',
        rewrite: (payload) => payload.replace(/\bprisma\s+migrate\s+dev\b/i, 'prisma migrate dev --create-only'),
    },
    {
        id: 'chmod-world-writable',
        title: 'Insecure World-Writable Permissions (chmod 777)',
        severity: 'high',
        blastRadiusScore: 80,
        defaultDecision: 'rewrite',
        shellOnly: true,
        pattern: /\bchmod\s+(?:(?:-[a-zA-Z]+|--recursive|--verbose|--changes)\s+)*(?:0?777|a\+rwx)\b/i,
        reason: 'chmod 777 / a+rwx grants global write/execute permissions and triggers CI security audit failures.',
        prescription: 'Use least-privilege permissions (chmod 755 for executables/dirs, chmod 644 for files).',
        rewrite: (payload) => payload.replace(/(\bchmod\s+(?:(?:-[a-zA-Z]+|--recursive|--verbose|--changes)\s+)*)(?:0?777|a\+rwx)\b/i, '$1755'),
    },
    {
        id: 'git-no-verify-bypass',
        title: 'Pre-Commit / CI Safety Hook Bypass (--no-verify)',
        severity: 'high',
        blastRadiusScore: 75,
        defaultDecision: 'rewrite',
        shellOnly: true,
        pattern: /\bgit(?:\s+-C\s+\S+)?\s+(?:commit|push)\b/i,
        customMatch: (payload) => {
            const masked = maskQuotedText(payload);
            return (/\bgit(?:\s+-C\s+\S+)?\s+(?:commit|push)\b[^\r\n;&|]*\s--no-verify\b/i.test(masked) ||
                /\bgit(?:\s+-C\s+\S+)?\s+commit\b[^\r\n;&|]*\s-n(?=$|[\s;&|\r\n])/i.test(masked));
        },
        reason: 'Passing --no-verify (or git commit -n) bypasses repository pre-commit linters, typechecks, and pitfall gates.',
        prescription: 'Fix the underlying pre-commit hook failure instead of bypassing verification.',
        rewrite: (payload) => {
            // Only strip flags outside quoted message literals.
            const masked = maskQuotedText(payload);
            const out = [];
            let cursor = 0;
            const re = /\s+(?:--no-verify\b|-n(?=$|[\s;&|\r\n]))/g;
            let m;
            while ((m = re.exec(masked)) !== null) {
                out.push(payload.slice(cursor, m.index));
                cursor = m.index + m[0].length;
            }
            out.push(payload.slice(cursor));
            const cleaned = out.join('');
            return cleaned !== payload ? cleaned : null;
        },
    },
    {
        id: 'hardcoded-secret-literal',
        title: 'Hardcoded Secret / API Token Literal in Payload',
        severity: 'critical',
        blastRadiusScore: 96,
        defaultDecision: 'block',
        pattern: /(?:sk-(?:proj|live|ant)[A-Za-z0-9_-]{12,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
        customMatch: (payload) => /(?:sk-(?:proj|live|ant)[A-Za-z0-9_-]{12,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(payload) || redact(payload) !== payload,
        reason: 'Live credential or private key literal detected directly inside tool command or file payload.',
        prescription: 'Read credentials from process.env / GitHub Actions secrets and never inline tokens in commands or source.',
    },
];
const WEAK_GUARD_WORDS = new Set([
    'file', 'files', 'found', 'url', 'urls', 'path', 'paths', 'import', 'export',
    'code', 'line', 'lines', 'node', 'json', 'text', 'data', 'value', 'type',
    'call', 'test', 'run', 'build', 'read', 'write', 'open', 'close', 'check',
    'list', 'name', 'true', 'false', 'null', 'error', 'failed', 'failure',
    'command', 'exit', 'status', 'output', 'input', 'result', 'edit', 'bash',
]);
function tokenizeForGuard(text) {
    const out = new Set(signals(text));
    for (const bg of cjkBigrams(text)) {
        out.add(bg);
    }
    return out;
}
/**
 * Evaluate a proposed tool command or file edit payload before execution.
 */
export function evaluatePreFlightGuard(payload, learnedRules = [], opts = {}) {
    const toolName = opts.toolName ?? 'Bash';
    const shellTool = isShellTool(toolName);
    const strict = Boolean(opts.strict);
    const boundedPayload = payload.slice(0, MAX_GUARD_PAYLOAD_LEN);
    const matches = [];
    let currentRewrite = null;
    let maxScore = 0;
    let highestDecision = 'allow';
    const rankDecision = (d) => d === 'block' ? 4 : d === 'rewrite' ? 3 : d === 'warn' ? 2 : 1;
    const promoteDecision = (d) => {
        if (rankDecision(d) > rankDecision(highestDecision)) {
            highestDecision = d;
        }
    };
    for (const policy of BUILTIN_GUARD_POLICIES) {
        if (policy.shellOnly && !shellTool)
            continue;
        const matched = policy.customMatch
            ? policy.customMatch(boundedPayload)
            : policy.pattern.test(boundedPayload);
        if (!matched)
            continue;
        if (policy.negativePattern && policy.negativePattern.test(boundedPayload))
            continue;
        const candidateRewrite = policy.rewrite
            ? policy.rewrite(currentRewrite ?? boundedPayload)
            : null;
        if (candidateRewrite && candidateRewrite !== (currentRewrite ?? boundedPayload)) {
            currentRewrite = candidateRewrite;
        }
        const effectiveDecision = strict && (policy.defaultDecision === 'warn' || policy.defaultDecision === 'rewrite')
            ? 'block'
            : policy.defaultDecision;
        promoteDecision(effectiveDecision);
        if (policy.blastRadiusScore > maxScore)
            maxScore = policy.blastRadiusScore;
        matches.push({
            id: policy.id,
            title: policy.title,
            severity: policy.severity,
            blastRadiusScore: policy.blastRadiusScore,
            reason: policy.reason,
            prescription: policy.prescription,
            suggestedRewrite: candidateRewrite ? redact(candidateRewrite) : null,
            source: 'builtin-policy',
        });
    }
    const pm = opts.workspacePackageManager ?? null;
    if (shellTool && pm && pm !== 'npm') {
        if (pm === 'uv') {
            const pipPattern = /\bpip3?\s+install\b/i;
            if (pipPattern.test(boundedPayload) && !/\buv\s+pip\s+install\b/i.test(boundedPayload)) {
                const targetBase = currentRewrite ?? boundedPayload;
                const rewritten = targetBase.replace(/\bpip3?\s+install\b/i, 'uv pip install');
                currentRewrite = rewritten;
                const score = 78;
                if (score > maxScore)
                    maxScore = score;
                promoteDecision(strict ? 'block' : 'rewrite');
                matches.push({
                    id: 'lockfile-drift-uv',
                    title: 'Lockfile Package Manager Drift (pip in uv workspace)',
                    severity: 'high',
                    blastRadiusScore: score,
                    reason: 'Workspace is locked to uv, but command invokes pip install directly.',
                    prescription: 'Use uv add / uv pip install / uv sync so uv.lock stays consistent.',
                    suggestedRewrite: redact(rewritten),
                    source: 'workspace-lockfile',
                });
            }
        }
        else {
            const npmCmdPattern = /\bnpm\s+(?:install|i|add|ci)\b/i;
            if (npmCmdPattern.test(boundedPayload)) {
                const targetBase = currentRewrite ?? boundedPayload;
                let rewritten;
                if (/\bnpm\s+ci\b/i.test(targetBase)) {
                    rewritten = targetBase.replace(/\bnpm\s+ci\b/i, `${pm} install --frozen-lockfile`);
                }
                else if (/\bnpm\s+(?:install|i|add)\s+(?!-)\S+/i.test(targetBase)) {
                    rewritten = targetBase.replace(/\bnpm\s+(?:install|i|add)\b/i, `${pm} add`);
                }
                else {
                    rewritten = targetBase.replace(/\bnpm\s+(?:install|i|add)\b/i, `${pm} install`);
                }
                currentRewrite = rewritten;
                const score = 78;
                if (score > maxScore)
                    maxScore = score;
                promoteDecision(strict ? 'block' : 'rewrite');
                matches.push({
                    id: `lockfile-drift-${pm}`,
                    title: `Lockfile Package Manager Drift (npm in ${pm} workspace)`,
                    severity: 'high',
                    blastRadiusScore: score,
                    reason: `Workspace is locked to ${pm}, but command invokes npm install/ci directly.`,
                    prescription: `Use ${pm} add / ${pm} install instead of npm so lockfiles remain consistent.`,
                    suggestedRewrite: redact(rewritten),
                    source: 'workspace-lockfile',
                });
            }
        }
    }
    // Learned DB rules NEVER auto-block unless explicit `strict: true` (AGENTS.md #8).
    const payloadTokens = tokenizeForGuard(boundedPayload);
    for (const rule of learnedRules) {
        if (rule.status && rule.status !== 'active')
            continue;
        if (rule.tool_name && rule.tool_name.toLowerCase() !== toolName.toLowerCase())
            continue;
        const hits = Math.max(0, rule.hit_count ?? 0);
        const fails = Math.max(0, rule.fail_count ?? 0);
        if (hits < 2 && fails < 1)
            continue;
        const trigTokens = tokenizeForGuard(rule.trigger_pattern);
        if (trigTokens.size === 0)
            continue;
        let overlap = 0;
        let specificOverlap = 0;
        for (const t of trigTokens) {
            if (payloadTokens.has(t)) {
                overlap += 1;
                if (!WEAK_GUARD_WORDS.has(t))
                    specificOverlap += 1;
            }
        }
        if (specificOverlap >= 1 && (overlap >= 2 || (trigTokens.size === 1 && overlap === 1))) {
            const escalated = fails >= 2;
            const score = escalated ? 84 : Math.min(74, 55 + hits * 2);
            if (score > maxScore)
                maxScore = score;
            promoteDecision(strict ? 'block' : 'warn');
            matches.push({
                id: `antibody:${rule.trigger_pattern.slice(0, 32)}`,
                title: escalated
                    ? `[CRITICAL · ignored ${fails}x] ${rule.trigger_pattern}`
                    : `Learned Antibody: ${rule.trigger_pattern}`,
                severity: escalated ? 'high' : 'medium',
                blastRadiusScore: score,
                reason: `Avoid: ${rule.symptom}`,
                prescription: rule.prescription,
                suggestedRewrite: null,
                source: 'learned-antibody',
            });
        }
    }
    const severity = maxScore >= 90 ? 'critical' : maxScore >= 75 ? 'high' : maxScore >= 45 ? 'medium' : 'low';
    // Redact payload & rewrite before returning so live secrets never echo out (AGENTS.md #10).
    const safePayload = redact(boundedPayload);
    const safeRewrite = currentRewrite ? redact(currentRewrite) : null;
    const summary = matches.length === 0
        ? `ALLOW (Blast Radius 0/100): No destructive signatures or pitfall triggers matched for ${toolName}.`
        : `${highestDecision.toUpperCase()} (Blast Radius ${maxScore}/100 · ${severity.toUpperCase()}): ${matches.length} policy/antibody trigger(s) intercepted.` +
            (safeRewrite ? ` Safe rewrite -> \`${safeRewrite}\`` : '');
    return {
        payload: safePayload,
        toolName,
        decision: highestDecision,
        severity,
        blastRadiusScore: maxScore,
        suggestedRewrite: safeRewrite,
        matches,
        summary,
    };
}
/** Render a human-friendly terminal Pre-Flight Guard verdict. */
export function renderGuardTerminal(verdict) {
    const ver = packageVersion();
    const safePayload = redact(verdict.payload);
    const safeRewrite = verdict.suggestedRewrite ? redact(verdict.suggestedRewrite) : null;
    const icon = verdict.decision === 'block'
        ? '🛑'
        : verdict.decision === 'rewrite'
            ? '🔧'
            : verdict.decision === 'warn'
                ? '⚠️'
                : '✅';
    const lines = [
        `╔══════════════════════════════════════════════════════════════════════════╗`,
        `║  🛡️ AGENT IMMUNE v${ver} — PRE-FLIGHT BLAST-RADIUS GUARD`.padEnd(75) + '║',
        `╚══════════════════════════════════════════════════════════════════════════╝`,
        `  Tool Payload : [${verdict.toolName}] ${safePayload}`,
        `  Verdict      : ${icon} ${verdict.decision.toUpperCase()} (Blast-Radius Score: ${verdict.blastRadiusScore}/100 · Severity: ${verdict.severity.toUpperCase()})`,
    ];
    if (safeRewrite) {
        lines.push(`  Safe Rewrite : ${safeRewrite}`);
    }
    if (verdict.matches.length > 0) {
        lines.push('', '  Intercepted Policies & Antibodies:');
        for (const m of verdict.matches) {
            lines.push(`    • [${m.source} · ${m.blastRadiusScore}/100] ${m.title}`, `      Why : ${m.reason}`, `      Rx  : ${m.prescription}`);
        }
    }
    else {
        lines.push('', '  ✨ Zero pre-flight hazards detected. Safe to execute.');
    }
    lines.push('');
    return lines.join('\n');
}
/** Render a GitHub Markdown report for a Pre-Flight Guard evaluation. */
export function renderGuardMarkdown(verdict) {
    const safePayload = escapeMdCell(redact(verdict.payload));
    const safeRewrite = verdict.suggestedRewrite ? escapeMdCell(redact(verdict.suggestedRewrite)) : null;
    const lines = [
        `### 🛡️ Pre-Flight Blast-Radius Guard Verdict: \`${verdict.decision.toUpperCase()}\` (${verdict.blastRadiusScore}/100)`,
        '',
        `- **Tool**: \`${escapeMdCell(verdict.toolName)}\``,
        `- **Payload**: \`${safePayload}\``,
        `- **Severity**: **${verdict.severity.toUpperCase()}**`,
    ];
    if (safeRewrite) {
        lines.push(`- **Suggested Safe Rewrite**: \`${safeRewrite}\``);
    }
    if (verdict.matches.length > 0) {
        lines.push('', '| Policy / Antibody | Source | Score | Prescription |', '| :--- | :--- | :--- | :--- |', ...verdict.matches.map((m) => `| **${escapeMdCell(m.title)}** | \`${m.source}\` | \`${m.blastRadiusScore}/100\` | ${escapeMdCell(m.prescription)} |`));
    }
    lines.push('');
    return lines.join('\n');
}
/**
 * Format a PreToolUse hook decision (generic JSON contract).
 */
export function renderGuardHookDecision(verdict) {
    if (verdict.decision === 'block') {
        return {
            decision: 'block',
            reason: verdict.matches.map((m) => `${m.title}: ${m.prescription}`).join(' | ') || verdict.summary,
            blastRadiusScore: verdict.blastRadiusScore,
        };
    }
    if (verdict.decision === 'rewrite' && verdict.suggestedRewrite) {
        return {
            decision: 'allow',
            reason: verdict.summary,
            blastRadiusScore: verdict.blastRadiusScore,
            updatedInput: { command: verdict.suggestedRewrite },
        };
    }
    return {
        decision: 'allow',
        reason: verdict.summary,
        blastRadiusScore: verdict.blastRadiusScore,
    };
}
/**
 * Format a strict host-schema PreToolUse hook payload without unknown keys (AGENTS.md #2).
 */
export function renderGuardHostHookDecision(verdict, host = 'claude-code') {
    const reason = verdict.matches.map((m) => `${m.title}: ${m.prescription}`).join(' | ') || verdict.summary;
    if (host === 'generic') {
        return renderGuardHookDecision(verdict);
    }
    if (host === 'cursor') {
        if (verdict.decision === 'block') {
            return { permission: 'deny', user_message: reason, agent_message: reason };
        }
        return verdict.matches.length > 0
            ? { permission: 'allow', agent_message: verdict.summary }
            : { permission: 'allow' };
    }
    if (host === 'antigravity' || host === 'gemini-cli') {
        if (verdict.decision === 'block') {
            return { decision: 'deny', reason };
        }
        return verdict.matches.length > 0 ? { decision: 'allow', reason: verdict.summary } : {};
    }
    // claude-code / zcode strict hookSpecificOutput schema
    if (verdict.decision === 'block') {
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
            },
        };
    }
    if (verdict.matches.length > 0) {
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                additionalContext: verdict.summary,
            },
        };
    }
    return {};
}
/**
 * Render a concise, sanitized `<immune_guard>` banner for live PreToolUse hooks
 * (both warn and deny modes). Includes legacy `(force-push-main)` tag when a
 * force push targets main/master and surfaces deterministic safe rewrites.
 */
export function formatLiveGuardBanner(verdict) {
    if (verdict.matches.length === 0)
        return '';
    const safe = (v) => redact(v).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
    const top = verdict.matches[0];
    const isForcePushMain = top.id === 'git-force-push' && /\b(?:main|master)\b/i.test(verdict.payload);
    const tag = isForcePushMain ? `${top.id} / force-push-main` : top.id;
    const lines = [
        '<immune_guard>',
        `[${tag}] (blast ${verdict.blastRadiusScore}/100 · ${verdict.severity.toUpperCase()}) ${safe(top.reason)}`,
        `请改用 / Do instead: ${safe(top.prescription)}`,
    ];
    if (verdict.suggestedRewrite) {
        lines.push(`安全改写 / Safe rewrite: ${safe(verdict.suggestedRewrite)}`);
    }
    if (verdict.matches.length > 1) {
        const others = verdict.matches
            .slice(1, 3)
            .map((m) => m.id)
            .join(', ');
        lines.push(`Additional triggers: ${others}`);
    }
    lines.push('</immune_guard>');
    return lines.join('\n');
}
