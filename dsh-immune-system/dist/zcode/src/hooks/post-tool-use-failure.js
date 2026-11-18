/**
 * PostToolUseFailure — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { runHook, sessionIdOf, toolNameOf } from '../hook-io.js';
import { summarizeFailure } from '../format.js';
import { selfMarkers } from '../root-marker.js';
await runHook('PostToolUseFailure', (event) => {
    const failureTrace = summarizeFailure(event);
    const sandboxDenied = /\[sandbox:\s*file access denied under [^\]\n]+ mode\]|\bUPLOAD_NEEDS_PERMISSION\b|permission denied by user|rejected by user/i.test(failureTrace);
    if (sandboxDenied)
        return null;
    const workspace = (typeof event.cwd === 'string' && event.cwd) ||
        process.env.ZCODE_PROJECT_DIR ||
        process.cwd();
    const store = new ImmuneStore({ cwd: workspace });
    try {
        new ImmuneRuntime(store).postToolUse({
            sessionId: sessionIdOf(event),
            toolName: toolNameOf(event),
            toolInput: event.tool_input,
            failed: true,
            sandboxDenied: false,
            trace: failureTrace,
            workspace,
            selfMarkers: selfMarkers(),
            skipProbeBookkeeping: true,
        });
    }
    finally {
        store.close();
    }
    return null;
});
