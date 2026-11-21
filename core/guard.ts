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
import type { DiagnosableRule } from './diagnose.js';

export type GuardSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardDecision = 'allow' | 'warn' | 'rewrite' | 'block';

export interface GuardMatchedPolicy {
  readonly id: string;
  readonly title: string;
  readonly severity: GuardSeverity;
  readonly blastRadiusScore: number;
  readonly reason: string;
  readonly prescription: string;
  readonly suggestedRewrite: string | null;
  readonly source: 'builtin-policy' | 'workspace-lockfile' | 'learned-antibody';
}

export interface GuardEvaluationOptions {
  readonly toolName?: string;
  readonly strict?: boolean;
  readonly workspacePackageManager?: 'pnpm' | 'yarn' | 'bun' | 'npm' | 'uv' | null;
}

export interface GuardVerdict {
  readonly payload: string;
  readonly toolName: string;
  readonly decision: GuardDecision;
  readonly severity: GuardSeverity;
  readonly blastRadiusScore: number;
  readonly suggestedRewrite: string | null;
  readonly matches: ReadonlyArray<GuardMatchedPolicy>;
  readonly summary: string;
}

export interface BuiltinGuardPolicySpec {
  readonly id: string;
  readonly title: string;
  readonly severity: GuardSeverity;
  readonly blastRadiusScore: number;
  readonly defaultDecision: GuardDecision;
  readonly pattern: RegExp;
  readonly negativePattern?: RegExp;
  readonly reason: string;
  readonly prescription: string;
  readonly rewrite?: (payload: string) => string | null;
}

export const BUILTIN_GUARD_POLICIES: ReadonlyArray<BuiltinGuardPolicySpec> = [
  {
    id: 'destructive-rm-root',
    title: 'Catastrophic Recursive Delete (Root / Home / .git)',
    severity: 'critical',
    blastRadiusScore: 100,
    defaultDecision: 'block',
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/(?:\s|$)|~(?:\/|\s|$)|\$HOME\b|\.git(?:\/|\s|$)|\*(?:\s|$))/i,
    reason: 'Recursive forced deletion targeting root (/), home (~), or .git repository metadata.',
    prescription: 'Scope deletion to a verified build subdir (e.g. rm -rf ./dist) after checking git status.',
  },
  {
    id: 'git-force-push',
    title: 'Unleased Force Push Overwriting Remote History',
    severity: 'high',
    blastRadiusScore: 88,
    defaultDecision: 'rewrite',
    pattern: /\bgit\s+push\b[^\n]*\s(?:--force|-f)(?:\s|$)/i,
    negativePattern: /--force-with-lease/i,
    reason: 'Raw git push --force overwrites remote commits pushed by teammates or CI workflows.',
    prescription: 'Use git push --force-with-lease so Git aborts if the remote ref advanced.',
    rewrite: (payload: string) =>
      payload
        .replace(/\s--force(?=\s|$)/g, ' --force-with-lease')
        .replace(/\s-f(?=\s|$)/g, ' --force-with-lease'),
  },
  {
    id: 'git-reset-hard',
    title: 'Unstashed git reset --hard Working-Tree Wipe',
    severity: 'high',
    blastRadiusScore: 82,
    defaultDecision: 'rewrite',
    pattern: /\bgit\s+reset\s+--hard\b/i,
    negativePattern: /\bgit\s+stash\b/i,
    reason: 'git reset --hard permanently destroys uncommitted working-tree and staged changes.',
    prescription: 'Snapshot dirty state with git stash push -u before running git reset --hard.',
    rewrite: (payload: string) =>
      payload.replace(/\bgit\s+reset\s+--hard\b/i, 'git stash push -u -m "immune-pre-reset" && git reset --hard'),
  },
  {
    id: 'sql-destructive-ddl',
    title: 'Unfiltered Destructive SQL DDL (DROP / TRUNCATE)',
    severity: 'critical',
    blastRadiusScore: 95,
    defaultDecision: 'block',
    pattern: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
    reason: 'Direct destructive SQL DDL detected outside a reviewed migration rollback transaction.',
    prescription: 'Generate a versioned reversible migration file and run against a disposable branch DB first.',
  },
  {
    id: 'non-tty-prisma-dev',
    title: 'Interactive Non-TTY Trap (prisma migrate dev)',
    severity: 'high',
    blastRadiusScore: 76,
    defaultDecision: 'rewrite',
    pattern: /\bprisma\s+migrate\s+dev\b/i,
    negativePattern: /--create-only/i,
    reason: 'prisma migrate dev prompts interactively in non-TTY agent shells and hangs indefinitely.',
    prescription: 'Use prisma migrate deploy or prisma db push --accept-data-loss in non-interactive shells.',
    rewrite: (payload: string) => payload.replace(/\bprisma\s+migrate\s+dev\b/i, 'prisma migrate deploy'),
  },
  {
    id: 'chmod-world-writable',
    title: 'Insecure World-Writable Permissions (chmod 777)',
    severity: 'high',
    blastRadiusScore: 80,
    defaultDecision: 'rewrite',
    pattern: /\bchmod\s+(?:-[a-zA-Z]+\s+)?777\b/i,
    reason: 'chmod 777 grants global write/execute permissions and triggers CI security audit failures.',
    prescription: 'Use least-privilege permissions (chmod 755 for executables/dirs, chmod 644 for files).',
    rewrite: (payload: string) => payload.replace(/(\bchmod\s+(?:-[a-zA-Z]+\s+)?)777\b/i, '$1755'),
  },
  {
    id: 'git-no-verify-bypass',
    title: 'Pre-Commit / CI Safety Hook Bypass (--no-verify)',
    severity: 'high',
    blastRadiusScore: 75,
    defaultDecision: 'warn',
    pattern: /\bgit\s+(?:commit|push)\b[^\n]*\s--no-verify\b/i,
    reason: 'Passing --no-verify bypasses repository pre-commit linters, typechecks, and pitfall gates.',
    prescription: 'Fix the underlying pre-commit hook failure instead of bypassing verification with --no-verify.',
    rewrite: (payload: string) => payload.replace(/\s+--no-verify\b/g, ''),
  },
  {
    id: 'hardcoded-secret-literal',
    title: 'Hardcoded Secret / API Token Literal in Payload',
    severity: 'critical',
    blastRadiusScore: 96,
    defaultDecision: 'block',
    pattern: /(?:sk-(?:proj|live)-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
    reason: 'Live credential or private key literal detected directly inside tool command or file payload.',
    prescription: 'Read credentials from process.env / GitHub Actions secrets and never inline tokens in commands or source.',
  },
];

function tokenizeForGuard(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Evaluate a proposed tool command or file edit payload before execution.
 */
export function evaluatePreFlightGuard(
  payload: string,
  learnedRules: ReadonlyArray<DiagnosableRule> = [],
  opts: GuardEvaluationOptions = {},
): GuardVerdict {
  const toolName = opts.toolName ?? 'Bash';
  const strict = Boolean(opts.strict);
  const matches: GuardMatchedPolicy[] = [];
  let currentRewrite: string | null = null;
  let maxScore = 0;
  let highestDecision: GuardDecision = 'allow';

  const rankDecision = (d: GuardDecision): number =>
    d === 'block' ? 4 : d === 'rewrite' ? 3 : d === 'warn' ? 2 : 1;

  const promoteDecision = (d: GuardDecision) => {
    if (rankDecision(d) > rankDecision(highestDecision)) {
      highestDecision = d;
    }
  };

  for (const policy of BUILTIN_GUARD_POLICIES) {
    if (!policy.pattern.test(payload)) continue;
    if (policy.negativePattern && policy.negativePattern.test(payload)) continue;

    const candidateRewrite: string | null = policy.rewrite ? policy.rewrite(currentRewrite ?? payload) : null;
    if (candidateRewrite && candidateRewrite !== (currentRewrite ?? payload)) {
      currentRewrite = candidateRewrite;
    }

    const effectiveDecision: GuardDecision =
      strict && (policy.defaultDecision === 'warn' || policy.defaultDecision === 'rewrite')
        ? 'block'
        : policy.defaultDecision;

    promoteDecision(effectiveDecision);
    if (policy.blastRadiusScore > maxScore) maxScore = policy.blastRadiusScore;

    matches.push({
      id: policy.id,
      title: policy.title,
      severity: policy.severity,
      blastRadiusScore: policy.blastRadiusScore,
      reason: policy.reason,
      prescription: policy.prescription,
      suggestedRewrite: candidateRewrite,
      source: 'builtin-policy',
    });
  }

  const pm = opts.workspacePackageManager ?? null;
  if (pm && pm !== 'npm' && pm !== 'uv') {
    const npmCmdPattern = /\bnpm\s+(?:install|i|add|ci)\b/i;
    if (npmCmdPattern.test(payload)) {
      const targetBase = currentRewrite ?? payload;
      const rewritten = targetBase.replace(/\bnpm\s+(?:install|i|add|ci)\b/i, `${pm} install`);
      currentRewrite = rewritten;
      const score = 78;
      if (score > maxScore) maxScore = score;
      promoteDecision(strict ? 'block' : 'rewrite');
      matches.push({
        id: `lockfile-drift-${pm}`,
        title: `Lockfile Package Manager Drift (npm in ${pm} workspace)`,
        severity: 'high',
        blastRadiusScore: score,
        reason: `Workspace is locked to ${pm}, but command invokes npm install/ci directly.`,
        prescription: `Use ${pm} install instead of npm so lockfiles remain consistent.`,
        suggestedRewrite: rewritten,
        source: 'workspace-lockfile',
      });
    }
  }

  const payloadTokens = new Set(tokenizeForGuard(payload));
  for (const rule of learnedRules) {
    if (rule.status && rule.status !== 'active') continue;
    if (rule.tool_name && rule.tool_name.toLowerCase() !== toolName.toLowerCase()) continue;
    const hits = Math.max(0, rule.hit_count ?? 0);
    const fails = Math.max(0, rule.fail_count ?? 0);
    if (hits < 2 && fails < 1) continue;

    const trigTokens = tokenizeForGuard(rule.trigger_pattern);
    if (trigTokens.length === 0) continue;
    const overlap = trigTokens.filter((t) => payloadTokens.has(t)).length;
    const ratio = overlap / trigTokens.length;
    if (overlap >= 2 || (trigTokens.length === 1 && overlap === 1) || ratio >= 0.65) {
      const escalated = fails >= 2;
      const score = escalated ? 84 : Math.min(74, 55 + hits * 2);
      if (score > maxScore) maxScore = score;
      promoteDecision(strict || escalated ? 'block' : 'warn');
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

  const severity: GuardSeverity =
    maxScore >= 90 ? 'critical' : maxScore >= 75 ? 'high' : maxScore >= 45 ? 'medium' : 'low';

  const summary =
    matches.length === 0
      ? `ALLOW (Blast Radius 0/100): No destructive signatures or pitfall triggers matched for ${toolName}.`
      : `${highestDecision.toUpperCase()} (Blast Radius ${maxScore}/100 · ${severity.toUpperCase()}): ${matches.length} policy/antibody trigger(s) intercepted.` +
        (currentRewrite ? ` Safe rewrite -> \`${currentRewrite}\`` : '');

  return {
    payload,
    toolName,
    decision: highestDecision,
    severity,
    blastRadiusScore: maxScore,
    suggestedRewrite: currentRewrite,
    matches,
    summary,
  };
}

/** Render a human-friendly terminal Pre-Flight Guard verdict. */
export function renderGuardTerminal(verdict: GuardVerdict): string {
  const icon =
    verdict.decision === 'block'
      ? '🛑'
      : verdict.decision === 'rewrite'
        ? '🔧'
        : verdict.decision === 'warn'
          ? '⚠️'
          : '✅';
  const lines: string[] = [
    `╔══════════════════════════════════════════════════════════════════════════╗`,
    `║  🛡️ AGENT IMMUNE v3.0 — PRE-FLIGHT BLAST-RADIUS GUARD                    ║`,
    `╚══════════════════════════════════════════════════════════════════════════╝`,
    `  Tool Payload : [${verdict.toolName}] ${verdict.payload}`,
    `  Verdict      : ${icon} ${verdict.decision.toUpperCase()} (Blast-Radius Score: ${verdict.blastRadiusScore}/100 · Severity: ${verdict.severity.toUpperCase()})`,
  ];

  if (verdict.suggestedRewrite) {
    lines.push(`  Safe Rewrite : ${verdict.suggestedRewrite}`);
  }

  if (verdict.matches.length > 0) {
    lines.push('', '  Intercepted Policies & Antibodies:');
    for (const m of verdict.matches) {
      lines.push(
        `    • [${m.source} · ${m.blastRadiusScore}/100] ${m.title}`,
        `      Why : ${m.reason}`,
        `      Rx  : ${m.prescription}`,
      );
    }
  } else {
    lines.push('', '  ✨ Zero pre-flight hazards detected. Safe to execute.');
  }

  lines.push('');
  return lines.join('\n');
}

/** Render a GitHub Markdown report for a Pre-Flight Guard evaluation. */
export function renderGuardMarkdown(verdict: GuardVerdict): string {
  const lines: string[] = [
    `### 🛡️ Pre-Flight Blast-Radius Guard Verdict: \`${verdict.decision.toUpperCase()}\` (${verdict.blastRadiusScore}/100)`,
    '',
    `- **Tool**: \`${verdict.toolName}\``,
    `- **Payload**: \`${verdict.payload.replace(/`/g, "'")}\``,
    `- **Severity**: **${verdict.severity.toUpperCase()}**`,
  ];
  if (verdict.suggestedRewrite) {
    lines.push(`- **Suggested Safe Rewrite**: \`${verdict.suggestedRewrite.replace(/`/g, "'")}\``);
  }
  if (verdict.matches.length > 0) {
    lines.push(
      '',
      '| Policy / Antibody | Source | Score | Prescription |',
      '| :--- | :--- | :--- | :--- |',
      ...verdict.matches.map(
        (m) =>
          `| **${m.title.replace(/\|/g, '\\|')}** | \`${m.source}\` | \`${m.blastRadiusScore}/100\` | ${m.prescription.replace(/\|/g, '\\|')} |`,
      ),
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Format a PreToolUse hook decision compatible with Claude Code / Cursor hook protocol.
 */
export function renderGuardHookDecision(verdict: GuardVerdict): {
  readonly decision: 'allow' | 'block';
  readonly reason: string;
  readonly blastRadiusScore: number;
  readonly updatedInput?: { readonly command: string };
} {
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
