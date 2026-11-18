/**
 * Meaningful lowercase tokens of a text.
 *
 * Extracts from BOTH the head and any `error=`/`result=` tail (so long `Edit`
 * diffs never push the actual error code past the 32-token cap), splits
 * hyphenated trigger slugs (`old_string-not-found` -> `old_string`, `found`),
 * and includes CJK trigrams while filtering function stopwords.
 */
export declare function signals(text: string): Set<string>;
/**
 * True when the antibody's trigger shares at least one meaningful term with the
 * failure, ignoring the tool name itself.
 *
 * The tool name is excluded on purpose: almost every trigger starts with "Bash"
 * or "Edit", so sharing it would mark everything as related.
 */
export declare function isRelated(trigger: string, failureText: string, toolName: string): boolean;
