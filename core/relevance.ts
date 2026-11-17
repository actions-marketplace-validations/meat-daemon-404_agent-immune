/**
 * Deciding whether a failure is plausibly related to an antibody.
 *
 * Without this, every injected antibody is blamed for every later failure in
 * the same turn. A good rule would then be retired because an unrelated command
 * failed, which is worse than not having the rule at all.
 */
import { tokenize } from './store/tokenize.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Words that carry no topic. Without this list "not" alone made a rule about
 * `old_string not found` look related to `operation not permitted`, so the
 * anti-rot guard could blame (and eventually retire) an unrelated rule — and
 * the coverage report counted such failures as covered.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'you', 'your', 'are', 'was', 'were', 'has', 'have', 'had', 'but', 'not',
  'can', 'cannot', 'could', 'would', 'should', 'does', 'did', 'its', 'any',
  'all', 'use', 'using', 'into', 'when', 'then', 'than', 'too', 'also', 'via',
  'out', 'off', 'per', 'yet', 'one', 'two', 'been', 'being', 'since', 'before',
  'after', 'during', 'while', 'about', 'over', 'under',
]);

/** Overlapping 3-character windows, so Chinese phrases can be compared. */
function cjkGrams(token: string, size = 3): string[] {
  const chars = [...token];
  if (chars.length <= size) return [token];
  const out: string[] = [];
  for (let i = 0; i + size <= chars.length; i += 1) out.push(chars.slice(i, i + size).join(''));
  return out;
}

/**
 * Meaningful lowercase tokens of a text.
 *
 * Extracts from BOTH the head and any `error=`/`result=` tail (so long `Edit`
 * diffs never push the actual error code past the 32-token cap), splits
 * hyphenated trigger slugs (`old_string-not-found` -> `old_string`, `found`),
 * and includes CJK trigrams while filtering function stopwords.
 */
export function signals(text: string): Set<string> {
  const out = new Set<string>();
  const addFrom = (slice: string, maxTokens: number) => {
    for (const token of tokenize(slice, maxTokens)) {
      const lower = token.toLowerCase();
      if (lower.length >= 3 && !STOPWORDS.has(lower)) out.add(lower);
      if (lower.includes('-')) {
        for (const sub of lower.split('-')) {
          if (sub.length >= 3 && !STOPWORDS.has(sub)) out.add(sub);
        }
      }
      if (CJK.test(token)) for (const gram of cjkGrams(token)) out.add(gram.toLowerCase());
    }
  };
  addFrom(text, 24);
  const tailMatch = /(?:error=|result=|\[exit code:|\bexit code\b)/i.exec(text);
  if (tailMatch && tailMatch.index > 0) {
    addFrom(text.slice(tailMatch.index, tailMatch.index + 600), 24);
  } else if (text.length > 400) {
    addFrom(text.slice(-400), 18);
  }
  return out;
}

/**
 * True when the antibody's trigger shares at least one meaningful term with the
 * failure, ignoring the tool name itself.
 *
 * The tool name is excluded on purpose: almost every trigger starts with "Bash"
 * or "Edit", so sharing it would mark everything as related.
 */
export function isRelated(trigger: string, failureText: string, toolName: string): boolean {
  const ignore = toolName.toLowerCase();
  const a = [...signals(trigger)].filter((t) => t !== ignore);
  if (a.length === 0) return false;
  const b = signals(failureText);
  return a.some((token) => b.has(token));
}
