import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ImmuneStore } from '../dsh-immune-system/dist/core/store/index.js';
import { classifyRuleQuality, deriveProjectScope } from '../dsh-immune-system/dist/core/hygiene.js';
import { looksEchoPrescription } from '../dsh-immune-system/dist/core/rewrite.js';
import { distillBatch } from '../dsh-immune-system/dist/core/distiller.js';
import { isRelated } from '../dsh-immune-system/dist/core/relevance.js';
import {
  recordDeliveryReceipt,
  summarizeReceipts,
} from '../dsh-immune-system/dist/core/receipts.js';
import { BUILTIN_PACKS } from '../dsh-immune-system/dist/core/packs.js';
import { ciCheck, parseManagedBlock } from '../dsh-immune-system/dist/core/share-guard.js';
import { startUiServer } from '../dsh-immune-system/dist/core/ui/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');
const MCP = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'mcp-server.js');

test('v2.1 hygiene quarantines webview/inline-JS/media dumps and locks deterministic rule scope', () => {
  const browserDump =
    'webview_browser: const alipanPage = pages.find(p => p.url().includes("member.bilibili.com")) && upload("scholar-weave-demo.mp4")';
  assert.equal(looksEchoPrescription(browserDump), true);

  const report = classifyRuleQuality({
    trigger_pattern: 'webview_browser upload video',
    symptom: 'UPLOAD_NEEDS_PERMISSION',
    prescription: browserDump,
    tool_name: 'webview_browser',
    prescription_source: 'rule',
  });
  assert.equal(report.grade, 'quarantined');
  assert.equal(report.universalEligible, false);

  // Even a clean-looking deterministic rule must stay workspace-scoped (Decision #28 / #39).
  const detRule = classifyRuleQuality({
    trigger_pattern: 'Bash npm test vitest',
    symptom: 'vitest run failed with exit code 1',
    prescription: 'Bash: npx vitest run --reporter=dot',
    tool_name: 'Bash',
    prescription_source: 'rule',
  });
  assert.equal(detRule.universalEligible, false);
  const wsDir = mkdtempSync(join(tmpdir(), 'demo-app-'));
  try {
    writeFileSync(join(wsDir, 'package.json'), '{}', 'utf8');
    assert.match(deriveProjectScope(wsDir), /^proj:demo-app-/);
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test('v2.1 distillBatch enforces hygiene, rubric scoring, and workspace scope parity', async () => {
  const ws = 'D:/Project/service-alpha';
  const expectedScope = deriveProjectScope(ws);
  const episodes = [
    {
      id: 101,
      toolName: 'Bash',
      failedTrace: 'tool=Bash command="npm run build"\nerror TS2307: Cannot find module ./gen.js',
      fixedTrace: 'tool=Bash command="npm run codegen && npm run build"\nok',
      projectScope: expectedScope,
      workspaceRoot: ws,
    },
    {
      id: 102,
      toolName: 'Write',
      failedTrace: 'tool=Write file_path="D:/Project/service-alpha/out.mp4"\nfailed',
      fixedTrace: 'tool=Write file_path="D:/Project/service-alpha/out.mp4"\nwrote 10MB',
      projectScope: expectedScope,
      workspaceRoot: ws,
    },
  ];
  // Force deterministic fallback path inside distillBatch (no LLM env).
  const out = await distillBatch(episodes, { env: {} });
  const r101 = out.get(101);
  assert.ok(r101?.ok, 'episode 101 should produce a valid antibody');
  assert.equal(r101.antibody.project_scope, expectedScope, 'deterministic batch rule must stay workspace-scoped');
  assert.equal(typeof r101.antibody.rubric_score, 'number');
});

test('v2.1 isRelated requires specific anchors or >=2 weak runtime tokens', () => {
  const trigger = 'Edit import line file';
  // Stack trace sharing only ONE weak runtime word ("file") must NOT blame the rule.
  assert.equal(isRelated(trigger, 'TypeError: boom\n    at main (file:///app/index.mjs:42:9)', 'Edit'), false);
  // Sharing >=2 weak runtime tokens ("file" + "import") or a specific anchor DOES relate.
  assert.equal(isRelated(trigger, 'SyntaxError: invalid file import statement', 'Edit'), true);
  assert.equal(isRelated('Bash ERESOLVE peer dependency', 'npm ERR! ERESOLVE peer conflict', 'Bash'), true);
});

test('v2.1 removeAntibody preserves SHA-256 receipt chain, recent-window verification, and cleans seed_packs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v21-receipts-'));
  const dbPath = join(dir, 'immune.sqlite');
  const store = new ImmuneStore({ dbPath, sharedDbPath: false });
  try {
    const rustPack = BUILTIN_PACKS.find((p) => p.id === 'rust-cargo');
    assert.ok(rustPack);
    const seedRes = store.seedPack('rust-cargo', rustPack.rules);
    assert.equal(seedRes.inserted, 6);
    assert.equal(store.seededPackCounts().get('rust-cargo'), 6);

    const list = store.listAll(true);
    const first = list[0];
    const second = list[1];
    assert.ok(first?.id && second?.id);

    const rawDb = new DatabaseSync(dbPath);
    try {
      for (let i = 0; i < 5; i += 1) {
        recordDeliveryReceipt(rawDb, {
          sessionId: `sess-${i}`,
          ruleId: i % 2 === 0 ? first.id : second.id,
          outcome: 'delivered',
          model: 'claude-sonnet-4',
          projectScope: '*',
        });
      }
    } finally {
      rawDb.close();
    }

    assert.equal(store.remove(first.id), true);
    // Orphan seed_packs row cleaned up -> count drops from 6 to 5!
    assert.equal(store.seededPackCounts().get('rust-cargo'), 5);

    // Append-only receipt chain MUST stay intact after antibody deletion!
    const fullChain = store.receiptSummary(500);
    assert.equal(fullChain.chainValid, true);
    assert.equal(fullChain.total, 5);

    // Windowed summary (limit < total) must verify from preceding row's digest!
    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const recentSummary = summarizeReceipts(verifyDb, 2);
      assert.equal(recentSummary.chainValid, true);
      assert.equal(recentSummary.total, 5);
    } finally {
      verifyDb.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.1 ciCheck parses file:line hunks, skips managed blocks, and honours flag boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v21-cicheck-'));
  try {
    const docFile = join(dir, 'AGENTS.md');
    writeFileSync(
      docFile,
      [
        '# Project Guide',
        '<!-- immune:generated start -->',
        '- **git push --force main**',
        '  - 忌/avoid: Force-pushing directly to main',
        '  - 宜/do: Use git push --force-with-lease origin main instead',
        '<!-- immune:generated end -->',
      ].join('\n'),
      'utf8',
    );

    const diff = [
      'diff --git a/AGENTS.md b/AGENTS.md',
      '+++ b/AGENTS.md',
      '@@ -1,3 +1,7 @@',
      '+<!-- immune:generated start -->',
      '+- **git push --force main**',
      '+<!-- immune:generated end -->',
      'diff --git a/scripts/release.sh b/scripts/release.sh',
      '+++ b/scripts/release.sh',
      '@@ -10,2 +10,4 @@',
      ' echo "releasing"',
      '+git push --force-with-lease origin main',
      '+git push --force origin main',
    ].join('\n');

    const rules = parseManagedBlock(docFile);
    assert.equal(rules.length, 1);
    const report = ciCheck(diff, rules);
    assert.equal(report.findings.length, 1, `expected 1 finding, got ${JSON.stringify(report.findings)}`);
    assert.equal(report.findings[0].file, 'scripts/release.sh');
    assert.equal(report.findings[0].line, 12);
    assert.match(report.findings[0].text, /--force origin main/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.1 CLI --version, non-mutating --help, CLAUDE.md sync-doc fallback, --github warn-only, and --json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v21-cli-'));
  const dbPath = join(dir, 'nonexistent.sqlite');
  try {
    const ver = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    assert.equal(ver.status, 0);
    assert.match(ver.stdout.trim(), /^dsh-immune-system v\d+\.\d+\.\d+$/);

    // Subcommand --help must NEVER create the database or mutate host configs!
    for (const cmd of ['connect', 'hygiene', 'backup', 'ci-check']) {
      const res = spawnSync(process.execPath, [CLI, cmd, '--help'], {
        cwd: dir,
        env: { ...process.env, IMMUNE_DB_PATH: dbPath },
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, `${cmd} --help failed`);
      assert.match(res.stdout, new RegExp(`immune ${cmd}`));
    }
    assert.equal(existsSync(dbPath), false, '--help must not create an empty SQLite file');

    // Populate one proven universal rule and verify sync-doc writes to existing CLAUDE.md when AGENTS.md is absent.
    const liveDb = join(dir, 'live.sqlite');
    const store = new ImmuneStore({ dbPath: liveDb, sharedDbPath: false });
    store.insert({
      trigger_pattern: 'ERR_UNSUPPORTED_ESM_URL_SCHEME dynamic import',
      symptom: 'Raw Windows path passed to dynamic import()',
      prescription: 'Wrap local paths with pathToFileURL(p).href before dynamic import()',
      tool_name: 'Bash',
      hit_count: 5,
      prescription_source: 'human',
      project_scope: '*',
    });
    store.close();

    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# Claude Instructions\n', 'utf8');
    const syncRes = spawnSync(process.execPath, [CLI, 'sync-doc', '--min-hits', '0'], {
      cwd: dir,
      env: { ...process.env, IMMUNE_DB_PATH: liveDb },
      encoding: 'utf8',
    });
    assert.equal(syncRes.status, 0, syncRes.stderr);
    assert.equal(existsSync(join(dir, 'AGENTS.md')), false);
    assert.match(readFileSync(claudeMd, 'utf8'), /ERR_UNSUPPORTED_ESM_URL_SCHEME/);

    // ci-check --github --warn-only emits ::warning and exits 0.
    const diffPath = join(dir, 'pr.diff');
    writeFileSync(
      diffPath,
      ['+++ b/src/loader.mjs', '@@ -1,1 +1,2 @@', '+// ERR_UNSUPPORTED_ESM_URL_SCHEME dynamic import'].join('\n'),
      'utf8',
    );
    const summaryPath = join(dir, 'step-summary.md');
    const ciRes = spawnSync(
      process.execPath,
      [CLI, 'ci-check', '--diff', diffPath, '--doc', claudeMd, '--github', '--warn-only'],
      {
        cwd: dir,
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
        encoding: 'utf8',
      },
    );
    assert.equal(ciRes.status, 0, ciRes.stderr);
    assert.match(ciRes.stdout, /::warning file=src\/loader\.mjs,line=1/);
    assert.match(readFileSync(summaryPath, 'utf8'), /Agent Immune — PR Pitfall Check/);

    // stats --json & doctor --json return valid JSON.
    const statsJson = spawnSync(process.execPath, [CLI, 'stats', '--json'], {
      cwd: dir,
      env: { ...process.env, IMMUNE_DB_PATH: liveDb },
      encoding: 'utf8',
    });
    assert.equal(statsJson.status, 0);
    const parsedStats = JSON.parse(statsJson.stdout);
    assert.equal(parsedStats.active, 1);

    const docJson = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
      cwd: dir,
      env: { ...process.env, IMMUNE_DB_PATH: liveDb },
      encoding: 'utf8',
    });
    const parsedDoc = JSON.parse(docJson.stdout);
    assert.ok(Array.isArray(parsedDoc.checks));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.1 MCP exposes 20 tools including immune_doctor, immune_ci_check, and human-provenance immune_learn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v21-mcp-'));
  const dbPath = join(dir, 'mcp.sqlite');
  const agentsMd = join(dir, 'AGENTS.md');
  writeFileSync(
    agentsMd,
    [
      '<!-- immune:generated start -->',
      '- **Cargo borrow checker mutable aliasing**',
      '  - 忌/avoid: double mutable borrow',
      '  - 宜/do: split struct borrows',
      '<!-- immune:generated end -->',
    ].join('\n'),
    'utf8',
  );

  const child = spawn(process.execPath, [MCP], {
    cwd: dir,
    env: { ...process.env, IMMUNE_DB_PATH: dbPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = new Map();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    }
  });

  const rpc = async (id, method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const deadline = Date.now() + 5_000;
    while (!responses.has(id) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(responses.has(id), `timed out waiting for MCP response #${id}`);
    return responses.get(id);
  };

  try {
    await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
    const listResp = await rpc(2, 'tools/list');
    const names = listResp.result.tools.map((t) => t.name);
    assert.equal(names.length, 27);
    assert.ok(names.includes('immune_doctor'));
    assert.ok(names.includes('immune_ci_check'));
    assert.ok(names.includes('immune_explain'));
    assert.ok(names.includes('immune_guard'));
    assert.ok(names.includes('immune_guard_log'));
    assert.ok(names.includes('immune_vaccinate'));
    assert.ok(names.includes('immune_diagnose'));
    assert.ok(names.includes('immune_autopsy'));
    assert.ok(names.includes('immune_federate'));

    await rpc(3, 'tools/call', {
      name: 'immune_learn',
      arguments: {
        trigger: 'Cargo borrow checker mutable aliasing',
        symptom: 'cannot borrow as mutable more than once',
        prescription: 'Clone or split struct borrows into disjoint fields before mutating',
        tool_name: 'Bash',
      },
    });

    const docResp = await rpc(4, 'tools/call', { name: 'immune_doctor', arguments: {} });
    const docData = JSON.parse(docResp.result.content[0].text);
    assert.equal(typeof docData.ok, 'boolean');
    assert.ok(Array.isArray(docData.checks));

    const ciResp = await rpc(5, 'tools/call', {
      name: 'immune_ci_check',
      arguments: {
        diff: '+++ b/src/main.rs\n@@ -1,1 +1,2 @@\n+// Cargo borrow checker mutable aliasing\n',
        doc: agentsMd,
      },
    });
    const ciData = JSON.parse(ciResp.result.content[0].text);
    assert.equal(ciData.findings.length, 1);
    assert.equal(ciData.findings[0].file, 'src/main.rs');
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise((r) => child.once('close', r));
  }

  const verifyStore = new ImmuneStore({ dbPath, sharedDbPath: false, readOnly: true });
  try {
    const learned = verifyStore.listAll(false)[0];
    assert.equal(learned.prescription_source, 'human');
  } finally {
    verifyStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.1 Dashboard isolates quarantined rules from Project tab, renders ?lang=zh-CN offline, and returns workspace fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imm-v21-ui-'));
  const dbPath = join(dir, 'ui.sqlite');
  const store = new ImmuneStore({ dbPath, sharedDbPath: false });
  store.insert({
    trigger_pattern: 'active clean rule',
    symptom: 'clean symptom',
    prescription: 'Use clean architectural boundary',
    prescription_source: 'human',
    status: 'active',
  });
  store.insert({
    trigger_pattern: 'quarantined noisy dump',
    symptom: 'noisy symptom',
    prescription: 'Write: C:\\temp\\dump.mp4',
    status: 'quarantined',
    quality_grade: 'quarantined',
  });
  store.upsertWorkspaceProfile({
    scope_id: 'proj:demo:12345678',
    name: 'demo',
    root_path: 'D:/Project/demo',
    stack: JSON.stringify(['node-ts', 'rust-cargo']),
    baseline: 'widely',
    rules_count: 1,
    source: 'disk',
    last_scanned_at: Date.now(),
  });
  store.close();

  const srv = await startUiServer({ dbPath });
  try {
    const baseUrl = `http://127.0.0.1:${srv.port}`;
    const zhHtmlRes = await fetch(`${baseUrl}/?lang=zh-CN`);
    const zhHtml = await zhHtmlRes.text();
    assert.match(zhHtml, /lang="zh-CN"/);
    assert.doesNotMatch(zhHtml, /https?:\/\//i, 'dashboard HTML must stay 100% offline');

    const tokenMatch = zhHtml.match(/TOKEN\s*=\s*["']([a-f0-9]+)["']/i) ?? zhHtml.match(/\bt=([a-f0-9]{32,})/i);
    assert.ok(tokenMatch?.[1], 'expected dashboard page to embed per-run API token');
    const token = tokenMatch[1];

    const projRes = await fetch(`${baseUrl}/api/list?t=${token}`);
    const projData = await projRes.json();
    assert.equal(projData.antibodies.length, 1);
    assert.equal(projData.antibodies[0].status, 'active');

    const quarRes = await fetch(`${baseUrl}/api/quarantined?t=${token}`);
    const quarData = await quarRes.json();
    assert.equal(quarData.antibodies.length, 1);
    assert.equal(quarData.antibodies[0].status, 'quarantined');

    const wsRes = await fetch(`${baseUrl}/api/workspaces?t=${token}`);
    const wsData = await wsRes.json();
    assert.equal(wsData.workspaces.length, 1);
    assert.equal(wsData.workspaces[0].scope_id, 'proj:demo:12345678');
    assert.equal(wsData.workspaces[0].root_path, 'D:/Project/demo');
    assert.equal(wsData.workspaces[0].stack, JSON.stringify(['node-ts', 'rust-cargo']));
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
