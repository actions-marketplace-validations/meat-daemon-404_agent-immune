import type { ImmuneStore } from '../../../core/store/index.js';
export declare function cmdSeed(store: ImmuneStore, args: string[]): number;
export declare function cmdIngestSkill(store: ImmuneStore, args: string[]): number;
export declare function cmdIngestDisk(store: ImmuneStore, args: string[]): number;
export declare function cmdWorkspaces(store: ImmuneStore, args?: string[]): number;
export declare function cmdBackfillAsync(store: ImmuneStore, args: string[], onDone: () => void): void;
export declare function cmdAudit(store: ImmuneStore, args: string[], onAsyncDone: () => void): {
    asyncStarted: boolean;
    code: number;
};
