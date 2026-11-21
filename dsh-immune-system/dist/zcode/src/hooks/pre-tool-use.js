/**
 * PreToolUse — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { emitAsk, emitDeny, runHook, sessionIdOf, toolNameOf } from '../hook-io.js';
import { formatToolWarning } from '../format.js';
await runHook('PreToolUse', (event) => {
    const workspace = (typeof event.cwd === 'string' && event.cwd) ||
        process.env.ZCODE_PROJECT_DIR ||
        process.cwd();
    const store = new ImmuneStore({ cwd: workspace });
    try {
        const out = new ImmuneRuntime(store).preToolUse({
            sessionId: sessionIdOf(event),
            toolName: toolNameOf(event),
            toolInput: event.tool_input,
            workspace,
        });
        if (out.denyBanner) {
            emitDeny('PreToolUse', out.denyBanner);
            return null;
        }
        if (out.askBanner && emitAsk('PreToolUse', out.askBanner)) {
            return null;
        }
        const recall = formatToolWarning(out.recallRows);
        return [out.thrashNote, out.warnBanner, out.stuckNote, recall].filter(Boolean).join('\n\n');
    }
    finally {
        store.close();
    }
});
