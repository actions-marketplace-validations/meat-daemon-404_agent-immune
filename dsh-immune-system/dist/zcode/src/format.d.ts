/**
 * Formatting helpers for the ZCode adapter.
 *
 * Two jobs: render antibodies as a compact context block, and summarise tool
 * events into the short traces the distiller works from.
 */
import type { Antibody } from '../../core/types.js';
/**
 * Render at most a handful of antibodies as an `<immune_memory>` block.
 *
 * Each field is clamped individually AND the whole block is clamped: per-field
 * caps keep one bloated rule from consuming the whole budget, and the global
 * cap keeps three of them from doing it together.
 */
export declare function formatImmuneContext(antibodies: Antibody[], maxChars?: number): string;
/**
 * Render a just-in-time warning for PreToolUse.
 *
 * Tighter than the prompt-time block: this appears on the tool call itself, so
 * every extra word competes with the tool result the model is about to read.
 */
export declare function formatToolWarning(antibodies: Antibody[], maxChars?: number): string;
/** Short, redactable description of a tool invocation. */
export declare function summarizeToolCall(toolName: string, toolInput: unknown): string;
/** Describe a failure from a PostToolUseFailure event. */
export declare function summarizeFailure(event: Record<string, unknown>): string;
/**
 * Describe a success from a PostToolUse event.
 *
 * Prefers the runtime's own preview when present, because `tool_response` is a
 * raw handler result whose shape differs per tool.
 */
export declare function summarizeSuccess(event: Record<string, unknown>): string;
