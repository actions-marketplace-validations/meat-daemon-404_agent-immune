import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  computeImmunityScore,
  escapeSvgText,
  formatCompactNumber,
  renderImmunityBadgeSvg,
  renderWrappedMarkdown,
  renderWrappedSvg,
} from '../dsh-immune-system/dist/core/wrapped.js';
import {
  canonicalRuleHash,
  hydrateTeamRules,
  isTeamShareSafe,
  maybeSyncTeamRulesAfterDrain,
  parseTeamRulesJsonl,
  serializeTeamRulesJsonl,
  verifyTeamRulesJsonl,
  writeTeamRulesFile,
} from '../dsh-immune-system/dist/core/team-sync.js';
import {
  renderCommandHelp,
  renderMainHelp,
} from '../dsh-immune-system/dist/zcode/src/commands/shared.js';

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

test('v2.4 hydrateTeamRules automatically imports .immune/rules.jsonl and respects IMMUNE_TEAM_SYNC=off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-hydrate-'));
  try {
    const file = join(dir, '.immune', 'rules.jsonl');
    writeTeamRulesFile(file, [
      {
        trigger_pattern: 'prisma migrate dev',
        symptom: 'non-interactive shell error',
        prescription: 'Use npx prisma migrate deploy or prisma db push in CI/non-TTY shells',
        tool_name: 'Bash',
        hit_count: 4,
      },
      {
        trigger_pattern: 'next/router App Router',
        symptom: 'NextRouter was not mounted',
        prescription: 'Import useRouter from next/navigation in Next.js App Router components',
        tool_name: 'Edit',
        hit_count: 6,
      },
    ]);

    const inserted = [];
    const mockStore = {
      insert(row) {
        inserted.push(row);
        return row;
      },
    };

    const offResult = hydrateTeamRules(mockStore, dir, { IMMUNE_TEAM_SYNC: 'off' });
    assert.equal(offResult.imported, 0);
    assert.equal(offResult.path, null);
    assert.equal(inserted.length, 0);

    const onResult = hydrateTeamRules(mockStore, dir, {});
    assert.equal(onResult.imported, 2);
    assert.equal(onResult.total, 2);
    assert.equal(onResult.path, file);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].origin, 'team_sync');
    assert.equal(inserted[0].prescription_source, 'human');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.4 maybeSyncTeamRulesAfterDrain auto-exports proven share-safe rules when .immune/rules.jsonl exists or IMMUNE_TEAM_SYNC=1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-autodrain-'));
  try {
    const mockStore = {
      listAll() {
        return [
          {
            trigger_pattern: 'pytest asyncio fixture',
            symptom: 'ScopeMismatch or unawaited coroutine',
            prescription: 'Decorate async pytest fixtures with @pytest_asyncio.fixture',
            tool_name: 'Bash',
            hit_count: 4,
            status: 'active',
          },
          {
            trigger_pattern: 'low hit candidate',
            symptom: 'minor typo',
            prescription: 'Fix typo',
            tool_name: 'Edit',
            hit_count: 1,
            status: 'active',
          },
        ];
      },
    };

    // When .immune/rules.jsonl does not exist and IMMUNE_TEAM_SYNC is not '1', no-op
    assert.equal(maybeSyncTeamRulesAfterDrain(mockStore, dir, {}), null);

    // When IMMUNE_TEAM_SYNC='1', creates .immune/rules.jsonl automatically
    const synced = maybeSyncTeamRulesAfterDrain(mockStore, dir, { IMMUNE_TEAM_SYNC: '1' });
    assert.ok(synced);
    assert.equal(synced.exported, 1);
    assert.equal(existsSync(join(dir, '.immune', 'rules.jsonl')), true);

    // Subsequent drain without IMMUNE_TEAM_SYNC='1' still syncs because .immune/rules.jsonl now exists
    const syncedAgain = maybeSyncTeamRulesAfterDrain(mockStore, dir, {});
    assert.ok(syncedAgain);
    assert.equal(syncedAgain.exported, 1);

    // Opt-out via IMMUNE_TEAM_SYNC='off'
    assert.equal(maybeSyncTeamRulesAfterDrain(mockStore, dir, { IMMUNE_TEAM_SYNC: 'off' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.4 CLI help surfaces wrapped and team-sync commands and serializeTeamRulesJsonl is exported', () => {
  const mainHelp = renderMainHelp('2.3.0');
  assert.match(mainHelp, /wrapped \[out\.svg\]/);
  assert.match(mainHelp, /team-sync \[--import\]/);

  const wrappedHelp = renderCommandHelp('wrapped');
  assert.ok(wrappedHelp && wrappedHelp.includes('immune wrapped'));

  const teamSyncHelp = renderCommandHelp('team-sync');
  assert.ok(teamSyncHelp && teamSyncHelp.includes('immune team-sync'));

  const serialized = serializeTeamRulesJsonl(
    [
      {
        trigger_pattern: 'Cargo.toml E0502 borrow',
        symptom: 'mutable borrow conflict',
        prescription: 'Split mutable struct borrows into disjoint fields',
        tool_name: 'Bash',
        hit_count: 4,
      },
    ],
    { minHits: 3 },
  );
  assert.equal(serialized.exported, 1);
});

test('v2.4 package.json exposes npm run bench:ab and includes server.json in files list', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.['bench:ab'], 'node scripts/bench-ab-simulation.mjs');
  assert.ok(pkg.scripts?.bench?.includes('bench-ab-simulation.mjs'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('server.json'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('smithery.yaml'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('glama.json'));
});

test('v2.4 end-to-end A/B multi-turn simulation benchmark achieves >=90% repeat pitfall reduction', () => {
  const benchScript = join(ROOT, 'scripts', 'bench-ab-simulation.mjs');
  assert.equal(existsSync(benchScript), true);
  const run = spawnSync(process.execPath, [benchScript], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /-95\.0%/);
  assert.match(run.stdout, /-63\.3%/);
});

test('v2.4 renderImmunityBadgeSvg and renderWrappedMarkdown generate viral README badge & PR summary', () => {
  const input = {
    totalCalls: 20100,
    repeatFailures: 495,
    avoidableTokens: 1420000,
    activeRules: 54,
    totalInjections: 6694,
    topNemeses: [{ label: 'Edit: Target file not read', count: 42 }],
  };

  const badge = renderImmunityBadgeSvg(input);
  assert.ok(badge.startsWith('<svg') && badge.endsWith('</svg>'));
  assert.ok(badge.includes('agent-immune'));
  assert.ok(badge.includes('/100 · 54 rules'));

  const md = renderWrappedMarkdown(input);
  assert.match(md, /Agent Pitfall Immunity Scorecard/);
  assert.match(md, /\*\*54\*\* rules/);
  assert.match(md, /meat-daemon-404\/agent-immune/);
});

test('v2.4 verifyTeamRulesJsonl detects git conflict markers, unsorted hashes, and auto-heals via writeTeamRulesFile', () => {
  const conflicted = [
    '<<<<<<< HEAD',
    '{"hash":"ffff000011112222","trigger_pattern":"vite env","symptom":"undef","prescription":"Use loadEnv","tool_name":"Edit"}',
    '=======',
    '{"hash":"0000111122223333","trigger_pattern":"pnpm lock","symptom":"npm fail","prescription":"Use pnpm install","tool_name":"Bash"}',
    '>>>>>>> feature-branch',
  ].join('\n');

  const checkBefore = verifyTeamRulesJsonl(conflicted);
  assert.equal(checkBefore.valid, false);
  assert.equal(checkBefore.conflictMarkers, true);
  assert.equal(checkBefore.unsorted, true);
  assert.equal(checkBefore.total, 2);

  const dir = mkdtempSync(join(tmpdir(), 'immune-conflict-heal-'));
  try {
    const file = join(dir, '.immune', 'rules.jsonl');
    mkdirSync(join(dir, '.immune'), { recursive: true });
    writeFileSync(file, conflicted, 'utf8');

    const healed = writeTeamRulesFile(file, [], { minHits: 0 });
    assert.equal(healed.exported, 2);

    const checkAfter = verifyTeamRulesJsonl(readFileSync(file, 'utf8'));
    assert.equal(checkAfter.valid, true);
    assert.equal(checkAfter.conflictMarkers, false);
    assert.equal(checkAfter.unsorted, false);
    assert.equal(checkAfter.duplicates, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.4 root action.yml GitHub Marketplace Action exists and defines composite steps', () => {
  const actionPath = join(ROOT, 'action.yml');
  assert.equal(existsSync(actionPath), true, 'action.yml exists at repository root');
  const raw = readFileSync(actionPath, 'utf8');
  assert.match(raw, /name:\s*'Agent Immune/);
  assert.match(raw, /using:\s*'composite'/);
  assert.match(raw, /dsh-immune-system ci-check/);
  assert.match(raw, /dsh-immune-system team-sync --check/);
  assert.match(raw, /dsh-immune-system wrapped/);
});

test('v2.4 dsh-immune-system/core barrel exports badge, markdown, and team-sync verification helpers', () => {
  const indexJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.js'), 'utf8');
  const indexDts = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.d.ts'), 'utf8');
  for (const sym of [
    'renderImmunityBadgeSvg',
    'renderWrappedMarkdown',
    'hydrateTeamRules',
    'maybeSyncTeamRulesAfterDrain',
    'verifyTeamRulesJsonl',
  ]) {
    assert.ok(indexJs.includes(sym), `dist/core/index.js exports ${sym}`);
    assert.ok(indexDts.includes(sym), `dist/core/index.d.ts declares ${sym}`);
  }
  assert.equal(typeof renderImmunityBadgeSvg, 'function');
  assert.equal(typeof renderWrappedMarkdown, 'function');
  assert.equal(typeof hydrateTeamRules, 'function');
  assert.equal(typeof maybeSyncTeamRulesAfterDrain, 'function');
  assert.equal(typeof verifyTeamRulesJsonl, 'function');
});

test('v2.4 assets/immunity-badge.svg and shell completions include --badge, --markdown, --check, and --dedupe', () => {
  const badgePath = join(ROOT, 'assets', 'immunity-badge.svg');
  assert.equal(existsSync(badgePath), true, 'assets/immunity-badge.svg exists');
  const badgeRaw = readFileSync(badgePath, 'utf8');
  assert.ok(badgeRaw.startsWith('<svg') && badgeRaw.includes('agent-immune'));

  const compJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'commands', 'completions.js'), 'utf8');
  assert.ok(compJs.includes('--check') && compJs.includes('--dedupe'));
});
