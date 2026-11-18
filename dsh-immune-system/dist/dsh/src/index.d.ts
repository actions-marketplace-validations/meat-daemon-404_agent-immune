import { type DshContext } from './dsh-adapter.js';
export declare const name = "dsh-immune-system";
export declare const inject: string[];
export { PLUGIN_NAME, DSH_EVENTS, normaliseToolEvent } from './dsh-adapter.js';
export declare function readWebTabState(registry: unknown): string;
export declare function apply(ctx: DshContext): void;
