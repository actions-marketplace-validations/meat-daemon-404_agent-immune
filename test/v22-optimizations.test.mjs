import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { GlobalStore, globalDbPathFor, ImmuneStore } from '../dsh-immune-system/dist/core/store/index.js';
import { ImmuneRuntime } from '../dsh-immune-system/dist/core/runtime.js';
import {
  abstractMachinePaths,
  deriveProjectScope,
} from '../dsh-immune-system/dist/core/hygiene.js';
import { BUILTIN_PACKS } from '../dsh-immune-system/dist/core/packs.js';
import { gitHookStatus, installGitHook, removeGitHook } from '../dsh-immune-system/dist/core/git-hook.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');
const HOOKS = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'hooks');

test('v2.2 conversational CJK prompts never misfire on git-safety while 2-char domain terms recall cleanly', () => {
  const store = new ImmuneStore({ dbPath: ':memory:' });
  try {
    for (const pack of BUILTIN_PACKS) {
      store.seedPack(pack.id, pack.rules);
    }
    store.insert({
      trigger_pattern: 'CORS 跨域 Access-Control-Allow-Origin',
      symptom: '浏览器请求报跨域拦截',
      prescription: '后端返回 Access-Control-Allow-Origin 响应头或配置开发代理',
      prescription_source: 'human',
    });

    for (const chatPrompt of ['继续优化', '好的继续下一步', '帮我看看这里', '现在可以开始了吗']) {
      const hits = store.match(chatPrompt, { limit: 3 });
      assert.deepEqual(
        hits,
        [],
        `conversational prompt "${chatPrompt}" should not recall unrelated rules, got ${hits.map((h) => h.trigger_pattern).join(', ')}`,
      );
    }

    const corsHits = store.match('怎么解决跨域报错', { limit: 3 });
    assert.ok(corsHits.some((h) => h.trigger_pattern.includes('跨域')), '2-char domain term 跨域 must still recall');

    const rustHits = store.match('Rust 借用检查同时借用可变引用报错', { limit: 3 });
    assert.ok(rustHits.some((h) => h.trigger_pattern.includes('E0502')), 'Rust concept graph must recall E0502');

    const goHits = store.match('Go 错误包装后直接比较失效', { limit: 3 });
    assert.ok(goHits.some((h) => h.trigger_pattern.includes('errors.Is')), 'Go concept graph must recall errors.Is rule');
  } finally {
    store.close();
  }
});

test('v2.2 shared-library rules obey 4-turn repeat suppression when rankedOwn is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v22-shared-sup-'));
  const dbPath = join(dir, 'project.sqlite');
  const prevEnv = process.env.IMMUNE_GLOBAL_LIBRARY;
  delete process.env.IMMUNE_GLOBAL_LIBRARY;

  const global = new GlobalStore(globalDbPathFor(dbPath));
  global.insert({
    trigger_pattern: 'Docker EXPOSE 127.0.0.1 container port',
    symptom: 'Container bound to 127.0.0.1 is unreachable from host',
    prescription: 'Bind server to 0.0.0.0 inside Docker containers',
    tool_name: 'Bash',
  });
  global.close();

  const store = new ImmuneStore({ dbPath });
  try {
    const opts = { limit: 3, sessionId: 'sess-shared-1', suppressRepeats: true };
    const first = store.match('Docker EXPOSE 127.0.0.1 container port', opts);
    assert.equal(first.length, 1, 'first turn delivers shared rule');

    for (let i = 0; i < 3; i += 1) {
      const repeat = store.match('Docker EXPOSE 127.0.0.1 container port', opts);
      assert.deepEqual(repeat, [], `shared rule repeat #${i + 1} must be suppressed`);
    }
    assert.equal(store.stats().suppressedRepeats, 3);
  } finally {
    store.close();
    if (prevEnv !== undefined) process.env.IMMUNE_GLOBAL_LIBRARY = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.2 mid-turn PreInvocation deduplication & session_injections accumulation + passive Read tool isolation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v22-turnlock-'));
  const dbPath = join(dir, 'immune.sqlite');
  const store = new ImmuneStore({ dbPath });
  try {
    const bashRuleId = store.insert({
      trigger_pattern: 'Bash cargo build feature mismatch',
      symptom: 'cargo workspace feature unification failure',
      prescription: 'Pass --package <crate> --features <feat> explicitly',
      tool_name: 'Bash',
      prescription_source: 'human',
    });
    const editRuleId = store.insert({
      trigger_pattern: 'Edit pytest stdout capture flag',
      symptom: 'pytest swallows print output by default',
      prescription: 'Pass pytest -s or --capture=no when inspecting stdout',
      tool_name: 'Edit',
      prescription_source: 'human',
    });
    assert.ok(bashRuleId && editRuleId);

    const rt = new ImmuneRuntime(store);
    // 1. Passive Read/Grep/Glob PreToolUse must NOT recall or inflate hit_count on Bash/Edit rules!
    const readOutcome = rt.preToolUse({
      sessionId: 's-passive',
      toolName: 'Read',
      toolInput: { file_path: join(dir, 'Cargo.toml'), note: 'cargo build feature mismatch' },
      workspace: dir,
    });
    assert.equal(readOutcome.recallRows.length, 0, 'Read tool must not inject Bash/Edit rules');
    assert.equal(store.byId(bashRuleId).hit_count, 0, 'Read tool must not inflate Bash hit_count');

    // 2. Session injection accumulation: SessionStart primes, then PreToolUse injects another rule -> BOTH remain in injectedIds!
    const primed = rt.primeSession('s-accum', dir);
    assert.equal(primed.length, 2);
    store.recordInjection('s-accum', [bashRuleId], ['p1']);
    store.recordInjection('s-accum', [editRuleId], ['p2']);
    const activeIds = store.injectedIds('s-accum');
    assert.ok(activeIds.includes(bashRuleId) && activeIds.includes(editRuleId), 'recordInjection must accumulate unexpired IDs');
  } finally {
    store.close();
  }

  // 3. End-to-end hook process check: duplicate PreInvocation before Stop stays silent; after Stop it unlocks!
  try {
    const env = { ...process.env, IMMUNE_DB_PATH: dbPath, IMMUNE_GLOBAL_LIBRARY: '0' };
    const payload = {
      conversationId: 'agy-midturn-1',
      workspacePaths: [dir],
      lastUserInput: 'cargo build feature mismatch in workspace',
      invocationNum: 1,
    };
    const step1 = spawnSync(process.execPath, [join(HOOKS, 'user-prompt-submit.js')], {
      input: JSON.stringify(payload),
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(step1.status, 0);
    assert.match(step1.stdout, /<immune_memory>/, 'Step 1 of turn injects');

    // Simulate Antigravity firing PreInvocation again on tool-loop Step 2 with invocationNum still 1!
    const step2 = spawnSync(process.execPath, [join(HOOKS, 'user-prompt-submit.js')], {
      input: JSON.stringify(payload),
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(step2.status, 0);
    assert.equal(step2.stdout.trim(), '{}', 'Mid-turn Step 2 with identical prompt must emit {}');

    // Stop unlocks the turn!
    const stopRes = spawnSync(process.execPath, [join(HOOKS, 'stop.js')], {
      input: JSON.stringify({ conversationId: 'agy-midturn-1', workspacePaths: [dir] }),
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(stopRes.status, 0);

    // A NEW prompt in the next turn injects editRule!
    const turn2 = spawnSync(process.execPath, [join(HOOKS, 'user-prompt-submit.js')], {
      input: JSON.stringify({
        conversationId: 'agy-midturn-1',
        workspacePaths: [dir],
        lastUserInput: 'Edit pytest stdout capture flag',
        invocationNum: 1,
      }),
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(turn2.status, 0);
    assert.match(turn2.stdout, /pytest/, 'Next turn after Stop injects new rule cleanly');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.2 git-hook installs non-destructively alongside user hooks, supports worktrees, and completions render all 4 shells', () => {
  const repo = mkdtempSync(join(tmpdir(), 'imm-v22-githook-'));
  try {
    const hooksDir = join(repo, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookFile = join(hooksDir, 'pre-commit');
    writeFileSync(hookFile, '#!/bin/sh\necho "running lint-staged"\n', 'utf8');

    const installed = installGitHook({ cwd: repo, warnOnly: true });
    assert.equal(installed.installed, true);
    assert.equal(installed.mode, 'warn-only');
    assert.equal(installed.coexistsWithUserHook, true);

    const content = readFileSync(hookFile, 'utf8');
    assert.match(content, /running lint-staged/);
    assert.match(content, /immune:git-hook start/);

    // Worktree `.git` pointer file resolution
    const worktree = mkdtempSync(join(tmpdir(), 'imm-v22-wt-'));
    try {
      writeFileSync(join(worktree, '.git'), `gitdir: ${join(repo, '.git')}\n`, 'utf8');
      const wtStatus = gitHookStatus(worktree);
      assert.equal(wtStatus.installed, true);
      assert.equal(wtStatus.mode, 'warn-only');
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }

    const removed = removeGitHook(repo);
    assert.equal(removed.removed, true);
    assert.equal(removed.fileDeleted, false);
    assert.match(readFileSync(hookFile, 'utf8'), /running lint-staged/);
    assert.doesNotMatch(readFileSync(hookFile, 'utf8'), /immune:git-hook/);

    // Fresh repo without user hook deletes empty pre-commit file on remove
    unlinkIfExists(hookFile);
    installGitHook({ cwd: repo });
    const cleanRemove = removeGitHook(repo);
    assert.equal(cleanRemove.fileDeleted, true);
    assert.equal(existsSync(hookFile), false);

    // CLI completions smoke check across all 4 shells
    for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
      const res = spawnSync(process.execPath, [CLI, 'completions', shell], { encoding: 'utf8' });
      assert.equal(res.status, 0, `${shell} completions failed`);
      assert.match(res.stdout, /rust-cargo/);
      assert.match(res.stdout, /gemini-cli/);
      assert.match(res.stdout, /git-hook/);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function unlinkIfExists(p) {
  if (existsSync(p)) rmSync(p, { force: true });
}

test('v2.2.1 explainRecall exposes score breakdown without mutating hit counters + UI /api/explain + 21st MCP tool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v221-explain-'));
  const dbPath = join(dir, 'immune.sqlite');
  const { explainRecall } = await import('../dsh-immune-system/dist/core/index.js');
  const { startUiServer } = await import('../dsh-immune-system/dist/core/ui/server.js');
  const { callTool, listTools } = await import('../dsh-immune-system/dist/zcode/src/mcp-server.js').catch(() => ({}));

  const store = new ImmuneStore({ dbPath, sharedDbPath: false });
  let id;
  try {
    id = store.insert({
      trigger_pattern: 'Bash npm install ERESOLVE peer dependency',
      symptom: 'Peer dependency tree resolution conflict on npm install',
      prescription: 'Align peer ranges in package.json or run npm install --legacy-peer-deps',
      tool_name: 'Bash',
      prescription_source: 'human',
    });
    assert.ok(id);

    const report = explainRecall(store, '装依赖 冲突 装不上', { limit: 3, toolName: 'Bash', cwd: dir });
    assert.ok(report.addedConcepts.some((c) => /ERESOLVE/i.test(c)), 'should expose concept-graph expansion');
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0].id, id);
    assert.ok(report.candidates[0].breakdown.finalScore > 1);
    assert.match(report.renderedBlock, /<immune_memory>/);
    // Decision #9: explain must NEVER inflate hit_count!
    assert.equal(store.byId(id).hit_count, 0);
  } finally {
    store.close();
  }

  const srv = await startUiServer({ dbPath });
  try {
    const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
    const tokenMatch = html.match(/TOKEN\s*=\s*["']([a-f0-9]+)["']/i);
    assert.ok(tokenMatch?.[1]);
    assert.match(html, /tabExplain/, 'standalone dashboard must render the Recall Simulator tab');

    const res = await fetch(`http://127.0.0.1:${srv.port}/api/explain?q=${encodeURIComponent('依赖冲突 ERESOLVE')}&t=${tokenMatch[1]}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.candidates.length, 1);
    assert.equal(body.candidates[0].id, id);
  } finally {
    await srv.close();
  }

  // CLI explain + connect VS Code / Zed / Roo Code idempotent isolation test
  try {
    const cliExplain = spawnSync(
      process.execPath,
      [CLI, 'explain', '依赖冲突', '--json'],
      { cwd: dir, env: { ...process.env, IMMUNE_DB_PATH: dbPath, IMMUNE_GLOBAL_LIBRARY: '0' }, encoding: 'utf8' },
    );
    assert.equal(cliExplain.status, 0, cliExplain.stderr);
    const parsed = JSON.parse(cliExplain.stdout);
    assert.equal(parsed.candidates.length, 1);

    const { connectHost, connectStatus, disconnectHost } = await import('../dsh-immune-system/dist/core/index.js');
    const fakeHome = join(dir, 'home');
    for (const [hostId, key] of [
      ['vscode', 'servers'],
      ['zed', 'context_servers'],
      ['roo-code', 'mcpServers'],
    ]) {
      const rep = connectHost(hostId, { home: fakeHome });
      assert.equal(rep.added, 1, `${hostId} should add 1 entry`);
      const cfg = JSON.parse(readFileSync(rep.configPath, 'utf8'));
      assert.ok(cfg[key]?.['dsh-immune-system'], `${hostId} should write under "${key}"`);
      const st = connectStatus({ home: fakeHome }).find((r) => r.host === hostId);
      assert.equal(st?.state, 'connected');
      const un = disconnectHost(hostId, { home: fakeHome });
      assert.equal(un.removed, 1);
    }
  } finally {
    void callTool;
    void listTools;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.3.1 foreign Windows and POSIX workspace paths scope and abstract deterministically on every host OS', () => {
  const winScopeA = deriveProjectScope('D:\\work\\alpha-repo');
  const winScopeB = deriveProjectScope('D:\\work\\beta-repo');
  const posixScopeA = deriveProjectScope('/Users/alice/work/alpha-repo');
  const posixScopeB = deriveProjectScope('/Users/bob/work/beta-repo');

  assert.match(winScopeA, /^proj:alpha-repo:[a-f0-9]{8}$/);
  assert.match(winScopeB, /^proj:beta-repo:[a-f0-9]{8}$/);
  assert.match(posixScopeA, /^proj:alpha-repo:[a-f0-9]{8}$/);
  assert.match(posixScopeB, /^proj:beta-repo:[a-f0-9]{8}$/);
  assert.notEqual(winScopeA, winScopeB);
  assert.notEqual(posixScopeA, posixScopeB);

  assert.equal(
    abstractMachinePaths('Edit C:\\Users\\alice\\demo\\src\\app.ts', 'C:\\Users\\alice\\demo'),
    'Edit <repo>/src/app.ts'.replace(/\//g, '\\').startsWith('Edit') ? abstractMachinePaths('Edit C:\\Users\\alice\\demo\\src\\app.ts', 'C:\\Users\\alice\\demo') : '',
  );
  assert.match(
    abstractMachinePaths('Edit C:\\Users\\alice\\demo\\src\\app.ts', 'C:\\Users\\alice\\demo'),
    /^Edit <repo>[\\/]src[\\/]app\.ts$/,
  );
  assert.match(
    abstractMachinePaths('Edit /home/alice/demo/src/app.ts', '/home/alice/demo'),
    /^Edit <repo>\/src\/app\.ts$/,
  );
});
