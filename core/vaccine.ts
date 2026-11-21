/**
 * v3.0 Declarative Vaccine Lockfile & Zero-Shot Workspace DNA Auto-Immunization (`immune vaccinate`).
 *
 * Scans a repository's manifest files (package.json, pnpm-lock.yaml, tsconfig.json,
 * Cargo.toml, go.mod, pyproject.toml, uv.lock, Dockerfile, .github/workflows) to
 * build a deterministic Workspace DNA fingerprint, synthesizes zero-day stack
 * antibodies, and compiles or verifies a Git-committable `.immune/vaccine.lock.json`
 * with SHA-256 integrity verification.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DiagnosableRule } from './diagnose.js';
import { canonicalRuleHash, isTeamShareSafe, type TeamRuleImportStore } from './team-sync.js';
import { packageVersion } from './version.js';

export type DetectedPackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm' | 'uv' | 'cargo' | 'go' | 'unknown';

export interface VaccineAntibodySpec {
  readonly hash: string;
  readonly trigger_pattern: string;
  readonly symptom: string;
  readonly prescription: string;
  readonly tool_name: string | null;
  readonly origin: 'workspace-dna' | 'proven-scar';
}

export interface WorkspaceDNA {
  readonly detectedMarkers: ReadonlyArray<string>;
  readonly packageManager: DetectedPackageManager;
  readonly stacks: ReadonlyArray<string>;
  readonly recommendedPacks: ReadonlyArray<string>;
  readonly riskTerritories: ReadonlyArray<string>;
}

export interface VaccineLockfile {
  readonly schemaVersion: '3.0.0';
  readonly dna: WorkspaceDNA;
  readonly antibodies: ReadonlyArray<VaccineAntibodySpec>;
  readonly integrityHash: string;
}

export interface VaccineVerificationReport {
  readonly valid: boolean;
  readonly schemaVersion: string | null;
  readonly antibodyCount: number;
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
  readonly reason: string;
}

const MARKER_CHECKS: ReadonlyArray<{
  readonly file: string;
  readonly stack: string;
  readonly pack: string;
  readonly territory: string;
  readonly rule: {
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name: string;
  };
}> = [
  {
    file: 'pnpm-lock.yaml',
    stack: 'pnpm',
    pack: 'node-ts',
    territory: 'Lockfile & Workspace Package Manager (pnpm)',
    rule: {
      trigger_pattern: 'pnpm-lock.yaml npm install yarn',
      symptom: 'Running npm install or yarn in a pnpm workspace creates conflicting lockfiles and broken node_modules',
      prescription: 'Use pnpm install / pnpm add / pnpm run exclusively in this pnpm-locked repository',
      tool_name: 'Bash',
    },
  },
  {
    file: 'yarn.lock',
    stack: 'yarn',
    pack: 'node-ts',
    territory: 'Lockfile & Workspace Package Manager (yarn)',
    rule: {
      trigger_pattern: 'yarn.lock npm install pnpm',
      symptom: 'Running npm install in a yarn-locked repository corrupts dependency resolution',
      prescription: 'Use yarn install / yarn add exclusively when yarn.lock is present',
      tool_name: 'Bash',
    },
  },
  {
    file: 'bun.lockb',
    stack: 'bun',
    pack: 'node-ts',
    territory: 'Lockfile & Workspace Package Manager (bun)',
    rule: {
      trigger_pattern: 'bun.lockb bun.lock npm install',
      symptom: 'Running npm install in a Bun repository bypasses bun.lockb/bun.lock',
      prescription: 'Use bun install / bun add / bun run in this Bun-locked repository',
      tool_name: 'Bash',
    },
  },
  {
    file: 'bun.lock',
    stack: 'bun',
    pack: 'node-ts',
    territory: 'Lockfile & Workspace Package Manager (bun)',
    rule: {
      trigger_pattern: 'bun.lockb bun.lock npm install',
      symptom: 'Running npm install in a Bun repository bypasses bun.lockb/bun.lock',
      prescription: 'Use bun install / bun add / bun run in this Bun-locked repository',
      tool_name: 'Bash',
    },
  },
  {
    file: 'tsconfig.json',
    stack: 'typescript',
    pack: 'node-ts',
    territory: 'TypeScript ESM & Module Resolution',
    rule: {
      trigger_pattern: 'tsconfig.json ERR_MODULE_NOT_FOUND relative import .js',
      symptom: 'NodeNext / ESM TypeScript compilation fails at runtime when relative imports omit .js extensions',
      prescription: 'Include explicit .js extensions on relative TypeScript ESM imports and run tsc --noEmit before committing',
      tool_name: 'Edit',
    },
  },
  {
    file: 'Cargo.toml',
    stack: 'rust',
    pack: 'rust-cargo',
    territory: 'Rust Cargo & Borrow Checker (E0502 / E0382)',
    rule: {
      trigger_pattern: 'Cargo.toml E0502 E0382 mutable borrow cargo check',
      symptom: 'Overlapping mutable/immutable struct borrows or slow full cargo test rebuild loops',
      prescription: 'Run cargo check --tests for fast type validation and split mutable struct borrows into disjoint fields',
      tool_name: 'Bash',
    },
  },
  {
    file: 'go.mod',
    stack: 'go',
    pack: 'go-mod',
    territory: 'Go Modules, Race Detector & Typed-Nil Interfaces',
    rule: {
      trigger_pattern: 'go.mod go test -race concurrent map writes typed nil',
      symptom: 'Unchecked concurrent map writes or typed-nil pointer returned as non-nil error interface',
      prescription: 'Return explicit untyped nil on zero-error paths and verify concurrency with go test -race ./...',
      tool_name: 'Bash',
    },
  },
  {
    file: 'uv.lock',
    stack: 'python-uv',
    pack: 'python-uv',
    territory: 'Python uv Lockfile & Virtualenv Isolation',
    rule: {
      trigger_pattern: 'uv.lock pip install python pytest',
      symptom: 'Calling global pip install or bare python bypasses the uv.lock virtual environment',
      prescription: 'Use uv run pytest / uv add / uv sync instead of bare pip or global python',
      tool_name: 'Bash',
    },
  },
  {
    file: 'pyproject.toml',
    stack: 'python',
    pack: 'python-uv',
    territory: 'Python Project Packaging & Async Pytest Fixtures',
    rule: {
      trigger_pattern: 'pyproject.toml pytest asyncio fixture ModuleNotFoundError',
      symptom: 'Pytest fails with ModuleNotFoundError on src/ layout or unawaited async fixture',
      prescription: 'Run pytest via python -m pytest (or uv run pytest) and decorate async fixtures with @pytest_asyncio.fixture',
      tool_name: 'Bash',
    },
  },
  {
    file: 'Dockerfile',
    stack: 'docker',
    pack: 'docker',
    territory: 'Docker Layer Caching & .dockerignore Context',
    rule: {
      trigger_pattern: 'Dockerfile COPY . . docker build cache node_modules',
      symptom: 'COPY . . before dependency manifest copy invalidates Docker layer cache and leaks local node_modules/.git',
      prescription: 'Copy lockfiles and install dependencies before COPY . . and exclude node_modules/.git in .dockerignore',
      tool_name: 'Edit',
    },
  },
  {
    file: '.github/workflows',
    stack: 'github-actions',
    pack: 'git-safety',
    territory: 'GitHub Actions Workflows & Non-Interactive CI Gates',
    rule: {
      trigger_pattern: '.github/workflows npm ci git push --force-with-lease',
      symptom: 'CI npm ci fails when package.json drifts from package-lock.json or interactive commands hang runner',
      prescription: 'Keep package.json and lockfiles strictly synchronized and pass non-interactive flags in CI workflows',
      tool_name: 'Edit',
    },
  },
];

export function detectWorkspaceDNA(workspaceDir: string): WorkspaceDNA {
  const detectedMarkers: string[] = [];
  const stacks = new Set<string>(['git']);
  const recommendedPacks = new Set<string>(['git-safety']);
  const riskTerritories: string[] = ['File Edit-Before-Read & Git History Safety'];

  for (const m of MARKER_CHECKS) {
    if (existsSync(join(workspaceDir, m.file))) {
      detectedMarkers.push(m.file);
      stacks.add(m.stack);
      recommendedPacks.add(m.pack);
      riskTerritories.push(m.territory);
    }
  }

  if (existsSync(join(workspaceDir, 'package.json')) && !detectedMarkers.includes('package.json')) {
    detectedMarkers.push('package.json');
    stacks.add('node');
    recommendedPacks.add('node-ts');
  }
  if (existsSync(join(workspaceDir, 'package-lock.json')) && !detectedMarkers.includes('package-lock.json')) {
    detectedMarkers.push('package-lock.json');
    stacks.add('node');
    recommendedPacks.add('node-ts');
  }

  let packageManager: DetectedPackageManager = 'unknown';
  if (detectedMarkers.includes('pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (detectedMarkers.includes('yarn.lock')) packageManager = 'yarn';
  else if (detectedMarkers.includes('bun.lockb') || detectedMarkers.includes('bun.lock')) packageManager = 'bun';
  else if (detectedMarkers.includes('uv.lock')) packageManager = 'uv';
  else if (detectedMarkers.includes('Cargo.toml')) packageManager = 'cargo';
  else if (detectedMarkers.includes('go.mod')) packageManager = 'go';
  else if (detectedMarkers.includes('package-lock.json') || detectedMarkers.includes('package.json')) {
    packageManager = 'npm';
  }

  return {
    detectedMarkers: detectedMarkers.sort(),
    packageManager,
    stacks: [...stacks].sort(),
    recommendedPacks: [...recommendedPacks].sort(),
    riskTerritories: [...new Set(riskTerritories)],
  };
}

export function computeVaccineIntegrityHash(
  dna: WorkspaceDNA,
  antibodies: ReadonlyArray<VaccineAntibodySpec>,
): string {
  const canonicalPayload = JSON.stringify({
    schemaVersion: '3.0.0',
    dna: {
      detectedMarkers: dna.detectedMarkers,
      packageManager: dna.packageManager,
      stacks: dna.stacks,
      recommendedPacks: dna.recommendedPacks,
      riskTerritories: dna.riskTerritories ?? [],
    },
    antibodies: antibodies.map((a) => ({
      hash: a.hash,
      trigger_pattern: a.trigger_pattern,
      symptom: a.symptom,
      prescription: a.prescription,
      tool_name: a.tool_name,
      origin: a.origin,
    })),
  });
  return createHash('sha256').update(canonicalPayload).digest('hex').slice(0, 32);
}

export function compileVaccineLockfile(
  workspaceDir: string,
  learnedRules: ReadonlyArray<DiagnosableRule> = [],
  opts: { minHits?: number } = {},
): VaccineLockfile {
  const minHits = opts.minHits ?? 2;
  const dna = detectWorkspaceDNA(workspaceDir);
  const byHash = new Map<string, VaccineAntibodySpec>();

  const baselineRule = {
    trigger_pattern: 'Edit Write target file without Read',
    symptom: 'Calling Edit on a file before reading its current lines causes stale-slice corruption',
    prescription: 'Always Read the target file lines in the current session before invoking Edit or Write',
    tool_name: 'Edit',
  };
  const baseHash = canonicalRuleHash(baselineRule.prescription);
  byHash.set(baseHash, {
    hash: baseHash,
    ...baselineRule,
    origin: 'workspace-dna',
  });

  for (const m of MARKER_CHECKS) {
    if (dna.detectedMarkers.includes(m.file)) {
      const h = canonicalRuleHash(m.rule.prescription);
      byHash.set(h, {
        hash: h,
        trigger_pattern: m.rule.trigger_pattern,
        symptom: m.rule.symptom,
        prescription: m.rule.prescription,
        tool_name: m.rule.tool_name,
        origin: 'workspace-dna',
      });
    }
  }

  for (const r of learnedRules) {
    if (r.status && r.status !== 'active') continue;
    if ((r.hit_count ?? 0) < minHits) continue;
    if (!isTeamShareSafe(r)) continue;
    const h = canonicalRuleHash(r.prescription);
    byHash.set(h, {
      hash: h,
      trigger_pattern: r.trigger_pattern.trim(),
      symptom: r.symptom.trim(),
      prescription: r.prescription.trim(),
      tool_name: r.tool_name ?? null,
      origin: 'proven-scar',
    });
  }

  const antibodies = [...byHash.values()].sort((a, b) => a.hash.localeCompare(b.hash));
  const integrityHash = computeVaccineIntegrityHash(dna, antibodies);

  return {
    schemaVersion: '3.0.0',
    dna,
    antibodies,
    integrityHash,
  };
}

export function writeVaccineLockfile(
  workspaceDir: string,
  learnedRules: ReadonlyArray<DiagnosableRule> = [],
  opts: { lockfilePath?: string; minHits?: number } = {},
): { readonly lockfilePath: string; readonly lockfile: VaccineLockfile } {
  const lockfilePath = opts.lockfilePath ?? join(workspaceDir, '.immune', 'vaccine.lock.json');
  const lockfile = compileVaccineLockfile(workspaceDir, learnedRules, opts);
  mkdirSync(dirname(lockfilePath), { recursive: true });
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8');
  return { lockfilePath, lockfile };
}

export function verifyVaccineLockfile(rawJson: string): VaccineVerificationReport {
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      valid: false,
      schemaVersion: null,
      antibodyCount: 0,
      expectedHash: null,
      actualHash: null,
      reason: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    return {
      valid: false,
      schemaVersion: null,
      antibodyCount: 0,
      expectedHash: null,
      actualHash: null,
      reason: 'Lockfile root must be a JSON object',
    };
  }

  const parsed = rawParsed as Partial<VaccineLockfile>;
  if (
    parsed.schemaVersion !== '3.0.0' ||
    !parsed.dna ||
    typeof parsed.dna !== 'object' ||
    Array.isArray(parsed.dna) ||
    !Array.isArray(parsed.dna.detectedMarkers) ||
    !Array.isArray(parsed.dna.stacks) ||
    !Array.isArray(parsed.dna.recommendedPacks) ||
    !Array.isArray(parsed.antibodies)
  ) {
    return {
      valid: false,
      schemaVersion: typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null,
      antibodyCount: Array.isArray(parsed.antibodies) ? parsed.antibodies.length : 0,
      expectedHash: typeof parsed.integrityHash === 'string' ? parsed.integrityHash : null,
      actualHash: null,
      reason: 'Missing schemaVersion 3.0.0, valid dna object, or antibodies array',
    };
  }

  for (const entry of parsed.antibodies) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.hash !== 'string' ||
      typeof entry.trigger_pattern !== 'string' ||
      !entry.trigger_pattern.trim() ||
      typeof entry.symptom !== 'string' ||
      typeof entry.prescription !== 'string' ||
      !entry.prescription.trim()
    ) {
      return {
        valid: false,
        schemaVersion: parsed.schemaVersion,
        antibodyCount: parsed.antibodies.length,
        expectedHash: typeof parsed.integrityHash === 'string' ? parsed.integrityHash : null,
        actualHash: null,
        reason: 'Malformed antibody entry in lockfile',
      };
    }
    if (entry.hash !== canonicalRuleHash(entry.prescription)) {
      return {
        valid: false,
        schemaVersion: parsed.schemaVersion,
        antibodyCount: parsed.antibodies.length,
        expectedHash: typeof parsed.integrityHash === 'string' ? parsed.integrityHash : null,
        actualHash: null,
        reason: `Per-rule prescription hash mismatch (${entry.hash})`,
      };
    }
    if (!isTeamShareSafe(entry)) {
      return {
        valid: false,
        schemaVersion: parsed.schemaVersion,
        antibodyCount: parsed.antibodies.length,
        expectedHash: typeof parsed.integrityHash === 'string' ? parsed.integrityHash : null,
        actualHash: null,
        reason: 'Lockfile contains an unsafe rule (local path, email, or secret literal)',
      };
    }
  }

  const actualHash = computeVaccineIntegrityHash(parsed.dna, parsed.antibodies);
  const valid = actualHash === parsed.integrityHash;
  return {
    valid,
    schemaVersion: parsed.schemaVersion,
    antibodyCount: parsed.antibodies.length,
    expectedHash: typeof parsed.integrityHash === 'string' ? parsed.integrityHash : null,
    actualHash,
    reason: valid ? 'Integrity verified (SHA-256 lockfile match)' : 'Integrity hash mismatch (lockfile tampered or drifted)',
  };
}

export function applyVaccineLockfile(
  store: TeamRuleImportStore,
  lockfile: VaccineLockfile,
): { readonly applied: number; readonly total: number } {
  let applied = 0;
  for (const ab of lockfile.antibodies) {
    if (!isTeamShareSafe(ab)) continue;
    const id = store.insert(
      {
        trigger_pattern: ab.trigger_pattern,
        symptom: ab.symptom,
        prescription: ab.prescription,
        tool_name: ab.tool_name,
        prescription_source: 'human',
        origin: 'team_sync',
      },
      { skipIfExists: true },
    );
    if (id !== null && id !== undefined) applied += 1;
  }
  return { applied, total: lockfile.antibodies.length };
}

export function renderVaccineTerminal(lockfile: VaccineLockfile, lockfilePath?: string): string {
  const ver = packageVersion();
  const dnaCount = lockfile.antibodies.filter((a) => a.origin === 'workspace-dna').length;
  const scarCount = lockfile.antibodies.filter((a) => a.origin === 'proven-scar').length;
  const lines: string[] = [
    `╔══════════════════════════════════════════════════════════════════════════╗`,
    `║  💉 AGENT IMMUNE v${ver} — WORKSPACE DNA & VACCINE LOCKFILE`.padEnd(75) + '║',
    `╚══════════════════════════════════════════════════════════════════════════╝`,
    `  Package Manager   : ${lockfile.dna.packageManager}`,
    `  Detected Markers  : ${lockfile.dna.detectedMarkers.join(', ') || '(none)'}`,
    `  Detected Stacks   : ${lockfile.dna.stacks.join(', ')}`,
    `  Recommended Packs : ${lockfile.dna.recommendedPacks.join(', ')}`,
    `  Locked Antibodies : ${lockfile.antibodies.length} (${dnaCount} DNA zero-day + ${scarCount} proven scars)`,
    `  Integrity SHA-256 : ${lockfile.integrityHash}`,
  ];
  if (lockfilePath) {
    lines.push(`  Lockfile Path     : ${lockfilePath}`);
  }
  lines.push('', '  Locked Zero-Shot Antibodies:');
  for (const ab of lockfile.antibodies.slice(0, 8)) {
    lines.push(
      `    • [${ab.origin}] ${ab.trigger_pattern}`,
      `      Rx: ${ab.prescription}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function renderVaccineMarkdown(lockfile: VaccineLockfile): string {
  const lines: string[] = [
    `### 💉 Workspace DNA & Vaccine Lockfile (\`v${lockfile.schemaVersion}\`)`,
    '',
    `- **Package Manager**: \`${lockfile.dna.packageManager}\``,
    `- **Detected Markers**: ${lockfile.dna.detectedMarkers.map((m) => `\`${m}\``).join(', ') || 'none'}`,
    `- **Recommended Seed Packs**: ${lockfile.dna.recommendedPacks.map((p) => `\`${p}\``).join(', ')}`,
    `- **Integrity SHA-256**: \`${lockfile.integrityHash}\``,
    '',
    '| Origin | Trigger Territory | Prescription |',
    '| :--- | :--- | :--- |',
    ...lockfile.antibodies.map((a) => {
      const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|');
      return `| \`${a.origin}\` | \`${clean(a.trigger_pattern)}\` | ${clean(a.prescription)} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
