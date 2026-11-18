import type { ImmuneStore } from '../../../core/store/index.js';
export declare function cmdStats(store: ImmuneStore, args?: string[]): number;
export declare function cmdDetours(store: ImmuneStore): number;
export declare function cmdCoverage(store: ImmuneStore, args: string[]): number;
export declare function cmdConsolidate(store: ImmuneStore, args: string[]): number;
export declare function cmdHygiene(store: ImmuneStore, args: string[]): number;
export declare function cmdTriage(store: ImmuneStore, args?: string[]): number;
export declare function cmdReceipts(store: ImmuneStore, args?: string[]): number;
export declare function cmdModels(store: ImmuneStore, args?: string[]): number;
export declare function cmdExplain(store: ImmuneStore, args: string[]): number;
export declare function cmdRewriteSyncOrAsync(store: ImmuneStore, args: string[], onAsyncFinish: () => void): {
    asyncStarted: boolean;
    code: number;
};
