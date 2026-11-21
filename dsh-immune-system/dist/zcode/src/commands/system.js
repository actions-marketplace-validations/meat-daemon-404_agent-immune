import { ImmuneStore } from '../../../core/store/index.js';
import { HOSTS, connectAllDetected, connectHost, connectStatus, disconnectAllConnected, disconnectHost, } from '../../../core/connect.js';
import { startUiServer } from '../../../core/ui/server.js';
import { gitHookStatus, installGitHook, removeGitHook } from '../../../core/git-hook.js';
import { runDoctor } from '../doctor.js';
import { flagValue } from './shared.js';
export function cmdConnect(args) {
    const hostArg = args.find((arg) => !arg.startsWith('-'));
    const remove = args.includes('--remove');
    const asJson = args.includes('--json');
    if (!hostArg) {
        if (args.includes('--status')) {
            const rows = connectStatus();
            if (asJson) {
                process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
                return 0;
            }
            process.stdout.write('Hosts immune can wire (connect [host] [--remove]):\n');
            for (const row of rows) {
                process.stdout.write(`  ${row.label.padEnd(16)} ${row.state.padEnd(14)} ${row.configPath}\n`);
            }
            return 0;
        }
        if (remove) {
            try {
                const reports = disconnectAllConnected();
                if (asJson) {
                    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
                    return 0;
                }
                if (reports.length === 0) {
                    process.stdout.write('connect --remove: no connected hosts found.\n');
                    return 0;
                }
                for (const rep of reports) {
                    process.stdout.write(`removed ${rep.removed} immune entry(ies) from ${rep.label} (${rep.configPath})\n`);
                    if (rep.vendorDir)
                        process.stdout.write(`  vendored install removed: ${rep.vendorDir}\n`);
                }
                return 0;
            }
            catch (error) {
                process.stderr.write(`disconnect failed: ${error instanceof Error ? error.message : String(error)}\n`);
                return 1;
            }
        }
        try {
            const report = connectAllDetected({ refresh: args.includes('--refresh') });
            if (asJson) {
                process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
                return 0;
            }
            if (report.detected.length === 0) {
                process.stdout.write('connect: no supported host detected (~/.claude, ~/.codex, ~/.gemini, ~/.cursor, ~/.codeium/windsurf). ' +
                    'Install a host first, or wire one explicitly: connect claude-code\n');
                return 0;
            }
            for (const candidate of report.detected) {
                if (candidate.wired)
                    continue;
                process.stdout.write(`  ${candidate.label}: detected (${candidate.marker}) — ${candidate.reason}\n`);
            }
            if (report.wired.length === 0) {
                process.stdout.write('connect: detected hosts are wired through their own plugin systems; nothing to write\n');
                return 0;
            }
            for (const wired of report.wired) {
                process.stdout.write(`connected ${wired.label} -> ${wired.configPath}\n`);
                const counts = [];
                if (wired.added > 0)
                    counts.push(`${wired.added} event(s) wired`);
                if (wired.upgraded > 0)
                    counts.push(`${wired.upgraded} stale entry(ies) upgraded`);
                if (wired.alreadyPresent > 0)
                    counts.push(`${wired.alreadyPresent} already present`);
                process.stdout.write(`  ${counts.join(' · ')}: ${wired.eventsWired.join(', ')}\n`);
                if (wired.vendorDir) {
                    process.stdout.write(`  vendored: ${wired.vendorDir} (v${wired.vendorVersion ?? '?'}${wired.vendorRefreshed ? ', refreshed' : ''})\n`);
                }
                process.stdout.write(`  scripts: ${wired.scriptDir}\n`);
                if (wired.backupPath)
                    process.stdout.write(`  backup: ${wired.backupPath}\n`);
                for (const note of wired.notes)
                    process.stdout.write(`  note: ${note}\n`);
            }
            return 0;
        }
        catch (error) {
            process.stderr.write(`connect failed: ${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
        }
    }
    const definition = HOSTS[hostArg];
    if (!definition) {
        process.stderr.write(`connect: unknown host "${hostArg}". Supported: ${Object.keys(HOSTS).join(', ')}\n`);
        return 2;
    }
    try {
        if (remove) {
            const report = disconnectHost(definition.id);
            if (asJson) {
                process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
                return 0;
            }
            process.stdout.write(report.removed > 0
                ? `removed ${report.removed} immune hook(s) from ${report.configPath}\n`
                : `no immune hooks found in ${report.configPath}\n`);
            if (report.vendorDir)
                process.stdout.write(`  vendored install removed: ${report.vendorDir}\n`);
            return 0;
        }
        const report = connectHost(definition.id, { refresh: args.includes('--refresh') });
        if (asJson) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            return 0;
        }
        process.stdout.write(`connected ${report.label} -> ${report.configPath}\n`);
        const counts = [];
        if (report.added > 0)
            counts.push(`${report.added} event(s) wired`);
        if (report.upgraded > 0)
            counts.push(`${report.upgraded} stale entry(ies) upgraded`);
        if (report.alreadyPresent > 0)
            counts.push(`${report.alreadyPresent} already present`);
        process.stdout.write(`  ${counts.join(' · ')}: ${report.eventsWired.join(', ')}\n`);
        if (report.vendorDir) {
            process.stdout.write(`  vendored: ${report.vendorDir} (v${report.vendorVersion ?? '?'}${report.vendorRefreshed ? ', refreshed' : ''})\n`);
        }
        process.stdout.write(`  scripts: ${report.scriptDir}\n`);
        if (report.backupPath)
            process.stdout.write(`  backup: ${report.backupPath}\n`);
        for (const note of report.notes)
            process.stdout.write(`  note: ${note}\n`);
        return 0;
    }
    catch (error) {
        process.stderr.write(`connect failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
export function cmdUi(args) {
    const rawPort = flagValue(args, '--port');
    const wanted = rawPort !== undefined ? Number(rawPort) : 7788;
    const port = Number.isInteger(wanted) && wanted >= 0 ? wanted : 7788;
    startUiServer({ port })
        .then((handle) => {
        process.stdout.write(`免疫仪表盘 / Immune dashboard: ${handle.url}\n` +
            `仅本机可访问 / bound to 127.0.0.1 · Ctrl+C 停止 / press Ctrl+C to stop\n`);
        const stop = () => {
            handle.close().then(() => process.exit(0));
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    })
        .catch((error) => {
        process.stderr.write(`failed to start UI: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
    return 0;
}
export function cmdDoctor(args = []) {
    const doctorStore = new ImmuneStore();
    const results = runDoctor(doctorStore);
    doctorStore.close();
    const failures = results.filter((check) => !check.ok).length;
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ ok: failures === 0, passed: results.length - failures, total: results.length, checks: results }, null, 2)}\n`);
        return failures === 0 ? 0 : 1;
    }
    for (const check of results) {
        process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write(`\n${results.length - failures}/${results.length} checks passed${failures ? ` — fix the ${failures} FAIL above` : ''}\n`);
    return failures === 0 ? 0 : 1;
}
export async function runDemo() {
    const { distillEpisode } = await import('../../../core/distiller.js');
    const { formatImmuneContext } = await import('../format.js');
    const store = new ImmuneStore({ dbPath: ':memory:' });
    try {
        store.insert({
            trigger_pattern: 'vite.config.ts 环境变量 loadEnv',
            symptom: '直接用 process.env 读客户端变量得到 undefined',
            prescription: '在 vite.config.ts 用 loadEnv(mode, process.cwd(), 前缀) 再传给 define',
        });
        store.insert({
            trigger_pattern: 'EPERM 只读目录 mkdir',
            symptom: '在只读目录创建 .dsh 或文件报 EPERM',
            prescription: '换可写工作目录，或用 IMMUNE_DB_PATH 显式指定库路径',
        });
        console.log('\n[1] a tool call fails (this project: npm install under a peer conflict)\n');
        console.log('  $ npm install');
        console.log('  npm ERR! ERESOLVE Unable to resolve dependency tree: peer react@19 found react-dom@18');
        console.log('  [exit code: 1]\n');
        console.log('[2] the retry succeeds — turn end distils & scores the episode offline\n');
        const distilled = await distillEpisode('Bash', 'tool=Bash input={"command":"npm install"} result=npm ERR! ERESOLVE unable to resolve dependency tree [exit code: 1]', 'tool=Bash input={"command":"npm install --legacy-peer-deps"} result=added 312 packages in 14s [exit code: 0]', { llm: null, repairs: ['Edit package.json'] });
        if (!distilled.ok) {
            console.log(`  the demo episode was skipped: ${distilled.detail ?? 'unknown'}`);
            return;
        }
        const id = store.insert(distilled.antibody);
        console.log(`  learned antibody #${id} (rubric ${distilled.antibody.rubric_score ?? 85}/100 · ${distilled.antibody.quality_grade ?? 'tactic'}):`);
        console.log(`    trigger: ${distilled.antibody.trigger_pattern}`);
        console.log(`    symptom: ${distilled.antibody.symptom.slice(0, 80)}`);
        console.log(`    do:      ${distilled.antibody.prescription.slice(0, 80)}\n`);
        console.log('[3] a NEW session hits the same wall with different words — recall + injection\n');
        const hits = store.match('npm 装依赖又冲突了，装不上怎么办', { limit: 3 });
        const block = formatImmuneContext(hits);
        console.log(block
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'));
        console.log('\n[next] immune connect · immune audit --dry-run · immune seed · immune ui   (demo ran 100% in-memory)\n');
    }
    finally {
        store.close();
    }
}
export function cmdGitHook(args) {
    const asJson = args.includes('--json');
    const warnOnly = args.includes('--warn-only');
    const wantsRemove = args.includes('--remove') || args.includes('remove') || args.includes('uninstall');
    const wantsStatus = args.includes('--status') || args.includes('status');
    try {
        if (wantsStatus) {
            const st = gitHookStatus();
            if (asJson) {
                process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
                return 0;
            }
            if (!st.gitCommonDir) {
                process.stdout.write('git-hook: not inside a Git repository.\n');
                return 1;
            }
            process.stdout.write(`git-hook: ${st.installed ? `installed (${st.mode})` : 'not installed'} · ${st.hookPath ?? '?'}${st.coexistsWithUserHook ? ' (coexists with user hook)' : ''}\n`);
            return 0;
        }
        if (wantsRemove) {
            const res = removeGitHook();
            if (asJson) {
                process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
                return 0;
            }
            process.stdout.write(res.removed
                ? `removed immune pre-commit hook from ${res.hookPath}${res.fileDeleted ? ' (deleted empty hook file)' : ' (preserved existing user hook)'}\n`
                : `no immune pre-commit hook found in ${res.hookPath ?? '.git/hooks/pre-commit'}\n`);
            return 0;
        }
        const st = installGitHook({ warnOnly });
        if (asJson) {
            process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
            return 0;
        }
        process.stdout.write(`installed immune pre-commit hook (${st.mode}) -> ${st.hookPath}${st.coexistsWithUserHook ? ' (preserved existing pre-commit hook)' : ''}\n`);
        return 0;
    }
    catch (error) {
        process.stderr.write(`git-hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
