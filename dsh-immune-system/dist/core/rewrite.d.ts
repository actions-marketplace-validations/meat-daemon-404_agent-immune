/**
 * Rewriting echo-grade prescriptions.
 *
 * The deterministic distiller cannot write advice: given no repair evidence
 * beyond the command that happened to work, its prescription IS that command.
 * Production data shows the cost — six of thirteen active rules are raw
 * command dumps (one is 160 characters of `gh api`), and they account for
 * roughly half of all deliveries. A model looking at the rule can say what the
 * command accomplished; this module is the only path allowed to replace a
 * prescription in place, and it says where the replacement came from.
 */
import type { Antibody } from './types.js';
import type { LlmConfig } from './llm.js';
import { chat } from './llm.js';
import type { ImmuneStore } from './store/index.js';
export declare const REWRITE_PROMPT = "You rewrite ONE stored pitfall rule so its prescription reads as an action, not a command dump.\n\nInput JSON: { \"tool\", \"trigger\", \"symptom\", \"currentPrescription\" }\n\ncurrentPrescription is a raw command or tool trace captured when the failure was fixed. Treat it as evidence of what worked, not as the answer.\n\n\"symptom\" was written by an earlier pass and may be stale or wrong \u2014 several production rules carry the same generic symptom because an early lesson matched them all. Trust the command in currentPrescription over the symptom.\n\nOutput strictly JSON, no prose, no fence: {\"prescription\": \"...\"}\n\nRules:\n- One imperative sentence, at most 60 characters, in the language of the symptom.\n- State what the command ACCOMPLISHES, not the command itself (\"point the build at the local binary, then rebuild\").\n- Use only facts present in the input. Never invent paths, flags, tool names or APIs.\n- Strip vendor-specific banners and internal tool names.\n- Never include secrets, tokens, hostnames or absolute user paths.\n- If the command's purpose cannot be told from the input, output {\"skip\": true} instead of guessing.";
/** Prescriptions that only echo the trace cannot teach anything. */
export declare function looksEchoPrescription(prescription: string): boolean;
/** Active rules whose prescription is a command dump, worst offenders first. */
export declare function echoCandidates(store: ImmuneStore): Antibody[];
export interface RewriteItem {
    id: number;
    from: string;
    to?: string;
    status: 'rewritten' | 'skipped' | 'failed';
    detail?: string;
}
export interface RewriteReport {
    candidates: number;
    rewritten: number;
    skipped: number;
    failed: number;
    dryRun: boolean;
    items: RewriteItem[];
}
/** Parse the model's answer; null means "no usable prescription". */
export declare function parseRewrite(raw: string): {
    ok: true;
    prescription: string;
} | {
    ok: false;
    reason: string;
};
export declare function rewriteEchoes(store: ImmuneStore, opts: {
    llm: LlmConfig;
    max?: number;
    dryRun?: boolean;
    ids?: number[];
}, deps?: {
    chat?: typeof chat;
}): Promise<RewriteReport>;
