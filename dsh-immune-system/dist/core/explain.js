import { deriveProjectScope } from './hygiene.js';
import { expandConceptQuery, lexicalTriggerAffinity } from './retrieval.js';
import { cjkBigrams, tokenize } from './store/tokenize.js';
import { timeDecay } from './store/rerank.js';
import { strings } from './i18n.js';
function queryPathTokens(query) {
    const tokens = new Set();
    for (const match of query.matchAll(/[\w@./\\-]+\.[A-Za-z0-9]{1,8}\b/g)) {
        const value = match[0].replace(/\\/g, '/').toLowerCase();
        if (value.length >= 3)
            tokens.add(value);
    }
    for (const match of query.matchAll(/(?:^|[\s"'(])((?:[\w-]+\/)+[\w-]+)/g)) {
        const value = match[1]?.replace(/\\/g, '/').toLowerCase();
        if (value && value.length >= 3)
            tokens.add(value);
    }
    return [...tokens].slice(0, 12);
}
function hasPathAffinity(trigger, tokens) {
    if (tokens.length === 0)
        return false;
    const haystack = trigger.replace(/\\/g, '/').toLowerCase();
    return tokens.some((token) => {
        if (haystack.includes(token))
            return true;
        const base = token.split('/').pop();
        return Boolean(base && base.length >= 5 && haystack.includes(base));
    });
}
function sanitizeAngleBrackets(text) {
    return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}
function renderPreviewBlock(rows) {
    if (rows.length === 0)
        return '';
    const s = strings();
    const lines = rows.map((row, idx) => {
        const trig = sanitizeAngleBrackets(row.trigger_pattern).slice(0, 120);
        const avoid = sanitizeAngleBrackets(row.symptom).slice(0, 140);
        const fix = sanitizeAngleBrackets(row.prescription).slice(0, 180);
        return `${idx + 1}. [${s.trigger}: ${trig}] ${s.avoid}: ${avoid} -> ${s.do}: ${fix}`;
    });
    return `<immune_memory>\n${s.promptPreamble}\n${lines.join('\n')}\n</immune_memory>`;
}
export function explainRecall(store, query, opts = {}) {
    const trimmed = query.trim();
    const limit = Math.max(1, Math.min(10, opts.limit ?? 3));
    const cwd = opts.cwd ?? process.cwd();
    const projectScope = deriveProjectScope(cwd);
    if (!trimmed) {
        return {
            query: '',
            expandedQuery: '',
            addedConcepts: [],
            projectScope,
            candidates: [],
            renderedBlock: '',
        };
    }
    const expandedQuery = expandConceptQuery(trimmed);
    const addedConcepts = expandedQuery.length > trimmed.length
        ? expandedQuery
            .slice(trimmed.length)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
        : [];
    const wide = limit * 2;
    const own = store.peek(trimmed, wide, projectScope);
    const delivered = new Set(own.map((r) => r.prescription));
    const shared = [];
    const sharedSet = new Set();
    // Read shared library read-only via sharedAntibodies + in-memory match check
    if (own.length < wide) {
        const queryToks = tokenize(expandedQuery, 20).map((t) => t.toLowerCase());
        const queryBgs = cjkBigrams(expandedQuery, 16);
        for (const candidate of store.sharedAntibodies(200)) {
            if (candidate.status !== 'active')
                continue;
            if (delivered.has(candidate.prescription))
                continue;
            const hay = `${candidate.trigger_pattern} ${candidate.symptom} ${candidate.prescription}`.toLowerCase();
            const matched = queryToks.some((t) => t.length >= 3 && !/[\u4e00-\u9fff]/.test(t) && hay.includes(t)) ||
                queryBgs.some((bg) => hay.includes(bg));
            if (!matched)
                continue;
            shared.push(candidate);
            sharedSet.add(candidate);
            delivered.add(candidate.prescription);
            if (own.length + shared.length >= wide)
                break;
        }
    }
    const merged = [...own, ...shared];
    const aff = (r) => opts.toolName && r.tool_name?.toLowerCase() === opts.toolName.toLowerCase() ? 0 : 1;
    const ordered = merged
        .map((r, i) => ({ r, i }))
        .sort((x, y) => aff(x.r) - aff(y.r) || x.i - y.i);
    const rankByRule = new Map(ordered.map((e, idx) => [e.r, idx]));
    const pathTokens = queryPathTokens(trimmed);
    const expandedTokens = tokenize(expandedQuery, 20)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 2 && !/[\u4e00-\u9fff]/.test(t));
    const expandedBigrams = cjkBigrams(expandedQuery, 16);
    const now = Date.now();
    const explained = merged.map((ab) => {
        const rankIdx = rankByRule.get(ab) ?? 0;
        const baseRelevance = 1 / (1 + rankIdx);
        const hitMultiplier = 1 + Math.log1p(Math.max(0, ab.hit_count));
        const pathBoost = hasPathAffinity(ab.trigger_pattern, pathTokens) ? 1.5 : 1.0;
        const lex = lexicalTriggerAffinity(trimmed, ab);
        const lexMult = lex > 0 ? 1 + Math.min(4.5, lex * 0.65) : 1.0;
        const rubric = ab.rubric_score ?? 70;
        const rubricMult = rubric >= 85 ? 1.12 : rubric < 50 ? 0.7 : 1.0;
        const isShared = sharedSet.has(ab);
        const sharedDiscount = isShared ? 0.85 : 1.0;
        const stamp = ab.updated_at || ab.created_at || now;
        const decay = timeDecay(now - stamp);
        const finalScore = baseRelevance * hitMultiplier * pathBoost * lexMult * rubricMult * sharedDiscount * decay;
        const hay = `${ab.trigger_pattern} ${ab.symptom} ${ab.prescription}`.toLowerCase();
        const matchedTokens = expandedTokens.filter((t) => hay.includes(t));
        const matchedBigrams = expandedBigrams.filter((bg) => hay.includes(bg));
        const round = (n) => Math.round(n * 1000) / 1000;
        return {
            id: ab.id,
            source: isShared ? 'shared' : 'project',
            trigger_pattern: ab.trigger_pattern,
            symptom: ab.symptom,
            prescription: ab.prescription,
            tool_name: ab.tool_name ?? null,
            project_scope: ab.project_scope ?? '*',
            quality_grade: ab.quality_grade ?? 'advice',
            rubric_score: rubric,
            hit_count: ab.hit_count,
            breakdown: {
                bm25Rank: rankIdx + 1,
                baseRelevance: round(baseRelevance),
                hitMultiplier: round(hitMultiplier),
                pathAffinityBoost: round(pathBoost),
                lexicalAffinity: round(lex),
                lexicalMultiplier: round(lexMult),
                rubricMultiplier: round(rubricMult),
                sharedDiscount: round(sharedDiscount),
                timeDecay: round(decay),
                finalScore: round(finalScore),
            },
            matchedTokens,
            matchedBigrams,
        };
    });
    explained.sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore);
    const top = explained.slice(0, limit);
    return {
        query: trimmed,
        expandedQuery,
        addedConcepts,
        projectScope,
        candidates: top,
        renderedBlock: renderPreviewBlock(top),
    };
}
