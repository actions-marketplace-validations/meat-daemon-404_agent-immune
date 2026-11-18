import { ImmuneStore } from '../../core/store/index.js';
/** Dispatch one tools/call. Kept pure-ish so tests can call it without stdio. */
export declare function callTool(store: ImmuneStore, name: string, args: Record<string, unknown>): string;
/** Run the stdio loop. Resolves when stdin closes. */
export declare function runMcpServer(env?: NodeJS.ProcessEnv): Promise<void>;
