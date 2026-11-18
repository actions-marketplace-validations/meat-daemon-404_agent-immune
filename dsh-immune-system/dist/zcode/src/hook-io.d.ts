export interface HookEvent {
    hook_event_name?: string;
    hookEventName?: string;
    session_id?: string;
    sessionId?: string;
    conversationId?: string;
    conversation_id?: string;
    workspacePaths?: string[];
    workspace_roots?: string[];
    transcriptPath?: string;
    artifactDirectoryPath?: string;
    modelName?: string;
    model?: string;
    lastUserInput?: string;
    invocationNum?: number;
    initialNumSteps?: number;
    stepIdx?: number;
    toolCall?: {
        name?: string;
        args?: Record<string, unknown>;
    };
    terminationReason?: string;
    fullyIdle?: boolean;
    cwd?: string;
    command?: string;
    output?: string;
    file_path?: string;
    edits?: unknown[];
    tool_name?: string;
    toolName?: string;
    tool_input?: unknown;
    tool_response?: unknown;
    tool_result_preview?: string;
    error?: unknown;
    error_details?: unknown;
    prompt?: string;
    source?: string;
    [key: string]: unknown;
}
export declare function log(message: string): void;
/**
 * The only stdout write this plugin performs. Kept to the single documented
 * shape so strict schema validation cannot fail on an extra key.
 */
export declare function emitContext(eventName: string, additionalContext: string): void;
/**
 * Deny a tool call (PreToolUse only).
 *
 * Uses the one additional shape the schema allows for this event. Only the
 * three documented keys are emitted — an extra key fails validation and the
 * whole hook is discarded, which would silently turn a deny into an allow.
 */
export declare function emitDeny(eventName: string, reason: string): void;
export declare function isAntigravityEvent(event: HookEvent): boolean;
export declare function isGeminiCliEvent(event: HookEvent): boolean;
export declare function isCursorEvent(event: HookEvent): boolean;
/**
 * Normalise host-specific parameter names (e.g. Antigravity's CommandLine /
 * Path / TargetFile) into the canonical fields core/ expects while preserving
 * all original keys.
 */
export declare function normaliseToolInput(raw: unknown): unknown;
/** Fold Antigravity / Cursor / Gemini CLI fields into the shared HookEvent shape. */
export declare function normaliseHookEvent(event: HookEvent): HookEvent;
export declare function readEvent(): Promise<HookEvent>;
export declare function eventNameOf(event: HookEvent, fallback: string): string;
export declare function sessionIdOf(event: HookEvent): string;
export declare function normaliseToolName(name: string): string;
export declare function toolNameOf(event: HookEvent): string;
/**
 * Run a hook body. `body` returns the context to inject, or null to stay
 * silent. Any throw is logged and swallowed: a broken plugin must not break
 * the session.
 */
export declare function runHook(fallbackName: string, body: (event: HookEvent, eventName: string) => Promise<string | null> | string | null): Promise<void>;
