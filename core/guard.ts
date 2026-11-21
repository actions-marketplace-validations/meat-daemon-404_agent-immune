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
import type { DiagnosableRule } from './diagnose.js';
import { redact } from './redact.js';
import { signals } from './relevance.js';
import { cjkBigrams } from './store/tokenize.js';
import { canonicalToolName, isShellToolName } from './tools.js';
import { packageVersion } from './version.js';

export type GuardSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardDecision = 'allow' | 'warn' | 'rewrite' | 'block';
export type GuardHookHost = 'generic' | 'claude-code' | 'cursor' | 'antigravity' | 'gemini-cli';

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
  readonly shellOnly?: boolean;
  readonly customMatch?: (payload: string) => boolean;
  readonly reason: string;
  readonly prescription: string;
  readonly rewrite?: (payload: string) => string | null;
}

const MAX_GUARD_PAYLOAD_LEN = 8192;
const MAX_SECRET_SCAN_LEN = 65536;

function isShellTool(toolName: string): boolean {
  return isShellToolName(toolName);
}

/** Lightweight lockfile probe (<0.05 ms) for live PreToolUse lockfile-drift guard. */
export function detectWorkspacePackageManager(
  workspace?: string,
): 'pnpm' | 'yarn' | 'bun' | 'uv' | null {
  if (!workspace) return null;
  try {
    if (existsSync(join(workspace, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(workspace, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(workspace, 'bun.lock')) || existsSync(join(workspace, 'bun.lockb'))) return 'bun';
    if (existsSync(join(workspace, 'uv.lock'))) return 'uv';
  } catch {
    // Ignore unreadable directories.
  }
  return null;
}

const NON_SQL_PROSE_CMD =
  /^\s*(?:git\s+(?:commit|tag|log|notes|branch)\b|grep\b|egrep\b|fgrep\b|rg\b|ag\b|ack\b|findstr\b|Select-String\b|echo\b|printf\b|Write-Output\b)/i;
const SQL_DDL_RE =
  /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)\s+(?:IF\s+EXISTS\s+)?[`"'\w]|TRUNCATE\s+(?:TABLE\s+)?[`"'\w])/i;

interface ShellSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Quote-aware O(n) shell command splitter on unquoted `&&`, `||`, `;`, `|`, `\r`, `\n`.
 * Prevents chained-command guard bypasses such as `echo ok && psql -c "DROP TABLE users;"`
 * or `git clean -n && git clean -fd` while keeping quoted arguments intact.
 */
function splitShellSegments(input: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let segStart = 0;
  let quote: '"' | "'" | null = null;
  const n = input.length;

  const pushSeg = (end: number) => {
    if (end > segStart) {
      const text = input.slice(segStart, end);
      if (text.trim()) segments.push({ text, start: segStart, end });
    }
  };

  for (let i = 0; i < n; i += 1) {
    const ch = input[i]!;
    if (quote !== null) {
      if (quote === '"' && ch === '\\' && i + 1 < n) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < n) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r') {
      pushSeg(i);
      segStart = i + 1;
      continue;
    }
    if (ch === '&' && input[i + 1] === '&') {
      pushSeg(i);
      i += 1;
      segStart = i + 1;
      continue;
    }
    if (ch === '|') {
      pushSeg(i);
      if (input[i + 1] === '|') i += 1;
      segStart = i + 1;
      continue;
    }
  }
  pushSeg(n);
  return segments;
}

/**
 * Mask closed single/double-quoted string bodies with spaces in O(n) time so flag
 * and prose checks ignore commit messages (including multiline quoted messages).
 */
function maskQuotedText(input: string): string {
  const chars = input.split('');
  let i = 0;
  const n = chars.length;
  while (i < n) {
    const ch = chars[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const inner = chars[j];
        if (quote === '"' && inner === '\\') {
          j += 2;
          continue;
        }
        if (inner === quote) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        for (let k = i + 1; k < j; k += 1) chars[k] = ' ';
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return chars.join('');
}

const GIT_RESET_HARD_SEG_RE = /\bgit(?:\s+-C\s+\S+)?\s+reset\b[^\r\n;&|]*\s--hard\b/i;
const GIT_STASH_SAVE_SEG_RE = /^\s*git(?:\s+-C\s+\S+)?\s+stash(?:\s+(?:push|save)\b|\s*$)/i;
const GIT_CLEAN_FORCE_SEG_RE = /\bgit(?:\s+-C\s+\S+)?\s+clean\b[^\r\n;&|]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force\b)/i;
const GIT_CLEAN_DRY_SEG_RE = /\bgit(?:\s+-C\s+\S+)?\s+clean\b[^\r\n;&|]*(?:\s-[a-zA-Z]*n[a-zA-Z]*\b|\s--dry-run\b)/i;
const GIT_COMMIT_SEG_RE = /\bgit(?:\s+-C\s+\S+)?\s+commit\b/i;
const GIT_PUSH_SEG_RE = /\bgit(?:\s+-C\s+\S+)?\s+push\b/i;
const GIT_COMMIT_SHORT_N_RE = /\s-([a-ce-ln-zA-Z]*n[a-zA-Z]*)(?=$|[\s;&|\r\n])/g;

function stripNoVerifyInSegment(seg: string): string {
  const masked = maskQuotedText(seg);
  const isCommit = GIT_COMMIT_SEG_RE.test(masked);
  const isPush = GIT_PUSH_SEG_RE.test(masked);
  if (!isCommit && !isPush) return seg;

  // Strip unquoted `--no-verify` on commit/push and unquoted `-n` (or combined `-an`/`-nm`)
  // ONLY on `git commit` — never touch `git push -n` (--dry-run) or `head -n 5`.
  const ranges: Array<{ start: number; end: number; replacement: string }> = [];
  const longRe = /\s+--no-verify\b/gi;
  let m: RegExpExecArray | null;
  while ((m = longRe.exec(masked)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length, replacement: '' });
  }
  if (isCommit) {
    GIT_COMMIT_SHORT_N_RE.lastIndex = 0;
    while ((m = GIT_COMMIT_SHORT_N_RE.exec(masked)) !== null) {
      const flags = m[1] ?? '';
      // In `git commit -m...`, anything after `m` is the message payload, not a flag.
      const mPos = flags.indexOf('m');
      const nPos = flags.indexOf('n');
      if (mPos >= 0 && nPos > mPos) continue;
      const withoutN = flags.replace(/n/g, '');
      ranges.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement: withoutN ? ` -${withoutN}` : '',
      });
    }
  }
  if (ranges.length === 0) return seg;
  ranges.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    out += seg.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  out += seg.slice(cursor);
  return out;
}

const CATASTROPHIC_RM_TARGETS = new Set([
  '/',
  '/*',
  '~',
  '~/',
  '~/*',
  '$home',
  '${home}',
  '$home/',
  '$home/*',
  '${home}/',
  '${home}/*',
  '.git',
  './.git',
  '.git/',
  './.git/',
  '*',
]);

function splitShellArgs(seg: string): string[] {
  const args: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < seg.length; i += 1) {
    const ch = seg[i]!;
    if (quote !== null) {
      if (quote === '"' && ch === '\\' && i + 1 < seg.length) {
        cur += seg[i + 1]!;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < seg.length) {
      cur += seg[i + 1]!;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        args.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

/**
 * Inspect a single shell segment for catastrophic recursive forced `rm` regardless
 * of flag ordering, `--no-preserve-root`, `--` terminator, or trailing target position
 * (e.g. `rm -rf ./dist /`, `rm --no-preserve-root -rf /`, `rm -rf -- /`, `rm -rf ./.git`).
 */
function isCatastrophicRmSegment(seg: string): boolean {
  const tokens = splitShellArgs(seg);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || /^(?:sudo|env|command|nohup)$/i.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  const cmd = (tokens[i] ?? '').split(/[\\/]/).pop()?.toLowerCase();
  if (cmd !== 'rm') return false;

  let hasRecursive = false;
  let hasForce = false;
  let afterDoubleDash = false;
  const targets: string[] = [];

  for (let j = i + 1; j < tokens.length; j += 1) {
    const tok = tokens[j]!;
    if (!afterDoubleDash && tok === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && tok.startsWith('--')) {
      const lower = tok.toLowerCase();
      if (lower === '--recursive') hasRecursive = true;
      else if (lower === '--force') hasForce = true;
      continue;
    }
    if (!afterDoubleDash && tok.startsWith('-') && tok.length > 1) {
      const flags = tok.slice(1).toLowerCase();
      if (flags.includes('r')) hasRecursive = true;
      if (flags.includes('f')) hasForce = true;
      continue;
    }
    targets.push(tok);
  }

  if (!hasRecursive || !hasForce) return false;
  return targets.some((t) => CATASTROPHIC_RM_TARGETS.has(t.toLowerCase()));
}

const PRISMA_MIGRATE_DEV_RE = /\bprisma\s+migrate\s+dev\b/i;

function escapeMdCell(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|').trim();
}

export const BUILTIN_GUARD_POLICIES: ReadonlyArray<BuiltinGuardPolicySpec> = [
  {
    id: 'destructive-rm-root',
    title: 'Catastrophic Recursive Delete (Root / Home / .git)',
    severity: 'critical',
    blastRadiusScore: 100,
    defaultDecision: 'block',
    shellOnly: true,
    pattern: /\brm\b/i,
    customMatch: (payload: string) =>
      splitShellSegments(payload).some((seg) => isCatastrophicRmSegment(seg.text)),
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
    rewrite: (payload: string) =>
      payload.replace(
        /\bgit(?:\s+-C\s+\S+)?\s+push\b[^\r\n;&|]*/gi,
        (seg) => {
          if (/--force-with-lease/i.test(seg)) {
            return seg.replace(/\s(?:--force(?!-)|-f)(?=$|[\s;&|\r\n])/gi, '');
          }
          return seg.replace(/\s(?:--force(?!-)|-f)(?=$|[\s;&|\r\n])/gi, ' --force-with-lease');
        },
      ),
  },
  {
    id: 'git-reset-hard',
    title: 'Unstashed git reset --hard Working-Tree Wipe',
    severity: 'high',
    blastRadiusScore: 82,
    defaultDecision: 'rewrite',
    shellOnly: true,
    pattern: GIT_RESET_HARD_SEG_RE,
    customMatch: (payload: string) => {
      let stashed = false;
      for (const seg of splitShellSegments(payload)) {
        const masked = maskQuotedText(seg.text);
        if (GIT_STASH_SAVE_SEG_RE.test(masked)) {
          stashed = true;
          continue;
        }
        if (GIT_RESET_HARD_SEG_RE.test(masked) && !stashed) {
          return true;
        }
      }
      return false;
    },
    reason: 'git reset --hard permanently destroys uncommitted working-tree and staged changes.',
    prescription: 'Snapshot dirty state with git stash push -u before running git reset --hard.',
    rewrite: (payload: string) => {
      const re = /\bgit(\s+-C\s+\S+)?\s+reset\b[^\r\n;&|]*\s--hard\b[^\r\n;&|]*/i;
      return payload.replace(re, (match, dirFlag: string | undefined) => {
        const stashCmd = `git${dirFlag ?? ''} stash push -u -m "immune-pre-reset"`;
        const replacement = `${stashCmd} && ${match}`;
        return /\|\|/.test(payload) ? `( ${replacement} )` : replacement;
      });
    },
  },
  {
    id: 'git-clean-force',
    title: 'Destructive Untracked File Deletion (git clean -f)',
    severity: 'high',
    blastRadiusScore: 78,
    defaultDecision: 'warn',
    shellOnly: true,
    pattern: GIT_CLEAN_FORCE_SEG_RE,
    customMatch: (payload: string) => {
      for (const seg of splitShellSegments(payload)) {
        const masked = maskQuotedText(seg.text);
        if (GIT_CLEAN_FORCE_SEG_RE.test(masked) && !GIT_CLEAN_DRY_SEG_RE.test(masked)) {
          return true;
        }
      }
      return false;
    },
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
    customMatch: (payload: string) => {
      if (!SQL_DDL_RE.test(payload)) return false;
      // Evaluate per shell segment so chained commands like
      // `echo ok && psql -c "DROP TABLE users;"` cannot hide behind a leading echo/grep,
      // while legitimate single prose segments (`git commit -m "fix DROP TABLE"`,
      // `grep -rn "DROP TABLE" migrations/`) stay allowed.
      for (const seg of splitShellSegments(payload)) {
        if (!SQL_DDL_RE.test(seg.text)) continue;
        if (NON_SQL_PROSE_CMD.test(seg.text) && !SQL_DDL_RE.test(maskQuotedText(seg.text))) {
          continue;
        }
        return true;
      }
      return false;
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
    pattern: PRISMA_MIGRATE_DEV_RE,
    customMatch: (payload: string) =>
      splitShellSegments(payload).some((seg) => {
        const masked = maskQuotedText(seg.text);
        return PRISMA_MIGRATE_DEV_RE.test(masked) && !/--create-only/i.test(masked);
      }),
    reason: 'prisma migrate dev prompts interactively in non-TTY agent shells and hangs indefinitely.',
    prescription: 'Pass --create-only to generate migrations non-interactively, or run prisma migrate deploy in CI.',
    rewrite: (payload: string) => {
      let out = '';
      let cursor = 0;
      for (const seg of splitShellSegments(payload)) {
        const masked = maskQuotedText(seg.text);
        const nextSeg =
          PRISMA_MIGRATE_DEV_RE.test(masked) && !/--create-only/i.test(masked)
            ? seg.text.replace(PRISMA_MIGRATE_DEV_RE, 'prisma migrate dev --create-only')
            : seg.text;
        out += payload.slice(cursor, seg.start) + nextSeg;
        cursor = seg.end;
      }
      out += payload.slice(cursor);
      return out !== payload ? out : null;
    },
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
    rewrite: (payload: string) =>
      payload.replace(
        /(\bchmod\s+(?:(?:-[a-zA-Z]+|--recursive|--verbose|--changes)\s+)*)(?:0?777|a\+rwx)\b/i,
        '$1755',
      ),
  },
  {
    id: 'git-no-verify-bypass',
    title: 'Pre-Commit / CI Safety Hook Bypass (--no-verify)',
    severity: 'high',
    blastRadiusScore: 75,
    defaultDecision: 'rewrite',
    shellOnly: true,
    pattern: /\bgit(?:\s+-C\s+\S+)?\s+(?:commit|push)\b/i,
    customMatch: (payload: string) => {
      for (const seg of splitShellSegments(payload)) {
        if (stripNoVerifyInSegment(seg.text) !== seg.text) return true;
      }
      return false;
    },
    reason: 'Passing --no-verify (or git commit -n) bypasses repository pre-commit linters, typechecks, and pitfall gates.',
    prescription: 'Fix the underlying pre-commit hook failure instead of bypassing verification.',
    rewrite: (payload: string) => {
      // Rewrite strictly inside each `git commit` / `git push` segment so flags on
      // sibling commands (`head -n 5`, `git push -n` dry-run) are never corrupted.
      let out = '';
      let cursor = 0;
      for (const seg of splitShellSegments(payload)) {
        out += payload.slice(cursor, seg.start) + stripNoVerifyInSegment(seg.text);
        cursor = seg.end;
      }
      out += payload.slice(cursor);
      return out !== payload ? out : null;
    },
  },
  {
    id: 'hardcoded-secret-literal',
    title: 'Hardcoded Secret / API Token Literal in Payload',
    severity: 'critical',
    blastRadiusScore: 96,
    defaultDecision: 'block',
    pattern:
      /(?:sk-(?:proj|live|ant)[A-Za-z0-9_-]{12,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
    customMatch: (payload: string) =>
      /(?:sk-(?:proj|live|ant)[A-Za-z0-9_-]{12,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
        payload,
      ) || redact(payload) !== payload,
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

function tokenizeForGuard(text: string): Set<string> {
  const out = new Set<string>(signals(text));
  for (const bg of cjkBigrams(text)) {
    out.add(bg);
  }
  return out;
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
  const shellTool = isShellTool(toolName);
  const strict = Boolean(opts.strict);
  const boundedPayload = payload.slice(0, MAX_GUARD_PAYLOAD_LEN);
  const secretScanPayload = payload.slice(0, MAX_SECRET_SCAN_LEN);
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
    if (policy.shellOnly && !shellTool) continue;
    const targetPayload = policy.id === 'hardcoded-secret-literal' ? secretScanPayload : boundedPayload;
    const matched = policy.customMatch
      ? policy.customMatch(targetPayload)
      : policy.pattern.test(targetPayload);
    if (!matched) continue;
    if (policy.negativePattern && policy.negativePattern.test(targetPayload)) continue;

    const candidateRewrite: string | null = policy.rewrite
      ? policy.rewrite(currentRewrite ?? boundedPayload)
      : null;
    if (candidateRewrite && candidateRewrite !== (currentRewrite ?? boundedPayload)) {
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
      suggestedRewrite: candidateRewrite ? redact(candidateRewrite) : null,
      source: 'builtin-policy',
    });
  }

  const pm = opts.workspacePackageManager ?? null;
  if (shellTool && pm && pm !== 'npm') {
    if (pm === 'uv') {
      const pipPattern = /\bpip3?\s+install\b/i;
      const hasBarePip = splitShellSegments(boundedPayload).some((seg) => {
        const masked = maskQuotedText(seg.text);
        return pipPattern.test(masked) && !/\buv\s+pip3?\s+install\b/i.test(masked);
      });
      if (hasBarePip) {
        const targetBase = currentRewrite ?? boundedPayload;
        let rewritten = '';
        let cursor = 0;
        for (const seg of splitShellSegments(targetBase)) {
          const masked = maskQuotedText(seg.text);
          const nextSeg =
            pipPattern.test(masked) && !/\buv\s+pip3?\s+install\b/i.test(masked)
              ? seg.text.replace(pipPattern, 'uv pip install')
              : seg.text;
          rewritten += targetBase.slice(cursor, seg.start) + nextSeg;
          cursor = seg.end;
        }
        rewritten += targetBase.slice(cursor);
        currentRewrite = rewritten;
        const score = 78;
        if (score > maxScore) maxScore = score;
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
    } else {
      const npmCmdPattern = /\bnpm\s+(?:install|i|add|ci)\b/i;
      const hasNpmDrift = splitShellSegments(boundedPayload).some((seg) =>
        npmCmdPattern.test(maskQuotedText(seg.text)),
      );
      if (hasNpmDrift) {
        const targetBase = currentRewrite ?? boundedPayload;
        let rewritten = '';
        let cursor = 0;
        for (const seg of splitShellSegments(targetBase)) {
          let nextSeg = seg.text;
          const masked = maskQuotedText(seg.text);
          if (/\bnpm\s+ci\b/i.test(masked)) {
            nextSeg = seg.text.replace(/\bnpm\s+ci\b/i, `${pm} install --frozen-lockfile`);
          } else if (/\bnpm\s+(?:install|i|add)\b/i.test(masked)) {
            const afterSub = masked.replace(/^[\s\S]*?\bnpm\s+(?:install|i|add)\b/i, '').trim();
            const hasPkgArg = afterSub
              .split(/\s+/)
              .filter(Boolean)
              .some((tok) => !tok.startsWith('-'));
            nextSeg = seg.text.replace(
              /\bnpm\s+(?:install|i|add)\b/i,
              hasPkgArg ? `${pm} add` : `${pm} install`,
            );
          }
          rewritten += targetBase.slice(cursor, seg.start) + nextSeg;
          cursor = seg.end;
        }
        rewritten += targetBase.slice(cursor);
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
          prescription: `Use ${pm} add / ${pm} install instead of npm so lockfiles remain consistent.`,
          suggestedRewrite: redact(rewritten),
          source: 'workspace-lockfile',
        });
      }
    }
  }

  // Learned DB rules NEVER auto-block unless explicit `strict: true` (AGENTS.md #8).
  const payloadTokens = tokenizeForGuard(boundedPayload);
  const canonicalTool = canonicalToolName(toolName).toLowerCase();
  for (const rule of learnedRules) {
    if (rule.status && rule.status !== 'active') continue;
    if (rule.tool_name && canonicalToolName(rule.tool_name).toLowerCase() !== canonicalTool) continue;
    const hits = Math.max(0, rule.hit_count ?? 0);
    const fails = Math.max(0, rule.fail_count ?? 0);
    if (hits < 2 && fails < 1) continue;

    const trigTokens = tokenizeForGuard(rule.trigger_pattern);
    if (trigTokens.size === 0) continue;
    let overlap = 0;
    let specificOverlap = 0;
    for (const t of trigTokens) {
      if (payloadTokens.has(t)) {
        overlap += 1;
        if (!WEAK_GUARD_WORDS.has(t)) specificOverlap += 1;
      }
    }
    if (specificOverlap >= 1 && (overlap >= 2 || (trigTokens.size === 1 && overlap === 1))) {
      const escalated = fails >= 2;
      const score = escalated ? 84 : Math.min(74, 55 + hits * 2);
      if (score > maxScore) maxScore = score;
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

  const severity: GuardSeverity =
    maxScore >= 90 ? 'critical' : maxScore >= 75 ? 'high' : maxScore >= 45 ? 'medium' : 'low';

  // Redact payload & rewrite before returning so live secrets never echo out (AGENTS.md #10).
  const safePayload = redact(boundedPayload);
  const safeRewrite = currentRewrite ? redact(currentRewrite) : null;

  const summary =
    matches.length === 0
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
export function renderGuardTerminal(verdict: GuardVerdict): string {
  const ver = packageVersion();
  const safePayload = redact(verdict.payload);
  const safeRewrite = verdict.suggestedRewrite ? redact(verdict.suggestedRewrite) : null;
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
  const safePayload = escapeMdCell(redact(verdict.payload));
  const safeRewrite = verdict.suggestedRewrite ? escapeMdCell(redact(verdict.suggestedRewrite)) : null;
  const lines: string[] = [
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
    lines.push(
      '',
      '| Policy / Antibody | Source | Score | Prescription |',
      '| :--- | :--- | :--- | :--- |',
      ...verdict.matches.map(
        (m) =>
          `| **${escapeMdCell(m.title)}** | \`${m.source}\` | \`${m.blastRadiusScore}/100\` | ${escapeMdCell(m.prescription)} |`,
      ),
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Format a PreToolUse hook decision (generic JSON contract).
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

/**
 * Format a strict host-schema PreToolUse hook payload without unknown keys (AGENTS.md #2).
 */
export function renderGuardHostHookDecision(
  verdict: GuardVerdict,
  host: GuardHookHost = 'claude-code',
): Record<string, unknown> {
  const reason =
    verdict.matches.map((m) => `${m.title}: ${m.prescription}`).join(' | ') || verdict.summary;
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
export function formatLiveGuardBanner(verdict: GuardVerdict): string {
  if (verdict.matches.length === 0) return '';
  const safe = (v: string): string => redact(v).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const ranked = [...verdict.matches].sort((a, b) => b.blastRadiusScore - a.blastRadiusScore);
  const top = ranked[0]!;
  const isForcePushMain =
    top.id === 'git-force-push' && /\b(?:main|master)\b/i.test(verdict.payload);
  const tag = isForcePushMain ? `${top.id} / force-push-main` : top.id;
  const lines = [
    '<immune_guard>',
    `[${tag}] (blast ${verdict.blastRadiusScore}/100 · ${verdict.severity.toUpperCase()}) ${safe(top.reason)}`,
    `请改用 / Do instead: ${safe(top.prescription)}`,
  ];
  if (verdict.suggestedRewrite) {
    lines.push(`安全改写 / Safe rewrite: ${safe(verdict.suggestedRewrite)}`);
  }
  if (ranked.length > 1) {
    const others = ranked
      .slice(1, 3)
      .map((m) => m.id)
      .join(', ');
    lines.push(`Additional triggers: ${others}`);
  }
  lines.push('</immune_guard>');
  return lines.join('\n');
}
