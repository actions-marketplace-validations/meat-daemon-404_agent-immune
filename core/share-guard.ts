/**
 * ROADMAP 3.2 — the share gate and the CI gate.
 *
 * Two stateless checks, one file:
 *
 *  1. `shareSanityCheck` runs before ANY shareable artifact (SKILL.md export,
 *     packs) leaves the machine: a rule that still carries a machine path or a
 *     secret-shaped string must FAIL the export instead of shipping to the
 *     team. Redaction (#10) scrubs traces at capture time; this gate is the
 *     second line — it inspects the RULES themselves.
 *
 *  2. `ciCheck` scans PR-diff added lines against rules parsed from the repo's
 *     own AGENTS.md `<!-- immune:generated -->` block — stateless by design:
 *     CI has no immune database, but it has the committed managed section.
 */
import { readFileSync, existsSync } from 'node:fs';
import { redact, redactEmails } from './redact.js';
import { signals } from './relevance.js';
import { SECTION_START, SECTION_END } from './sync-doc.js';

/** Machine paths that must never leave the machine. */
const MACHINE_PATH =
  /(?:(?<![A-Za-z])[A-Za-z]:[\\/](?![\\/])[^\s|'"<>]{1,120}|(?<![:\\A-Za-z0-9])\\\\[A-Za-z0-9._-]{2,}\\[^\s|'"<>]{1,120}|\/home\/[^\s|'"<>]{1,120}|\/Users\/[^\s|'"<>]{1,120}|\/root\/[^\s|'"<>]{1,120})/;

const TOOL_NAMES = new Set(['bash', 'edit', 'write', 'read', 'multiedit', 'notebookedit', 'grep', 'glob']);

export type ShareViolationKind = 'machine-path' | 'secret-shaped' | 'email';

export interface ShareViolation {
  /** Rule index in the export set (1-based, matches the rendered row order). */
  rule: number;
  field: string;
  kind: ShareViolationKind;
  /** The offending snippet, itself redacted before display. */
  sample: string;
}

/**
 * Inspect the rules destined for a shareable artifact. The FIRST violation is
 * enough to stop the export; the list lets the operator fix everything at once.
 */
export function shareSanityCheck(
  rules: ReadonlyArray<
    Pick<AntibodyFields, 'trigger_pattern' | 'symptom' | 'prescription'> & { repair_path?: string[] }
  >,
): ShareViolation[] {
  const out: ShareViolation[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;
    const candidates: Array<[string, string]> = [
      ['trigger_pattern', String(rule.trigger_pattern ?? '')],
      ['symptom', String(rule.symptom ?? '')],
      ['prescription', String(rule.prescription ?? '')],
    ];
    if (Array.isArray(rule.repair_path) && rule.repair_path.length > 0) {
      candidates.push(['repair_path', rule.repair_path.join(' | ')]);
    }
    for (const [field, text] of candidates) {
      const pathMatch = text.match(MACHINE_PATH);
      if (pathMatch) {
        out.push({ rule: index + 1, field, kind: 'machine-path', sample: redact(pathMatch[0]) });
        continue;
      }
      if (redact(text) !== text) {
        out.push({ rule: index + 1, field, kind: 'secret-shaped', sample: redact(text).slice(0, 60) });
        continue;
      }
      if (redactEmails(text) !== text) {
        out.push({ rule: index + 1, field, kind: 'email', sample: redactEmails(text).slice(0, 60) });
      }
      if (out.length >= 20) return out;
    }
  }
  return out;
}

/** Consistent human-readable summary shared by every blocked export path. */
export function formatShareViolations(violations: ReadonlyArray<ShareViolation>): string {
  const lines = ['export blocked by the share gate:'];
  for (const violation of violations) {
    lines.push(`  rule ${violation.rule} ${violation.field}: ${violation.kind} — "${violation.sample}"`);
  }
  lines.push('fix or forget those rules, then re-export');
  return lines.join('\n');
}

/** Minimal rule shape the AGENTS.md block parser needs. */
interface AntibodyFields {
  trigger_pattern: string;
  symptom: string;
  prescription: string;
}

/**
 * Parse the rules a repository committed into its managed AGENTS.md section.
 * The block is fully replaced on every sync (sync-doc.ts), so the parse is
 * stable; a missing block is an EMPTY rule set, not an error.
 */
export function parseManagedBlock(docPath: string): Array<AntibodyFields> {
  if (!existsSync(docPath)) return [];
  let text = '';
  try {
    text = readFileSync(docPath, 'utf8');
  } catch {
    return [];
  }
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  if (start < 0 || end <= start) return [];
  const body = text.slice(start + SECTION_START.length, end);
  // Support both sync-doc format:
  //   - **<trigger>**
  //     - 忌/avoid: <symptom>
  //     - 宜/do: <prescription>
  // and compile-rules format:
  //   - **[Tool] When**: `<trigger>` *(files: `...`)*
  //     - **Avoid**: <symptom>
  //     - **Do instead**: <prescription>
  const rules: Array<AntibodyFields> = [];
  let current: { trigger: string; avoid: string } | null = null;
  for (const line of body.split('\n')) {
    const syncTrigger = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*$/);
    const compileTrigger = line.match(/^\s*-\s*\*\*(?:\[[^\]]+\]\s*)?When\*\*:\s*`([^`]+)`/);
    if (syncTrigger || compileTrigger) {
      if (current) rules.push({ trigger_pattern: current.trigger, symptom: current.avoid, prescription: '' });
      current = { trigger: (compileTrigger?.[1] ?? syncTrigger?.[1] ?? '').trim(), avoid: '' };
      continue;
    }
    const avoidLine = line.match(/^\s*-\s*(?:忌\/avoid:|\*\*Avoid\*\*:)\s*(.*)$/);
    if (avoidLine && current) {
      current.avoid = (avoidLine[1] ?? '').trim();
      continue;
    }
    const doLine = line.match(/^\s*-\s*(?:宜\/do:|\*\*Do instead\*\*:)\s*(.*)$/);
    if (doLine && current) {
      rules.push({
        trigger_pattern: current.trigger,
        symptom: current.avoid,
        prescription: (doLine[1] ?? '').trim(),
      });
      current = null;
    }
  }
  if (current) rules.push({ trigger_pattern: current.trigger, symptom: current.avoid, prescription: '' });
  return rules.filter((rule) => rule.trigger_pattern.length > 0);
}

export interface CiCheckFinding {
  file?: string;
  line: number;
  text: string;
  trigger: string;
  symptom?: string;
  prescription?: string;
}

export interface CiCheckReport {
  addedLines: number;
  rulesConsidered: number;
  findings: CiCheckFinding[];
}

const GENERIC_CI_WORDS = new Set([
  'file', 'files', 'url', 'urls', 'path', 'paths', 'import', 'export',
  'code', 'line', 'lines', 'node', 'json', 'text', 'data', 'value',
  'type', 'call', 'test', 'read', 'write', 'open', 'close', 'check',
  'list', 'name', 'true', 'false', 'null', 'error', 'failed', 'failure',
  'command', 'exit', 'status', 'output', 'input', 'result', 'sync', 'auto',
  'probe', 'windows', 'linux', 'macos',
]);

const HIGH_RISK_CODE_ANCHORS = new Set([
  '__dirname', '__filename', 'eresolve', 'err_unsupported_esm_url_scheme',
  'eperm', 'eacces', 'enoent', 'eaddrinuse', 'indentationerror',
]);

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenMatchesDiffLine(lowerLine: string, token: string): boolean {
  if (/^[a-z0-9_.]+$/i.test(token)) {
    // Allow leading flag hyphens (`--force` matches `force`), while refusing
    // trailing hyphen extensions (`--force-with-lease` does NOT match `force`, #17).
    return new RegExp(`(?<![a-z0-9_])${escapeRegex(token)}(?![a-z0-9_-])`, 'i').test(lowerLine);
  }
  if (/^[a-z0-9_.-]+$/i.test(token)) {
    return new RegExp(`(?<![a-z0-9_])${escapeRegex(token)}(?![a-z0-9_-])`, 'i').test(lowerLine);
  }
  return lowerLine.includes(token);
}

/**
 * Scan diff added lines against the managed-block rules.
 *
 * Improvements in v2.1:
 *  - Parses unified diff `+++ b/<file>` and `@@ -a,b +c,d @@` hunk headers so
 *    findings carry real file paths and line numbers (for GitHub PR annotations).
 *  - Skips changes inside the `<!-- immune:generated -->` block itself so
 *    running `immune sync-doc` never self-triggers CI failure.
 *  - Uses word-boundary + hyphen-safe token matching and requires >=2 matched
 *    trigger tokens (or an unambiguous high-specificity anchor), eliminating
 *    single-word false positives on ordinary `import` / `file` / `url` lines.
 */
export function ciCheck(
  diffText: string,
  rules: ReadonlyArray<AntibodyFields>,
  opts: { ignoreFiles?: string[] } = {},
): CiCheckReport {
  const ignoreSet = new Set(
    (opts.ignoreFiles ?? []).map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()),
  );
  const added: Array<{ file?: string; line: number; text: string }> = [];
  let rawLineNo = 0;
  let currentFile: string | undefined;
  let hunkLine: number | null = null;
  let inGeneratedBlock = false;

  for (const rawLine of diffText.split('\n')) {
    rawLineNo += 1;
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      hunkLine = null;
      inGeneratedBlock = false;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const m = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
      const candidate = m?.[1]?.trim();
      currentFile = candidate && candidate !== '/dev/null' ? candidate.replace(/\\/g, '/') : undefined;
      hunkLine = null;
      inGeneratedBlock = false;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const m = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      hunkLine = m?.[1] ? Number(m[1]) : null;
      continue;
    }
    if (line.startsWith('--- ')) continue;

    if (line.includes(SECTION_START)) {
      inGeneratedBlock = true;
    }
    if (line.includes(SECTION_END)) {
      inGeneratedBlock = false;
      if (line.startsWith('+') && hunkLine !== null) hunkLine += 1;
      else if (line.startsWith(' ') && hunkLine !== null) hunkLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      if (hunkLine !== null) hunkLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      continue;
    }
    if (!line.startsWith('+')) continue;

    const targetLine = hunkLine !== null ? hunkLine : rawLineNo;
    if (hunkLine !== null) hunkLine += 1;

    if (inGeneratedBlock) continue;
    if (currentFile && ignoreSet.has(currentFile.toLowerCase())) continue;

    const text = line.slice(1).trim();
    if (text.length < 3) continue;
    // Skip managed-block three-line bullets even when hunk context started inside the block.
    if (/^-\s*(?:忌\/avoid:|宜\/do:|repaired by:)/.test(text)) continue;

    added.push({ ...(currentFile ? { file: currentFile } : {}), line: targetLine, text });
  }

  const preparedRules = rules
    .map((rule) => {
      const rawTrigger = rule.trigger_pattern ?? '';
      const tokens = [...signals(rawTrigger)].filter((token) => !TOOL_NAMES.has(token));
      const requiredFlags = rawTrigger
        .split(/\s+/)
        .map((t) => t.replace(/^[^-a-zA-Z0-9]+|[^a-zA-Z0-9_-]+$/g, '').toLowerCase())
        .filter((t) => /^--?[a-z0-9][\w-]*$/.test(t));
      return { rule, tokens, requiredFlags };
    })
    .filter((entry) => entry.tokens.length > 0);

  const findings: CiCheckFinding[] = [];
  for (const addedLine of added) {
    const lower = addedLine.text.toLowerCase();
    for (const { rule, tokens, requiredFlags } of preparedRules) {
      // Decision #17 parity: if a rule's trigger explicitly names CLI flag(s)
      // (e.g. `--force`), a diff line using a safe alternative (`--force-with-lease`)
      // that matches none of those flags must not be flagged.
      if (requiredFlags.length > 0 && !requiredFlags.some((flag) => tokenMatchesDiffLine(lower, flag))) {
        continue;
      }
      const matched = tokens.filter((token) => tokenMatchesDiffLine(lower, token));
      if (matched.length === 0) continue;
      const hasHighAnchor = matched.some((token) => HIGH_RISK_CODE_ANCHORS.has(token));
      const nonGenericCount = matched.filter((token) => !GENERIC_CI_WORDS.has(token)).length;
      const hit =
        hasHighAnchor ||
        (tokens.length === 1 ? nonGenericCount === 1 : matched.length >= 2 && nonGenericCount >= 1);
      if (hit) {
        findings.push({
          ...(addedLine.file ? { file: addedLine.file } : {}),
          line: addedLine.line,
          text: addedLine.text.slice(0, 120),
          trigger: rule.trigger_pattern.slice(0, 80),
          ...(rule.symptom ? { symptom: rule.symptom.slice(0, 120) } : {}),
          ...(rule.prescription ? { prescription: rule.prescription.slice(0, 140) } : {}),
        });
        break;
      }
    }
  }
  return { addedLines: added.length, rulesConsidered: rules.length, findings };
}
