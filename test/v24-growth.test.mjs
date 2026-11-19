import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  computeImmunityScore,
  escapeSvgText,
  formatCompactNumber,
  renderWrappedSvg,
} from '../dsh-immune-system/dist/core/wrapped.js';
import {
  canonicalRuleHash,
  isTeamShareSafe,
  parseTeamRulesJsonl,
  serializeTeamRulesJsonl,
  writeTeamRulesFile,
} from '../dsh-immune-system/dist/core/team-sync.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('v2.4 MCP registry manifests (server.json, smithery.yaml, glama.json) exist and are valid', () => {
  const serverJsonPath = join(ROOT, 'server.json');
  const smitheryPath = join(ROOT, 'smithery.yaml');
  const glamaPath = join(ROOT, 'glama.json');

  assert.equal(existsSync(serverJsonPath), true, 'server.json exists');
  assert.equal(existsSync(smitheryPath), true, 'smithery.yaml exists');
  assert.equal(existsSync(glamaPath), true, 'glama.json exists');

  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  assert.equal(serverJson.name, 'io.github.meat-daemon-404/agent-immune');
  assert.equal(serverJson.packages?.[0]?.identifier, 'dsh-immune-system');
  assert.equal(serverJson.packages?.[0]?.transport?.type, 'stdio');

  const glamaJson = JSON.parse(readFileSync(glamaPath, 'utf8'));
  assert.ok(Array.isArray(glamaJson.maintainers));
  assert.ok(glamaJson.maintainers.includes('meat-daemon-404'));
});

test('v2.4 wrapped SVG scorecard renders valid XML and escapes special entities', () => {
  assert.equal(escapeSvgText('<script>&"test\'</script>'), '&lt;script&gt;&amp;&quot;test&#39;&lt;/script&gt;');
  assert.equal(formatCompactNumber(20100), '20.1k');
  assert.equal(formatCompactNumber(1420000), '1.42M');

  const score = computeImmunityScore({
    totalCalls: 20100,
    repeatFailures: 495,
    avoidableTokens: 1420000,
    activeRules: 54,
    totalInjections: 6694,
  });
  assert.ok(score >= 80 && score <= 100);

  const svg = renderWrappedSvg({
    totalCalls: 20100,
    repeatFailures: 495,
    avoidableTokens: 1420000,
    activeRules: 54,
    totalInjections: 6694,
    hosts: ['Claude Code', 'Cursor', 'Codex'],
    topNemeses: [{ label: 'Edit: <unsafe> & "quote"', count: 42 }],
  });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!svg.includes('<unsafe>'), 'raw angle brackets must never appear in SVG');
  assert.ok(svg.includes('&lt;unsafe&gt; &amp; &quot;quote&quot;'));
  assert.ok(svg.includes('20.1k'));
});

test('v2.4 team-sync serializes deterministically sorted JSONL and filters unsafe paths/secrets', () => {
  const h1 = canonicalRuleHash('Use pnpm install instead of npm');
  const h2 = canonicalRuleHash('  use   PNPM install instead of npm ');
  assert.equal(h1, h2, 'hash normalizes case and whitespace');

  assert.equal(
    isTeamShareSafe({
      trigger_pattern: 'Edit C:\\Users\\alice\\project\\a.ts',
      symptom: 'failed',
      prescription: 'read file',
    }),
    false,
  );
  assert.equal(
    isTeamShareSafe({
      trigger_pattern: 'auth header',
      symptom: '401',
      prescription: 'use Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    }),
    false,
  );

  const dir = mkdtempSync(join(tmpdir(), 'immune-team-sync-'));
  try {
    const file = join(dir, '.immune', 'rules.jsonl');
    const res1 = writeTeamRulesFile(file, [
      {
        trigger_pattern: 'vite.config.ts loadEnv',
        symptom: 'process.env undefined',
        prescription: 'Use loadEnv(mode, process.cwd()) in vite.config.ts',
        tool_name: 'Edit',
        hit_count: 5,
      },
      {
        trigger_pattern: 'pnpm-lock.yaml npm',
        symptom: 'npm install fails',
        prescription: 'Use pnpm install instead of npm install',
        tool_name: 'Bash',
        hit_count: 8,
      },
      {
        trigger_pattern: '/Users/bob/secret.ts',
        symptom: 'leak',
        prescription: 'never export /Users/bob/secret.ts',
        tool_name: 'Edit',
        hit_count: 9,
      },
    ]);
    assert.equal(res1.exported, 2);
    assert.equal(res1.skippedUnsafe, 1);

    const parsed = parseTeamRulesJsonl(readFileSync(file, 'utf8'));
    assert.equal(parsed.length, 2);
    assert.ok(parsed[0].hash < parsed[1].hash, 'lines are sorted by hash for conflict-free git merges');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
