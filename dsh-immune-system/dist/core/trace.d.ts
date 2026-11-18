/**
 * Trace readers: pull the human-meaningful part out of a compact tool trace.
 *
 * Traces look like:
 *   tool=Bash input={"command":"npm run build"} error=ENOENT: not found
 *   tool=Edit input={"file_path":"a.ts"} result=[{"type":"text","text":"ok"}]
 */
/**
 * Pick the most informative error line from multi-line tool output so CLI
 * startup banners or proxy warnings on line 1 do not mask the actual failure.
 */
export declare function pickSalientErrorLine(text: string): string;
/** Extract the error/result text from a trace, without the tool input preamble. */
export declare function extractError(trace: string): string | null;
/**
 * The command, path or query that was actually run.
 *
 * Parsed by scanning for the key then reading to the closing unescaped quote,
 * which avoids both a fragile regex and a `JSON.parse` of untrusted fragments.
 */
export declare function extractInvocation(trace: string): string | null;
