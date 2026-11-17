/**
 * PostToolUse — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { runHook, sessionIdOf, toolNameOf } from '../hook-io.js';
import { summarizeToolCall } from '../format.js';
import { classifyOutcome } from '../outcome.js';
import { selfMarkers } from '../root-marker.js';

await runHook('PostToolUse', (event) => {
  const record = event as Record<string, unknown>;
  const toolName = toolNameOf(event);
  const outcome = classifyOutcome(record);
  const trace = `${summarizeToolCall(toolName, event.tool_input)} result=${outcome.text}`;
  const workspace =
    (typeof record.cwd === 'string' && record.cwd) ||
    process.env.ZCODE_PROJECT_DIR ||
    process.cwd();

  const store = new ImmuneStore();
  try {
    new ImmuneRuntime(store).postToolUse({
      sessionId: sessionIdOf(event),
      toolName,
      toolInput: event.tool_input,
      failed: outcome.failed,
      sandboxDenied: outcome.sandboxDenied,
      trace,
      workspace,
      selfMarkers: selfMarkers(),
    });
  } finally {
    store.close();
  }
  return null;
});
