/**
 * v4.1.0 security, concurrency, accuracy, and protocol hardening regression suite.
 *
 * Pins every P0/P1 finding closed in v4.1.0 against the compiled dist/ build:
 *   - Chained-command & flag-order Pre-Flight Guard bypasses + AGENTS.md #17 self-advice
 *   - LLM SSRF redirect/trailing-dot/IPv6 hardening + abortable sleep + Azure query URLs
 *   - Path abstraction username non-leak & root guard + manual-retirement preservation
 *   - Receipt chain accounting & full-table SQL ROI + non-inverted Immunity Score
 *   - Structured outcome verdict (AGENTS.md #13), chained-command pairing, selfnoise MIME filter
 *   - UI DNS-rebinding Host check + CSP frame-ancestors + MCP JSON-RPC resilience
 *   - Native PreToolUse `ask` dispatch, git core.hooksPath + pre-exit insertion,
 *     Cursor sidecar connect status, disk-ingest depth-0, skill-ingest symlink loop,
 *     and Doctor v4 telemetry rows.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = process.cwd();
const CLI = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');
const PRE_TOOL_HOOK = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'hooks', 'pre-tool-use.js');

test('v4.1 Pre-Flight Guard closes chained-command, flag-order, secret-scan & AGENTS #17 self-advice gaps', async () => {
  const { evaluatePreFlightGuard, formatLiveGuardBanner } = await import(
    '../dsh-immune-system/dist/core/guard.js'
  );
  const { redact } = await import('../dsh-immune-system/dist/core/redact.js');

  // Chained SQL DDL after harmless echo must still be blocked.
  const chainedSql = evaluatePreFlightGuard('echo ok && psql -c "DROP TABLE users;"', []);
  assert.equal(chainedSql.decision, 'block');
  assert.ok(chainedSql.matches.some((m) => m.id === 'sql-destructive-ddl'));

  // git reset --hard BEFORE git stash is NOT safe; stash MUST be in an earlier segment.
  const badOrder = evaluatePreFlightGuard('git reset --hard HEAD && git stash', []);
  assert.equal(badOrder.decision, 'rewrite');
  assert.ok(badOrder.matches.some((m) => m.id === 'git-reset-hard'));
  assert.equal(evaluatePreFlightGuard('git stash && git reset --hard HEAD', []).decision, 'allow');

  // git clean -n in segment 1 must NOT whitelist git clean -fd in segment 2.
  const chainedClean = evaluatePreFlightGuard('git clean -n && git clean -fd', []);
  assert.equal(chainedClean.decision, 'warn');
  assert.ok(chainedClean.matches.some((m) => m.id === 'git-clean-force'));
  assert.equal(evaluatePreFlightGuard('git clean -n', []).decision, 'allow');

  // Catastrophic rm variants: multiple targets, `--`, extra flags, `--no-preserve-root`, `.git`.
  for (const cmd of [
    'rm -rf ./dist /',
    'rm -rf -- /',
    'rm -rf -v /',
    'rm --no-preserve-root -rf /',
    'rm -rf ./.git',
  ]) {
    const v = evaluatePreFlightGuard(cmd, []);
    assert.equal(v.decision, 'block', `must block: ${cmd}`);
    assert.ok(v.matches.some((m) => m.id === 'destructive-rm-root'), `policy mismatch: ${cmd}`);
  }
  assert.equal(evaluatePreFlightGuard('rm -rf ./dist', []).decision, 'allow');

  // Bundled `-nm` on git commit rewrites only the commit segment, leaving `head -n 5` intact.
  const bundled = evaluatePreFlightGuard('head -n 5 README.md && git commit -nm "wip"', []);
  assert.equal(bundled.decision, 'rewrite');
  assert.equal(bundled.suggestedRewrite, 'head -n 5 README.md && git commit -m "wip"');

  // `--force-with-lease -f` strips redundant `-f`.
  const mixedForce = evaluatePreFlightGuard('git push --force-with-lease -f origin main', []);
  assert.equal(mixedForce.decision, 'rewrite');
  assert.equal(mixedForce.suggestedRewrite, 'git push --force-with-lease origin main');

  // npm install -D under pnpm rewrites cleanly to pnpm add -D.
  const lockDrift = evaluatePreFlightGuard('npm install -D vitest', [], {
    workspacePackageManager: 'pnpm',
  });
  assert.equal(lockDrift.decision, 'rewrite');
  assert.equal(lockDrift.suggestedRewrite, 'pnpm add -D vitest');

  // AGENTS.md #17: guard must NEVER block its own recommended env-var usage.
  const selfAdvice = evaluatePreFlightGuard('const apiKey = process.env.OPENAI_API_KEY;', [], {
    toolName: 'Write',
  });
  assert.equal(selfAdvice.decision, 'allow');

  // Secret placed past the old 8 KiB cap (at ~12 KiB) must still be caught.
  const deepPayload = `${'a'.repeat(12_000)}\nconst token = "ghp_1234567890abcdefghij1234567890abcd";`;
  const deepSecret = evaluatePreFlightGuard(deepPayload, [], { toolName: 'Write' });
  assert.equal(deepSecret.decision, 'block');
  assert.ok(deepSecret.matches.some((m) => m.id === 'hardcoded-secret-literal'));

  // Banner headlines highest blastRadiusScore match, not matches[0].
  const multi = evaluatePreFlightGuard('git commit --no-verify -m "x" && rm -rf /', []);
  const banner = formatLiveGuardBanner(multi);
  assert.match(banner, /destructive-rm-root/);

  // Learned rule tool matching normalizes cross-host aliases (Bash <-> run_command).
  const learnedRule = {
    id: 7,
    trigger_pattern: 'prisma migrate',
    symptom: 'non-interactive migrate hung',
    prescription: 'Use prisma migrate deploy in automation',
    tool_name: 'Bash',
    hit_count: 5,
    fail_count: 2,
    ignored_count: 2,
    status: 'active',
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const crossTool = evaluatePreFlightGuard('npx prisma migrate status', [learnedRule], {
    toolName: 'run_command',
  });
  assert.ok(crossTool.matches.some((m) => m.source === 'learned-antibody' && m.id === 'antibody:prisma migrate'));

  // Cookie header redaction crosses semicolon attributes.
  const redactedCookie = redact('Cookie: HttpOnly; session_id=supersecret999999');
  assert.ok(!redactedCookie.includes('supersecret999999'), `cookie secret leaked: ${redactedCookie}`);
});

test('v4.1 LLM SSRF trailing-dot/IPv6/redirect blocking, Azure query preservation, and abortable retry', async (t) => {
  const { assertSafeEndpoint, chat } = await import('../dsh-immune-system/dist/core/llm.js');

  for (const bad of [
    'http://localhost./v1',
    'http://metadata.google.internal./v1',
    'http://metadata.goog/v1',
    'http://[fe90::1]/v1',
    'http://[::ffff:7f00:1]/v1',
    'http://[::127.0.0.1]/v1',
    'http://[64:ff9b::1]/v1',
  ]) {
    assert.throws(
      () => assertSafeEndpoint(bad),
      /loopback|private|metadata|refusing|local|link-local|reserved/i,
      `must reject SSRF host: ${bad}`,
    );
  }

  // Local HTTP server: test redirect rejection, query preservation, and 503 retry.
  let seenUrl = '';
  let attempts = 0;
  const server = createServer((req, res) => {
    seenUrl = req.url ?? '';
    if (seenUrl.startsWith('/redirect')) {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (seenUrl.startsWith('/flaky')) {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"temporarily overloaded"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const { port } = server.address();

  // Redirect must fail immediately instead of following to metadata IP.
  await assert.rejects(
    chat(
      { endpoint: `http://127.0.0.1:${port}/redirect`, model: 'm', apiKey: '', timeoutMs: 2000, allowPrivate: true },
      'sys',
      'usr',
    ),
    /redirect/i,
  );

  // Azure-style query string on endpoint must be preserved on /chat/completions.
  const azureOut = await chat(
    {
      endpoint: `http://127.0.0.1:${port}/openai/deployments/gpt4?api-version=2024-06-01`,
      model: 'm',
      apiKey: '',
      timeoutMs: 2000,
      allowPrivate: true,
    },
    'sys',
    'usr',
  );
  assert.equal(azureOut, 'ok');
  assert.equal(seenUrl, '/openai/deployments/gpt4/chat/completions?api-version=2024-06-01');

  // Transient 503 retries once and succeeds.
  const flakyOut = await chat(
    { endpoint: `http://127.0.0.1:${port}/flaky`, model: 'm', apiKey: '', timeoutMs: 3000, allowPrivate: true },
    'sys',
    'usr',
  );
  assert.equal(flakyOut, 'recovered');
  assert.equal(attempts, 2);

  // AbortSignal cancels retry backoff quickly.
  const ac = new AbortController();
  attempts = 0;
  setTimeout(() => ac.abort(new Error('cancelled')), 80);
  const start = Date.now();
  await assert.rejects(
    chat(
      { endpoint: `http://127.0.0.1:${port}/flaky`, model: 'm', apiKey: '', timeoutMs: 3000, allowPrivate: true },
      'sys',
      'usr',
      ac.signal,
    ),
  );
  assert.ok(Date.now() - start < 700, 'abort during backoff must return promptly');
});

test('v4.1 hygiene username non-leak, root guard, manual retirement preservation, and delimiter sanitization', async () => {
  const { abstractMachinePaths } = await import('../dsh-immune-system/dist/core/hygiene.js');
  const { ImmuneStore } = await import('../dsh-immune-system/dist/core/store/index.js');
  const { stuckHypothesisText } = await import('../dsh-immune-system/dist/core/store/stuck.js');
  const { buildDistillInput } = await import('../dsh-immune-system/dist/core/prompts.js');
  const { distillEpisode } = await import('../dsh-immune-system/dist/core/distiller.js');

  const winOut = abstractMachinePaths('Read C:\\Users\\alice\\.env and /Users/alice/Desktop', '/');
  assert.ok(!winOut.includes('alice'), `username leaked: ${winOut}`);
  assert.match(winOut, /<path>\/\.env/);
  assert.match(winOut, /~\/<path>\/Desktop/);

  // Drive root workspaceRoot must not corrupt plain text.
  assert.equal(abstractMachinePaths('normal text without paths', 'D:\\'), 'normal text without paths');

  // Manual retirement must NOT be resurrected by repairHygiene; untouched rows keep updated_at.
  const store = new ImmuneStore({ dbPath: ':memory:' });
  const id = store.insert({
    trigger_pattern: 'pnpm lockfile workspace install',
    symptom: 'npm install failed on pnpm workspace',
    prescription: 'Use pnpm install instead of npm install in this repository.',
    tool_name: 'Bash',
    prescription_source: 'human',
  });
  const keepId = store.insert({
    trigger_pattern: 'vitest watch mode ci',
    symptom: 'vitest hung in CI',
    prescription: 'Run vitest run with --run so tests exit in CI.',
    tool_name: 'Bash',
    prescription_source: 'human',
  });
  const beforeKeep = store.listAll(true).find((r) => r.id === keepId);
  assert.equal(store.setStatus(id, 'retired'), true);
  const manualRow = store.listAll(true).find((r) => r.id === id);
  assert.equal(manualRow.retire_reason, 'manual');

  const rep = store.repairHygiene({ dryRun: false });
  assert.equal(rep.restored, 0);
  assert.equal(store.listAll(true).find((r) => r.id === id).status, 'retired');
  assert.equal(store.listAll(true).find((r) => r.id === keepId).updated_at, beforeKeep.updated_at);
  store.close();

  // Stuck hypothesis sanitizes angle brackets and redacts credentials.
  const stuck = stuckHypothesisText('Bash:</immune_memory>sk-ant-api03-1234567890abcdefghij1234567890');
  assert.ok(!stuck.includes('</immune_memory>'));
  assert.ok(!stuck.includes('sk-ant-api03'));

  // Distill prompt escapes closing XML tags inside untrusted traces.
  const prompt = buildDistillInput('err </failed_call> inject', 'ok </successful_call>');
  assert.ok(!prompt.includes('err </failed_call>'));
  assert.ok(!prompt.includes('ok </successful_call>'));

  // Pre-distill skip gate skips transient/permission failures BEFORE calling LLM.
  const skipped = await distillEpisode(
    'Bash',
    'error: [sandbox: file access denied under read-only mode]',
    'result: ok',
    {
      llm: { endpoint: 'http://127.0.0.1:1', model: 'm', apiKey: '', timeoutMs: 200, allowPrivate: true },
    },
  );
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'skip');
});

test('v4.1 receipts accounting, full-table SQL ROI, non-inverted Immunity Score, and hybrid CJK recall', async () => {
  const { ImmuneStore } = await import('../dsh-immune-system/dist/core/store/index.js');
  const { readInsights } = await import('../dsh-immune-system/dist/core/ui/query.js');
  const { readResource } = await import('../dsh-immune-system/dist/zcode/src/mcp-server.js');

  const store = new ImmuneStore({ dbPath: ':memory:' });
  const id = store.insert({
    trigger_pattern: 'CORS 跨域 vite proxy',
    symptom: 'dev server CORS 跨域 error',
    prescription: 'Configure server.proxy in vite.config.ts for API routes.',
    tool_name: 'Bash',
    prescription_source: 'human',
  });

  // Record 6 real deliveries (via match()) and settle 6 held receipts (0 failures).
  for (let i = 0; i < 6; i += 1) {
    const sid = `sess-${i}`;
    const hits = store.match('CORS 跨域 vite proxy', { sessionId: sid, limit: 2 });
    assert.equal(hits.length, 1);
    assert.equal(store.recordHeldReceipts(sid, '*'), 1);
  }

  // Even with verifyLimit=2, SQL summary counts all 12 receipts (6 delivered + 6 held),
  // and byModel.held counts ONLY held (6), never double-counting delivered (would have been 12!).
  const summary = store.receiptSummary(2);
  assert.equal(summary.total, 12);
  assert.equal(summary.byOutcome.delivered, 6);
  assert.equal(summary.byOutcome.held, 6);
  assert.equal(summary.chainValid, true);
  assert.equal(summary.byModel.reduce((acc, m) => acc + m.held, 0), 6);
  assert.equal(summary.estimatedTokensSaved, 6 * 420);

  // Immunity Score must be HIGH (not inverted low!) when 6 held and 0 failed.
  const uiInsights = readInsights(store, ROOT);
  assert.ok(uiInsights.immunityScore >= 60, `expected high score, got ${uiInsights.immunityScore}`);

  const mcpRes = readResource(store, 'immune://insights/report', ROOT);
  const mcpData = JSON.parse(mcpRes.text);
  assert.ok(mcpData.immunityScore >= 60, `expected high MCP score, got ${mcpData.immunityScore}`);

  // Hybrid recall with limit=2 on mixed English+CJK keeps both FTS5 and CJK hits.
  store.insert({
    trigger_pattern: 'typescript tsconfig moduleResolution',
    symptom: 'TS module resolution error',
    prescription: 'Set moduleResolution NodeNext in tsconfig.json.',
    tool_name: 'Edit',
    prescription_source: 'human',
  });
  const hybrid = store.peek('tsconfig 跨域', 2);
  assert.equal(hybrid.length, 2);

  // mutateRule inherits prescription_source and stamps parent retire_reason='mutated_to_child'.
  const childId = store.mutateRule(id, 'vite proxy changeOrigin', {
    repairPath: ['Edit vite.config.ts'],
  });
  assert.ok(childId !== null);
  const parentAfter = store.listAll(true).find((r) => r.id === id);
  const childRow = store.listAll(true).find((r) => r.id === childId);
  assert.equal(parentAfter.retire_reason, 'mutated_to_child');
  assert.equal(childRow.prescription_source, 'human');
  store.close();
});

test('v4.1 pairing chained cd && cmd, outcome HTTP/structured payload, and selfnoise MIME filter', async () => {
  const { parseCommand, targetSignature, canCloseEpisode } = await import(
    '../dsh-immune-system/dist/core/pairing.js'
  );
  const { classifyOutcome } = await import('../dsh-immune-system/dist/zcode/src/outcome.js');
  const { isSelfEpisode } = await import('../dsh-immune-system/dist/core/selfnoise.js');

  const chained = parseCommand('cd packages/api && npm test | tail -20');
  assert.equal(chained.program, 'npm');
  assert.equal(chained.sub, 'test');
  const chainedSig = targetSignature('Bash', { command: 'cd packages/api && npm test | tail -20' });
  assert.equal(chainedSig.probeOnly, false);

  const probeSig = targetSignature('Bash', { command: 'cd /repo && git status' });
  assert.equal(probeSig.probeOnly, true);

  assert.equal(
    canCloseEpisode('Bash:npm:test', { signature: 'bash:npm:test', probeOnly: false }),
    true,
  );

  // HTTP 200 structured response and Read file content are NOT failures.
  assert.equal(
    classifyOutcome({ tool_response: { status: 200, ok: true, body: 'Error: handled' } }).failed,
    false,
  );
  assert.equal(
    classifyOutcome({
      tool_response: { type: 'text', file: { filePath: 'app.log', content: 'Error: log entry' } },
    }).failed,
    false,
  );
  // Multiline raw error text IS caught thanks to /im flag.
  assert.equal(
    classifyOutcome({ tool_result_preview: 'compiling...\nError: syntax error in main.ts' }).failed,
    true,
  );

  // MIME/git-ref tokens do not starve MAX_PATHS=6 in selfnoise detection.
  const noisySelfTrace = JSON.stringify({
    command:
      'curl -H "Accept: application/json" -H "Content-Type: text/plain" -H "X: image/png" ' +
      '-H "Y: audio/mpeg" -H "Z: video/mp4" origin/main 2>&1 ' +
      join(ROOT, 'core', 'guard.ts'),
  });
  assert.equal(isSelfEpisode(noisySelfTrace), true);
});

test('v4.1 UI server DNS-rebinding Host guard + CSP frame-ancestors and MCP JSON-RPC resilience', async (t) => {
  const { startUiServer } = await import('../dsh-immune-system/dist/core/ui/server.js');
  const { PROMPTS, callTool } = await import('../dsh-immune-system/dist/zcode/src/mcp-server.js');
  const { BUILTIN_PACKS } = await import('../dsh-immune-system/dist/core/packs.js');
  const { ImmuneStore } = await import('../dsh-immune-system/dist/core/store/index.js');

  const dir = mkdtempSync(join(tmpdir(), 'immune-v41-ui-'));
  const handle = await startUiServer({ dbPath: join(dir, 'immune.sqlite'), port: 0 });
  t.after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Normal loopback request gets frame-ancestors 'none' in CSP.
  const okRes = await fetch(handle.url);
  assert.equal(okRes.status, 200);
  await okRes.text();
  assert.match(okRes.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);

  // DNS-rebinding Host header must be rejected with 403.
  const parsed = new URL(handle.url);
  const rebindStatus = await new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: Number(parsed.port),
          path: '/api/antibodies',
          method: 'GET',
          headers: { Host: `attacker.evil:${parsed.port}`, Connection: 'close' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
  assert.equal(rebindStatus, 403);

  // MCP prompt tool name + dynamic seed pack list + stdio primitive resilience + resources/templates/list.
  const store = new ImmuneStore({ dbPath: ':memory:' });
  const seedOut = callTool(store, 'immune_seed_packs', {});
  for (const p of BUILTIN_PACKS) {
    assert.ok(seedOut.includes(p.id), `seed pack missing: ${p.id}`);
  }
  store.close();
  assert.ok(PROMPTS.some((p) => p.name === 'immune_rewrite_echoes'));

  const mcpInput = [
    'null',
    '42',
    '[]',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'immune_rewrite_echoes' } }),
    '',
  ].join('\n');
  const mcpRun = spawnSync(
    process.execPath,
    [join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'mcp-server.js')],
    {
      input: mcpInput,
      env: { ...process.env, IMMUNE_DB_PATH: join(dir, 'mcp.sqlite') },
      encoding: 'utf8',
    },
  );
  assert.equal(mcpRun.status, 0);
  const lines = mcpRun.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const tmpl = lines.find((m) => m.id === 1);
  assert.deepEqual(tmpl?.result, { resourceTemplates: [] });
  const promptMsg = lines.find((m) => m.id === 2);
  const promptText = promptMsg?.result?.messages?.[0]?.content?.text ?? '';
  assert.match(promptText, /immune_rewrite_apply/);
  assert.doesNotMatch(promptText, /immune_apply_rewrite/);
});

test('v4.1 native PreToolUse ask mode, guard_events enforced decision, git core.hooksPath & pre-exit hook, connect, disk-ingest, skill-ingest & doctor', async (t) => {
  const { installGitHook, gitHookStatus, removeGitHook } = await import('../dsh-immune-system/dist/core/git-hook.js');
  const { connectHost, connectStatus } = await import('../dsh-immune-system/dist/core/connect.js');
  const { ingestDiskCorpus } = await import('../dsh-immune-system/dist/core/disk-ingest.js');
  const { ingestSkillPaths } = await import('../dsh-immune-system/dist/core/skill-ingest.js');
  const { ImmuneStore } = await import('../dsh-immune-system/dist/core/store/index.js');
  const { ImmuneRuntime } = await import('../dsh-immune-system/dist/core/runtime.js');
  const { runDoctor } = await import('../dsh-immune-system/dist/zcode/src/doctor.js');

  const dir = mkdtempSync(join(tmpdir(), 'immune-v41-ops-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 1. PreToolUse IMMUNE_GUARD=ask native protocol across Claude/ZCode, Cursor, Antigravity.
  const dbAsk = join(dir, 'ask.sqlite');
  const askClaude = spawnSync(process.execPath, [PRE_TOOL_HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      cwd: dir,
    }),
    env: { ...process.env, IMMUNE_DB_PATH: dbAsk, IMMUNE_GUARD: 'ask' },
    encoding: 'utf8',
  });
  const claudeJson = JSON.parse(askClaude.stdout);
  assert.equal(claudeJson.hookSpecificOutput.permissionDecision, 'ask');

  const askCursor = spawnSync(process.execPath, [PRE_TOOL_HOOK], {
    input: JSON.stringify({
      hook_event_name: 'beforeShellExecution',
      conversation_id: 'c1',
      command: 'rm -rf /',
      workspace_roots: [dir],
    }),
    env: { ...process.env, IMMUNE_DB_PATH: dbAsk, IMMUNE_GUARD: 'ask' },
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(askCursor.stdout).permission, 'ask');

  const askAgy = spawnSync(process.execPath, [PRE_TOOL_HOOK], {
    input: JSON.stringify({
      conversationId: 'a1',
      workspacePaths: [dir],
      toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
    }),
    env: { ...process.env, IMMUNE_DB_PATH: dbAsk, IMMUNE_GUARD: 'ask' },
    encoding: 'utf8',
  });
  const agyJson = JSON.parse(askAgy.stdout);
  assert.equal(agyJson.decision, 'allow');
  assert.match(agyJson.reason, /destructive-rm-root/);

  // Warn mode records decision='warn' in guard_events (NOT 'block').
  const storeWarn = new ImmuneStore({ dbPath: ':memory:' });
  const rt = new ImmuneRuntime(storeWarn);
  rt.evaluateLiveGuard({
    sessionId: 'w1',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
    env: { ...process.env, IMMUNE_GUARD: 'warn' },
  });
  const guardSummary = storeWarn.guardEventSummary(5);
  assert.equal(guardSummary.total, 1);
  assert.equal(guardSummary.recent[0].decision, 'warn');
  storeWarn.close();

  // 2. Git hook respects core.hooksPath and inserts BEFORE trailing `exec`/`exit`.
  const repoDir = join(dir, 'repo');
  const customHooks = join(repoDir, '.githooks');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  mkdirSync(customHooks, { recursive: true });
  writeFileSync(join(repoDir, '.git', 'config'), '[core]\n\thooksPath = .githooks\n', 'utf8');
  writeFileSync(join(customHooks, 'pre-commit'), '#!/bin/sh\nexec npx lint-staged\n', 'utf8');

  const st = installGitHook({ cwd: repoDir });
  assert.equal(st.installed, true);
  assert.equal(st.hookPath, join(customHooks, 'pre-commit'));
  const hookContent = readFileSync(st.hookPath, 'utf8');
  assert.ok(
    hookContent.indexOf('# --- immune:git-hook start ---') < hookContent.indexOf('exec npx lint-staged'),
    'managed block must precede exec/exit so it is reachable',
  );
  assert.equal(gitHookStatus(repoDir).coexistsWithUserHook, true);
  removeGitHook(repoDir);
  assert.match(readFileSync(st.hookPath, 'utf8'), /exec npx lint-staged/);

  // 3. Connect: Cursor sidecar-only MCP detection + stale-duplicate persistence.
  const fakeHome = join(dir, 'home');
  mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
  writeFileSync(
    join(fakeHome, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { 'dsh-immune-system': { command: 'node', args: ['/tmp/mcp.js'] } } }),
    'utf8',
  );
  const cursorRow = connectStatus({ home: fakeHome }).find((r) => r.host === 'cursor');
  assert.equal(cursorRow.state, 'connected');

  const scriptDir = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'hooks');
  const firstConn = connectHost('claude-code', { home: fakeHome, scriptDir });
  assert.equal(firstConn.added, 6);
  // Inject a stale duplicate alongside the valid entry and reconnect -> stale must be cleaned & persisted.
  const claudeCfgPath = join(fakeHome, '.claude', 'settings.json');
  const claudeCfg = JSON.parse(readFileSync(claudeCfgPath, 'utf8'));
  claudeCfg.hooks.Stop.push({
    hooks: [{ type: 'command', command: 'node "/stale/.dsh-immune/dist/zcode/src/hooks/stop.js"', timeout: 30 }],
  });
  writeFileSync(claudeCfgPath, JSON.stringify(claudeCfg, null, 2), 'utf8');
  const secondConn = connectHost('claude-code', { home: fakeHome, scriptDir });
  assert.equal(secondConn.upgraded, 1);
  const cleanedCfg = JSON.parse(readFileSync(claudeCfgPath, 'utf8'));
  assert.equal(cleanedCfg.hooks.Stop.length, 1);

  // 4. disk-ingest discovers depth-0 project root directly.
  const singleRepo = join(dir, 'my-single-repo');
  mkdirSync(singleRepo, { recursive: true });
  writeFileSync(join(singleRepo, 'package.json'), JSON.stringify({ name: 'single-app' }), 'utf8');
  writeFileSync(
    join(singleRepo, 'AGENTS.md'),
    '# Decisions\n1. **Never edit dist directly.** Always edit TypeScript source in src/ and run npm run build to regenerate dist/.\n',
    'utf8',
  );
  const ingestStore = new ImmuneStore({ dbPath: ':memory:' });
  const diskReport = ingestDiskCorpus(ingestStore, { roots: [singleRepo], dryRun: false });
  assert.equal(diskReport.projectsScanned, 1);
  assert.ok(diskReport.rulesExtracted >= 1);
  ingestStore.close();

  // 5. skill-ingest skips oversized >512 KiB files and survives symlink loops.
  const skillDir = join(dir, 'skills');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'huge.md'), 'x'.repeat(600_000), 'utf8');
  writeFileSync(join(skillDir, 'ok.md'), '- Never commit .env secrets; use .env.example instead.\n', 'utf8');
  try {
    symlinkSync(skillDir, join(skillDir, 'loop'), 'junction');
  } catch {
    // Symlink creation may require elevation on restricted hosts; huge-file check still runs.
  }
  const skillStore = new ImmuneStore({ dbPath: ':memory:' });
  const skillRep = ingestSkillPaths(skillStore, [skillDir]);
  assert.equal(skillRep.filesRead, 1);
  skillStore.close();

  // 6. Doctor exposes v4 rows (`schema`, `pre-flight guard`, `receipt chain`) and detects tampered chain.
  const docStore = new ImmuneStore({ dbPath: ':memory:' });
  const cid = docStore.insert({
    trigger_pattern: 'doctor receipt check',
    symptom: 'sample',
    prescription: 'sample verified advice rule',
  });
  docStore.match('doctor receipt check', { sessionId: 'doc-s', limit: 1 });
  const checksOk = runDoctor(docStore, { pluginRoot: ROOT });
  assert.ok(checksOk.some((c) => c.name === 'schema' && c.ok));
  assert.ok(checksOk.some((c) => c.name === 'pre-flight guard' && c.ok));
  assert.ok(checksOk.some((c) => c.name === 'receipt chain' && c.ok));
  // Tamper with receipt chain -> doctor must flag receipt chain as FAIL!
  docStore.db.prepare('UPDATE delivery_receipts SET digest = ?').run('0'.repeat(64));
  const checksTampered = runDoctor(docStore, { pluginRoot: ROOT });
  assert.equal(checksTampered.find((c) => c.name === 'receipt chain')?.ok, false);
  docStore.close();

  // 7. CLI strict validation: unknown connect flag and out-of-range --port exit 2.
  const badConnect = spawnSync(process.execPath, [CLI, 'connect', '--bogus'], { encoding: 'utf8' });
  assert.equal(badConnect.status, 2);
  assert.match(badConnect.stderr, /unknown option/i);

  const badPort = spawnSync(process.execPath, [CLI, 'ui', '--port', '99999'], { encoding: 'utf8' });
  assert.equal(badPort.status, 2);
  assert.match(badPort.stderr, /invalid --port/i);
});
