import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BUILTIN_GUARD_POLICIES,
  evaluatePreFlightGuard,
  renderGuardHookDecision,
  renderGuardMarkdown,
  renderGuardTerminal,
} from '../dsh-immune-system/dist/core/guard.js';
import {
  applyVaccineLockfile,
  compileVaccineLockfile,
  computeVaccineIntegrityHash,
  detectWorkspaceDNA,
  renderVaccineMarkdown,
  renderVaccineTerminal,
  verifyVaccineLockfile,
  writeVaccineLockfile,
} from '../dsh-immune-system/dist/core/vaccine.js';
import {
  federateSwarmRules,
  renderFederationMarkdown,
  renderFederationSvg,
  renderFederationTerminal,
} from '../dsh-immune-system/dist/core/federate.js';
import {
  renderCommandHelp,
  renderMainHelp,
} from '../dsh-immune-system/dist/zcode/src/commands/shared.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('v3.0 all 7 manifests are synchronized across all 10 version fields', () => {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const nestedPkg = JSON.parse(readFileSync(join(ROOT, 'dsh-immune-system/package.json'), 'utf8'));
  const zcodePlugin = JSON.parse(readFileSync(join(ROOT, 'dsh-immune-system/.zcode-plugin/plugin.json'), 'utf8'));
  const market = JSON.parse(readFileSync(join(ROOT, 'marketplace.json'), 'utf8'));
  const claudePlugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  const claudeMarket = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  const serverJson = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8'));

  assert.match(rootPkg.version, /^\d+\.\d+\.\d+$/);
  for (const v of [
    rootPkg.version,
    rootPkg.dsh?.version,
    nestedPkg.version,
    nestedPkg.dsh?.version,
    zcodePlugin.version,
    market.plugins?.[0]?.version,
    claudePlugin.version,
    claudeMarket.plugins?.[0]?.version,
    serverJson.version,
    serverJson.packages?.[0]?.version,
  ]) {
    assert.equal(v, rootPkg.version);
  }
});

test('v3.0 evaluatePreFlightGuard blocks catastrophic rm -rf and destructive SQL DDL', () => {
  assert.ok(BUILTIN_GUARD_POLICIES.length >= 8);

  const rmVerdict = evaluatePreFlightGuard('rm -rf /');
  assert.equal(rmVerdict.decision, 'block');
  assert.equal(rmVerdict.severity, 'critical');
  assert.equal(rmVerdict.blastRadiusScore, 100);

  const sqlVerdict = evaluatePreFlightGuard('psql -c "DROP TABLE users;"');
  assert.equal(sqlVerdict.decision, 'block');
  assert.equal(sqlVerdict.severity, 'critical');
  assert.equal(sqlVerdict.blastRadiusScore, 95);
});

test('v3.0 evaluatePreFlightGuard rewrites git push --force to --force-with-lease and allows already-leased push', () => {
  const rawPush = evaluatePreFlightGuard('git push --force origin main');
  assert.equal(rawPush.decision, 'rewrite');
  assert.equal(rawPush.suggestedRewrite, 'git push --force-with-lease origin main');
  assert.equal(rawPush.blastRadiusScore, 88);

  const safePush = evaluatePreFlightGuard('git push --force-with-lease origin main');
  assert.equal(safePush.decision, 'allow');
  assert.equal(safePush.blastRadiusScore, 0);
});

test('v3.0 evaluatePreFlightGuard rewrites non-TTY prisma migrate dev and chmod 777', () => {
  const prismaVerdict = evaluatePreFlightGuard('npx prisma migrate dev --name init');
  assert.equal(prismaVerdict.decision, 'rewrite');
  assert.equal(prismaVerdict.suggestedRewrite, 'npx prisma migrate dev --create-only --name init');

  const chmodVerdict = evaluatePreFlightGuard('chmod -R 777 ./scripts');
  assert.equal(chmodVerdict.decision, 'rewrite');
  assert.equal(chmodVerdict.suggestedRewrite, 'chmod -R 755 ./scripts');
});

test('v3.0 evaluatePreFlightGuard detects workspace lockfile drift and rewrites npm install to pnpm add', () => {
  const drift = evaluatePreFlightGuard('npm install zod', [], {
    workspacePackageManager: 'pnpm',
  });
  assert.equal(drift.decision, 'rewrite');
  assert.equal(drift.suggestedRewrite, 'pnpm add zod');
  assert.equal(drift.matches[0].source, 'workspace-lockfile');
});

test('v3.0 evaluatePreFlightGuard intercepts hardcoded API secrets and escalated learned antibodies', () => {
  const secretVerdict = evaluatePreFlightGuard('curl -H "Authorization: Bearer ghp_1234567890abcdefghij1234567890" https://api.github.com');
  assert.equal(secretVerdict.decision, 'block');
  assert.equal(secretVerdict.severity, 'critical');
  assert.ok(!secretVerdict.payload.includes('ghp_1234567890abcdefghij1234567890'), 'secret must be redacted from verdict');

  const rule = {
    trigger_pattern: 'vite build --mode staging env',
    symptom: 'VITE_API_URL missing unless loadEnv is called',
    prescription: 'Use loadEnv(mode, process.cwd()) in vite.config.ts',
    tool_name: 'Bash',
    hit_count: 5,
    fail_count: 2,
  };
  const warnVerdict = evaluatePreFlightGuard('vite build --mode staging', [rule], { toolName: 'Bash' });
  assert.equal(warnVerdict.decision, 'warn', 'learned DB rules never auto-block unless strict=true (AGENTS #8)');
  assert.equal(warnVerdict.severity, 'high');
  assert.equal(warnVerdict.matches[0].source, 'learned-antibody');

  const strictVerdict = evaluatePreFlightGuard('vite build --mode staging', [rule], {
    toolName: 'Bash',
    strict: true,
  });
  assert.equal(strictVerdict.decision, 'block');
});

test('v3.0 renderGuardHookDecision, renderGuardTerminal, and renderGuardMarkdown format structured outputs', () => {
  const verdict = evaluatePreFlightGuard('git push -f origin feat/ui');
  const hook = renderGuardHookDecision(verdict);
  assert.equal(hook.decision, 'allow');
  assert.equal(hook.updatedInput?.command, 'git push --force-with-lease origin feat/ui');

  const term = renderGuardTerminal(verdict);
  assert.match(term, /PRE-FLIGHT BLAST-RADIUS GUARD/);
  assert.match(term, /--force-with-lease/);

  const md = renderGuardMarkdown(verdict);
  assert.match(md, /Pre-Flight Blast-Radius Guard Verdict/);
});

test('v3.0 detectWorkspaceDNA identifies polyglot markers, package managers, and recommended packs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-dna-'));
  try {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), '{}\n', 'utf8');
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8');
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:22-alpine\n', 'utf8');

    const dna = detectWorkspaceDNA(dir);
    assert.equal(dna.packageManager, 'pnpm');
    assert.ok(dna.detectedMarkers.includes('pnpm-lock.yaml'));
    assert.ok(dna.detectedMarkers.includes('Cargo.toml'));
    assert.ok(dna.recommendedPacks.includes('node-ts'));
    assert.ok(dna.recommendedPacks.includes('rust-cargo'));
    assert.ok(dna.recommendedPacks.includes('docker'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v3.0 writeVaccineLockfile, verifyVaccineLockfile, and applyVaccineLockfile round-trip with SHA-256 integrity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-vaccine-'));
  try {
    writeFileSync(join(dir, 'uv.lock'), 'version = 1\n', 'utf8');
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "app"\n', 'utf8');

    const { lockfilePath, lockfile } = writeVaccineLockfile(dir, [
      {
        trigger_pattern: 'fastapi async sessionmaker',
        symptom: 'MissingGreenlet in sync session call',
        prescription: 'Use async_sessionmaker with AsyncSession in FastAPI routes',
        tool_name: 'Edit',
        hit_count: 5,
      },
      {
        trigger_pattern: '/Users/alice/private.py',
        symptom: 'local secret path',
        prescription: 'Never commit /Users/alice/private.py',
        tool_name: 'Edit',
        hit_count: 9,
      },
    ]);

    assert.equal(existsSync(lockfilePath), true);
    assert.equal(lockfile.schemaVersion, '3.0.0');
    assert.equal(lockfile.dna.packageManager, 'uv');

    const raw = readFileSync(lockfilePath, 'utf8');
    const verified = verifyVaccineLockfile(raw);
    assert.equal(verified.valid, true);
    assert.equal(verified.antibodyCount, lockfile.antibodies.length);

    const tampered = raw.replace('AsyncSession', 'TamperedSession');
    const badVerify = verifyVaccineLockfile(tampered);
    assert.equal(badVerify.valid, false);

    const inserted = [];
    const res = applyVaccineLockfile(
      {
        insert(row) {
          inserted.push(row);
          return inserted.length;
        },
      },
      lockfile,
    );
    assert.equal(res.applied, lockfile.antibodies.length);
    assert.ok(inserted.some((r) => r.prescription.includes('AsyncSession')));
    assert.ok(!inserted.some((r) => r.prescription.includes('/Users/alice')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v3.0 renderVaccineTerminal and renderVaccineMarkdown output Workspace DNA and locked antibodies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'immune-vac-render-'));
  try {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/m\n', 'utf8');
    const lockfile = compileVaccineLockfile(dir);
    assert.equal(lockfile.integrityHash, computeVaccineIntegrityHash(lockfile.dna, lockfile.antibodies));

    const term = renderVaccineTerminal(lockfile);
    assert.match(term, /WORKSPACE DNA & VACCINE LOCKFILE/);
    assert.match(term, /go\.mod/);

    const md = renderVaccineMarkdown(lockfile);
    assert.match(md, /Workspace DNA & Vaccine Lockfile/);
    assert.match(md, /go-mod/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v3.0 federateSwarmRules clusters corroborated rules across multiple workspaces into Universal Swarm Laws', () => {
  const report = federateSwarmRules([
    {
      sourceId: 'repo-alpha (Claude Code)',
      rules: [
        {
          trigger_pattern: 'pnpm-lock.yaml npm install',
          symptom: 'lockfile conflict',
          prescription: 'Use pnpm install instead of npm install',
          tool_name: 'Bash',
          hit_count: 8,
          fail_count: 0,
        },
        {
          trigger_pattern: '/Users/bob/local-only.ts',
          symptom: 'private path',
          prescription: 'Edit /Users/bob/local-only.ts',
          tool_name: 'Edit',
          hit_count: 5,
        },
      ],
    },
    {
      sourceId: 'repo-beta (Cursor)',
      rules: [
        {
          trigger_pattern: 'pnpm-lock.yaml npm i',
          symptom: 'npm install breaks pnpm workspace',
          prescription: 'Use pnpm install instead of npm install',
          tool_name: 'Bash',
          hit_count: 11,
          fail_count: 0,
        },
        {
          trigger_pattern: 'minor experimental rule',
          symptom: 'flaky test',
          prescription: 'Retry once',
          tool_name: 'Bash',
          hit_count: 1,
          fail_count: 3,
        },
      ],
    },
  ]);

  assert.equal(report.totalSources, 2);
  assert.equal(report.totalInputRules, 4);
  assert.equal(report.withheldUnsafe, 1);
  assert.equal(report.clusters.length, 2);
  assert.equal(report.universalLaws.length, 1);

  const law = report.universalLaws[0];
  assert.equal(law.tier, 'universal-law');
  assert.equal(law.sourceCount, 2);
  assert.equal(law.totalHits, 19);
  assert.ok(law.consensusScore >= 80);
});

test('v3.0 renderFederationTerminal, renderFederationMarkdown, and renderFederationSvg escape XML and format consensus', () => {
  const report = federateSwarmRules([
    {
      sourceId: 'agent-1',
      rules: [
        {
          trigger_pattern: 'Edit <unsafe> & "tag"',
          symptom: 'unread file',
          prescription: 'Read target file before <Edit>',
          tool_name: 'Edit',
          hit_count: 14,
          fail_count: 0,
        },
      ],
    },
    {
      sourceId: 'agent-2',
      rules: [
        {
          trigger_pattern: 'Edit <unsafe> & "tag"',
          symptom: 'unread file',
          prescription: 'Read target file before <Edit>',
          tool_name: 'Edit',
          hit_count: 9,
          fail_count: 0,
        },
      ],
    },
  ]);

  const term = renderFederationTerminal(report);
  assert.match(term, /SWARM ANTIBODY FEDERATION & CONSENSUS/);
  assert.match(term, /UNIVERSAL LAW/);

  const md = renderFederationMarkdown(report);
  assert.match(md, /Swarm Antibody Federation & Consensus Report/);

  const svg = renderFederationSvg(report);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!svg.includes('<unsafe>'));
  assert.ok(svg.includes('&lt;unsafe&gt;'));
});

test('v3.0 CLI help, completions, and SDK barrel expose guard, vaccinate, and federate', () => {
  const mainHelp = renderMainHelp('3.0.0');
  assert.match(mainHelp, /dsh-immune-system v3\.0\.0/);
  assert.match(mainHelp, /guard "<command>"/);
  assert.match(mainHelp, /vaccinate \[--apply\]/);
  assert.match(mainHelp, /federate \[<files\.\.\.>\]/);

  assert.ok(renderCommandHelp('guard')?.includes('immune guard'));
  assert.ok(renderCommandHelp('vaccinate')?.includes('immune vaccinate'));
  assert.ok(renderCommandHelp('federate')?.includes('immune federate'));

  const compJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'commands', 'completions.js'), 'utf8');
  assert.ok(compJs.includes("'guard'") && compJs.includes("'vaccinate'") && compJs.includes("'federate'"));

  const indexJs = readFileSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.js'), 'utf8');
  for (const sym of [
    'evaluatePreFlightGuard',
    'compileVaccineLockfile',
    'detectWorkspaceDNA',
    'federateSwarmRules',
  ]) {
    assert.ok(indexJs.includes(sym), `dist/core/index.js exports ${sym}`);
  }
});

test('v3.0.1 CLI guard excludes --tool value from payload and preserves command flags', () => {
  const cli = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');
  const tmp = mkdtempSync(join(tmpdir(), 'immune-v301-guard-'));
  try {
    const env = {
      ...process.env,
      IMMUNE_DB_PATH: join(tmp, 'test.sqlite'),
      IMMUNE_SHARED_DB_PATH: join(tmp, 'shared.sqlite'),
    };
    const r1 = spawnSync(process.execPath, [cli, 'guard', '--tool', 'Edit', 'rm -rf /', '--json'], {
      cwd: tmp,
      env,
      encoding: 'utf8',
    });
    assert.equal(r1.status, 0, 'shell-only rm -rf rule must not false-positive on Edit payloads');
    const v1 = JSON.parse(r1.stdout);
    assert.equal(v1.toolName, 'Edit');
    assert.equal(v1.payload, 'rm -rf /');
    assert.equal(v1.decision, 'allow');

    const r1b = spawnSync(process.execPath, [cli, 'guard', '--tool', 'Bash', 'rm -rf /', '--json'], {
      cwd: tmp,
      env,
      encoding: 'utf8',
    });
    assert.equal(r1b.status, 1);
    const v1b = JSON.parse(r1b.stdout);
    assert.equal(v1b.toolName, 'Bash');
    assert.equal(v1b.payload, 'rm -rf /');
    assert.equal(v1b.decision, 'block');

    const r2 = spawnSync(
      process.execPath,
      [cli, 'guard', '--tool', 'Bash', 'git push origin main --force', '--json'],
      { cwd: tmp, env, encoding: 'utf8' },
    );
    assert.equal(r2.status, 0);
    const v2 = JSON.parse(r2.stdout);
    assert.equal(v2.toolName, 'Bash');
    assert.equal(v2.payload, 'git push origin main --force');
    assert.equal(v2.suggestedRewrite, 'git push origin main --force-with-lease');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('v3.0.1 CLI vaccinate --apply preserves existing lockfile proven scars, rejects tampering, and supports --refresh', () => {
  const cli = join(ROOT, 'dsh-immune-system', 'dist', 'zcode', 'src', 'cli.js');
  const tmp = mkdtempSync(join(tmpdir(), 'immune-v301-vacc-'));
  try {
    const ws = join(tmp, 'repo');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'package.json'), '{"name":"repo"}\n');
    writeFileSync(join(ws, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");

    const lockPath = join(ws, '.immune', 'vaccine.lock.json');
    const teamScarRx = 'Use pnpm --filter @acme/api test instead of root npm test';
    writeVaccineLockfile(
      ws,
      [
        {
          trigger_pattern: 'pnpm filter workspace test',
          symptom: 'root npm test misses workspace package',
          prescription: teamScarRx,
          tool_name: 'Bash',
          hit_count: 8,
          fail_count: 0,
          status: 'active',
        },
      ],
      { lockfilePath: lockPath },
    );
    const originalLockRaw = readFileSync(lockPath, 'utf8');

    // Fresh developer clone with empty SQLite DB runs `vaccinate --apply`
    const freshEnv = {
      ...process.env,
      IMMUNE_DB_PATH: join(tmp, 'fresh.sqlite'),
      IMMUNE_SHARED_DB_PATH: join(tmp, 'shared.sqlite'),
    };
    const applyOut = execFileSync(process.execPath, [cli, 'vaccinate', '--apply', '--json'], {
      cwd: ws,
      env: freshEnv,
      encoding: 'utf8',
    });
    const applied = JSON.parse(applyOut);
    assert.ok(applied.appliedCount >= 3);
    assert.equal(readFileSync(lockPath, 'utf8'), originalLockRaw, 'existing lockfile must not be overwritten');

    const listed = JSON.parse(
      execFileSync(process.execPath, [cli, 'list', '--json'], { cwd: ws, env: freshEnv, encoding: 'utf8' }),
    );
    assert.ok(
      listed.some((r) => r.prescription === teamScarRx),
      'proven team scar from committed lockfile must be hydrated into fresh SQLite store',
    );

    // Tampered lockfile must be rejected by --apply
    const tampered = JSON.parse(originalLockRaw);
    tampered.antibodies[0].prescription = 'evil tampered command';
    writeFileSync(lockPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const badApply = spawnSync(process.execPath, [cli, 'vaccinate', '--apply', '--json'], {
      cwd: ws,
      env: freshEnv,
      encoding: 'utf8',
    });
    assert.equal(badApply.status, 1, 'tampered lockfile must fail integrity verification');

    // Explicit --refresh regenerates a valid lockfile
    const refreshOut = execFileSync(process.execPath, [cli, 'vaccinate', '--apply', '--refresh', '--json'], {
      cwd: ws,
      env: freshEnv,
      encoding: 'utf8',
    });
    const refreshed = JSON.parse(refreshOut);
    assert.equal(verifyVaccineLockfile(readFileSync(lockPath, 'utf8')).valid, true);
    assert.ok(refreshed.lockfile.antibodies.length >= 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
