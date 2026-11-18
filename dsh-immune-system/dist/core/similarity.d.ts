/**
 * Character 3-gram Jaccard similarity, used to merge near-duplicate rules.
 *
 * Why character n-grams and not word tokens: prescriptions are short, mixed
 * Chinese/English sentences ("用 pnpm 装依赖" vs "用 pnpm 安装依赖"), and word
 * tokenisation of CJK is unreliable without a dictionary. Character trigrams
 * are language-agnostic and cheap.
 */
/** Set of character trigrams; shorter strings fall back to their whole self. */
export declare function charTrigrams(text: string): Set<string>;
/** J(A,B) = |A ∩ B| / |A ∪ B|; 0 for two empty sets. */
export declare function jaccard(a: Set<string>, b: Set<string>): number;
/** Set of characters (for the short-text blend). */
export declare function charSet(text: string): Set<string>;
/**
 * Similarity used to decide whether two prescriptions are the same rule.
 *
 * Trigram Jaccard alone is too harsh for short CJK sentences: inserting one
 * character ("装依赖" → "安装依赖") shifts every following trigram, so a rule
 * that means the same thing scores ~0.55. Character-set Jaccard is too loose
 * for long text. The blend takes the MAX of the two, which keeps long, genuinely
 * different prescriptions apart while recognising short rewordings.
 */
export declare function prescriptionSimilarity(left: string, right: string): number;
