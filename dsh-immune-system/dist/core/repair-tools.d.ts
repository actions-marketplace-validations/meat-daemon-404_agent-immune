/** Write tools whose invocations between a failure and a retry are the repair path. */
export declare const REPAIR_TOOLS: Set<string>;
/** Case-insensitive check so lowercase hosts (e.g. DSH `edit`/`write`) match too. */
export declare function isRepairTool(toolName: string): boolean;
