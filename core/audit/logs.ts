/**
 * Streaming JSONL log parsers for Codex, Claude Code, and Antigravity (v2).
 *
 * Uses bounded chunked reads (`openSync`/`readSync`) for large files and pre-filters
 * lines before `JSON.parse` so 280+ MB of transcripts scan in milliseconds without
 * exhausting V8 heap.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CallRow } from '../backfill.js';
import { resolveWorkspaceRoot } from '../hygiene.js';
import { pickSalientErrorLine } from '../trace.js';
import { clampText, type AuditSession } from './types.js';

const STREAM_THRESHOLD_BYTES = 512 * 1024;
const CHUNK_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 512 * 1024;

function forEachJsonlLine(path: string, onLine: (line: string) => void): void {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size <= STREAM_THRESHOLD_BYTES) {
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      if (line.trim()) onLine(line);
    }
    return;
  }

  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(CHUNK_BYTES);
    const decoder = new StringDecoder('utf8');
    let leftover = '';
    let skipOversize = false;
    for (;;) {
      const bytesRead = readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (bytesRead <= 0) break;
      const chunk = decoder.write(buf.subarray(0, bytesRead));
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf('\n', start);
        if (nl === -1) {
          const tail = chunk.slice(start);
          if (!skipOversize) {
            if (leftover.length + tail.length > MAX_LINE_BYTES) {
              leftover = '';
              skipOversize = true;
            } else {
              leftover += tail;
            }
          }
          break;
        }
        if (skipOversize) {
          skipOversize = false;
          leftover = '';
        } else {
          const full = leftover + chunk.slice(start, nl);
          leftover = '';
          if (full.trim()) onLine(full);
        }
        start = nl + 1;
      }
    }
    const flushed = decoder.end();
    if (!skipOversize) {
      leftover += flushed;
      if (leftover.trim()) onLine(leftover);
    }
  } catch {
    // Unreadable transcript skipped cleanly.
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ------------------------------------------------------------------- Codex
const CODEX_TOOL_MAP: Record<string, string> = {
  shell_command: 'Bash',
  exec_command: 'Bash',
  shell: 'Bash',
  local_shell: 'Bash',
  apply_patch: 'Edit',
};

function codexStatusOf(output: string): { status: 'completed' | 'error'; error?: string } {
  const match = output.match(/^Exit code: (\d+)/);
  if (!match) return { status: 'completed' };
  if (Number(match[1]) === 0) return { status: 'completed' };
  const body = output
    .slice(match[0].length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Wall time:/.test(line) && !/^Output:$/.test(line))
    .join('\n');
  const salient = body.length > 0 ? pickSalientErrorLine(body) : '';
  return { status: 'error', error: clampText(salient || body || output) };
}

function parseCodexFile(path: string, since: number): AuditSession {
  const calls: CallRow[] = [];
  const parts = new Map<string, { input: unknown; output: string }>();
  const callIndex = new Map<string, { name: string; arguments: string; timestamp: number }>();
  const tokenSamples: number[] = [];
  let sessionCwd: string | undefined;

  forEachJsonlLine(path, (line) => {
    if (
      !line.includes('response_item') &&
      !line.includes('session_meta') &&
      !line.includes('turn_context') &&
      !line.includes('token_count')
    ) {
      return;
    }
    let record: {
      timestamp?: string;
      type?: string;
      payload?: {
        type?: string;
        cwd?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        input?: string;
        output?: string;
        info?: { last_token_usage?: { total_tokens?: number } };
      };
    };
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    const payload = record.payload;
    if (!payload) return;
    if ((record.type === 'session_meta' || record.type === 'turn_context') && typeof payload.cwd === 'string' && payload.cwd) {
      sessionCwd = payload.cwd;
      return;
    }
    if (record.type === 'event_msg' && payload.type === 'token_count') {
      const total = Number(payload.info?.last_token_usage?.total_tokens ?? 0);
      if (total > 0) tokenSamples.push(total);
      return;
    }
    if (record.type !== 'response_item') return;
    const timestamp = record.timestamp ? Date.parse(record.timestamp) : Date.now();
    if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && payload.call_id) {
      callIndex.set(payload.call_id, {
        name: payload.name ?? 'unknown',
        arguments: payload.arguments ?? payload.input ?? '',
        timestamp,
      });
    } else if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') && payload.call_id) {
      const call = callIndex.get(payload.call_id);
      if (!call) return;
      const tool = CODEX_TOOL_MAP[call.name] ?? null;
      if (!tool) return;
      const output = typeof payload.output === 'string' ? payload.output : '';
      const verdict = codexStatusOf(output);
      calls.push({
        session_id: path,
        tool_call_id: payload.call_id,
        tool_name: tool,
        status: verdict.status,
        error_message: verdict.error ?? null,
        started_at: call.timestamp,
      });
      parts.set(payload.call_id, { input: safeJson(call.arguments), output: clampText(output) });
    }
  });

  calls.sort((a, b) => a.started_at - b.started_at);
  return {
    calls: calls.filter((c) => c.started_at >= since),
    parts,
    tokenSamples,
    ...(sessionCwd ? { cwd: sessionCwd } : {}),
  };
}

export function loadCodexSessions(
  dir: string,
  since: number,
): { sessions: AuditSession[]; present: boolean; note?: string } {
  if (!existsSync(dir)) return { sessions: [], present: false, note: 'no ~/.codex/sessions directory' };
  const sessions: AuditSession[] = [];
  const safeDirs = (parent: string): string[] => {
    try {
      return readdirSync(parent, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const year of safeDirs(dir)) {
    for (const month of safeDirs(join(dir, year))) {
      for (const day of safeDirs(join(dir, year, month))) {
        const dayMs = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
        if (Number.isFinite(dayMs) && dayMs < since - 86_400_000) continue;
        const dayDir = join(dir, year, month, day);
        let files: string[] = [];
        try {
          files = readdirSync(dayDir);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue;
          const parsed = parseCodexFile(join(dayDir, file), since);
          if (parsed.calls.length > 0) sessions.push(parsed);
        }
      }
    }
  }
  return { sessions, present: true, ...(sessions.length === 0 ? { note: 'no tool calls in rollouts' } : {}) };
}

// ------------------------------------------------------------------- Claude Code
function listClaudeTranscripts(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      if (entry.name === 'memory') continue;
      files.push(...listClaudeTranscripts(join(dir, entry.name), depth + 1));
    } else if (entry.name.endsWith('.jsonl')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function claudeResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === 'object' && block !== null && 'text' in block
          ? String((block as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}

function claudeVerdictOf(
  block: { is_error?: unknown },
  text: string,
): { status: 'completed' | 'error'; error?: string } {
  if (block.is_error === true) return { status: 'error', error: clampText(text) };
  if (block.is_error === false) return { status: 'completed' };
  const head = text.slice(0, 300);
  const match = head.match(/^Exit code: (\d+)/m);
  if (match && Number(match[1]) !== 0) {
    return { status: 'error', error: clampText(text) };
  }
  return { status: 'completed' };
}

function parseClaudeFile(path: string, since: number): AuditSession {
  const calls: CallRow[] = [];
  const callById = new Map<string, CallRow>();
  const parts = new Map<string, { input: unknown; output: string }>();
  const tokenSamples: number[] = [];
  let sessionCwd: string | undefined;

  forEachJsonlLine(path, (line) => {
    if (!line.includes('tool_use') && !line.includes('tool_result') && !line.includes('usage') && !line.includes('"cwd"')) {
      return;
    }
    let record: {
      type?: string;
      cwd?: string;
      timestamp?: string;
      message?: {
        content?: unknown;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
    };
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (!sessionCwd && typeof record.cwd === 'string' && record.cwd) {
      sessionCwd = record.cwd;
    }
    if (record.type === 'assistant' && record.message?.usage) {
      const total = Number(record.message.usage.input_tokens ?? 0) + Number(record.message.usage.output_tokens ?? 0);
      if (total > 0) tokenSamples.push(total);
    }
    const timestamp = record.timestamp ? Date.parse(record.timestamp) : Date.now();
    const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const call: CallRow = {
          session_id: path,
          tool_call_id: block.id,
          tool_name: String(block.name ?? 'unknown'),
          status: 'completed',
          error_message: null,
          started_at: timestamp,
        };
        calls.push(call);
        parts.set(block.id, { input: block.input ?? null, output: '' });
        callById.set(block.id, call);
      } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const text = claudeResultText(block.content);
        const call = callById.get(block.tool_use_id);
        if (call) {
          const verdict = claudeVerdictOf(block, text);
          call.status = verdict.status;
          call.error_message = verdict.error ?? null;
          call.started_at = timestamp;
          call.session_id = path;
        }
        const part = parts.get(block.tool_use_id);
        if (part) part.output = clampText(text);
      }
    }
  });

  calls.sort((a, b) => a.started_at - b.started_at);
  return {
    calls: calls.filter((call) => call.started_at >= since),
    parts,
    tokenSamples,
    ...(sessionCwd ? { cwd: sessionCwd } : {}),
  };
}

export function loadClaudeSessions(
  dir: string,
  since: number,
): { sessions: AuditSession[]; present: boolean; note?: string } {
  if (!existsSync(dir)) return { sessions: [], present: false, note: 'no ~/.claude/projects directory' };
  const sessions: AuditSession[] = [];
  for (const project of readdirSync(dir)) {
    const projectDir = join(dir, project);
    for (const file of listClaudeTranscripts(projectDir)) {
      const parsed = parseClaudeFile(file, since);
      if (parsed.calls.length > 0) sessions.push(parsed);
    }
  }
  return { sessions, present: true, ...(sessions.length === 0 ? { note: 'no tool calls in transcripts' } : {}) };
}

// ------------------------------------------------------------------- Antigravity
const ANTIGRAVITY_TOOL_MAP: Record<string, string> = {
  run_command: 'Bash',
  edit_file: 'Edit',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  write_file: 'Write',
  write_to_file: 'Write',
  read_file: 'Read',
  view_file: 'Read',
  view_file_outline: 'Read',
  view_code_item: 'Read',
  grep_search: 'Grep',
  find_by_name: 'Glob',
  list_dir: 'Glob',
};

function unwrapAntigravityArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    let decoded: unknown = value;
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      try {
        decoded = JSON.parse(value);
      } catch {
        decoded = value;
      }
    }
    out[key] = decoded;
  }
  if (out.command === undefined && typeof out.CommandLine === 'string') out.command = out.CommandLine;
  if (out.file_path === undefined) {
    const pathCandidate =
      out.Path ??
      out.TargetFile ??
      out.AbsolutePath ??
      out.DirectoryPath ??
      out.SearchPath ??
      out.SearchDirectory;
    if (typeof pathCandidate === 'string') out.file_path = pathCandidate;
  }
  if (out.pattern === undefined) {
    const patCandidate = out.Query ?? out.Pattern;
    if (typeof patCandidate === 'string') out.pattern = patCandidate;
  }
  return out;
}

function antigravityErrorLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^(Created At|Completed At|Command output|Showing lines|Partial read):?/i.test(line),
    );
  const body = lines.join('\n').trim();
  const salient = body ? pickSalientErrorLine(body) : '';
  return clampText(salient || body || text.trim() || 'unknown error');
}

function antigravityVerdictOf(
  toolName: string,
  record: { status?: string; error?: unknown; content?: unknown },
): { ignore?: boolean; status: 'completed' | 'error'; error?: string; output: string } {
  const content = typeof record.content === 'string' ? record.content : '';
  const errField = typeof record.error === 'string' ? record.error.trim() : '';
  if (record.status === 'ERROR' || errField.length > 0) {
    const rawErr = errField || content;
    if (
      /tool call denied by pre-tool hook|editing tools are refused while plan mode|plan mode only allows|\[sandbox:\s*file access denied|was cancelled|was aborted/i.test(
        rawErr,
      )
    ) {
      return { ignore: true, status: 'completed', output: '' };
    }
    return { status: 'error', error: antigravityErrorLine(rawErr), output: clampText(content || rawErr) };
  }
  if (toolName === 'Bash') {
    const exitMatch = content.match(/^Command exited with code (-?\d+)\./m);
    if (exitMatch && Number(exitMatch[1]) !== 0) {
      const outputMarker = 'Command output:\n';
      const idx = content.indexOf(outputMarker);
      const after =
        idx >= 0
          ? content.slice(idx + outputMarker.length)
          : content.slice((exitMatch.index ?? 0) + exitMatch[0].length);
      return {
        status: 'error',
        error: antigravityErrorLine(after) || `Command exited with code ${exitMatch[1]}`,
        output: clampText(content),
      };
    }
  }
  return { status: 'completed', output: clampText(content) };
}

function parseAntigravityFile(path: string, since: number): AuditSession {
  const calls: CallRow[] = [];
  const parts = new Map<string, { input: unknown; output: string }>();
  const tokenSamples: number[] = [];
  const pendingCalls: Array<{ tool: string; input: Record<string, unknown>; timestamp: number; callId: string }> = [];
  let seq = 0;

  forEachJsonlLine(path, (line) => {
    if (!line.includes('PLANNER_RESPONSE') && !line.includes('GENERIC') && !line.includes('USER_INPUT')) {
      return;
    }
    let record: {
      step_index?: number;
      type?: string;
      status?: string;
      error?: unknown;
      content?: unknown;
      created_at?: string;
      input_tokens?: number;
      cache_read_tokens?: number;
      output_tokens?: number;
      tool_calls?: Array<{ name?: string; args?: unknown }>;
    };
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    const timestamp = record.created_at ? Date.parse(record.created_at) : Date.now();
    if (record.type === 'USER_INPUT') {
      pendingCalls.length = 0;
      return;
    }
    if (record.type === 'PLANNER_RESPONSE') {
      pendingCalls.length = 0;
      const total =
        Number(record.input_tokens ?? 0) +
        Number(record.cache_read_tokens ?? 0) +
        Number(record.output_tokens ?? 0);
      if (total > 0 && timestamp >= since) tokenSamples.push(total);
      if (Array.isArray(record.tool_calls)) {
        for (const tc of record.tool_calls) {
          const rawName = typeof tc?.name === 'string' ? tc.name : '';
          if (!rawName) continue;
          seq += 1;
          pendingCalls.push({
            tool: ANTIGRAVITY_TOOL_MAP[rawName] ?? rawName,
            input: unwrapAntigravityArgs(tc.args),
            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
            callId: `agy-${record.step_index ?? 'x'}-${seq}`,
          });
        }
      }
      return;
    }
    if (record.type === 'GENERIC' && pendingCalls.length > 0) {
      const pending = pendingCalls.shift()!;
      const ts = Number.isFinite(timestamp) ? timestamp : pending.timestamp;
      if (ts < since) return;
      const verdict = antigravityVerdictOf(pending.tool, record);
      if (verdict.ignore) return;
      calls.push({
        session_id: path,
        tool_call_id: pending.callId,
        tool_name: pending.tool,
        status: verdict.status,
        error_message: verdict.error ?? null,
        started_at: ts,
      });
      parts.set(pending.callId, { input: pending.input, output: verdict.output });
    }
  });

  calls.sort((a, b) => a.started_at - b.started_at);
  let sessionCwd: string | undefined;
  for (const part of parts.values()) {
    const obj = (part.input as Record<string, unknown> | null) ?? {};
    const candidate = obj.file_path ?? obj.Path ?? obj.TargetFile ?? obj.AbsolutePath ?? obj.DirectoryPath;
    if (typeof candidate === 'string' && (isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate))) {
      sessionCwd = resolveWorkspaceRoot(dirname(candidate));
      break;
    }
  }
  return { calls, parts, tokenSamples, ...(sessionCwd ? { cwd: sessionCwd } : {}) };
}

export function loadAntigravitySessions(
  dir: string,
  since: number,
): { sessions: AuditSession[]; present: boolean; note?: string } {
  if (!existsSync(dir)) return { sessions: [], present: false, note: 'no ~/.gemini/antigravity/brain directory' };
  const sessions: AuditSession[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { sessions: [], present: true, note: 'unreadable ~/.gemini/antigravity/brain directory' };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcript = join(dir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(transcript)) continue;
    try {
      if (statSync(transcript).mtimeMs < since - 86_400_000) continue;
    } catch {
      continue;
    }
    const parsed = parseAntigravityFile(transcript, since);
    if (parsed.calls.length > 0) sessions.push(parsed);
  }
  return { sessions, present: true, ...(sessions.length === 0 ? { note: 'no tool calls in transcripts' } : {}) };
}
