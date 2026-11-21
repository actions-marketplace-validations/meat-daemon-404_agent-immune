/** Write tools whose invocations between a failure and a retry are the repair path. */
export declare const REPAIR_TOOLS: Set<string>;
/** Canonical cross-host check so Edit/Write aliases (DSH, Antigravity, Codex, Gemini) match. */
export declare function isRepairTool(toolName: string): boolean;
