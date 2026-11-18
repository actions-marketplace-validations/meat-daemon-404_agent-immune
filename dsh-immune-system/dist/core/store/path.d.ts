/** File the plugin uses to self-locate; line 1 root, line 2 database path. */
export declare const ROOT_MARKER = "immune-root.txt";
/**
 * Resolve the database location from the environment, mirroring host
 * conventions so the same file is found by every hook process.
 *
 * Priority:
 *   1. explicit IMMUNE_DB_PATH override
 *   2. the host's plugin data directory (hook processes)
 *   3. the plugin's self-location marker, `<project>/.dsh/immune-root.txt`
 *      line 2 — slash commands run inside a model Bash call WITHOUT the hook
 *      environment, and this is how their CLI finds the hooks' database
 *   4. a per-project `.dsh` folder (fresh projects without a marker)
 */
export declare function resolveDbPath(env?: NodeJS.ProcessEnv, cwdOverride?: string): string;
