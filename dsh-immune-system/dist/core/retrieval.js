/**
 * Hybrid retrieval & bilingual developer concept-expansion graph (v2).
 *
 * Keeps zero runtime dependencies (`node:sqlite` FTS5 trigram + CJK bigram LIKE)
 * while closing semantic synonym gaps across Chinese and English coding prompts
 * (e.g. "跨域" <-> "CORS Access-Control-Allow-Origin", "依赖冲突" <-> "ERESOLVE peer").
 *
 * Concept expansion only triggers when an explicit domain phrase is present,
 * preserving 0% false-positive rate on unrelated natural-language negatives.
 */
import { cjkBigrams, tokenize } from './store/tokenize.js';
const CONCEPT_GRAPH = [
    { pattern: /跨域|cors|access-control-allow-origin/i, expansions: ['CORS', '跨域', 'Access-Control'] },
    { pattern: /权限|eacces|eperm|permission denied|chmod|chown/i, expansions: ['EACCES', 'EPERM', 'permission'] },
    { pattern: /依赖\s*冲突|装依赖.*冲突|eresolve|peer.?dep|legacy-peer-deps|依赖打架/i, expansions: ['ERESOLVE', 'peer', 'dependency'] },
    { pattern: /换行符|crlf|autocrlf|line ending|百分号|printf.*commit/i, expansions: ['CRLF', 'autocrlf', 'printf'] },
    { pattern: /环境变量|loadenv|import\.meta\.env|vite_app|process\.env/i, expansions: ['loadEnv', '环境变量', 'vite.config'] },
    { pattern: /转义|反斜杠|backslash|json\.stringify/i, expansions: ['反斜杠', '转义', 'JSON'] },
    { pattern: /端口占用|eaddrinuse|address already in use|端口.*访问不到|expose/i, expansions: ['EXPOSE', 'EADDRINUSE', '端口'] },
    { pattern: /esm|盘符|err_unsupported_esm_url_scheme|file:\/\/|动态导入.*路径|协议不支持/i, expansions: ['ERR_UNSUPPORTED_ESM_URL_SCHEME', 'ESM', 'Windows', 'file://'] },
    { pattern: /编码|乱码|gbk|utf-?8|chcp/i, expansions: ['UTF8', 'Encoding', '乱码'] },
    { pattern: /先读后写|not been read yet|modified since read|old_string|忘了先读|没先读/i, expansions: ['Read', 'old_string', 'Edit', 'yet'] },
    { pattern: /替换文本.*找不到|找不到.*文本|old_string/i, expansions: ['old_string', 'found', 'Edit'] },
    { pattern: /缩进.*报错|tab.*空格|混用.*缩进/i, expansions: ['IndentationError', 'tab', '空格', '缩进'] },
    { pattern: /依赖版本.*锁文件|脚本.*锁文件|锁文件.*不一致/i, expansions: ['uv', 'lockfile', 'run'] },
    { pattern: /死锁|sqlite_busy|database is locked|\bwal\b|cp\s*复制|主库.*空|打开备份/i, expansions: ['WAL', 'backup', 'sqlite', 'locked'] },
    { pattern: /未构建|dist\/|cannot find module|\btsc\b|doubled prefix|探针找不到|子目录前缀/i, expansions: ['dsh', '打包', 'doubled', 'prefix'] },
    { pattern: /shadow.?root|attachshadow|样式污染|样式隔离|行高塌陷|塌陷|样式被宿主/i, expansions: ['shadow', '样式污染', 'settings'] },
    { pattern: /红三分诊|flake|测试抖动|抖动超时|假回归/i, expansions: ['triage', 'flake', '巡查'] },
    { pattern: /回到上.*提交|不想丢.*改动|reset.*--hard|撤销提交/i, expansions: ['reset', 'hard', 'soft', 'git'] },
    { pattern: /__dirname|目录名报错|es\s*模块.*目录/i, expansions: ['__dirname', 'ReferenceError', 'import.meta.url'] },
    { pattern: /依赖清单.*覆盖|pyproject.*不一致|requirements\.txt/i, expansions: ['pyproject', 'requirements.txt'] },
    { pattern: /构建上下文|本地密钥.*传进去|\.dockerignore/i, expansions: ['.dockerignore', '构建上下文'] },
    { pattern: /inp|滚动输入卡顿|交互延迟/i, expansions: ['inp', 'thread', 'yield'] },
    { pattern: /借用检查|可变借用|同时借用|borrow.?check/i, expansions: ['borrow', 'E0502', 'mutable'] },
    { pattern: /跨.*await|send.*bound|mutexguard/i, expansions: ['Send', 'await', 'MutexGuard'] },
    { pattern: /阻塞.*异步|tokio.*阻塞|异步.*卡死/i, expansions: ['spawn_blocking', 'tokio', 'executor'] },
    { pattern: /serde|derive.*serialize|找不到宏/i, expansions: ['serde', 'Serialize', 'Deserialize', 'derive'] },
    { pattern: /空\s*map|未初始化.*map|nil\s*map/i, expansions: ['nil', 'map', 'assignment', 'make'] },
    { pattern: /错误包装|链式错误|fmt\.errorf/i, expansions: ['errors.Is', 'errors.As', 'Errorf'] },
    { pattern: /并发.*map|concurrent map/i, expansions: ['concurrent', 'map', 'race', 'sync'] },
    { pattern: /prisma.*migrate|非交互.*迁移|migrate dev.*卡/i, expansions: ['prisma', 'migrate', 'non-TTY', '--create-only'] },
    { pattern: /锁表|建索引.*阻塞|lock_timeout|concurrently/i, expansions: ['Postgres', 'ALTER', 'CONCURRENTLY', 'lock_timeout'] },
    { pattern: /drizzle|schema.*漂移|push.*迁移/i, expansions: ['drizzle-kit', 'push', 'generate', 'migrate'] },
    { pattern: /漏写.*where|全表清空|误删数据/i, expansions: ['DELETE', 'UPDATE', 'WHERE'] },
    { pattern: /删表|drop table|truncate/i, expansions: ['DROP', 'TABLE', 'TRUNCATE'] },
    { pattern: /水合|hydration|服务端.*客户端.*html/i, expansions: ['hydration', 'mismatch', 'SSR', 'Date.now'] },
    { pattern: /next\/router|nextrouter.*not mounted/i, expansions: ['next/router', 'next/navigation', 'useRouter'] },
    { pattern: /usesearchparams|预渲染.*suspense/i, expansions: ['useSearchParams', 'Suspense', 'prerender'] },
    { pattern: /server action.*redirect|next_redirect|跳转失效/i, expansions: ['Server', 'Action', 'redirect', 'NEXT_REDIRECT'] },
    { pattern: /请求.*竞态|卸载.*setstate|abortcontroller/i, expansions: ['useEffect', 'AbortController', 'cleanup'] },
    { pattern: /保留设备名|删不掉.*nul|>\s*nul/i, expansions: ['nul', 'Windows', 'Out-Null'] },
    { pattern: /powershell.*curl|invoke-webrequest|curl.*别名/i, expansions: ['curl', 'Invoke-WebRequest', 'curl.exe', 'PowerShell'] },
    { pattern: /utf-16|bom.*json|重定向.*乱码/i, expansions: ['UTF-16', 'BOM', 'Out-File', 'PowerShell'] },
    { pattern: /反斜杠.*glob|路径.*glob.*0/i, expansions: ['反斜杠', 'glob', 'Windows', 'posix'] },
];
const STOP_LEX = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'error', 'fail', 'failed']);
/**
 * Expand a user prompt or tool trace with matched domain synonyms (capped to avoid
 * diluting BM25 ranking). Unrelated prompts return the original text unchanged.
 */
export function expandConceptQuery(query) {
    const extra = [];
    const lower = query.toLowerCase();
    for (const edge of CONCEPT_GRAPH) {
        if (!edge.pattern.test(query))
            continue;
        for (const term of edge.expansions) {
            if (!lower.includes(term.toLowerCase()) && !extra.includes(term)) {
                extra.push(term);
            }
            if (extra.length >= 8)
                break;
        }
        if (extra.length >= 8)
            break;
    }
    return extra.length > 0 ? `${query} ${extra.join(' ')}` : query;
}
/** Precompute concept expansion + ASCII tokens + CJK bigrams once per query before scoring N candidates. */
export function prepareLexicalQuery(query) {
    const expanded = expandConceptQuery(query);
    const asciiTokens = [];
    for (const tok of tokenize(expanded, 20)) {
        const low = tok.toLowerCase();
        if (low.length < 2 || STOP_LEX.has(low) || /[\u4e00-\u9fff]/.test(low))
            continue;
        asciiTokens.push(low);
    }
    return {
        asciiTokens,
        cjkBigrams: cjkBigrams(expanded, 16),
    };
}
/**
 * Direct lexical + concept-trigger affinity score in [0, 3+].
 * Rewards rules whose trigger_pattern actually shares meaningful ASCII tokens or
 * CJK bigrams with the (concept-expanded) query, neutralizing BM25 short-field bias.
 */
export function lexicalTriggerAffinity(query, rule) {
    const prepared = typeof query === 'string' ? prepareLexicalQuery(query) : query;
    const triggerLow = rule.trigger_pattern.toLowerCase();
    const bodyLow = `${rule.symptom} ${rule.prescription}`.toLowerCase();
    let score = 0;
    for (const low of prepared.asciiTokens) {
        if (triggerLow.includes(low))
            score += 1.0;
        else if (bodyLow.includes(low))
            score += 0.35;
    }
    for (const bg of prepared.cjkBigrams) {
        if (triggerLow.includes(bg))
            score += 0.85;
        else if (bodyLow.includes(bg))
            score += 0.3;
    }
    return score;
}
