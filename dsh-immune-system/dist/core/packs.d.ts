/**
 * Builtin seed packs for `immune seed <pack>`.
 *
 * Every rule here is hand-authored by the maintainers — the same trust class
 * as core/lessons.ts's generic lessons, NOT model output. Each one is either
 * a lesson this project paid for itself (printf-% in commit messages,
 * --force-with-lease, push protection on fixtures, node:sqlite's version bar,
 * Windows file:// imports) or a universal, durable pitfall for that stack.
 * Triggers are keyword-rich like live rules, so recall works the same way.
 */
import type { BaselineLevel } from './baseline.js';
import type { SeedRule } from './store/seeds.js';
export interface SeedPackRule extends SeedRule {
    baseline?: BaselineLevel;
}
export interface SeedPack {
    id: string;
    label: string;
    description: string;
    rules: SeedPackRule[];
}
export declare const BUILTIN_PACKS: SeedPack[];
