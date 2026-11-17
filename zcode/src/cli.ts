#!/usr/bin/env node
/**
 * Command-line router for `agent-immune` (`dsh-immune-system`).
 *
 * All command handlers live in focused sub-modules under `zcode/src/commands/`.
 */
import { ImmuneStore } from '../../core/store/index.js';
import {
  cmdBackupAsync,
  cmdCiCheck,
  cmdExport,
  cmdExportJson,
  cmdForget,
  cmdImportJson,
  cmdLearn,
  cmdList,
  cmdSearch,
  cmdSyncDoc,
} from './commands/library.js';
import {
  cmdConsolidate,
  cmdCoverage,
  cmdDetours,
  cmdHygiene,
  cmdModels,
  cmdReceipts,
  cmdRewriteSyncOrAsync,
  cmdStats,
  cmdTriage,
} from './commands/intelligence.js';
import {
  cmdAudit,
  cmdBackfillAsync,
  cmdIngestDisk,
  cmdIngestSkill,
  cmdSeed,
  cmdWorkspaces,
} from './commands/ingest.js';
import { cmdConnect, cmdDoctor, cmdUi, runDemo } from './commands/system.js';

function main(argv: string[]): number {
  const [command = 'list', ...args] = argv;
  let deferStoreClose = false;

  if (command === 'demo') {
    const keepAlive = setInterval(() => {}, 60_000);
    runDemo()
      .catch((error: unknown) => {
        process.stderr.write(`demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      })
      .finally(() => clearInterval(keepAlive));
    return 0;
  }

  if (command === 'connect') return cmdConnect(args);
  if (command === 'ui') return cmdUi(args);
  if (command === 'ci-check') return cmdCiCheck(args);
  if (command === 'doctor') return cmdDoctor();

  const store = new ImmuneStore();
  try {
    switch (command) {
      case 'list':
        return cmdList(store, args.includes('--all'));
      case 'search':
        return cmdSearch(store, args);
      case 'learn':
        return cmdLearn(store, args);
      case 'forget':
        return cmdForget(store, args);
      case 'prune':
        store.pruneStale();
        process.stdout.write('Pruned stale pending failures and injection records.\n');
        return 0;
      case 'export':
        return cmdExport(store, args);
      case 'export-json':
        return cmdExportJson(store, args);
      case 'import-json':
        return cmdImportJson(store, args);
      case 'sync-doc':
        return cmdSyncDoc(store, args);
      case 'stats':
        return cmdStats(store);
      case 'detours':
        return cmdDetours(store);
      case 'coverage':
        return cmdCoverage(store, args);
      case 'consolidate':
        return cmdConsolidate(store, args);
      case 'hygiene':
        return cmdHygiene(store, args);
      case 'triage':
        return cmdTriage(store);
      case 'receipts':
        return cmdReceipts(store);
      case 'models':
        return cmdModels(store);
      case 'seed':
        return cmdSeed(store, args);
      case 'ingest-skill':
        return cmdIngestSkill(store, args);
      case 'ingest-disk':
        return cmdIngestDisk(store, args);
      case 'workspaces':
        return cmdWorkspaces(store);
      case 'backup': {
        deferStoreClose = true;
        const keepAlive = setInterval(() => {}, 60_000);
        cmdBackupAsync(store, args, () => {
          clearInterval(keepAlive);
          store.close();
        });
        return 0;
      }
      case 'rewrite': {
        deferStoreClose = true;
        const keepAlive = setInterval(() => {}, 60_000);
        const res = cmdRewriteSyncOrAsync(store, args, () => {
          clearInterval(keepAlive);
          store.close();
        });
        if (!res.asyncStarted) {
          clearInterval(keepAlive);
          deferStoreClose = false;
        }
        return res.code;
      }
      case 'backfill': {
        deferStoreClose = true;
        const keepAlive = setInterval(() => {}, 60_000);
        cmdBackfillAsync(store, args, () => {
          clearInterval(keepAlive);
          store.close();
        });
        return 0;
      }
      case 'audit': {
        deferStoreClose = true;
        const keepAlive = setInterval(() => {}, 60_000);
        const res = cmdAudit(store, args, () => {
          clearInterval(keepAlive);
          store.close();
        });
        if (!res.asyncStarted) {
          clearInterval(keepAlive);
          deferStoreClose = false;
        }
        return res.code;
      }
      default:
        process.stderr.write(
          'usage: immune <list|stats|coverage|detours|hygiene|triage|receipts|models|export|search|learn|forget|prune|' +
            'rewrite|consolidate|backup|connect|seed|ingest-skill|ingest-disk|workspaces|backfill|audit|sync-doc|' +
            'export-json|import-json|ci-check|ui|doctor|demo> [...args]\n',
        );
        return 2;
    }
  } finally {
    if (!deferStoreClose) store.close();
  }
}

process.exitCode = main(process.argv.slice(2));
