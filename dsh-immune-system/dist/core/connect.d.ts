/**
 * The vendored install: connect copies this package's dist into
 * `~/.dsh-immune/` and points the host hooks there, so the commands survive
 * an npx cache cleanup or an upgrade of the copy that ran `connect`. Without
 * this, `npx dsh-immune-system@latest connect …` writes a _npx cache path
 * into the host config and the hooks die silently on the next cache sweep.
 */
export declare function vendorRootOf(home: string): string;
/** The running package's version — both repo and npm layouts (core/version.ts). */
export declare function ownVersion(): string;
export interface VendorInfo {
    dir: string;
    distDir: string;
    version: string;
    /** True when the dist tree was (re)copied during this call. */
    refreshed: boolean;
}
/**
 * Copy the dist tree into the vendor root unless that version is already
 * there. `force` re-copies (a dev checkout can change code without a version
 * bump). The version marker records what is vendored and when.
 */
export declare function vendorDist(home: string, opts?: {
    force?: boolean;
}): VendorInfo;
export type ConnectHostId = 'claude-code' | 'codex' | 'antigravity' | 'gemini-cli' | 'cursor' | 'vscode' | 'windsurf' | 'zed' | 'roo-code' | 'claude-desktop' | 'cline' | 'opencode' | 'kiro';
/** One hook script wired into a host event, in the shared `command` dialect. */
interface HookHandler {
    type: 'command';
    command: string;
    timeout: number;
}
/** A matcher group as both Claude Code settings.json and Codex hooks.json use. */
export interface HookGroup {
    matcher?: string;
    hooks: HookHandler[];
}
export type HookEventEntry = HookGroup | HookHandler;
export interface HostDefinition {
    id: ConnectHostId;
    label: string;
    /** Config file, relative to the user's home directory. */
    relativeConfigPath: string;
    /** Optional sidecar MCP config file (relative to home) wired alongside hooks (e.g. Cursor). */
    sidecarMcpConfigPath?: string;
    /**
     * Key inside the config JSON that holds the event table. Claude Code keeps
     * hooks under `hooks` in settings.json; a Codex hooks.json IS the table;
     * Antigravity nests named hook packs under `"dsh-immune-system"`; MCP-only
     * hosts store servers under `"mcpServers"`.
     */
    eventsKey: string | null;
    /** Codex, Antigravity, Gemini CLI, and Cursor have no PostToolUseFailure event. */
    includesFailureHook: boolean;
    dialect?: 'standard' | 'antigravity' | 'gemini-cli' | 'cursor' | 'mcp';
    /** MCP entry shape: standard `{ command, args }` vs OpenCode `{ type: 'local', command: [...] }`. */
    mcpFormat?: 'standard' | 'opencode';
    /** Extra steps the user must take after connecting. */
    notes: string[];
}
export declare const HOSTS: Record<ConnectHostId, HostDefinition>;
export interface ConnectOptions {
    /** Override the user's home directory (tests). */
    home?: string;
    /** Override the dist hooks directory (tests). */
    scriptDir?: string;
    /** Re-copy the vendored dist even when the version matches (dev refresh). */
    refresh?: boolean;
}
export interface ConnectReport {
    host: string;
    label: string;
    configPath: string;
    scriptDir: string;
    /** Event names this host's runtime actually supports. */
    eventsWired: string[];
    added: number;
    alreadyPresent: number;
    /** Immune entries replaced because their command was stale. */
    upgraded: number;
    removed: number;
    backupPath: string | null;
    notes: string[];
    /** The vendored install, when connect (re)built it. */
    vendorDir: string | null;
    vendorVersion: string | null;
    vendorRefreshed: boolean;
}
/** The compiled hooks directory that ships next to this module in dist/. */
export declare function defaultScriptDir(): string;
export declare function extractScriptPath(command: string): string;
/** Build the event table this module would write — exported for tests. */
export declare function buildEventTable(host: HostDefinition, scriptDir: string): Record<string, HookEventEntry[]>;
/** Add the immune hooks (and/or MCP server) to the host's config. Idempotent; upgrades stale paths. */
export declare function connectHost(hostId: ConnectHostId, options?: ConnectOptions): ConnectReport;
/** Read-only look at the vendored install (never copies). */
export declare function vendorInfoOf(home: string): {
    dir: string;
    version: string | null;
};
/** Immune command strings currently wired into a host's config. */
export declare function listImmuneCommands(hostId: ConnectHostId, home?: string): string[];
export interface ConnectPathIssue {
    host: string;
    label: string;
    /** Command strings whose target script file no longer exists. */
    broken: string[];
}
/**
 * The npx-cache failure mode, made visible: a connected host whose hook/MCP
 * commands point at files that no longer exist. `immune doctor` reports it;
 * the fix is one `connect <host>` re-run.
 */
export declare function verifyConnectedPaths(home?: string): ConnectPathIssue[];
/** Remove every immune hook/MCP entry from the host's config. */
export declare function disconnectHost(hostId: ConnectHostId, options?: ConnectOptions): ConnectReport;
/** Disconnect every host that currently carries immune hooks or MCP entries. */
export declare function disconnectAllConnected(options?: ConnectOptions): ConnectReport[];
export type ConnectionState = 'connected' | 'not-connected' | 'no-config';
export interface ConnectStatusRow {
    host: string;
    label: string;
    configPath: string;
    state: ConnectionState;
    events: string[];
}
/** Which hosts already carry immune hooks or MCP entries, without writing anything. */
export declare function connectStatus(options?: ConnectOptions): ConnectStatusRow[];
/**
 * Zero-arg `connect`: which hosts does this machine actually have installed?
 * The signal is each host's home directory — the same evidence the hosts'
 * own installers leave behind. ZCode is detected but deliberately NOT wired
 * by connect: it installs immune through its plugin marketplace, and a
 * settings.json hook would double-fire with the plugin's hooks.
 */
export interface DetectedHost {
    host: string;
    label: string;
    /** The install signal that matched. */
    marker: string;
    /** Whether connectAllDetected wires this host. */
    wired: boolean;
    /** Why a detected host is not wired by connect. */
    reason?: string;
}
export declare function detectHosts(home: string): DetectedHost[];
export interface ConnectAllReport {
    /** connectHost reports for every detected, wirable host. */
    wired: ConnectReport[];
    /** Everything detected, including hosts connect deliberately skips. */
    detected: DetectedHost[];
}
/** Wire every detected host in one idempotent pass (zero-arg `connect`). */
export declare function connectAllDetected(options?: ConnectOptions): ConnectAllReport;
export {};
