#!/usr/bin/env node
/**
 * Command-line router for `agent-immune` (`dsh-immune-system`).
 *
 * All command handlers live in focused sub-modules under `zcode/src/commands/`.
 */
import { ImmuneStore } from '../../core/store/index.js';
import { packageVersion } from '../../core/version.js';
import { cmdAutopsy, cmdBackupAsync, cmdCiCheck, cmdCompileRules, cmdDiagnose, cmdExport, cmdExportJson, cmdForget, cmdImportJson, cmdLearn, cmdList, cmdSearch, cmdSyncDoc, cmdTeamSync, cmdWrapped, } from './commands/library.js';
import { cmdConsolidate, cmdCoverage, cmdDetours, cmdExplain, cmdHygiene, cmdModels, cmdReceipts, cmdRewriteSyncOrAsync, cmdStats, cmdTriage, } from './commands/intelligence.js';
import { cmdAudit, cmdBackfillAsync, cmdIngestDisk, cmdIngestSkill, cmdSeed, cmdWorkspaces, } from './commands/ingest.js';
import { cmdCompletions } from './commands/completions.js';
import { hasHelpFlag, renderCommandHelp, renderMainHelp } from './commands/shared.js';
import { cmdConnect, cmdDoctor, cmdGitHook, cmdUi, runDemo } from './commands/system.js';
function main(argv) {
    const [command = 'list', ...args] = argv;
    let deferStoreClose = false;
    if (command === '--version' || command === '-v' || command === 'version') {
        process.stdout.write(`dsh-immune-system v${packageVersion()}\n`);
        return 0;
    }
    if (command === '--help' || command === '-h' || command === 'help') {
        const sub = args[0] ? renderCommandHelp(args[0]) : null;
        process.stdout.write(sub ?? renderMainHelp(packageVersion()));
        return 0;
    }
    if (hasHelpFlag(args)) {
        const sub = renderCommandHelp(command);
        if (sub) {
            process.stdout.write(sub);
            return 0;
        }
        process.stdout.write(renderMainHelp(packageVersion()));
        return 0;
    }
    if (command === 'demo') {
        const keepAlive = setInterval(() => { }, 60_000);
        runDemo()
            .catch((error) => {
            process.stderr.write(`demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        })
            .finally(() => clearInterval(keepAlive));
        return 0;
    }
    if (command === 'connect')
        return cmdConnect(args);
    if (command === 'git-hook')
        return cmdGitHook(args);
    if (command === 'completions')
        return cmdCompletions(args);
    if (command === 'ui')
        return cmdUi(args);
    if (command === 'ci-check')
        return cmdCiCheck(args);
    if (command === 'doctor')
        return cmdDoctor(args);
    const store = new ImmuneStore();
    try {
        switch (command) {
            case 'list':
                return cmdList(store, args);
            case 'search':
                return cmdSearch(store, args);
            case 'explain':
                return cmdExplain(store, args);
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
            case 'wrapped':
                return cmdWrapped(store, args);
            case 'team-sync':
                return cmdTeamSync(store, args);
            case 'diagnose':
                return cmdDiagnose(store, args);
            case 'autopsy':
                return cmdAutopsy(store, args);
            case 'compile-rules':
                return cmdCompileRules(store, args);
            case 'stats':
                return cmdStats(store, args);
            case 'detours':
                return cmdDetours(store);
            case 'coverage':
                return cmdCoverage(store, args);
            case 'consolidate':
                return cmdConsolidate(store, args);
            case 'hygiene':
                return cmdHygiene(store, args);
            case 'triage':
                return cmdTriage(store, args);
            case 'receipts':
                return cmdReceipts(store, args);
            case 'models':
                return cmdModels(store, args);
            case 'seed':
                return cmdSeed(store, args);
            case 'ingest-skill':
                return cmdIngestSkill(store, args);
            case 'ingest-disk':
                return cmdIngestDisk(store, args);
            case 'workspaces':
                return cmdWorkspaces(store, args);
            case 'backup': {
                deferStoreClose = true;
                const keepAlive = setInterval(() => { }, 60_000);
                cmdBackupAsync(store, args, () => {
                    clearInterval(keepAlive);
                    store.close();
                });
                return 0;
            }
            case 'rewrite': {
                deferStoreClose = true;
                const keepAlive = setInterval(() => { }, 60_000);
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
                const keepAlive = setInterval(() => { }, 60_000);
                cmdBackfillAsync(store, args, () => {
                    clearInterval(keepAlive);
                    store.close();
                });
                return 0;
            }
            case 'audit': {
                deferStoreClose = true;
                const keepAlive = setInterval(() => { }, 60_000);
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
                process.stderr.write(`unknown command "${command}". Run \`immune --help\` to see all available commands.\n`);
                return 2;
        }
    }
    finally {
        if (!deferStoreClose)
            store.close();
    }
}
process.exitCode = main(process.argv.slice(2));
