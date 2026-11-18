/**
 * Search-token helpers.
 *
 * The FTS5 index uses the `trigram` tokenizer, which indexes every 3-character
 * sequence of the stored text. That gives correct CJK substring matching, but
 * only if the QUERY is also expressed as trigrams: a long Chinese phrase is not
 * itself a substring of a shorter stored field. So CJK tokens are expanded into
 * overlapping 3-character windows before the MATCH expression is built.
 */
/** Split text into candidate tokens, keeping paths and CJK runs intact. */
export declare function tokenize(text: string, max?: number): string[];
/**
 * Two-character CJK windows from free text, for the LIKE fallback.
 * Windows are taken inside every CJK run so natural Chinese sentences still
 * expose 2-character domain terms (跨域, 端口, 权限, 死锁, 备份…) without tail truncation.
 */
export declare function cjkBigrams(text: string, max?: number): string[];
/**
 * Build an FTS5 MATCH expression from free text.
 *
 * Terms shorter than the trigram window are dropped (they could never match),
 * and each term is quoted with embedded quotes doubled, so user text can never
 * inject FTS5 syntax.
 */
export declare function buildFtsQuery(text: string, maxTerms?: number): string | null;
