/**
 * Stop — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { runHook } from '../hook-io.js';
import { selfMarkers } from '../root-marker.js';
await runHook('Stop', async () => {
    const store = new ImmuneStore();
    try {
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
