import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ImmuneStore } from '../dsh-immune-system/dist/core/store/index.js';
import { extractGuardInput, findGuardHit } from '../dsh-immune-system/dist/core/guards.js';
import {
  evaluatePreFlightGuard,
  renderGuardHostHookDecision,
  renderGuardMarkdown,
  renderGuardTerminal,
} from '../dsh-immune-system/dist/core/guard.js';
import {
  applyVaccineLockfile,
  detectWorkspaceDNA,
  verifyVaccineLockfile,
  writeVaccineLockfile,
} from '../dsh-immune-system/dist/core/vaccine.js';
import {
  hydrateTeamRules,
  isTeamShareSafe,
  maybeSyncTeamRulesAfterDrain,
  verifyTeamRulesJsonl,
} from '../dsh-immune-system/dist/core/team-sync.js';
import { compileIdeRules, renderCursorMdc } from '../dsh-immune-system/dist/core/compile-rules.js';
import { parseManagedBlock, ciCheck } from '../dsh-immune-system/dist/core/share-guard.js';
import { diagnoseAgentArchetype } from '../dsh-immune-system/dist/core/diagnose.js';
import { federateSwarmRules } from '../dsh-immune-system/dist/core/federate.js';
import { computeImmunityScore, renderWrappedSvg } from '../dsh-immune-system/dist/core/wrapped.js';
import { startUiServer } from '../dsh-immune-system/dist/core/ui/server.js';
import { renderCompletions } from '../dsh-immune-system/dist/zcode/src/commands/completions.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');

test('v3.1 cli.js mcp starts JSON-RPC stdio server, exposes 26 tools, and sets isError on validation errors', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'immune-v31-mcp-'));
  const dbPath = join(tmp, 'mcp.sqlite');
  const child = spawn(process.execPath, [CLI, 'mcp'], {
    cwd: tmp,
    env: { ...process.env, IMMUNE_DB_PATH: dbPath, IMMUNE_GLOBAL_LIBRARY: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = new Map();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
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
    const init = await rpc(1, 'initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'dsh-immune-system');

    const listed = await rpc(2, 'tools/list');
    assert.equal(listed.result.tools.length, 26);

    const guardResp = await rpc(3, 'tools/call', {
      name: 'immune_guard',
      arguments: { payload: 'git push --force origin main' },
    });
    assert.notEqual(guardResp.result.isError, true);
    const verdict = JSON.parse(guardResp.result.content[0].text);
    assert.equal(verdict.decision, 'rewrite');
    assert.equal(verdict.suggestedRewrite, 'git push --force-with-lease origin main');

    const badResp = await rpc(4, 'tools/call', {
      name: 'immune_forget',
      arguments: { id: -1 },
    });
    assert.equal(badResp.result.isError, true, 'validation errors must set MCP isError: true');

    const diagResp = await rpc(5, 'tools/call', { name: 'immune_diagnose', arguments: {} });
    assert.equal(JSON.parse(diagResp.result.content[0].text).archetype.id, 'cold-start');

    const vaccResp = await rpc(6, 'tools/call', { name: 'immune_vaccinate', arguments: { workspace: tmp } });
    assert.ok(JSON.parse(vaccResp.result.content[0].text).preview.integrityHash);
  } finally {
    const exited = new Promise((res) => {
      if (child.exitCode !== null) res();
      else child.once('exit', () => res());
    });
    child.stdin.end();
    child.kill();
    await exited;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('v3.1 isTeamShareSafe delegates to shareSanityCheck and verifyTeamRulesJsonl catches malformed JSON & forged hashes', () => {
  // Leaks previously missed by narrow regexes
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'win', symptom: 'bad', prescription: 'Read D:\\Project\\secret\\app.dat' }),
    false,
  );
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'ssh', symptom: 'bad', prescription: 'chmod 600 /root/.ssh/id_rsa' }),
    false,
  );
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'openai', symptom: 'bad', prescription: 'use sk-proj-abcdefghijklmnopqrstuvwxyz123456' }),
    false,
  );
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'aws', symptom: 'bad', prescription: 'export AWS_KEY=AKIAIOSFODNN7EXAMPLE' }),
    false,
  );
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'gh', symptom: 'bad', prescription: 'token github_pat_11ABCDEF0123456789_xyz1234567890' }),
    false,
  );
  // Retina filename must NOT be rejected as an email
  assert.equal(
    isTeamShareSafe({ trigger_pattern: 'asset', symptom: 'missing', prescription: 'Keep logo@2x.png in public/' }),
    true,
  );

  // Corrupted JSONL & forged hash detection
  const malformed = verifyTeamRulesJsonl('{{{not json\n{"bad":1}\n');
  assert.equal(malformed.valid, false);
  assert.equal(malformed.malformedLines, 2);

  const forged = verifyTeamRulesJsonl(
    JSON.stringify({
      hash: '0000000000000000',
      trigger_pattern: 'pnpm',
      symptom: 'drift',
      prescription: 'Use pnpm install',
      tool_name: 'Bash',
    }) + '\n',
  );
  assert.equal(forged.valid, false);
  assert.equal(forged.hashMismatches, 1);
});

test('v3.1 hydrateTeamRules & applyVaccineLockfile are idempotent and never inflate hit_count (AGENTS #9)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'immune-v31-idem-'));
  try {
    const ws = join(tmp, 'repo');
    mkdirSync(join(ws, '.immune'), { recursive: true });
    writeFileSync(join(ws, 'package.json'), '{"name":"repo"}\n');
    writeFileSync(join(ws, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");

    const store = new ImmuneStore({ dbPath: join(tmp, 'store.sqlite') });
    try {
      const { lockfile } = writeVaccineLockfile(ws, []);
      const r1 = applyVaccineLockfile(store, lockfile);
      const r2 = applyVaccineLockfile(store, lockfile);
      const r3 = applyVaccineLockfile(store, lockfile);
      assert.equal(r1.applied, lockfile.antibodies.length);
      assert.equal(r2.applied, 0, 'second apply must skip existing rules');
      assert.equal(r3.applied, 0, 'third apply must skip existing rules');

      const rows = store.listAll(false);
      for (const row of rows) {
        assert.equal(row.hit_count, 0, `repeated vaccine apply must not bump hit_count on #${row.id}`);
      }

      // Write team rules and hydrate 3 times
      maybeSyncTeamRulesAfterDrain(store, ws, { IMMUNE_TEAM_SYNC: '1', IMMUNE_TEAM_SYNC_MIN_HITS: '1' });
      writeFileSync(
        join(ws, '.immune', 'rules.jsonl'),
        JSON.stringify({
          hash: 'b8a1b2c3d4e5f6a7',
          trigger_pattern: 'custom team rule',
          symptom: 'bad command',
          prescription: 'Use verified script instead of raw curl',
          tool_name: 'Bash',
        }) + '\n',
      );
      const h1 = hydrateTeamRules(store, ws);
      const h2 = hydrateTeamRules(store, ws);
      const h3 = hydrateTeamRules(store, ws);
      assert.equal(h1.imported, 1);
      assert.equal(h2.imported, 0);
      assert.equal(h3.imported, 0);
      const teamRow = store.listAll(false).find((r) => r.prescription === 'Use verified script instead of raw curl');
      assert.ok(teamRow);
      assert.equal(teamRow.hit_count, 0, 'repeated team-sync hydration must not inflate hit_count');
    } finally {
      store.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('v3.1 guard security matrix: multiline bypass, regex permutations, safe rewrites, redaction, and AGENTS #8', () => {
  // 1. core/guards.ts multiline bypass & cross-line FP fixed by extractGuardInput
  assert.ok(findGuardHit(extractGuardInput({ command: 'rm -rf /\necho done' })), 'multiline rm -rf / must match');
  assert.equal(
    findGuardHit(extractGuardInput({ command: 'git push origin feat\nrm -f main.log' })),
    null,
    'cross-line push + rm -f main.log must not false-positive',
  );

  // 2. core/guard.ts catastrophic false negatives fixed
  for (const cmd of [
    'rm -fr /',
    'rm -r -f /',
    'rm -rf --no-preserve-root /',
    'rm -rf /*',
    'rm -rf "/"',
    'psql -c "TRUNCATE users;"',
  ]) {
    const v = evaluatePreFlightGuard(cmd);
    assert.equal(v.decision, 'block', `must block: ${cmd}`);
  }

  // 3. False positives eliminated
  for (const safe of [
    'rm -rf ~/project/dist',
    'rm -rf .git/index.lock',
    'git commit -m "ban --no-verify in docs"',
    'git push --force-with-lease origin main',
  ]) {
    const v = evaluatePreFlightGuard(safe);
    assert.equal(v.decision, 'allow', `must allow: ${safe}`);
  }
  assert.equal(
    evaluatePreFlightGuard('// drag and drop table rows', [], { toolName: 'Edit' }).decision,
    'allow',
  );

  // 4. Scoped & accurate rewrites
  const chained = evaluatePreFlightGuard('git push --force-with-lease origin a && git push --force origin b');
  assert.equal(chained.decision, 'rewrite');
  assert.equal(chained.suggestedRewrite, 'git push --force-with-lease origin a && git push --force-with-lease origin b');

  const rmAndPush = evaluatePreFlightGuard('rm -f tmp.log && git push --force origin main');
  assert.equal(rmAndPush.suggestedRewrite, 'rm -f tmp.log && git push --force-with-lease origin main');

  const orReset = evaluatePreFlightGuard('echo ok || git reset --hard');
  assert.equal(orReset.suggestedRewrite, 'echo ok || ( git stash push -u -m "immune-pre-reset" && git reset --hard )');

  const stashDropReset = evaluatePreFlightGuard('git stash drop && git reset --hard');
  assert.equal(stashDropReset.decision, 'rewrite');

  assert.equal(evaluatePreFlightGuard('chmod 0777 ./run.sh').suggestedRewrite, 'chmod 755 ./run.sh');
  assert.equal(evaluatePreFlightGuard('chmod a+rwx ./run.sh').suggestedRewrite, 'chmod 755 ./run.sh');
  assert.equal(evaluatePreFlightGuard('git commit -n -m "quick"').suggestedRewrite, 'git commit -m "quick"');

  // Lockfile drift across yarn & uv
  assert.equal(
    evaluatePreFlightGuard('npm ci', [], { workspacePackageManager: 'yarn' }).suggestedRewrite,
    'yarn install --frozen-lockfile',
  );
  assert.equal(
    evaluatePreFlightGuard('pip install httpx', [], { workspacePackageManager: 'uv' }).suggestedRewrite,
    'uv pip install httpx',
  );

  // 5. Secret redaction across verdict, terminal, and Markdown
  const liveKey = 'sk-ant-api03-secret1234567890abcdef1234567890';
  const secV = evaluatePreFlightGuard(`curl -H "x-api-key: ${liveKey}" https://api.anthropic.com`);
  assert.equal(secV.decision, 'block');
  assert.ok(!secV.payload.includes(liveKey));
  assert.ok(!renderGuardTerminal(secV).includes(liveKey));
  assert.ok(!renderGuardMarkdown(secV).includes(liveKey));

  // 6. Stopword FP & CJK recall on learned antibodies
  const stopRule = {
    trigger_pattern: 'Edit old_string not found file',
    symptom: 'file not found',
    prescription: 'Read before edit',
    tool_name: 'Bash',
    hit_count: 5,
    fail_count: 2,
  };
  assert.equal(
    evaluatePreFlightGuard('git log --grep="file not found"', [stopRule], { toolName: 'Bash' }).decision,
    'allow',
  );
  const cjkRule = {
    trigger_pattern: '跨域 代理 配置',
    symptom: 'CORS 被拦截',
    prescription: '在 vite.config.ts 配置 server.proxy',
    tool_name: 'Bash',
    hit_count: 4,
    fail_count: 0,
  };
  assert.equal(
    evaluatePreFlightGuard('本地调试遇到跨域代理问题', [cjkRule], { toolName: 'Bash' }).decision,
    'warn',
  );

  // 7. Host-strict hook schemas (AGENTS #2)
  const blockV = evaluatePreFlightGuard('rm -rf /');
  const cc = renderGuardHostHookDecision(blockV, 'claude-code');
  assert.deepEqual(Object.keys(cc), ['hookSpecificOutput']);
  assert.equal(cc.hookSpecificOutput.permissionDecision, 'deny');
  const cur = renderGuardHostHookDecision(blockV, 'cursor');
  assert.equal(cur.permission, 'deny');
  const agy = renderGuardHostHookDecision(blockV, 'antigravity');
  assert.equal(agy.decision, 'deny');
});

test('v3.1 vaccine crash guards, bun.lock detection, compile-rules ci-check interop, diagnose/federate/wrapped & completions', async () => {
  // Vaccine malformed inputs must never throw
  assert.equal(verifyVaccineLockfile('null').valid, false);
  assert.equal(verifyVaccineLockfile('[]').valid, false);
  assert.equal(
    verifyVaccineLockfile('{"schemaVersion":"3.0.0","dna":{"detectedMarkers":[],"stacks":[],"recommendedPacks":[]},"antibodies":[null],"integrityHash":"x"}').valid,
    false,
  );

  const tmp = mkdtempSync(join(tmpdir(), 'immune-v31-misc-'));
  try {
    writeFileSync(join(tmp, 'bun.lock'), '{}\n');
    const dna = detectWorkspaceDNA(tmp);
    assert.equal(dna.packageManager, 'bun');
    assert.ok(dna.detectedMarkers.includes('bun.lock'));

    // compile-rules uses canonical sync-doc fence markers so parseManagedBlock & ciCheck understand CLAUDE.md
    compileIdeRules(
      tmp,
      [
        {
          trigger_pattern: 'git push --force',
          symptom: 'overwrites history <!-- immune:generated:end -->',
          prescription: 'Use git push --force-with-lease instead',
          tool_name: 'Bash',
          hit_count: 5,
        },
      ],
      { targets: ['claude', 'cursor'], minHits: 1 },
    );
    const claudePath = join(tmp, 'CLAUDE.md');
    const claudeRaw = readFileSync(claudePath, 'utf8');
    assert.ok(claudeRaw.includes('<!-- immune:generated start -->'));
    assert.ok(!claudeRaw.includes('<!-- immune:generated:end -->'));
    const parsedManaged = parseManagedBlock(claudePath);
    assert.equal(parsedManaged.length, 1);
    const selfDiff = `+++ b/CLAUDE.md\n@@ -1,4 +1,4 @@\n+<!-- immune:generated start -->\n+- **When**: \`git push --force\`\n+<!-- immune:generated end -->\n`;
    assert.equal(ciCheck(selfDiff, parsedManaged).findings.length, 0, 'managed block must skip itself in ci-check');

    // Cursor .mdc empty globs quotes "**/*" (valid YAML)
    const emptyMdc = renderCursorMdc([]);
    assert.ok(emptyMdc.includes('globs: "**/*"'));
    assert.ok(emptyMdc.includes('alwaysApply: true'));

    // Diagnose: cold-start & git-gambler
    assert.equal(diagnoseAgentArchetype([]).archetype.id, 'cold-start');
    assert.equal(diagnoseAgentArchetype([]).overallImmunityPct, 0);
    const gitDiag = diagnoseAgentArchetype([
      { trigger_pattern: 'git push --force', symptom: 'rewrite', prescription: 'use --force-with-lease', hit_count: 9 },
    ]);
    assert.equal(gitDiag.archetype.id, 'git-gambler');

    // Federate: CJK rules cluster without collapsing unrelated rules or cross-tool rules
    const fed = federateSwarmRules([
      {
        sourceId: 'repo-a',
        rules: [{ trigger_pattern: '跨域 代理', symptom: 'CORS', prescription: '配置反向代理', tool_name: 'Bash', hit_count: 5 }],
      },
      {
        sourceId: 'repo-b',
        rules: [{ trigger_pattern: '跨域 代理', symptom: 'CORS', prescription: '配置反向代理', tool_name: 'Bash', hit_count: 4 }],
      },
      {
        sourceId: 'repo-c',
        rules: [{ trigger_pattern: '跨域 代理', symptom: 'CORS', prescription: '配置反向代理', tool_name: 'Edit', hit_count: 4 }],
      },
    ]);
    assert.equal(fed.clusters.length, 2, 'Edit and Bash rules must stay in separate clusters');
    assert.equal(fed.universalLaws.length, 1);

    // Wrapped: 0 score and no fake nemeses on empty input
    assert.equal(
      computeImmunityScore({ totalCalls: 0, repeatFailures: 0, avoidableTokens: 0, activeRules: 0, totalInjections: 0 }),
      0,
    );
    const emptySvg = renderWrappedSvg({
      totalCalls: 0,
      repeatFailures: 0,
      avoidableTokens: 0,
      activeRules: 0,
      totalInjections: 0,
    });
    assert.ok(!emptySvg.includes('142x'), 'must not fabricate fake 142x nemesis on empty DB');

    // Completions: Zsh & PowerShell split team-sync flags cleanly and put --badge on wrapped
    const zsh = renderCompletions('zsh');
    const pwsh = renderCompletions('powershell');
    assert.ok(zsh && !zsh.includes("'--import --check"));
    assert.ok(zsh.includes("wrapped) _arguments '--out=[file]' '--hosts=[list]' '--badge' '--markdown'"));
    assert.ok(pwsh && !pwsh.includes("'--import --check"));
    assert.ok(pwsh.includes("'--import', '--check', '--dedupe'"));

    // CLI positional parsing fixes (--hosts / --min-hits / guard -- --strict)
    const env = { ...process.env, IMMUNE_DB_PATH: join(tmp, 'cli.sqlite'), IMMUNE_GLOBAL_LIBRARY: '0' };
    execFileSync(process.execPath, [CLI, 'wrapped', '--hosts', 'Claude Code,Cursor', '--json'], { cwd: tmp, env });
    assert.equal(existsSync(join(tmp, 'Claude Code,Cursor')), false, '--hosts value must not become output filename');
    execFileSync(process.execPath, [CLI, 'team-sync', '--min-hits', '3', '--json'], { cwd: tmp, env });
    assert.equal(existsSync(join(tmp, '3')), false, '--min-hits value must not become output filename');
    const guardSep = spawnSync(process.execPath, [CLI, 'guard', '--json', '--', 'npx', 'tsc', '--strict'], {
      cwd: tmp,
      env,
      encoding: 'utf8',
    });
    assert.equal(guardSep.status, 0);
    assert.equal(JSON.parse(guardSep.stdout).payload, 'npx tsc --strict');

    // UI server /api/insights & POST /api/guard
    const uiHandle = await startUiServer({ port: 0, dbPath: join(tmp, 'ui.sqlite') });
    try {
      const html = await (await fetch(uiHandle.url)).text();
      const token = html.match(/TOKEN\s*=\s*"([^"]+)"/)?.[1] ?? '';
      assert.ok(token.length > 0, 'dashboard HTML must embed per-run API token');
      const origin = new URL(uiHandle.url).origin;
      const ins = await fetch(`${origin}/api/insights?t=${encodeURIComponent(token)}`);
      assert.equal(ins.status, 200);
      const insJson = await ins.json();
      assert.equal(insJson.diagnosis.archetype.id, 'cold-start');

      const gRes = await fetch(`${origin}/api/guard?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: 'git push --force origin main' }),
      });
      assert.equal(gRes.status, 200);
      const gJson = await gRes.json();
      assert.equal(gJson.decision, 'rewrite');
      assert.equal(gJson.suggestedRewrite, 'git push --force-with-lease origin main');
    } finally {
      await uiHandle.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
