/**
 * Minimal OpenAI-compatible client used by the distiller.
 *
 * The endpoint is user-configured, so it is validated before use: only http(s)
 * is allowed and loopback, private, link-local, CGNAT and reserved addresses are
 * refused. That blocks the common SSRF shape where a value smuggled into config
 * (or a poisoned env var) points the agent's outbound request at internal
 * services or cloud metadata endpoints.
 *
 * Local inference servers are also loopback by definition. Set
 * IMMUNE_ALLOW_PRIVATE_ENDPOINT=1 to opt in deliberately; the default is deny.
 */
export interface LlmConfig {
    endpoint: string;
    apiKey: string;
    model: string;
    allowPrivate: boolean;
    timeoutMs: number;
    /** Omitted unless configured: some reasoning models reject max_tokens. */
    maxTokens?: number;
    /** Omitted unless configured: reasoning models reject it. */
    temperature?: number;
}
/** Read configuration from the environment; null when no model is configured. */
export declare function readLlmConfig(env?: NodeJS.ProcessEnv): LlmConfig | null;
/**
 * Validate an endpoint URL, throwing when it is not an acceptable target.
 * Returns the parsed URL so callers do not re-parse.
 */
export declare function assertSafeEndpoint(raw: string, allowPrivate?: boolean): URL;
/** Smallest gap between two calls, in ms (IMMUNE_LLM_MIN_INTERVAL_MS). */
export declare function minCallIntervalMs(env?: NodeJS.ProcessEnv): number;
/** One chat completion. Throws on transport error, timeout, or non-2xx. */
export declare function chat(cfg: LlmConfig, system: string, user: string, signal?: AbortSignal): Promise<string>;
