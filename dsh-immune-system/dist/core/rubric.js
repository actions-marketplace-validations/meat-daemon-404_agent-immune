import { redactOutbound } from './redact.js';
const ABS_WIN_PATH = /(?<![A-Za-z])[A-Za-z]:(?:\\\\|\\|\/)[^\s"'`<>|]{2,}/;
const ABS_UNIX_HOME = /\/(?:Users|home)\/[^\s"'`<>|]{2,}|\/root\/[^\s"'`<>|]+/;
const RAW_JSON_WRAP = /^\s*\{\s*"(?:stdout|stderr|interrupted|isImage|filePath|command|code)"\s*:/i;
const RAW_TOOL_PREFIX = /^\s*tool=[A-Za-z0-9_-]+\s+input=/i;
const ECHO_CMD_DUMP = /^(?!(?:Edit|Write|MultiEdit|NotebookEdit|Note|Tip|Fix|Do|Avoid)\b)[A-Za-z][\w-]*:\s+.{32,}/i;
const FILE_TOOL_ABS_DUMP = /^(?:Edit|Write|MultiEdit|NotebookEdit):\s*(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/root\/|~?\/?<path>|<repo>|[\w./\\-]+\.[A-Za-z0-9]{1,8}\s*$)/i;
const INLINE_CODE_DUMP = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bawait\s+[A-Za-z_$][\w$.]*\(|\bfunction\s+[A-Za-z_$]|\bdef\s+[A-Za-z_]\w*\s*\(|;\s*(?:const|let|var|await|return)\b/;
const AD_HOC_PROBE = /^(?:(?:bash|pwsh|powershell):\s*)?(?:grep|rg|sed|awk|head|tail|cat|ls|dir|find|tasklist|Get-ChildItem|Get-NetTCPConnection|Get-Process|Get-Content|Select-String|Write-Output|\$[A-Za-z_]+\s*=)/i;
const CHAT_FRAGMENT_NOISE = /^(?:还有[，,]|\s*npowershell\b|\$pids\s*=\s*\d+)/i;
const RAW_URL_DUMP = /^[A-Za-z][\w-]*:\s*https?:\/\/\S+\s*$/i;
const IP_URL_OR_SSH = /\b(?:\d{1,3}\.){3}\d{1,3}\b|ssh\s+-i\b/i;
const SESSION_URL = /https?:\/\/(?:[\w-]+\.)*(?:bilibili\.com|youtube\.com|alipan\.com|aliyundrive\.com|pan\.baidu\.com|feishu\.cn|dingtalk\.com|localhost(?::\d+)?)/i;
const MEDIA_OR_ARCHIVE_FILE = /\b[\w-]{3,}\.(?:mp4|mov|mkv|avi|mp3|wav|png|jpe?g|webp|gif|pdf|docx?|pptx?|xlsx?|zip|rar|7z)\b/i;
/** Infer causal root cause from error + repair signals. */
export function inferRootCause(symptomOrError, prescription, repairs = []) {
    const combined = `${symptomOrError} ${prescription} ${repairs.join(' ')}`.toLowerCase();
    if (/not been read yet|modified since read|old_string|re-read|先.*read|重新\s*read/i.test(combined)) {
        return 'stale_read';
    }
    if (/econnreset|etimedout|rate.?limit|\b429\b|\b503\b|network|timeout|超时/i.test(combined)) {
        return 'flake';
    }
    if (/eacces|eperm|enoent|err_unsupported_esm|module not found|command not found|path|盘符|环境变量|loadenv|port|eaddrinuse/i.test(combined)) {
        return 'env_or_path';
    }
    if (/tsconfig|package\.json|browserslist|eslint|prettier|config|wrangler|docker|yaml|toml|peer|eresolve/i.test(combined) || repairs.length > 0) {
        return 'config_mismatch';
    }
    if (/inputschema|validation|is not a function|typeerror|ts\d{4}|schema|api|404|400|422/i.test(combined)) {
        return 'api_or_schema_drift';
    }
    if (/before|first|prerequisite|缺少|先装|先构建|install|build/i.test(combined)) {
        return 'missing_prerequisite';
    }
    if (/powershell|quoting|syntax|flag|escape|转义|引号|crlf/i.test(combined)) {
        return 'command_syntax';
    }
    return 'other';
}
/**
 * Compute the deterministic 5-dimension rubric score for any rule candidate.
 * Calibration guarantees:
 *  - Clean generalized advice (`Edit: re-read...`, LLM-distilled rules) scores >= 80.
 *  - Clean scoped command tactics (`npm run build -> npx tsc`) score 55..75.
 *  - Raw command/path/JSON dumps (`Write: D:\...`, `{"stdout":...}`) score < 45.
 */
export function scoreAntibodyRubric(rule) {
    const trigger = rule.trigger_pattern.trim();
    const symptom = rule.symptom.trim();
    const prescription = rule.prescription.trim();
    const issues = [];
    // 1. Specificity (0..20): meaningful trigger tokens & clear non-boilerplate symptom.
    let specificity = 14;
    const triggerTokens = trigger.split(/\s+/).filter(Boolean);
    if (triggerTokens.length >= 3 && triggerTokens.length <= 10)
        specificity += 6;
    else if (triggerTokens.length < 2) {
        specificity -= 8;
        issues.push('weak trigger (<2 tokens)');
    }
    if (!symptom || symptom === 'the first attempt failed' || symptom === '(no symptom recorded)') {
        specificity -= 6;
        issues.push('generic or empty symptom');
    }
    if (RAW_JSON_WRAP.test(symptom) || RAW_TOOL_PREFIX.test(symptom)) {
        specificity -= 12;
        issues.push('raw JSON/tool wrapper in symptom');
    }
    specificity = Math.max(0, Math.min(20, specificity));
    // 2. Actionability (0..25): advice sentence vs raw command/code dump.
    let actionability = rule.prescription_source === 'rule' ? 18 : 22;
    const barePrescription = prescription.replace(/\s*\(after: .+\)$/, '').trim();
    if (RAW_TOOL_PREFIX.test(barePrescription)) {
        actionability = 2;
        issues.push('raw tool trace as prescription');
    }
    else if (FILE_TOOL_ABS_DUMP.test(barePrescription) ||
        RAW_URL_DUMP.test(barePrescription) ||
        INLINE_CODE_DUMP.test(barePrescription)) {
        actionability = 4;
        issues.push('one-off file/URL/code dump as prescription');
    }
    else if (AD_HOC_PROBE.test(barePrescription) || CHAT_FRAGMENT_NOISE.test(barePrescription)) {
        actionability = 6;
        issues.push('ad-hoc read-only probe or script/chat dump stored as prescription');
    }
    else if (ECHO_CMD_DUMP.test(barePrescription)) {
        actionability = 10;
        issues.push('long raw tool/shell dump (needs LLM rewrite)');
    }
    else if (/^(?:#{1,6}\s|>\s)/.test(barePrescription)) {
        actionability = 5;
        issues.push('markdown heading or quote fragment, not actionable advice');
    }
    else if (barePrescription.length > 160 || (rule.prescription_source === 'rule' && barePrescription.length > 115)) {
        actionability = 8;
        issues.push('overlong prescription (>115 chars deterministic / >160 chars)');
    }
    else if (barePrescription.length < 8) {
        actionability = 5;
        issues.push('too short to be actionable');
    }
    else if (rule.prescription_source === 'llm' ||
        rule.prescription_source === 'host_llm' ||
        rule.prescription_source === 'human' ||
        rule.origin === 'user_correction') {
        actionability = 25;
    }
    // 3. Portability (0..25): absence of machine-local paths, IPs, asset files, or session-only URLs.
    let portability = 25;
    const combined = `${symptom} ${barePrescription}`;
    if (ABS_WIN_PATH.test(combined) || ABS_UNIX_HOME.test(combined)) {
        portability -= 18;
        issues.push('machine-local absolute path');
    }
    if (IP_URL_OR_SSH.test(combined)) {
        portability -= 15;
        issues.push('hardcoded IP or SSH identity path');
    }
    if (SESSION_URL.test(combined)) {
        portability -= 15;
        issues.push('session-specific URL');
    }
    if (MEDIA_OR_ARCHIVE_FILE.test(combined)) {
        portability -= 12;
        issues.push('project-specific media or archive filename');
    }
    portability = Math.max(0, Math.min(25, portability));
    // 4. Evidence strength (0..15): repair path, LLM/human provenance, or survival rate.
    let evidenceStrength = 7;
    if ((rule.repair_path?.length ?? 0) > 0)
        evidenceStrength += 4;
    if (rule.origin === 'user_correction' || rule.origin === 'self_healing_experiment')
        evidenceStrength += 3;
    if (rule.prescription_source === 'llm' || rule.prescription_source === 'host_llm')
        evidenceStrength += 3;
    const hits = rule.hit_count ?? 0;
    const fails = rule.fail_count ?? 0;
    if (hits >= 5 && fails <= hits * 0.1)
        evidenceStrength += 3;
    if (fails >= 3 && fails >= Math.max(hits, fails) * 0.25)
        evidenceStrength -= 5;
    evidenceStrength = Math.max(0, Math.min(15, evidenceStrength));
    // 5. Leak safety (0..15): redaction cleanliness.
    let leakSafety = 15;
    if (redactOutbound(combined) !== combined) {
        leakSafety -= 12;
        issues.push('contains redactable user path, email, or secret-shaped token');
    }
    leakSafety = Math.max(0, Math.min(15, leakSafety));
    const total = specificity + actionability + portability + evidenceStrength + leakSafety;
    return {
        total,
        specificity,
        actionability,
        portability,
        evidenceStrength,
        leakSafety,
        issues,
    };
}
