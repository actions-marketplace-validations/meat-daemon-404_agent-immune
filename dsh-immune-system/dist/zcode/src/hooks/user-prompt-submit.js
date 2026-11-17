/**
 * UserPromptSubmit — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { runHook, sessionIdOf } from '../hook-io.js';
import { formatImmuneContext } from '../format.js';
await runHook('UserPromptSubmit', (event) => {
    if (typeof event.invocationNum === 'number' && event.invocationNum > 1)
        return null;
    const prompt = typeof event.prompt === 'string' ? event.prompt : '';
    if (!prompt.trim())
        return null;
    const workspace = (typeof event.cwd === 'string' && event.cwd) ||
        process.env.ZCODE_PROJECT_DIR ||
        process.cwd();
    const store = new ImmuneStore();
    try {
        const hits = new ImmuneRuntime(store).userPrompt({
            sessionId: sessionIdOf(event),
            prompt,
            workspace,
            excludeInjected: true,
            suppressRepeats: true,
        });
        return formatImmuneContext(hits);
    }
    finally {
        store.close();
    }
});
