import { ImmuneStore } from '../../core/store/index.js';
export declare const RESOURCES: readonly [{
    readonly uri: "immune://library/active";
    readonly name: "Active Pitfall Antibodies";
    readonly description: "Redacted JSON snapshot of active pitfall antibodies in the current project store.";
    readonly mimeType: "application/json";
}, {
    readonly uri: "immune://stats/summary";
    readonly name: "Immunity Telemetry Summary";
    readonly description: "Live counts, SHA-256 receipt chain status, Red-3 triage summary, and Pre-Flight Guard totals.";
    readonly mimeType: "application/json";
}, {
    readonly uri: "immune://workspace/dna";
    readonly name: "Workspace DNA & Vaccine Lockfile";
    readonly description: "Detected stack markers, package manager, recommended packs, and .immune/vaccine.lock.json verification.";
    readonly mimeType: "application/json";
}, {
    readonly uri: "immune://guard/events";
    readonly name: "Pre-Flight Guard Audit Ledger";
    readonly description: "Recent live Pre-Flight Guard interceptions (redacted) and policy breakdown.";
    readonly mimeType: "application/json";
}, {
    readonly uri: "immune://insights/report";
    readonly name: "Diagnosis & Forensic Autopsy Report";
    readonly description: "Real-telemetry Immunity Score, Agent Pitfall Archetype, 5-domain radar, and Forensic Autopsy.";
    readonly mimeType: "application/json";
}];
export declare const PROMPTS: readonly [{
    readonly name: "immune_review_pitfalls";
    readonly description: "Inject relevant workspace pitfall antibodies and a pre-flight safety checklist before editing or running risky commands.";
    readonly arguments: readonly [{
        readonly name: "query";
        readonly description: "Optional task, file path, or error keyword to filter relevant antibodies.";
        readonly required: false;
    }, {
        readonly name: "limit";
        readonly description: "Maximum number of antibodies to include (default 8).";
        readonly required: false;
    }];
}, {
    readonly name: "immune_triage_failure";
    readonly description: "Build a structured Red-3 root-cause triage prompt for a failing command or stack trace, grounded in existing antibodies.";
    readonly arguments: readonly [{
        readonly name: "error";
        readonly description: "The error message or failing command trace.";
        readonly required: true;
    }, {
        readonly name: "tool";
        readonly description: "Optional tool name (Bash, Edit, Write).";
        readonly required: false;
    }];
}, {
    readonly name: "immune_rewrite_echoes";
    readonly description: "Prepare a host-delegated rewrite prompt for up to 3 echo-grade antibodies so the host model can upgrade them into clean advice.";
    readonly arguments: readonly [];
}];
/** Dispatch one tools/call. Kept pure-ish so tests can call it without stdio. */
export declare function callTool(store: ImmuneStore, name: string, args: Record<string, unknown>): string;
/** Read one MCP resource URI (strictly read-only; never bumps hit counts). */
export declare function readResource(store: ImmuneStore, uri: string, workspace?: string): {
    uri: string;
    mimeType: string;
    text: string;
} | null;
/** Render one MCP prompt template with live read-only workspace pitfalls. */
export declare function getPrompt(store: ImmuneStore, name: string, args?: Record<string, unknown>): {
    description: string;
    messages: Array<{
        role: 'user';
        content: {
            type: 'text';
            text: string;
        };
    }>;
} | null;
/** Run the stdio loop. Resolves when stdin closes. */
export declare function runMcpServer(env?: NodeJS.ProcessEnv): Promise<void>;
