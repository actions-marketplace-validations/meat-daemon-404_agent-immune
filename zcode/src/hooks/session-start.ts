/**
 * SessionStart — thin adapter over `ImmuneRuntime`.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { hydrateTeamRules } from '../../../core/team-sync.js';
import { runHook, sessionIdOf } from '../hook-io.js';
import { formatImmuneContext } from '../format.js';
import { selfMarkers } from '../root-marker.js';

await runHook('SessionStart', async (event) => {
  const workspace =
    (typeof event.cwd === 'string' && event.cwd) ||
    process.env.ZCODE_PROJECT_DIR ||
    process.cwd();
  const store = new ImmuneStore({ cwd: workspace });
  try {
    const runtime = new ImmuneRuntime(store);
    const sessionId = sessionIdOf(event);
    const source = typeof event.source === 'string' ? event.source : '';

    try {
      hydrateTeamRules(store, workspace);
    } catch {
      // Best-effort team rule hydration; never fail SessionStart.
    }
    runtime.prepareSessionStart({ sessionId, source, workspace, prewarm: true });
    await runtime.drain({ selfMarkers: selfMarkers() });
    const top = runtime.primeSession(sessionId, workspace);
    return formatImmuneContext(top);
  } finally {
    store.close();
  }
});
