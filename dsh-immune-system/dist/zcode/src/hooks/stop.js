/**
 * Stop — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { runHook, sessionIdOf } from '../hook-io.js';
import { selfMarkers } from '../root-marker.js';
await runHook('Stop', async (event) => {
    const workspace = (typeof event.cwd === 'string' && event.cwd) ||
        process.env.ZCODE_PROJECT_DIR ||
        process.cwd();
    const store = new ImmuneStore({ cwd: workspace });
    try {
        store.clearPromptTurn(sessionIdOf(event));
        await new ImmuneRuntime(store).drain({
            selfMarkers: selfMarkers(),
            runPostDrainHooks: true,
        });
    }
    finally {
        store.close();
    }
    return null;
});
