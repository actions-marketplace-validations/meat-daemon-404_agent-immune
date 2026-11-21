/**
 * UserPromptSubmit — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { isSubstantiveHint } from '../../../core/distiller.js';
import { isCursorEvent, runHook, sessionIdOf } from '../hook-io.js';
import { formatImmuneContext } from '../format.js';

await runHook('UserPromptSubmit', (event) => {
  if (typeof event.invocationNum === 'number' && event.invocationNum > 1) return null;
  const prompt = typeof event.prompt === 'string' ? event.prompt : '';
  if (!prompt.trim()) return null;

  const workspace =
    (typeof event.cwd === 'string' && event.cwd) ||
    process.env.ZCODE_PROJECT_DIR ||
    process.cwd();
  const store = new ImmuneStore({ cwd: workspace });
  try {
    const sessionId = sessionIdOf(event);
    if (!store.claimPromptTurn(sessionId, prompt)) return null;
    // Cursor's beforeSubmitPrompt protocol only accepts `{ continue: true }`
    // and discards prompt-level context. Attach any human hint for episode
    // pairing, but skip `match()` so we never inflate hit_count or write
    // phantom delivery_receipts for undelivered context (AGENTS.md #9).
    if (isCursorEvent(event)) {
      if (isSubstantiveHint(prompt.trim())) {
        store.attachHumanHint(sessionId, prompt.trim());
      }
      return null;
    }
    const hits = new ImmuneRuntime(store).userPrompt({
      sessionId,
      prompt,
      workspace,
      excludeInjected: true,
      suppressRepeats: true,
    });
    return formatImmuneContext(hits);
  } finally {
    store.close();
  }
});
