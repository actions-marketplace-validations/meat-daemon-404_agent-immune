/**
 * Comprehensive v2 architecture & regression test suite:
 *   - hygiene (path abstraction, quality gate, legacy DB repair & restoration)
 *   - 5-dimension rubric scoring & causal root-cause classification
 *   - Red-3 failure triage (flake, scope leak, ignored, stale advice)
 *   - verifiable SHA-256 delivery receipt chain & tamper detection
 *   - hybrid bilingual concept retrieval & strict workspace scope isolation
 *   - unified ImmuneRuntime + Ollama config + budget clamp parity
 *   - Windows UNC SMB non-blocking regression in selfnoise gate
 *   - whole-disk corpus discovery & ingestion + v2 dashboard endpoints
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  abstractMachinePaths,
  canonicalizeSymptom,
  classifyRuleQuality,
  deriveProjectScope,
  inferScopeFromRuleText,
} from '../dsh-immune-system/dist/core/hygiene.js';
import { inferRootCause, scoreAntibodyRubric } from '../dsh-immune-system/dist/core/rubric.js';
import { triagePostInjectionFailure } from '../dsh-immune-system/dist/core/triage.js';
import { recordDeliveryReceipt, summarizeReceipts } from '../dsh-immune-system/dist/core/receipts.js';
import { expandConceptQuery } from '../dsh-immune-system/dist/core/retrieval.js';
import { clampBudgetMs, ImmuneRuntime } from '../dsh-immune-system/dist/core/runtime.js';
import { readLlmConfig } from '../dsh-immune-system/dist/core/llm.js';
import { isSelfEpisode } from '../dsh-immune-system/dist/core/selfnoise.js';
import { discoverDiskProjects, ingestDiskCorpus } from '../dsh-immune-system/dist/core/disk-ingest.js';
import { ImmuneStore } from '../dsh-immune-system/dist/core/store/index.js';
import { startUiServer } from '../dsh-immune-system/dist/core/ui/server.js';
import { distillEpisode } from '../dsh-immune-system/dist/core/distiller.js';
import { scanMagpieTelemetry, scanMagpieSummary } from '../dsh-immune-system/dist/core/audit/magpie.js';
import { isRelated } from '../dsh-immune-system/dist/core/relevance.js';
import { formatImmuneContext } from '../dsh-immune-system/dist/zcode/src/format.js';

test('v2 hygiene abstracts paths, classifies garbage vs advice, and infers project scope', () => {
  assert.match(deriveProjectScope('D:\\Project\\dsh-plugin-immune'), /^proj:dsh-plugin-immune:[a-f0-9]{8}$/);
  assert.match(
    inferScopeFromRuleText('Write: D:\\大创\\repo\\src\\app.ts') ?? '',
    /^proj:repo:[a-f0-9]{8}$/,
  );

  const abs = abstractMachinePaths(
    'Read C:\\Users\\alice\\demo\\src\\index.ts and open https://example.com/docs',
    'C:\\Users\\alice\\demo',
  );
  assert.match(abs, /<repo>/);
  assert.doesNotMatch(abs, /alice/);
  assert.match(abs, /https:\/\/example\.com\/docs/);

  const unrelatedAbs = abstractMachinePaths('Inspect C:\\Users\\bob\\other\\app.ts');
  assert.doesNotMatch(unrelatedAbs, /bob/);
  assert.match(unrelatedAbs, /^Inspect <path>\/other\/app\.ts$/);

  assert.equal(
    canonicalizeSymptom('{"stdout":"command failed with ERESOLVE peer conflict"}'),
    'command failed with ERESOLVE peer conflict',
  );

  const dump = classifyRuleQuality({
    trigger_pattern: 'Write D:\\secret\\main.py',
    symptom: 'the first attempt failed',
    prescription: 'Write: D:\\secret\\main.py',
    tool_name: 'Write',
    repair_path: [],
  });
  assert.equal(dump.grade, 'quarantined');
  assert.equal(dump.universalEligible, false);

  const good = classifyRuleQuality({
    trigger_pattern: 'npm install ERESOLVE peer conflict',
    symptom: 'npm install fails under peer dependency mismatch',
    prescription: 'Use npm install --legacy-peer-deps instead of forcing uninstall.',
    tool_name: 'Bash',
    repair_path: [],
    prescription_source: 'llm',
  });
  assert.equal(good.grade, 'advice');
  assert.ok(good.score >= 75, `expected rubric >= 75, got ${good.score}`);
});

test('v2 rubric differentiates generalized advice > scoped tactic > raw dump and classifies root causes', () => {
  const advice = scoreAntibodyRubric({
    trigger_pattern: 'Edit File has not been read yet',
    symptom: 'Edit fails when file was not read first',
    prescription: 'Read the target file before calling Edit to load current line numbers.',
    tool_name: 'Edit',
    repair_path: ['Read target.ts'],
    prescription_source: 'llm',
  });
  const tactic = scoreAntibodyRubric({
    trigger_pattern: 'tsc dist missing build',
    symptom: 'running cli fails with missing module under dist',
    prescription: 'Run npm run build before invoking dist CLI.',
    tool_name: 'Bash',
    repair_path: ['npm run build'],
    prescription_source: 'rule',
  });
  const raw = scoreAntibodyRubric({
    trigger_pattern: 'x',
    symptom: '{"stdout":"grep err"}',
    prescription: 'tool=Bash input={"command":"grep -n foo C:\\Users\\bob\\a.ts"}',
    tool_name: 'Bash',
    repair_path: [],
    prescription_source: 'rule',
  });

  assert.ok(advice.total > tactic.total, `${advice.total} should exceed ${tactic.total}`);
  assert.ok(tactic.total > raw.total, `${tactic.total} should exceed ${raw.total}`);
  assert.ok(raw.total < 48, `raw dump must stay below gate (<48), got ${raw.total}`);

  assert.equal(inferRootCause('File has not been read yet', 'Read first'), 'stale_read');
  assert.equal(inferRootCause('ECONNRESET timeout 503', 'Retry later'), 'flake');
  assert.equal(inferRootCause('ERR_UNSUPPORTED_ESM_URL_SCHEME EACCES', 'Use pathToFileURL'), 'env_or_path');
  assert.equal(inferRootCause('TS2307 inputSchema validation failed', 'Update API payload'), 'api_or_schema_drift');
});

test('v2 repairHygiene heals legacy polluted library without losing valid generic rules', () => {
  const store = new ImmuneStore({ dbPath: ':memory:' });
  // Insert simulated legacy rows: 1 clean generic wrongly retired, 1 echo dump active, 1 local tactic
  const junkId = store.insert({
    trigger_pattern: 'Write D:\\大创\\foo.py',
    symptom: '{"stdout":"write err"}',
    prescription: 'Write: D:\\大创\\foo.py',
    tool_name: 'Write',
  });
  const retiredValidId = store.insert({
    trigger_pattern: 'File has not been read yet Edit',
    symptom: 'Editing before reading fails',
    prescription: 'Read the target file with Read before calling Edit.',
    tool_name: 'Edit',
    status: 'retired',
    prescription_source: 'llm',
  });
  assert.ok(junkId && retiredValidId);
  const raw = new DatabaseSync(':memory:');
  raw.close();

  // Give the generic rule strong historical usage before a few transient post-injection misses.
  store.db.prepare('UPDATE antibodies SET hit_count = 30, fail_count = 3 WHERE id = ?').run(retiredValidId);

  const report = store.repairHygiene({ dryRun: false });
  assert.ok(report.quarantined >= 1, 'junk rule must be quarantined');
  assert.ok(report.restored >= 1, 'high-hit valid rule should be restored');
  assert.equal(store.byId(junkId).status, 'quarantined');
  assert.equal(store.byId(retiredValidId).status, 'active');
  store.close();
});

test('v2 Red-3 triage classifies transient flakes, cross-scope leaks, ignored generics, and bad advice', () => {
  const baseRule = {
    id: 1,
    trigger_pattern: 'npm install peer ERESOLVE',
    symptom: 'peer dependency mismatch blocks install',
    prescription: 'Pass --legacy-peer-deps',
    hit_count: 2,
    fail_count: 1,
    status: 'active',
    tool_name: 'Bash',
    repair_path: [],
    project_scope: '*',
  };

  const flake = triagePostInjectionFailure(baseRule, 'ETIMEDOUT network socket hang up', 'Bash', 'proj-a');
  assert.equal(flake.bucket, 'flake_or_transient');
  assert.equal(flake.shouldPenalize, false);

  const leak = triagePostInjectionFailure(
    { ...baseRule, project_scope: 'proj-other' },
    'exit code 1',
    'Bash',
    'proj-a',
  );
  assert.equal(leak.bucket, 'wrong_scope_leak');
  assert.equal(leak.shouldPenalize, false);
  assert.equal(leak.shouldQuarantine, true);

  const ignoredGeneric = triagePostInjectionFailure(
    { ...baseRule, trigger_pattern: 'Edit before Read', symptom: 'File has not been read yet before Edit' },
    'exit code 1',
    'Edit',
    'proj-a',
  );
  assert.equal(ignoredGeneric.bucket, 'ignored_by_agent');
  assert.equal(ignoredGeneric.escalateSurface, true);

  const badAdvice = triagePostInjectionFailure(baseRule, 'unknown flag --legacy-peer-deps', 'Bash', 'proj-a');
  assert.equal(badAdvice.bucket, 'stale_or_bad_advice');
  assert.equal(badAdvice.shouldPenalize, true);
});

test('v2 verifiable delivery receipts maintain SHA-256 chain integrity and detect tampering', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE delivery_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'unknown',
      project_scope TEXT NOT NULL DEFAULT '*',
      outcome TEXT NOT NULL,
      tokens_est INTEGER NOT NULL DEFAULT 0,
      digest TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  recordDeliveryReceipt(db, {
    ruleId: 1,
    sessionId: 's1',
    model: 'deepseek-chat',
    projectScope: 'demo-app',
    outcome: 'held',
    tokensEst: 420,
  });
  recordDeliveryReceipt(db, {
    ruleId: 2,
    sessionId: 's1',
    model: 'glm-5',
    projectScope: '*',
    outcome: 'failed',
    tokensEst: 0,
  });

  const valid = summarizeReceipts(db, 100);
  assert.equal(valid.total, 2);
  assert.equal(valid.chainValid, true);
  assert.equal(valid.estimatedTokensSaved, 420);
  assert.equal(valid.byModel.length, 2);

  // Tamper with receipt #2 outcome without recomputing digest -> chainValid must fail.
  db.prepare('UPDATE delivery_receipts SET outcome = ? WHERE id = 2').run('held');
  const tampered = summarizeReceipts(db, 100);
  assert.equal(tampered.chainValid, false);
  db.close();
});

test('v2 concept expansion and strict workspace scope isolation work end-to-end', () => {
  const expanded = expandConceptQuery('npm 依赖冲突怎么办');
  assert.match(expanded, /ERESOLVE/);
  assert.equal(expandConceptQuery('今天天气怎么样'), '今天天气怎么样');

  const alphaScope = deriveProjectScope('D:\\work\\alpha-repo');
  const betaScope = deriveProjectScope('D:\\work\\beta-repo');
  const store = new ImmuneStore({ dbPath: ':memory:' });
  store.insert({
    trigger_pattern: 'alpha build vite config error',
    symptom: 'alpha project vite build fails without base path',
    prescription: 'Use ./ relative base in alpha vite config.',
    project_scope: alphaScope,
    prescription_source: 'llm',
  });
  store.insert({
    trigger_pattern: 'beta build vite config error',
    symptom: 'beta project vite build fails without base path',
    prescription: 'Use /beta/ base in beta vite config.',
    project_scope: betaScope,
    prescription_source: 'llm',
  });
  store.insert({
    trigger_pattern: 'vite build config loadEnv import.meta.env',
    symptom: 'process.env is undefined in Vite client bundle build',
    prescription: 'Use loadEnv in vite.config.ts before exposing keys.',
    project_scope: '*',
    prescription_source: 'llm',
  });

  const alphaMatches = store.match('vite build config error', { cwd: 'D:\\work\\alpha-repo', limit: 5 });
  const betaMatches = store.match('vite build config error', { cwd: 'D:\\work\\beta-repo', limit: 5 });
  assert.ok(alphaMatches.some((r) => r.project_scope === alphaScope));
  assert.ok(!alphaMatches.some((r) => r.project_scope === betaScope), 'alpha must never receive beta rules');
  assert.ok(betaMatches.some((r) => r.project_scope === betaScope));
  assert.ok(!betaMatches.some((r) => r.project_scope === alphaScope), 'beta must never receive alpha rules');
  assert.ok(alphaMatches.some((r) => r.project_scope === '*'), 'universal rules match every workspace');
  store.close();
});

test('v2 unified ImmuneRuntime, Ollama config, budget clamp, and Windows UNC regression guard', async () => {
  assert.equal(clampBudgetMs(50), 1_000);
  assert.equal(clampBudgetMs(999_999), 60_000);

  const ollama = readLlmConfig({ IMMUNE_OLLAMA_MODEL: 'qwen2.5-coder:7b' });
  assert.equal(ollama?.endpoint, 'http://127.0.0.1:11434/v1');
  assert.equal(ollama?.allowPrivate, true);
  assert.equal(ollama?.model, 'qwen2.5-coder:7b');

  // Regression pin: Windows UNC/protocol-relative strings (//registry.npmjs.org/) must not block SMB lookups.
  const t0 = Date.now();
  assert.equal(
    isSelfEpisode('npm ERR! //registry.npmjs.org/:_authToken=dummy_token_value E401'),
    false,
  );
  assert.ok(Date.now() - t0 < 150, 'isSelfEpisode must reject protocol-relative paths immediately');

  const demoScope = deriveProjectScope('D:\\Project\\demo-rt');
  const store = new ImmuneStore({ dbPath: ':memory:' });
  const runtime = new ImmuneRuntime(store);
  runtime.prepareSessionStart({ sessionId: 'rt-1', workspace: 'D:\\Project\\demo-rt', prewarm: false });
  runtime.postToolUse({
    sessionId: 'rt-1',
    toolName: 'Bash',
    toolInput: { command: 'node scripts/deploy-local.mjs' },
    failed: true,
    trace: 'tool=Bash input={"command":"node scripts/deploy-local.mjs"} result=ERR_MODULE_NOT_FOUND D:\\Project\\demo-rt\\dist\\index.js [exit code: 1]',
    workspace: 'D:\\Project\\demo-rt',
  });
  runtime.postToolUse({
    sessionId: 'rt-1',
    toolName: 'Bash',
    toolInput: { command: 'npm run build && node scripts/deploy-local.mjs --env staging' },
    failed: false,
    trace: 'tool=Bash input={"command":"npm run build && node scripts/deploy-local.mjs --env staging"} result=deployed [exit code: 0]',
    workspace: 'D:\\Project\\demo-rt',
  });

  const drained = await runtime.drain({ budgetMs: 5_000, llm: null });
  assert.equal(drained.processed, 1);
  assert.equal(drained.learned, 1);
  const rules = store.listAll(true);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].project_scope, demoScope);
  assert.ok((rules[0].rubric_score ?? 0) >= 48);
  store.close();
});

test('v2 whole-disk ingestion discovers repos/skills and v2 UI routes expose telemetry safely', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-disk-v2-'));
  let server = null;
  t.after(async () => {
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const appDir = join(dir, 'sample-plugin');
  mkdirSync(join(appDir, 'skills', 'deploy-check'), { recursive: true });
  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'sample-plugin', dependencies: { react: '^19.0.0' }, dsh: { client: { platform: 'web' } } }),
  );
  writeFileSync(join(appDir, 'cordis.patch.yml'), 'plugins: []\n');
  writeFileSync(
    join(appDir, 'AGENTS.md'),
    [
      '# Engineering Rules',
      '',
      '1. **Never edit generated dist files directly.** Always run `npm run build` after modifying TypeScript source under `src/`.',
      '2. **Do not commit raw API secrets.** Replace `Bearer redact_only_fixture_token` before pushing to remote.',
    ].join('\n'),
  );
  writeFileSync(
    join(appDir, 'skills', 'deploy-check', 'SKILL.md'),
    [
      '---',
      'name: deploy-check',
      'description: Pre-deploy verification checklist',
      '---',
      '',
      '## Rules',
      '- Always run migration dry-run before applying production database changes.',
    ].join('\n'),
  );

  const discovered = discoverDiskProjects([dir], { maxProjects: 20 });
  assert.ok(discovered.length >= 1);

  const store = new ImmuneStore({ dbPath: join(dir, 'immune.sqlite') });
  const report = ingestDiskCorpus(store, { roots: [dir], dryRun: false, maxProjects: 20 });
  assert.ok(report.projectsScanned >= 1);
  assert.ok(report.rulesInserted >= 1);
  assert.ok(store.listWorkspaceProfiles().length >= 1);

  // Ensure secrets in markdown docs were scrubbed before persisting!
  for (const r of store.listAll(true)) {
    assert.doesNotMatch(`${r.trigger_pattern} ${r.symptom} ${r.prescription}`, /redact_only_fixture_token/);
  }
  store.close();

  server = await startUiServer({ dbPath: join(dir, 'immune.sqlite'), port: 0 });
  const html = await (await fetch(server.url)).text();
  const token = /var TOKEN = "([a-f0-9]+)"/.exec(html)?.[1];
  assert.ok(token);

  const wsRes = await (await fetch(`${server.url}api/workspaces?t=${token}`)).json();
  assert.ok(wsRes.workspaces.length >= 1);

  const triageRes = await (await fetch(`${server.url}api/triage?t=${token}`)).json();
  assert.equal(typeof triageRes.triage.totalEvents, 'number');
  assert.equal(typeof triageRes.receipts.chainValid, 'boolean');

  const hygRes = await (
    await fetch(`${server.url}api/hygiene?t=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    })
  ).json();
  assert.equal(hygRes.ok, true);
  assert.equal(hygRes.report.dryRun, true);
});

test('v2.1 Magpie preset, agentic self-reflection critique, model immunity & adaptive escalation', async (t) => {
  const magpieCfg = readLlmConfig({ IMMUNE_MAGPIE_MODEL: 'deepseek-v4.1-flash' });
  assert.equal(magpieCfg?.endpoint, 'http://127.0.0.1:3425/v1');
  assert.equal(magpieCfg?.allowPrivate, true);
  assert.equal(magpieCfg?.model, 'deepseek-v4.1-flash');

  // 1. Self-reflection critique: draft #1 leaks C:\Users\... / looks raw -> call #2 refines to portable advice
  let reqCount = 0;
  const stub = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      reqCount += 1;
      const body =
        reqCount === 1
          ? {
              trigger_pattern: 'x',
              symptom: 'the first attempt failed',
              prescription: 'Write: C:\\Users\\secret_bob\\bad.ts',
            }
          : {
              trigger_pattern: 'vite loadEnv import.meta.env',
              symptom: 'process.env is undefined inside browser bundle',
              prescription: 'Load client variables via loadEnv() inside vite.config.ts.',
              root_cause: 'env_or_path',
              scope: 'universal',
            };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => {
    stub.close();
    stub.closeAllConnections?.();
  });

  const { port } = stub.address();
  const distilled = await distillEpisode(
    'Bash',
    'error=missing VITE_API env var',
    'used loadEnv in vite.config.ts',
    {
      llm: {
        endpoint: `http://127.0.0.1:${port}/v1`,
        apiKey: '',
        model: 'mock-reflect',
        allowPrivate: true,
        timeoutMs: 5_000,
      },
    },
  );
  assert.equal(reqCount, 2, 'weak first-draft rule (<68 rubric) must trigger 1-shot critique reflection');
  assert.equal(distilled.ok, true);
  assert.ok((distilled.antibody.rubric_score ?? 0) >= 80);
  assert.equal(distilled.antibody.project_scope, '*');

  // 2. Magpie telemetry scanner & Model Immunity report + adaptive escalation
  const dir = mkdtempSync(join(tmpdir(), 'immune-magpie-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'routing'), { recursive: true });
  writeFileSync(
    join(dir, 'usage.jsonl'),
    [
      JSON.stringify({ model: 'glm-5.3-flash', in: 1000, out: 120, cache_read: 9000, ms: 420, status: 200 }),
      JSON.stringify({ model: 'glm-5.3-flash', in: 500, out: 0, cache_read: 0, ms: 1000, status: 429, err: 'rate limit' }),
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'routing', '2026-11-17.jsonl.gz'),
    gzipSync(
      JSON.stringify({
        agent: 'zcode',
        model: 'glm-5.3-flash',
        folder: 'D:\\Project\\dsh-plugin-immune',
        tries: [{ status: 502 }, { status: 200 }],
        done: true,
        status: 200,
        ms: 600,
        ttft: 180,
        tokens: 2000,
        out: 150,
      }) + '\n',
    ),
  );
  const gw = scanMagpieTelemetry({ magpieDir: dir });
  assert.equal(gw.present, true);
  assert.equal(gw.usageRequests, 2);
  assert.equal(gw.routingRequests, 1);
  assert.equal(gw.retryRecovered, 1);
  assert.equal(gw.cacheHitRatePct, 85.7);

  const store = new ImmuneStore({ dbPath: ':memory:' });
  const id = store.insert({
    trigger_pattern: 'Edit File has not been read yet',
    symptom: 'Edit fails before Read',
    prescription: 'Read the target file before editing.',
  });
  store.db.prepare('UPDATE antibodies SET ignored_count = 3, hit_count = 10, fail_count = 3 WHERE id = ?').run(id);
  const intel = store.modelImmunity(gw);
  assert.equal(intel.escalatedRules.length, 1);
  const injected = formatImmuneContext(store.listAll(true));
  assert.match(injected, /CRITICAL · ignored 3×/);
  store.close();
});

test('v2 relevance error-tail & hyphen-slug, pwsh/chat hygiene quarantine, and /api/models endpoint', async (t) => {
  // 1. Long Edit diffs push error= past the 32-token head window; signals() must inspect tail + hyphen parts.
  const longCodeDiff = 'const alpha = 1;\n'.repeat(40);
  const editFailTrace = `Edit file=src/app.ts old_string="${longCodeDiff}" result=Error: String to replace not found in file.`;
  assert.equal(
    isRelated('Edit old_string-not-found replace', editFailTrace, 'Edit'),
    true,
    'hyphen-slug triggers and long-diff error tail must stay related',
  );
  const unreadTrace = `Edit file=src/app.ts old_string="${longCodeDiff}" error=File has not been read yet. Read it first before writing to it.`;
  assert.equal(
    isRelated('Edit File has not been read yet before writing', unreadTrace, 'Edit'),
    true,
  );

  // 2. pwsh script dumps and conversational chat fragments must be quarantined.
  const pwshDump = classifyRuleQuality({
    trigger_pattern: 'pwsh Get-Process',
    symptom: 'pwsh fails',
    prescription: 'pwsh: $pids = 27660, 14252; Get-NetTCPConnection -State Listen',
    tool_name: 'pwsh',
  });
  assert.equal(pwshDump.grade, 'quarantined');
  const pwshRubric = scoreAntibodyRubric({
    trigger_pattern: 'pwsh Get-Process',
    symptom: 'pwsh fails',
    prescription: 'pwsh: $pids = 27660, 14252; Get-NetTCPConnection -State Listen',
  });
  assert.ok(pwshRubric.issues.some((x) => /probe|dump|rewrite/i.test(x)));
  assert.ok(pwshRubric.total < 75);

  const chatNoise = classifyRuleQuality({
    trigger_pattern: '还有 你怎么把issue给关了',
    symptom: 'Bash exit 1',
    prescription: '还有，你怎么把issue给关了',
    tool_name: 'bash',
  });
  assert.equal(chatNoise.grade, 'quarantined');

  // 3. scanMagpieSummary & /api/models dashboard endpoint
  const dir = mkdtempSync(join(tmpdir(), 'immune-ui-models-'));
  const summary = scanMagpieSummary({ magpieDir: dir });
  assert.equal(summary.present, false);

  const dbPath = join(dir, 'immune.sqlite');
  const s = new ImmuneStore({ dbPath });
  s.insert({
    trigger_pattern: 'Edit File has not been read yet',
    symptom: 'Edit fails before Read',
    prescription: 'Read target file first before editing.',
  });
  s.close();

  const ui = await startUiServer({ dbPath, port: 0 });
  try {
    const html = await (await fetch(ui.url)).text();
    const token = /var TOKEN = "([a-f0-9]+)"/.exec(html)?.[1];
    const modelsRes = await fetch(`${ui.url}api/models?t=${token}`);
    assert.equal(modelsRes.status, 200);
    const modelsJson = await modelsRes.json();
    assert.ok(Array.isArray(modelsJson.models));
    assert.ok(Array.isArray(modelsJson.escalatedRules));
  } finally {
    await ui.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
