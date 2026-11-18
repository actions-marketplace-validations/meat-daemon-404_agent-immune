/**
 * Local dashboard server.
 *
 * Deliberate constraints, because this exposes a database that contains text
 * captured from the user's own tool calls:
 *
 *  - binds `127.0.0.1` only, never `0.0.0.0`;
 *  - every `/api` call must present a random per-run token, so another page in
 *    the same browser cannot read or mutate the library (a simple cross-origin
 *    POST needs no preflight, so origin checking alone would not be enough);
 *  - responses carry a strict CSP and `nosniff`, and the page loads nothing
 *    external — it works offline and phones nowhere;
 *  - only three mutations exist, all on this project's rules, and a delete is
 *    confirmed in the page.
 */
export interface UiServerOptions {
    /** Database to open. Defaults to the host's resolution. */
    dbPath?: string;
    /** Preferred port; falls forward to the next free one. */
    port?: number;
    /** How many ports to try before giving up. */
    portAttempts?: number;
}
export interface UiServerHandle {
    url: string;
    port: number;
    close(): Promise<void>;
}
export declare function startUiServer(options?: UiServerOptions): Promise<UiServerHandle>;
