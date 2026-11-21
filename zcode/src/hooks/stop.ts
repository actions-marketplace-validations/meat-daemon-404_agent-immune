/**
 * Stop — thin adapter over `ImmuneRuntime` with automatic two-way `.immune/rules.jsonl` team sync.
 */
import { ImmuneStore } from '../../../core/store/index.js';
import { ImmuneRuntime } from '../../../core/runtime.js';
import { maybeSyncTeamRulesAfterDrain } from '../../../core/team-sync.js';
import { runHook, sessionIdOf } from '../hook-io.js';
import { selfMarkers } from '../root-marker.js';

await runHook('Stop', async (event) => {
  const workspace =
    (typeof event.cwd === 'string' && event.cwd) ||
    process.env.ZCODE_PROJECT_DIR ||
    process.cwd();
  const store = new ImmuneStore({ cwd: workspace });
  try {
    store.clearPromptTurn(sessionIdOf(event));
    await new ImmuneRuntime(store).drain({
      selfMarkers: selfMarkers(),
      runPostDrainHooks: true,
    });
    try {
      maybeSyncTeamRulesAfterDrain(store, workspace);
    } catch {
      // Best-effort team rule export; never fail Stop hook.
    }
  } finally {
    store.close();
  }
  return null;
});
