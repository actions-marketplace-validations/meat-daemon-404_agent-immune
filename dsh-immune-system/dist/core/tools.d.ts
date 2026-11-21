/**
 * Canonical cross-host tool taxonomy (v4.0).
 *
 * Single source of truth for normalising tool names emitted by ZCode, DSH,
 * Claude Code, Codex CLI, Google Antigravity, Gemini CLI, Cursor, Windsurf,
 * OpenCode, Kiro, and MCP hosts so pairing, repair-path tracking, passive-read
 * filtering, and Pre-Flight Guard scoping never drift across modules.
 */
export type CanonicalToolName = 'Bash' | 'Edit' | 'Write' | 'Read' | 'Grep' | 'Glob';
/**
 * Normalise a host tool name into the canonical pairing vocabulary when known,
 * or return the trimmed original name verbatim for custom/MCP tools.
 */
export declare function canonicalToolName(toolName: string): string;
/** True when the tool executes shell commands. */
export declare function isShellToolName(toolName: string): boolean;
/** True when the tool operates directly on a file path (Read/Edit/Write family). */
export declare function isFileToolName(toolName: string): boolean;
/** True when the tool only reads or searches without mutating workspace state. */
export declare function isPassiveReadToolName(toolName: string): boolean;
/** True when the tool writes/edits files (counted in episode repair paths). */
export declare function isRepairToolName(toolName: string): boolean;
