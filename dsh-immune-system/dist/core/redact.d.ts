/**
 * Redaction helpers.
 *
 * Hook stdin can carry secrets (API keys in a failed curl, tokens in an env
 * dump). We persist failure traces to disk, so scrub them first. This is
 * deliberately conservative: it prefers over-redacting to leaking a credential
 * into a SQLite file that later gets exported into a shared skill.
 */
export declare function redact(input: string): string;
/**
 * Mask OS user account segments inside home directory paths while keeping
 * project-relative paths intact for local self-noise and pairing logic.
 */
export declare function maskHomePaths(input: string): string;
/** Replace email addresses with a fixed placeholder on outbound/share paths. */
export declare function redactEmails(input: string): string;
/** Sanitize text before sending it to an external model or shared surface. */
export declare function redactOutbound(input: string): string;
/** Strip credentials and query parameters from a URL before logging it. */
export declare function redactUrl(raw: string): string;
/** Redact then clamp, so no single trace can bloat the database. */
export declare function redactAndClamp(input: unknown, max?: number): string;
