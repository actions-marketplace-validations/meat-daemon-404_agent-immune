import { isRepairToolName } from './tools.js';
/** Write tools whose invocations between a failure and a retry are the repair path. */
export const REPAIR_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Canonical cross-host check so Edit/Write aliases (DSH, Antigravity, Codex, Gemini) match. */
export function isRepairTool(toolName) {
    return REPAIR_TOOLS.has(toolName) || isRepairToolName(toolName);
}
