/**
 * Search-token helpers.
 *
 * The FTS5 index uses the `trigram` tokenizer, which indexes every 3-character
 * sequence of the stored text. That gives correct CJK substring matching, but
 * only if the QUERY is also expressed as trigrams: a long Chinese phrase is not
 * itself a substring of a shorter stored field. So CJK tokens are expanded into
 * overlapping 3-character windows before the MATCH expression is built.
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Conversational / functional 2-character Chinese words that carry zero domain
 * specificity. Without this filter, a prompt like "继续优化" or "帮我看看" matches
 * `git rebase ... 继续` via the 2-char LIKE fallback. Domain 2-char terms
 * (跨域, 端口, 权限, 死锁, 借用, 并发, 锁表, 缩进, 转义, 编码, 乱码, 备份…) stay untouched.
 */
const CJK_STOP_BIGRAMS = new Set([
  '继续', '优化', '一下', '这个', '那个', '什么', '怎么', '如何', '为什',
  '可以', '需要', '帮我', '帮忙', '看看', '现在', '已经', '还是', '如果',
  '或者', '以及', '因为', '所以', '但是', '然后', '开始', '下一', '一步',
  '好的', '一个', '一些', '我们', '你们', '自己', '没有', '进行', '使用',
  '通过', '之后', '之前', '这里', '那里', '请问', '谢谢', '麻烦', '直接',
]);

const CJK_STOP_TRIGRAMS = new Set([
  '继续优', '续优化', '好的继', '的继续', '下一步', '帮我看', '我看看',
  '看看这', '看这里', '改一下', '看一下', '看看现', '看现在',
]);

/** Split text into candidate tokens, keeping paths and CJK runs intact. */
export function tokenize(text: string, max = 16): string[] {
  const cleaned = text.replace(/[^\p{L}\p{N}_.\-/@]+/gu, ' ').trim();
  if (!cleaned) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const token = raw.replace(/^[.\-/@]+|[.\-/@]+$/g, '');
    if (token.length < 2) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

/** Overlapping 3-character windows of a CJK token, covering head AND tail of long runs. */
function cjkGrams(token: string, size = 3, max = 14): string[] {
  const chars = [...token];
  if (chars.length <= size) return [token];
  const grams: string[] = [];
  for (let i = 0; i + size <= chars.length && grams.length < max; i += 1) {
    grams.push(chars.slice(i, i + size).join(''));
  }
  return grams;
}

/**
 * Two-character CJK windows from free text, for the LIKE fallback.
 * Windows are taken inside every CJK run so natural Chinese sentences still
 * expose 2-character domain terms (跨域, 端口, 权限, 死锁, 备份…) without tail truncation.
 */
export function cjkBigrams(text: string, max = 14): string[] {
  const out: string[] = [];
  for (const token of tokenize(text)) {
    const chars = [...token];
    if (chars.length < 2) continue;
    for (let i = 0; i + 1 < chars.length && out.length < max; i += 1) {
      const window = `${chars[i]}${chars[i + 1]}`;
      if (!/^[\u4e00-\u9fff]{2}$/u.test(window)) continue;
      if (CJK_STOP_BIGRAMS.has(window)) continue;
      if (!out.includes(window)) out.push(window);
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build an FTS5 MATCH expression from free text.
 *
 * Terms shorter than the trigram window are dropped (they could never match),
 * and each term is quoted with embedded quotes doubled, so user text can never
 * inject FTS5 syntax.
 */
export function buildFtsQuery(text: string, maxTerms = 24): string | null {
  const terms: string[] = [];
  const push = (value: string) => {
    if ([...value].length < 3) return;
    if (CJK_STOP_TRIGRAMS.has(value)) return;
    if (terms.some((t) => t.toLowerCase() === value.toLowerCase())) return;
    terms.push(value);
  };

  for (const token of tokenize(text)) {
    if (CJK.test(token)) {
      for (const gram of cjkGrams(token)) push(gram);
    } else {
      push(token);
    }
    if (terms.length >= maxTerms) break;
  }

  if (terms.length === 0) return null;
  return terms
    .slice(0, maxTerms)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}
