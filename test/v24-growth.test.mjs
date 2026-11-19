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
  classifyRuleDomain,
  diagnoseAgentArchetype,
  renderDiagnosisMarkdown,
  renderDiagnosisSvg,
  renderDiagnosisTerminal,
} from '../dsh-immune-system/dist/core/diagnose.js';
import {
  compileIdeRules,
  inferRuleGlobs,
  renderCursorMdc,
} from '../dsh-immune-system/dist/core/compile-rules.js';
import {
  renderAutopsyMarkdown,
  renderAutopsyTerminal,
  runPitfallAutopsy,
} from '../dsh-immune-system/dist/core/autopsy.js';
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

    assert.equal(maybeSyncTeamRulesAfterDrain(mockStore, dir, {}), null);

    const synced = maybeSyncTeamRulesAfterDrain(mockStore, dir, { IMMUNE_TEAM_SYNC: '1' });
    assert.ok(synced);
    assert.equal(synced.exported, 1);
    assert.equal(existsSync(join(dir, '.immune', 'rules.jsonl')), true);

    const syncedAgain = maybeSyncTeamRulesAfterDrain(mockStore, dir, {});
    assert.ok(syncedAgain);
    assert.equal(syncedAgain.exported, 1);

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

test('v2.4 diagnoseAgentArchetype classifies 5 engineering domains and assigns vivid failure archetype + vaccine', () => {
  const rules = [
    {
      trigger_pattern: 'Edit target file not read',
      symptom: 'Edit failed because file was not read in session',
      prescription: 'Read target file lines before calling Edit',
      tool_name: 'Edit',
      hit_count: 15,
    },
    {
      trigger_pattern: 'Write path separator',
      symptom: 'ENOENT on Windows backslash path',
      prescription: 'Normalize paths with path.posix/win32',
      tool_name: 'Write',
      hit_count: 9,
    },
    {
      trigger_pattern: 'Cargo.toml E0502 borrow',
      symptom: 'mutable borrow conflict',
      prescription: 'Split mutable struct borrows',
      tool_name: 'Bash',
      hit_count: 3,
    },
  ];

  assert.equal(classifyRuleDomain(rules[0]), 'filesystem');
  assert.equal(classifyRuleDomain(rules[2]), 'types');

  const report = diagnoseAgentArchetype(rules);
  assert.equal(report.activeRules, 3);
  assert.equal(report.dominantDomain, 'filesystem');
  assert.equal(report.archetype.id, 'blind-surgeon');
  assert.equal(report.radar.length, 5);

  const term = renderDiagnosisTerminal(report);
  assert.match(term, /The Blind Surgeon/);
  assert.match(term, /npx dsh-immune-system seed/);

  const md = renderDiagnosisMarkdown(report);
  assert.match(md, /Agent Pitfall Archetype/);
  assert.match(md, /Prescribed System-Prompt Vaccine/);
});

test('v2.4 diagnoseAgentArchetype promotes well-rounded high-rule libraries to The Immunized Sentinel', () => {
  const rules = [];
  const domains = [
    { trigger_pattern: 'Edit read file', symptom: 'not read', prescription: 'Read first', tool_name: 'Edit' },
    { trigger_pattern: 'Bash non-tty flag', symptom: 'hang', prescription: 'Pass --yes', tool_name: 'Bash' },
    { trigger_pattern: 'pnpm-lock.yaml npm', symptom: 'drift', prescription: 'Use pnpm', tool_name: 'Bash' },
    { trigger_pattern: 'Cargo.toml E0502', symptom: 'borrow', prescription: 'Split struct', tool_name: 'Bash' },
    { trigger_pattern: 'git push --force-with-lease', symptom: 'overwrite', prescription: 'Use lease', tool_name: 'Bash' },
  ];
  for (let i = 0; i < 20; i++) {
    const d = domains[i % domains.length];
    rules.push({ ...d, trigger_pattern: `${d.trigger_pattern} #${i}`, hit_count: 12, fail_count: 0 });
  }
  const report = diagnoseAgentArchetype(rules);
  assert.equal(report.archetype.id, 'immunized-sentinel');
  assert.ok(report.overallImmunityPct >= 82);
});

test('v2.4 inferRuleGlobs and renderCursorMdc generate valid Cursor .mdc frontmatter with automatic globs', () => {
  const rustRule = {
    trigger_pattern: 'Cargo.toml E0502',
    symptom: 'cannot borrow as mutable',
    prescription: 'Split mutable struct fields in Rust',
    tool_name: 'Bash',
    hit_count: 5,
  };
  const nextRule = {
    trigger_pattern: 'next/router App Router',
    symptom: 'NextRouter not mounted in tsx',
    prescription: 'Import useRouter from next/navigation',
    tool_name: 'Edit',
    hit_count: 4,
  };

  assert.equal(inferRuleGlobs(rustRule), '**/*.rs, **/Cargo.toml');
  assert.equal(inferRuleGlobs(nextRule), '**/*.tsx, **/*.ts, **/*.jsx');

  const mdc = renderCursorMdc([rustRule, nextRule]);
  assert.ok(mdc.startsWith('---\ndescription:'));
  assert.ok(mdc.includes('globs: **/*.rs, **/Cargo.toml, **/*.tsx, **/*.ts, **/*.jsx'));
  assert.ok(mdc.includes('alwaysApply: true'));
});

test('v2.4 compileIdeRules transpiles rules across all 5 IDE targets and preserves existing user content outside fenced markers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-compile-ide-'));
  try {
    const copilotPath = join(dir, '.github', 'copilot-instructions.md');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(copilotPath, '# My Team Custom Copilot Instructions\n\nAlways write tests.\n', 'utf8');

    const rules = [
      {
        trigger_pattern: 'pnpm-lock.yaml npm',
        symptom: 'npm install fails in pnpm repo',
        prescription: 'Use pnpm install instead of npm',
        tool_name: 'Bash',
        hit_count: 6,
      },
      {
        trigger_pattern: '/Users/alice/secret.ts',
        symptom: 'leaked home path',
        prescription: 'Never export /Users/alice/secret.ts',
        tool_name: 'Edit',
        hit_count: 10,
      },
    ];

    const results = compileIdeRules(dir, rules, { minHits: 1 });
    assert.equal(results.length, 5);
    for (const item of results) {
      assert.equal(item.rulesCount, 1, 'unsafe path rule must be filtered out automatically');
      assert.equal(existsSync(item.fullPath), true, `${item.relativePath} written`);
    }

    const copilotMerged = readFileSync(copilotPath, 'utf8');
    assert.ok(copilotMerged.includes('# My Team Custom Copilot Instructions'), 'preserves user header');
    assert.ok(copilotMerged.includes('<!-- immune:generated:start -->'));
    assert.ok(copilotMerged.includes('Use pnpm install instead of npm'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2.4 CLI help and SDK barrel expose diagnose and compile-rules commands and functions', () => {
  const mainHelp = renderMainHelp('2.3.0');
  assert.match(mainHelp, /diagnose \[--markdown\]/);
  assert.match(mainHelp, /compile-rules \[--target\]/);

  const diagHelp = renderCommandHelp('diagnose');
  assert.ok(diagHelp && diagHelp.includes('immune diagnose'));

  const compHelp = renderCommandHelp('compile-rules');
  assert.ok(compHelp && compHelp.includes('immune compile-rules'));

  const indexJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.js'), 'utf8');
  assert.ok(indexJs.includes('diagnoseAgentArchetype'));
  assert.ok(indexJs.includes('compileIdeRules'));
});

test('v2.4 runPitfallAutopsy computes rescued tokens, frontier API dollar savings, spinner minutes, and fragile scars', () => {
  const report = runPitfallAutopsy([
    {
      trigger_pattern: 'pnpm-lock.yaml npm install',
      symptom: 'lockfile conflict',
      prescription: 'Use pnpm install',
      tool_name: 'Bash',
      hit_count: 10,
      fail_count: 0,
    },
    {
      trigger_pattern: 'Edit target file unread',
      symptom: 'stale slice',
      prescription: 'Read file first',
      tool_name: 'Edit',
      hit_count: 8,
      fail_count: 2,
    },
  ]);

  assert.equal(report.activeRules, 2);
  assert.equal(report.savedLoops, 18);
  assert.equal(report.tokensRescued, 18 * 2400);
  assert.ok(report.usdSaved > 0);
  assert.ok(report.minutesReclaimed >= 13);
  assert.equal(report.fragileScars.length, 1);
  assert.equal(report.fragileScars[0].trigger_pattern, 'Edit target file unread');
  assert.equal(report.fragileScars[0].survivalPct, 80);

  const term = renderAutopsyTerminal(report);
  assert.match(term, /FORENSIC PITFALL AUTOPSY/);
  assert.match(term, /Fragile Scars/);

  const md = renderAutopsyMarkdown(report);
  assert.match(md, /Forensic Pitfall Autopsy & Token Burn Ledger/);
  assert.match(md, /Fragile Scars Watchlist/);
});

test('v2.4 CLI help and SDK barrel expose autopsy command and functions', () => {
  const mainHelp = renderMainHelp('2.3.0');
  assert.match(mainHelp, /autopsy \[--markdown\]/);

  const autopsyHelp = renderCommandHelp('autopsy');
  assert.ok(autopsyHelp && autopsyHelp.includes('immune autopsy'));

  const indexJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.js'), 'utf8');
  assert.ok(indexJs.includes('runPitfallAutopsy'));
});

test('v2.4 renderDiagnosisSvg renders valid 880x440 dark-mode radar SVG card', () => {
  const report = diagnoseAgentArchetype([
    {
      trigger_pattern: 'Edit unread file <script>',
      symptom: 'stale slice',
      prescription: 'Read target file first & verify',
      tool_name: 'Edit',
      hit_count: 12,
    },
  ]);
  const svg = renderDiagnosisSvg(report);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('AGENT PITFALL ARCHETYPE'));
  assert.ok(!svg.includes('<script>'));
});
