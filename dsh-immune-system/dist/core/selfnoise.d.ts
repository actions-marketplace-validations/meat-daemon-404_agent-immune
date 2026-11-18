/**
 * Self-noise detection.
 *
 * Two proven failure modes drove this design:
 *
 *  1. The plugin was learning from failures while editing its OWN files. These
 *     are maintenance, not reusable pitfalls, and they occupied the injection
 *     budget of every later session.
 *  2. A path-prefix check against the working directory missed the dev checkout
 *     whenever it lived OUTSIDE the project (or behind a junction / pnpm link),
 *     so a documented blind spot let several such rules through.
 *
 * Detection therefore works from two physical facts instead of configuration:
 *  - the real location this module is loaded from (survives junction/symlink),
 *  - the `package.json` fingerprint of any path named in the trace, which
 *    identifies another clone of the plugin wherever it sits on disk.
 */
/** Physical package root this module runs from (junction/symlink resolved). */
export declare function moduleRoot(): string | null;
/**
 * True when `trace` describes the plugin operating on itself.
 *
 * `markers` are host-supplied path hints (plugin install / data directories);
 * they are still honoured, but the two physical checks above no longer depend
 * on them being complete.
 */
export declare function isSelfEpisode(trace: string, markers?: string[]): boolean;
