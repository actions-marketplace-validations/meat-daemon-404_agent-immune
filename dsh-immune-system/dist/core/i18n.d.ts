/**
 * Text shown to the user and to the model — bilingual by default.
 *
 * The injected block appears on every matching turn, so its wording matters
 * more than anything else here: an English-only preamble in a Chinese session
 * reads as noise, and a Chinese-only one does the same for an English session.
 *
 * Both languages are emitted together, kept to one short line each so the extra
 * tokens stay cheap. `IMMUNE_LOCALE=zh-CN` or `=en` forces a single language for
 * anyone who wants to trim context cost.
 */
export type Locale = 'zh-CN' | 'en' | 'both';
export interface Strings {
    /** Line above the injected antibodies at prompt time. */
    promptPreamble: string;
    /** Line above the just-in-time warning on a tool call. */
    toolPreamble: string;
    /** Short labels inside each antibody line, e.g. "触发/trigger". */
    trigger: string;
    avoid: string;
    do: string;
    /** Provenance line: the actions that repaired the problem. */
    repairedBy: string;
    /** CLI output. */
    noAntibodies: string;
    noExport: string;
    exported: string;
    forgot: string;
    learned: string;
    notFound: string;
    /** Zombie prune (never-injected, old). */
    pruned: string;
    purged: string;
    noZombies: string;
}
/**
 * Resolve the active locale.
 *
 * Default is bilingual. An explicit `IMMUNE_LOCALE` opts into a single language.
 */
export declare function resolveLocale(env?: NodeJS.ProcessEnv): Locale;
export declare function strings(locale?: Locale): Strings;
