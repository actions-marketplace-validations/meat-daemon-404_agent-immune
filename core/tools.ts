/**
 * Canonical cross-host tool taxonomy (v4.0).
 *
 * Single source of truth for normalising tool names emitted by ZCode, DSH,
 * Claude Code, Codex CLI, Google Antigravity, Gemini CLI, Cursor, Windsurf,
 * OpenCode, Kiro, and MCP hosts so pairing, repair-path tracking, passive-read
 * filtering, and Pre-Flight Guard scoping never drift across modules.
 */

export type CanonicalToolName = 'Bash' | 'Edit' | 'Write' | 'Read' | 'Grep' | 'Glob';

const TOOL_ALIAS_MAP: Record<string, CanonicalToolName> = {
  // Shell execution tools
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Bash',
  zsh: 'Bash',
  powershell: 'Bash',
  pwsh: 'Bash',
  terminal: 'Bash',
  shell_command: 'Bash',
  exec_command: 'Bash',
  local_shell: 'Bash',
  run_command: 'Bash',
  run_shell_command: 'Bash',
  run_terminal_cmd: 'Bash',
  // File edit / patch tools
  edit: 'Edit',
  multiedit: 'Edit',
  notebookedit: 'Edit',
  apply_patch: 'Edit',
  applypatch: 'Edit',
  edit_file: 'Edit',
  replace: 'Edit',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  // File write / creation tools
  write: 'Write',
  write_file: 'Write',
  write_to_file: 'Write',
  create_file: 'Write',
  // Passive file read tools
  read: 'Read',
  read_file: 'Read',
  view_file: 'Read',
  view_file_outline: 'Read',
  view_code_item: 'Read',
  // Search / grep tools
  grep: 'Grep',
  grep_search: 'Grep',
  search_file_content: 'Grep',
  ripgrep: 'Grep',
  // Glob / file listing tools
  glob: 'Glob',
  find_by_name: 'Glob',
  list_dir: 'Glob',
  list_files: 'Glob',
};

/**
 * Normalise a host tool name into the canonical pairing vocabulary when known,
 * or return the trimmed original name verbatim for custom/MCP tools.
 */
export function canonicalToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) return '';
  return TOOL_ALIAS_MAP[trimmed.toLowerCase()] ?? trimmed;
}

/** True when the tool executes shell commands. */
export function isShellToolName(toolName: string): boolean {
  return canonicalToolName(toolName) === 'Bash';
}

/** True when the tool operates directly on a file path (Read/Edit/Write family). */
export function isFileToolName(toolName: string): boolean {
  const canon = canonicalToolName(toolName);
  return canon === 'Read' || canon === 'Edit' || canon === 'Write';
}

/** True when the tool only reads or searches without mutating workspace state. */
export function isPassiveReadToolName(toolName: string): boolean {
  const canon = canonicalToolName(toolName);
  return canon === 'Read' || canon === 'Grep' || canon === 'Glob';
}

/** True when the tool writes/edits files (counted in episode repair paths). */
export function isRepairToolName(toolName: string): boolean {
  const canon = canonicalToolName(toolName);
  return canon === 'Edit' || canon === 'Write';
}
