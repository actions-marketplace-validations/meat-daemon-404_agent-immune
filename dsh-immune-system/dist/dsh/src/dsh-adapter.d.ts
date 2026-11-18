/** The plugin label stamped on injected messages and used as the Cordis id. */
export declare const PLUGIN_NAME = "dsh-immune-system";
/**
 * Event names the adapter subscribes to.
 *
 * - `sessionStart`    — `packages\core\agent\src\runtime-types.ts:217` (`@mode emit`)
 * - `preStep`         — `packages\core\agent\src\runtime-types.ts:231` (`@mode waterfall`)
 * - `preToolExecute`  — `packages\core\tools\src\index.ts:152` (`@mode waterfall`)
 * - `postToolExecute` — `packages\core\tools\src\index.ts:175` (`@mode waterfall`)
 * - `turnStopping`    — `packages\core\agent\src\runtime-types.ts:278` (`@mode serial`)
 */
export declare const DSH_EVENTS: {
    readonly sessionStart: "agent/session-start";
    readonly preStep: "agent/pre-step";
    readonly preToolExecute: "tools/pre-execute";
    readonly postToolExecute: "tools/post-execute";
    readonly turnStopping: "agent/turn-stopping";
};
/** A text block. Mirrors `TextBlock` at `packages\llm\llm\src\types.ts:53-56`. */
export interface DshContentBlock {
    readonly type: string;
    readonly text?: string;
}
/**
 * A message the plugin injects. Mirrors `createUserMessage(...)` output —
 * `packages\llm\llm\src\message.ts:192-199` — including the `kind:'plugin'`
 * source that keeps the text from rendering as a human prompt in derived
 * history (`MessageSourceMap` at `packages\llm\llm\src\message.ts:100-105`).
 */
export interface DshUserMessage {
    readonly id: string;
    readonly role: 'user';
    readonly content: ReadonlyArray<DshContentBlock>;
    readonly source: {
        readonly kind: 'plugin';
        readonly plugin: string;
    };
}
/** The agent handle. Mirrors `Agent` at `packages\core\agent\src\runtime-types.ts:66-143`. */
export interface DshAgent {
    /** `Agent.id` is typed `SessionId` — `runtime-types.ts:66`. */
    readonly id: string;
    readonly session: {
        readonly header: {
            readonly id: string;
        };
    };
    /** `runtime-types.ts:143`. Synchronous; queues onto the `next-step` inbox. */
    inject(message: DshUserMessage): void;
}
/** Tool failure detail. Mirrors `ToolFailure` at `packages\core\tools\src\index.ts:481`. */
export interface DshToolFailure {
    readonly message: string;
    readonly info?: {
        readonly name: string;
        readonly code: string;
    };
}
/**
 * The execution handle handed to a tool listener. Mirrors `ToolExecutionInput`
 * plus `token` at `packages\core\tools\src\index.ts:191-205`.
 */
export interface DshToolExecution {
    readonly callId: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly agent?: DshAgent;
    readonly signal: {
        readonly aborted: boolean;
    };
}
/**
 * The normalized dispatch result. Mirrors `ToolExecutionSuccess` /
 * `ToolExecutionFailure` / `ToolExecutionResult` at
 * `packages\core\tools\src\index.ts:556-580`.
 */
export type DshToolResult = {
    readonly isError: false;
    readonly value: unknown;
    readonly content: ReadonlyArray<DshContentBlock>;
} | {
    readonly isError: true;
    readonly error: DshToolFailure;
    readonly content: ReadonlyArray<DshContentBlock>;
};
/** `PreStepDecision` at `packages\core\agent\src\runtime-types.ts:53-55`. */
export type DshPreStepDecision = {
    readonly kind: 'reject';
} | {
    readonly kind: 'enter';
    readonly messages: DshUserMessage[];
};
/** `PreToolDecision` at `packages\core\tools\src\index.ts:588-591`. */
export type DshPreToolDecision = {
    readonly kind: 'allow';
} | {
    readonly kind: 'deny';
    readonly reason: string;
} | {
    readonly kind: 'ask';
    readonly reason?: string;
};
/** `PostToolDecision` at `packages\core\tools\src\index.ts:188-193`. */
export type DshPostToolDecision = {
    readonly kind: 'accept';
    readonly content?: ReadonlyArray<DshContentBlock>;
} | {
    readonly kind: 'block';
    readonly feedback: ReadonlyArray<DshContentBlock>;
};
/** Payload of `agent/pre-step` — `packages\core\agent\src\runtime-types.ts:231`. */
export interface DshPreStepPayload {
    readonly agent: DshAgent;
    readonly messages: DshUserMessage[];
    readonly turn: number;
    readonly step: number;
    readonly signal: {
        readonly aborted: boolean;
    };
}
/** Payload of `agent/session-start` — `packages\core\agent\src\runtime-types.ts:217`. */
export interface DshSessionStartPayload {
    readonly agent: DshAgent;
    readonly source: 'startup' | 'resume' | 'clear' | 'compact';
}
/**
 * Payload of `agent/turn-stopping` — `packages\core\agent\src\runtime-types.ts:278`
 * (`@mode serial`). Awaited before the turn boundary commits, so it is the last
 * place to do turn-end work without stalling a tool result mid-turn.
 */
export interface DshTurnStoppingPayload {
    readonly agent: DshAgent;
    readonly turn: number;
    readonly signal: {
        readonly aborted: boolean;
    };
}
/**
 * A session handle as handed to a `session/event` listener —
 * `packages\core\session\src\index.ts:76` (`'session/event'(this, session, event)`).
 */
export interface DshSession {
    readonly header: {
        readonly id: string;
    };
}
/**
 * One durable session event — `packages\core\session\src\types.ts:408-440`:
 * `{ type, seq, time, data }`. We only read `user/message` events, whose
 * `data` is the appended `UserMessage`.
 */
export interface DshSessionEvent {
    readonly type: string;
    readonly seq: number;
    readonly time: number;
    readonly data: unknown;
}
/** `CommandInvocation` at `packages\interaction\commands\src\index.ts:34-51`. */
export interface DshCommandInvocation {
    readonly commandId: string;
    readonly agent: DshAgent;
    /** The remaining command-line text — there is no separate `args` field. */
    readonly rawInput: string;
    readonly signal: {
        readonly aborted: boolean;
    };
}
/** `CommandResult` at `packages\interaction\commands\src\types.ts:27-34`. */
export type DshCommandResult = {
    readonly kind: 'success';
    readonly text?: string;
} | {
    readonly kind: 'error';
    readonly text: string;
};
/** `CommandDefinition` at `packages\interaction\commands\src\index.ts:54-69`. */
export interface DshCommandDefinition {
    readonly name: string;
    readonly description: string;
    readonly input?: {
        readonly hint: string;
        readonly images?: boolean;
    };
    readonly handler: (invocation: DshCommandInvocation) => DshCommandResult | Promise<DshCommandResult>;
}
export interface DshLogger {
    info(message: string): void;
    warn(message: string): void;
}
/**
 * The slice of the Cordis `Context` this plugin touches.
 *
 * `logger`, `on` and `effect` are members of the Context itself; `commands` is a
 * service and therefore requires `export const inject = ['commands']` — an
 * un-injected service property throws `cannot get property "commands" without
 * inject` (`vendor\cordis\src\reflect.ts:144`).
 */
export interface DshContext {
    readonly logger: DshLogger;
    /** `vendor\cordis\src\events.ts:97`. */
    on(event: typeof DSH_EVENTS.sessionStart, listener: (payload: DshSessionStartPayload) => void): () => boolean;
    on(event: typeof DSH_EVENTS.preStep, listener: (payload: DshPreStepPayload, next: () => Promise<DshPreStepDecision>) => Promise<DshPreStepDecision>): () => boolean;
    /**
     * Before dispatch — `packages\core\tools\src\index.ts:152` (`@mode waterfall`).
     * `next()` allows; returning a decision replaces the outcome. Used only for
     * the opt-in guard: `PreToolDecision` has no context channel, so an advisory
     * (non-blocking) warning cannot be delivered from here.
     */
    on(event: typeof DSH_EVENTS.preToolExecute, listener: (exec: DshToolExecution, next: () => Promise<DshPreToolDecision>) => Promise<DshPreToolDecision>): () => boolean;
    on(event: typeof DSH_EVENTS.postToolExecute, listener: (exec: DshToolExecution, result: DshToolResult, next: () => Promise<DshPostToolDecision>) => Promise<DshPostToolDecision>): () => boolean;
    /**
     * Turn end — `packages\core\agent\src\runtime-types.ts:278` (`@mode serial`).
     * Awaited before the boundary commits; returning a promise therefore delays
     * turn close (but never stalls a tool result mid-turn).
     */
    on(event: typeof DSH_EVENTS.turnStopping, listener: (payload: DshTurnStoppingPayload) => void | Promise<void>): () => boolean;
    /**
     * Durable session events — `packages\core\session\src\index.ts:76`. Used to
     * remember the latest human prompt so a cold `resume`/`compact` start (whose
     * `agent/pre-step` batch carries no human message) can still recall.
     */
    on(event: 'session/event', listener: (session: DshSession, event: DshSessionEvent) => void): () => boolean;
    /** `vendor\cordis\src\fiber.ts:415-418`. */
    effect(execute: () => () => void, label?: string): unknown;
    readonly commands: {
        /** `packages\interaction\commands\src\index.ts:270-277`. */
        register(definition: DshCommandDefinition): () => void;
    };
    /**
     * Service lookup without an `inject` edge (cordis `ctx.get`, as used by
     * `packages\context\agent-instructions\src\index.ts:116` for `fs`). Read-only
     * here: it reports whether the host composed the web client row, so a missing
     * settings tab can be diagnosed from `/immune` instead of guessed at.
     */
    get?(name: string): unknown;
    /**
     * Optional dependency activation (`ctx.inject(deps, cb)`), the same shape
     * `dsh/src/ui-route.ts` relies on. Used only to wait until `clientModules`
     * exists before reporting the web-tab state; a host without it is fine.
     */
    inject?(deps: string[], callback: (ctx: unknown) => void): unknown;
}
/** Normalised tool outcome, so call sites never read raw host fields. */
export interface NormalisedToolEvent {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    ok: boolean;
    errorText: string;
    /** The model-facing result text; used to capture the fix on the success leg. */
    resultText: string;
    /**
     * The call was refused by the sandbox's file-access policy, not by the tool.
     * A permission negotiation is environmental, so it is reported but never
     * learned from: distilling it can only restate the same command.
     */
    sandboxDenied: boolean;
}
/** Concatenate the text blocks of a content array. */
export declare function textOf(content: ReadonlyArray<DshContentBlock>): string;
/**
 * Decide success vs failure from the signals DSH actually provides.
 *
 * Authority order, highest first:
 *  1. `isError` — the host already classified it (but a thrown file tool can
 *     still carry the sandbox marker in its message, so it is checked too);
 *  2. a sandbox file-access denial — reported, but flagged so it is not learned;
 *  3. a kill signal / timeout — a status marker that can co-exist with exit 0;
 *  4. the structured `value.exitCode` — **authoritative for shell tools**;
 *  5. a structured `value` payload with no exit status — the tool encoded its
 *     own outcome, so its text is data and is not scanned;
 *  6. the rendered `[exit code: N]` trailer;
 *  7. `FAILURE_MARKERS` text — only for results that carry *no* structured
 *     status, since a successful command may legitimately print `Error:` or
 *     `command not found` in its own output (grep, test runners, docs).
 */
export declare function judgeOutcome(result: DshToolResult, resultText: string): {
    ok: boolean;
    errorText: string;
    sandboxDenied: boolean;
};
/**
 * Convert a real `(exec, result)` pair from `tools/post-execute` into the shape
 * `core/` consumes.
 *
 * Returns `undefined` for a call with no agent: a direct `ctx.tools.execute()`
 * invocation has no session to attribute the episode to (the same guard
 * `repeat-tool-reminder` uses at `packages\guard\repeat-tool-reminder\src\index.ts`).
 */
export declare function normaliseToolEvent(exec: DshToolExecution, result: DshToolResult): NormalisedToolEvent | undefined;
/**
 * Build the message `agent.inject()` takes.
 *
 * Mirrors what `createUserMessage` produces (`packages\llm\llm\src\message.ts:192-199`)
 * without importing `@deepseek-ai/dsh-llm`, so the plugin resolves from any
 * `node_modules` layout.
 */
export declare function createPluginMessage(text: string): DshUserMessage;
/** Log through the host logger. */
export declare function makeLogger(ctx: DshContext): {
    info: (message: string) => void;
    warn: (message: string) => void;
};
