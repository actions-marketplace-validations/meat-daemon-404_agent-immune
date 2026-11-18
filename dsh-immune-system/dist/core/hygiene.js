/**
 * Workspace isolation, path canonicalization, and admission hygiene gate (v2).
 *
 * Production telemetry on 57 real rules (12,332 deliveries) revealed two critical
 * failure modes in v1:
 *   1. 63% of active rules were raw command/path dumps (`Write: D:\大创\...`)
 *      or raw JSON stdout blobs (`{"stdout":...}`).
 *   2. A global SQLite plugin database had no `project_scope`, so rules learned
 *      in `D:\大创` leaked into unrelated repositories nearly 2,000 times.
 *
 * This module enforces strict path abstraction, quality grading (`advice` vs
 * `tactic` vs `quarantined`), workspace scoping, and one-command repair of
 * polluted libraries.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
import { matchGenericLesson } from './lessons.js';
import { redact, redactOutbound } from './redact.js';
import { looksEchoPrescription } from './rewrite.js';
import { inferRootCause, scoreAntibodyRubric } from './rubric.js';
const ROOT_MARKERS = [
    '.git',
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'project.config.json',
    'SKILL.md',
];
const WIN_ABS_PATH_RE = /(?<![A-Za-z0-9_])([A-Za-z]:(?:\\\\|\\|\/)[^\s"'`<>|]{2,})/g;
const UNIX_HOME_PATH_RE = /(?<![A-Za-z0-9_.\/-])(\/(?:Users|home)\/[^\s"'`<>|]{2,}|\/root\/[^\s"'`<>|]+)/g;
const RAW_JSON_WRAPPER_RE = /^\s*\{\s*"(?:stdout|stderr|interrupted|isImage|filePath|command|code)"\s*:/i;
const RAW_TOOL_WRAPPER_RE = /^\s*tool=[A-Za-z0-9_-]+\s+input=/i;
const FILE_TOOL_ABS_DUMP_RE = /^(?:Edit|Write|MultiEdit|NotebookEdit):\s*(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/root\/|~?\/?<path>|<repo>|[\w./\\-]+\.[A-Za-z0-9]{1,8}\s*$)/i;
const URL_TOOL_DUMP_RE = /^[A-Za-z][\w-]*:\s*https?:\/\/\S+\s*$/i;
const INLINE_CODE_DUMP_RE = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bawait\s+[A-Za-z_$][\w$.]*\(|\bfunction\s+[A-Za-z_$]|\bdef\s+[A-Za-z_]\w*\s*\(|;\s*(?:const|let|var|await|return)\b/;
const AD_HOC_PROBE_CMD_RE = /^(?:(?:bash|pwsh|powershell|cmd):\s*)?(?:grep|rg|sed|awk|head|tail|cat|ls|dir|find|tasklist|Get-ChildItem|Get-NetTCPConnection|Get-Process|Get-Content|Select-String|Write-Output|\$[A-Za-z_]+\s*=|set\s+-[a-z]\s+[A-Z_]+=)/i;
const SCRIPT_DUMP_OR_CHAT_RE = /^(?:(?:pwsh|powershell):\s*.*(?:\$[A-Za-z_]+=|nWrite-Out|\$pids\s*=\s*\d+)|还有[，,]|\$env:USERPROFILE)/i;
const WIN_DRIVE_PATH_RE = /^[A-Za-z]:(?:[\\/]|$)/;
/** Walk up from `cwd` to the nearest repo/workspace root (stopping before drive/home root). */
export function resolveWorkspaceRoot(cwd) {
    const trimmed = cwd?.trim();
    if (!trimmed)
        return '';
    if (WIN_DRIVE_PATH_RE.test(trimmed)) {
        const resolved = win32.resolve(trimmed);
        if (process.platform !== 'win32')
            return resolved;
        let current = resolved;
        for (let depth = 0; depth < 8; depth += 1) {
            if (ROOT_MARKERS.some((marker) => existsSync(win32.join(current, marker)))) {
                return current;
            }
            const parent = win32.dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
        return resolved;
    }
    if (trimmed.startsWith('/')) {
        const resolved = posix.resolve(trimmed);
        if (process.platform === 'win32')
            return resolved;
        let current = resolved;
        for (let depth = 0; depth < 8; depth += 1) {
            if (ROOT_MARKERS.some((marker) => existsSync(posix.join(current, marker)))) {
                return current;
            }
            const parent = posix.dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
        return resolved;
    }
    let current = resolve(trimmed);
    for (let depth = 0; depth < 8; depth += 1) {
        if (ROOT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return resolve(trimmed);
}
/**
 * Stable workspace scope identifier (`proj:<slug>:<hash8>`), or `'*'` when no
 * workspace path is supplied.
 */
export function deriveProjectScope(cwd) {
    const trimmed = cwd?.trim();
    if (!trimmed || trimmed === '*')
        return '*';
    const root = resolveWorkspaceRoot(trimmed);
    const norm = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const base = WIN_DRIVE_PATH_RE.test(root) ? win32.basename(root) : basename(norm);
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'ws';
    const hash = createHash('sha1').update(norm).digest('hex').slice(0, 8);
    return `proj:${slug}:${hash}`;
}
/** Infer a workspace root path embedded in a legacy rule text, if any. */
export function inferScopeFromRuleText(text) {
    const winMatch = text.match(/([A-Za-z]:(?:\\\\|\\|\/)[^\s"'`<>|]{3,})/);
    if (winMatch?.[1]) {
        const raw = winMatch[1].replace(/\\\\/g, '\\').replace(/\//g, '\\');
        // Prefer a two/three-segment project directory (e.g. D:\Project\nodepanel, D:\大创\_repo_sync).
        const parts = raw.split('\\').filter(Boolean);
        if (parts.length >= 3) {
            const candidate = `${parts[0]}\\${parts[1]}\\${parts[2]}`;
            if (!/^(Users|Windows|Program Files|tmp)$/i.test(parts[1] ?? '')) {
                return deriveProjectScope(candidate);
            }
            if (parts.length >= 4 && /memories/i.test(raw)) {
                const memProj = raw.match(/projects[\\/]([^\\/]+)/i);
                if (memProj?.[1])
                    return `proj:${memProj[1].slice(0, 24).toLowerCase()}`;
            }
        }
        if (parts.length >= 2)
            return deriveProjectScope(`${parts[0]}\\${parts[1]}`);
    }
    const unixMatch = text.match(/(\/(?:Users|home)\/[^/\s"'`<>|]+\/[^/\s"'`<>|]+(?:\/[^/\s"'`<>|]+)?)/);
    if (unixMatch?.[1])
        return deriveProjectScope(unixMatch[1]);
    return null;
}
/**
 * Convert machine-specific paths inside text into portable `<repo>/...` or
 * `<path>/basename` placeholders so rules do not leak usernames or drive letters.
 */
export function abstractMachinePaths(input, workspaceRoot) {
    let out = input;
    if (workspaceRoot) {
        const trimmedRoot = workspaceRoot.trim();
        const resolvedRoot = WIN_DRIVE_PATH_RE.test(trimmedRoot)
            ? win32.resolve(trimmedRoot)
            : trimmedRoot.startsWith('/')
                ? posix.resolve(trimmedRoot)
                : resolve(trimmedRoot);
        const normRoot = resolvedRoot.replace(/\\/g, '/').replace(/\/+$/, '');
        const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedFwd = escapeRe(normRoot);
        const escapedBack = escapedFwd.replace(/\//g, '\\\\');
        const escapedDoubleBack = escapedFwd.replace(/\//g, '\\\\\\\\');
        out = out
            .replace(new RegExp(escapedDoubleBack, 'gi'), '<repo>')
            .replace(new RegExp(escapedBack, 'gi'), '<repo>')
            .replace(new RegExp(escapedFwd, 'gi'), '<repo>');
    }
    out = out.replace(WIN_ABS_PATH_RE, (full) => {
        const clean = full.replace(/\\\\/g, '/').replace(/\\/g, '/');
        const segs = clean
            .split('/')
            .filter((s) => Boolean(s) && !/^[A-Za-z]:$/.test(s) && !/^(?:Users|home)$/i.test(s));
        const tail = segs.slice(-2).join('/');
        return tail ? `<path>/${tail}` : '<path>';
    });
    out = out.replace(UNIX_HOME_PATH_RE, (full) => {
        const segs = full.split('/').filter((s) => Boolean(s) && !/^(?:Users|home|root)$/i.test(s));
        const tail = segs.slice(-2).join('/');
        return tail ? `~/<path>/${tail}` : '~/<path>';
    });
    return redactOutbound(out);
}
/**
 * Unwrap raw JSON stdout wrappers or `tool=<name> input=` dumps into a clean,
 * human-readable symptom line.
 */
export function canonicalizeSymptom(raw, workspaceRoot) {
    const trimmed = raw.trim();
    if (!trimmed)
        return 'the first attempt failed';
    if (RAW_JSON_WRAPPER_RE.test(trimmed)) {
        try {
            const parsed = JSON.parse(trimmed);
            for (const key of ['stderr', 'error', 'message', 'stdout']) {
                const val = parsed[key];
                if (typeof val === 'string' && val.trim()) {
                    const first = val
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .find((l) => l.length > 0 && !/^[=\-*#\s]+$/.test(l));
                    if (first)
                        return abstractMachinePaths(redact(first), workspaceRoot).slice(0, 140);
                }
            }
        }
        catch {
            const m = trimmed.match(/"(?:stderr|error|message|stdout)"\s*:\s*"((?:[^"\\]|\\.){3,120})"/i);
            if (m?.[1]) {
                return abstractMachinePaths(redact(m[1].replace(/\\r?\\n/g, ' ')), workspaceRoot).slice(0, 140);
            }
        }
        return 'command failed with structured output';
    }
    if (RAW_TOOL_WRAPPER_RE.test(trimmed)) {
        const fileMatch = trimmed.match(/"(?:file_path|path|TargetFile|AbsolutePath)"\s*:\s*"([^"]{2,120})"/i);
        if (fileMatch?.[1]) {
            const base = basename(fileMatch[1].replace(/\\\\/g, '/'));
            return `tool call failed on ${base}`;
        }
        const cmdMatch = trimmed.match(/"(?:command|CommandLine)"\s*:\s*"([^"]{2,100})"/i);
        if (cmdMatch?.[1]) {
            return `command failed: ${abstractMachinePaths(cmdMatch[1], workspaceRoot).slice(0, 90)}`;
        }
        return 'tool invocation failed';
    }
    return abstractMachinePaths(redact(trimmed), workspaceRoot).slice(0, 160);
}
/**
 * Judge whether a rule is universal `advice`, workspace-scoped `tactic`, or
 * `quarantined` raw noise / echo garbage.
 */
export function classifyRuleQuality(ab) {
    const rubric = scoreAntibodyRubric(ab);
    const p = ab.prescription.trim();
    const s = ab.symptom.trim();
    const bare = p.replace(/\s*\(after: .+\)$/, '').trim();
    if (RAW_TOOL_WRAPPER_RE.test(p)) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'raw tool= wrapper stored as prescription',
            issues: rubric.issues,
        };
    }
    if (FILE_TOOL_ABS_DUMP_RE.test(bare)) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'machine-local absolute file-write dump',
            issues: rubric.issues,
        };
    }
    const isUnrewrittenRule = !ab.prescription_source || ab.prescription_source === 'rule';
    if (URL_TOOL_DUMP_RE.test(bare) || (isUnrewrittenRule && /\b(?:bilibili\.com|youtube\.com|alipan\.com)\b/i.test(`${s} ${bare}`))) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'one-off URL navigation dump',
            issues: rubric.issues,
        };
    }
    if (INLINE_CODE_DUMP_RE.test(bare) && isUnrewrittenRule) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'inline code snippet dump stored as prescription',
            issues: rubric.issues,
        };
    }
    if (AD_HOC_PROBE_CMD_RE.test(bare) && isUnrewrittenRule) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'ad-hoc read-only probe command dump',
            issues: rubric.issues,
        };
    }
    if (SCRIPT_DUMP_OR_CHAT_RE.test(bare) && isUnrewrittenRule) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'unrewritten shell script or chat fragment dump',
            issues: rubric.issues,
        };
    }
    if (RAW_JSON_WRAPPER_RE.test(s) && isUnrewrittenRule) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: 'unparsed JSON stdout wrapper in symptom',
            issues: rubric.issues,
        };
    }
    if (rubric.total < 48 || (rubric.portability <= 10 && ab.prescription_source !== 'human')) {
        return {
            grade: 'quarantined',
            score: rubric.total,
            universalEligible: false,
            quarantineReason: rubric.issues[0] ?? 'below admission rubric threshold (<48)',
            issues: rubric.issues,
        };
    }
    // Decision #28 & #39: deterministic rule captures (`prescription_source === 'rule'`)
    // without a curated generic lesson are workspace tactics, never universal advice.
    const isAdvice = ab.prescription_source !== 'rule' &&
        !looksEchoPrescription(p) &&
        (ab.prescription_source === 'llm' ||
            ab.prescription_source === 'host_llm' ||
            ab.prescription_source === 'human' ||
            ab.origin === 'user_correction' ||
            matchGenericLesson(s) !== null ||
            rubric.actionability >= 20);
    return {
        grade: isAdvice ? 'advice' : 'tactic',
        score: rubric.total,
        universalEligible: isAdvice && rubric.portability >= 22 && rubric.leakSafety >= 12,
        quarantineReason: null,
        issues: rubric.issues,
    };
}
/**
 * Audit and heal an existing (potentially legacy/polluted) antibody database:
 *  - Assigns inferred `project_scope` to rules containing machine project paths.
 *  - Quarantines echo-grade garbage dumps (`Write: D:\...`, raw JSON stdout, ad-hoc grep).
 *  - Cleans malformed JSON/tool-wrapper symptoms when the rule itself is salvageable.
 *  - Restores valid generic or low-failure-rate rules unjustly retired before Decision #36.
 */
export function repairLibraryHygiene(db, opts = {}) {
    const dryRun = opts.dryRun === true;
    const rows = db
        .prepare('SELECT * FROM antibodies ORDER BY hit_count DESC, id ASC')
        .all();
    const activeBefore = rows.filter((r) => r.status === 'active').length;
    let garbageActiveBefore = 0;
    let quarantined = 0;
    let scoped = 0;
    let restored = 0;
    let symptomsCleaned = 0;
    const changes = [];
    const now = Date.now();
    const updateStmt = db.prepare(`UPDATE antibodies
        SET status = ?,
            symptom = ?,
            project_scope = ?,
            quality_grade = ?,
            rubric_score = ?,
            root_cause = ?,
            retire_reason = ?,
            updated_at = ?
      WHERE id = ?`);
    for (const raw of rows) {
        const id = Number(raw.id);
        const status = String(raw.status);
        const trigger = String(raw.trigger_pattern ?? '');
        const symptom = String(raw.symptom ?? '');
        const prescription = String(raw.prescription ?? '');
        const toolName = raw.tool_name ? String(raw.tool_name) : null;
        const hitCount = Number(raw.hit_count ?? 0);
        const failCount = Number(raw.fail_count ?? 0);
        const source = String(raw.prescription_source ?? '');
        const origin = String(raw.origin ?? '');
        let repairPath = [];
        try {
            const parsed = JSON.parse(String(raw.repair_path ?? '[]'));
            if (Array.isArray(parsed))
                repairPath = parsed.filter((v) => typeof v === 'string');
        }
        catch {
            repairPath = [];
        }
        const verdict = classifyRuleQuality({
            trigger_pattern: trigger,
            symptom,
            prescription,
            tool_name: toolName,
            repair_path: repairPath,
            prescription_source: source,
            origin,
            hit_count: hitCount,
            fail_count: failCount,
        });
        if (status === 'active' && verdict.grade === 'quarantined')
            garbageActiveBefore += 1;
        let nextStatus = status;
        let nextSymptom = symptom;
        let nextScope = String(raw.project_scope ?? '*');
        let nextRetireReason = String(raw.retire_reason ?? '');
        const inferredScope = inferScopeFromRuleText(`${trigger} ${symptom} ${prescription}`);
        if (inferredScope && nextScope === '*' && !verdict.universalEligible) {
            nextScope = inferredScope;
            scoped += 1;
            changes.push({ id, action: 'scoped', detail: `assigned project_scope=${inferredScope}` });
        }
        if (RAW_JSON_WRAPPER_RE.test(symptom) || RAW_TOOL_WRAPPER_RE.test(symptom)) {
            const cleaned = canonicalizeSymptom(symptom);
            if (cleaned && cleaned !== symptom) {
                nextSymptom = cleaned;
                symptomsCleaned += 1;
                changes.push({ id, action: 'cleaned_symptom', detail: `cleaned wrapper symptom` });
            }
        }
        if (verdict.grade === 'quarantined' && status === 'active') {
            nextStatus = 'quarantined';
            nextRetireReason = verdict.quarantineReason ?? 'hygiene_quarantined';
            quarantined += 1;
            changes.push({
                id,
                action: 'quarantined',
                detail: `${verdict.quarantineReason} (score=${verdict.score})`,
            });
        }
        else if (status === 'retired' &&
            verdict.grade !== 'quarantined' &&
            verdict.score >= 60 &&
            (matchGenericLesson(nextSymptom) !== null ||
                (hitCount >= 10 && failCount < Math.max(hitCount, failCount) * 0.25)) &&
            nextRetireReason !== 'superseded_by_env_upgrade') {
            // Restore unjustly retired high-value universal/low-failure rules (e.g. #37 / #66).
            nextStatus = 'active';
            nextRetireReason = '';
            restored += 1;
            changes.push({
                id,
                action: 'restored',
                detail: `low failure rate (${failCount}/${hitCount}) or generic lesson (score=${verdict.score})`,
            });
        }
        const rootCause = inferRootCause(nextSymptom, prescription, repairPath);
        if (!dryRun) {
            updateStmt.run(nextStatus, nextSymptom, nextScope, verdict.grade, verdict.score, rootCause, nextRetireReason, now, id);
        }
    }
    const activeAfter = activeBefore - quarantined + restored;
    const garbageAfterCount = 0; // Active rules after repair have zero quarantined items.
    return {
        scanned: rows.length,
        activeBefore,
        activeAfter,
        quarantined,
        scoped,
        restored,
        symptomsCleaned,
        garbageRateBefore: activeBefore > 0 ? Number((garbageActiveBefore / activeBefore).toFixed(3)) : 0,
        garbageRateAfter: activeAfter > 0 ? Number((garbageAfterCount / activeAfter).toFixed(3)) : 0,
        dryRun,
        changes,
    };
}
