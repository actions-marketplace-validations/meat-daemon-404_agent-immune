/**
 * Whole-disk project & pitfall corpus ingestion engine (v2).
 *
 * Discovers real repositories, DSH plugins, skills, and engineering contracts
 * across local drives (e.g. `D:\`), profiles their tech stacks and Baselines,
 * extracts verified pitfalls/decisions/triage rules, redacts secrets and machine
 * paths, and stores project-local rules strictly under their own `project_scope`
 * while promoting universal skills (`SKILL.md` / `daily-patrol` / `codex-skills`)
 * into shared on-demand recall.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { detectProjectBaselineDetail } from './baseline.js';
import { abstractMachinePaths, classifyRuleQuality, deriveProjectScope } from './hygiene.js';
import { detectStacks } from './prewarm.js';
import { redactOutbound } from './redact.js';
import { inferRootCause } from './rubric.js';
import { parseSkillMarkdown } from './skill-ingest.js';
import type { ImmuneStore } from './store/index.js';
import type { NewAntibody, WorkspaceProfile } from './types.js';

export interface DiskIngestOptions {
  roots?: string[];
  maxDepth?: number;
  maxProjects?: number;
  maxRulesPerProject?: number;
  dryRun?: boolean;
  includeCodexSkills?: boolean;
}

export interface DiscoveredRepo {
  scopeId: string;
  name: string;
  rootPath: string;
  kind: 'skill' | 'dsh-plugin' | 'monorepo' | 'app';
  stacks: string[];
  baseline: string;
  extractedRules: NewAntibody[];
}

export interface DiskIngestReport {
  roots: string[];
  projectsScanned: number;
  profilesRecorded: number;
  rulesExtracted: number;
  rulesInserted: number;
  universalRules: number;
  scopedRules: number;
  skippedLowQuality: number;
  dryRun: boolean;
  projects: Array<{
    name: string;
    scopeId: string;
    kind: string;
    stacks: string[];
    rules: number;
    path: string;
  }>;
}

const SKIP_DIR_RE =
  /^(?:\.git|node_modules|\.venv|venv|__pycache__|dist|build|\.next|\.turbo|\.pnpm-store|target|out|coverage|\$RECYCLE\.BIN|System Volume Information|VMs|Windows|Program Files|x64|OVFTool|nmap|WPS Office|Resources|tmp|BaiduNetdiskDownload|download|Microsoft VS Code|Unity|UU远程|Tencent|微信web开发者工具|腾讯会议|QQ Agent.*|.*急救班.*|.*精听班.*|workbuddy|messages|ico|safe|wcheck|wd|tools-upgraders|CC-Switch.*|_apkcheck.*|_bundle_verify|_pubverify|_remote_head|_synchk|_trash|_verify_clone|ghp_trash.*|sm_?build.*|smbuild.*|build_.*|wt_.*|\.\w+)$/i;

const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'SKILL.md',
  'AGENTS.md',
  'CLAUDE.md',
  'project.config.json',
  'cordis.patch.yml',
];

function isProjectRoot(dir: string): boolean {
  return PROJECT_MARKERS.some((m) => existsSync(join(dir, m))) || existsSync(join(dir, '.git'));
}

function detectExtendedStacks(dir: string): string[] {
  const base = new Set(detectStacks(dir));
  if (existsSync(join(dir, 'cordis.patch.yml'))) base.add('dsh-plugin');
  if (existsSync(join(dir, 'wrangler.jsonc')) || existsSync(join(dir, 'wrangler.toml'))) base.add('cloudflare');
  if (existsSync(join(dir, 'project.config.json'))) base.add('miniprogram');
  if (existsSync(join(dir, 'SKILL.md'))) base.add('agent-skill');
  try {
    const pkgRaw = readFileSync(join(dir, 'package.json'), 'utf8');
    if (pkgRaw.includes('"dsh"')) base.add('dsh-plugin');
    if (pkgRaw.includes('electron')) base.add('electron');
    if (pkgRaw.includes('playwright')) base.add('playwright');
  } catch {
    // ignore
  }
  return [...base];
}

function stripGeneratedImmuneBlock(md: string): string {
  return md.replace(/<!--\s*immune:generated start\s*-->[\s\S]*?<!--\s*immune:generated end\s*-->/gi, '');
}

const ACTIONABLE_RULE_SIGNAL =
  /\b(?:never|don'?t|do not|must|always|avoid|use|prefer|ensure|check|run|keep|only|fail|error|warn|block|skip|backup|retry|sanitize|redact|isolate|verify|guard|timeout|cache|import|export|build|test)\b|禁止|不要|切勿|必须|务必|避免|改用|先|仅|红线|规范|失败|报错|超时|泄漏|污染|校验|隔离|分诊|回执/i;

/**
 * Extract structured pitfall/invariant rules from AGENTS.md, CLAUDE.md,
 * REWRITE-NOTES.md, triage.md, or README.md troubleshooting sections.
 */
export function extractEngineeringRules(
  md: string,
  opts: { projectName: string; rootPath: string; scopeId: string; universal: boolean; isSkill?: boolean },
): NewAntibody[] {
  const cleanMd = stripGeneratedImmuneBlock(md);
  const rules: NewAntibody[] = [];
  const seen = new Set<string>();

  const pushRule = (triggerRaw: string, symptomRaw: string, prescriptionRaw: string) => {
    const rawP = prescriptionRaw.trim();
    if (/^(?:#{1,6}\s|>\s|<!--)/.test(rawP)) return;
    if (!ACTIONABLE_RULE_SIGNAL.test(`${symptomRaw} ${rawP}`)) return;

    const trigger = abstractMachinePaths(redactOutbound(triggerRaw), opts.rootPath)
      .replace(/[*`#|>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    const symptom = abstractMachinePaths(redactOutbound(symptomRaw), opts.rootPath)
      .replace(/[*`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    const prescription = abstractMachinePaths(redactOutbound(prescriptionRaw), opts.rootPath)
      .replace(/[*`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (trigger.length < 6 || symptom.length < 8 || prescription.length < 12) return;
    const key = prescription.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const candidate: NewAntibody = {
      trigger_pattern: trigger,
      symptom,
      prescription,
      tool_name: null,
      origin: 'disk_corpus',
      prescription_source: 'human',
      project_scope: opts.universal ? '*' : opts.scopeId,
      root_cause: inferRootCause(symptom, prescription),
    };
    const verdict = classifyRuleQuality(candidate);
    if (verdict.grade === 'quarantined') return;
    candidate.quality_grade = verdict.grade;
    candidate.rubric_score = verdict.score;
    rules.push(candidate);
  };

  // 1. Only use parseSkillMarkdown on dedicated skill/triage files, never generic marketing READMEs.
  if (opts.isSkill) {
    const parsedSkill = parseSkillMarkdown(cleanMd);
    for (const r of parsedSkill.rules) {
      pushRule(`${opts.projectName} ${r.trigger_pattern}`, r.symptom, r.prescription);
    }
  }

  // 2. Parse numbered bold decisions/invariants (e.g. "1. **Title.** explanation..." or "- **Title**：...")
  const lines = cleanMd.split(/\r?\n/);
  let inRelevantSection = true;
  let currentHeading = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch?.[2]) {
      currentHeading = headingMatch[2].trim();
      inRelevantSection =
        /decision|invariant|limit|pitfall|triage|判例|分诊|坑|规范|红线|架构|contract|rewrite|差异|问题|教训|注意/i.test(
          currentHeading,
        );
      continue;
    }

    // Markdown comparison tables: | Bad / 原版 | Fix / 新版 |
    if (line.trim().startsWith('|') && inRelevantSection) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2 && !/^[-:]+$/.test(cells[0] ?? '') && !/^(?:原版|症状|问题|symptom|bad|old)/i.test(cells[0] ?? '')) {
        const left = cells[0] ?? '';
        const right = cells[1] ?? '';
        if (left.length >= 8 && right.length >= 8) {
          pushRule(`${opts.projectName} ${currentHeading} ${left.slice(0, 48)}`, left, right);
        }
      }
      continue;
    }

    // Bold numbered or bulleted invariant: `1. **Rule title.** body...` or `- **Rule title** — body`
    if (!inRelevantSection && !/^\s*(?:\d+\.|-|\*)\s+\*\*[^*]{4,80}\*\*/.test(line)) continue;
    const bulletMatch = line.match(/^\s*(?:\d+\.|-|\*)\s+\*\*([^*]{4,90})\*\*[:：\s.\-—]*(.*)$/);
    if (bulletMatch?.[1]) {
      const title = bulletMatch[1].trim().replace(/[。.]+$/, '');
      let detail = (bulletMatch[2] ?? '').trim();
      // Collect up to 2 continuation lines of the same paragraph.
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j += 1) {
        const next = (lines[j] ?? '').trim();
        if (!next || /^(?:#|\d+\.|-|\*|\||```)/.test(next)) break;
        detail = detail ? `${detail} ${next}` : next;
      }
      if (detail.length >= 12) {
        const sentences = detail.split(/(?<=[。.!?；;])\s+/);
        const symptom = sentences[0] ?? title;
        const prescription = sentences.slice(1).join(' ').trim() || detail;
        pushRule(`${opts.projectName} ${currentHeading} ${title}`, `${title}: ${symptom}`, prescription);
      }
    }
  }

  return rules;
}

function collectProjectDocs(dir: string): Array<{ file: string; universal: boolean; isSkill: boolean }> {
  const candidates: Array<{ rel: string; universal: boolean; isSkill: boolean }> = [
    { rel: 'SKILL.md', universal: true, isSkill: true },
    { rel: 'references/triage.md', universal: true, isSkill: true },
    { rel: 'AGENTS.md', universal: false, isSkill: false },
    { rel: 'CLAUDE.md', universal: false, isSkill: false },
    { rel: 'docs/REWRITE-NOTES.md', universal: false, isSkill: false },
    { rel: 'README.md', universal: false, isSkill: false },
  ];
  const out: Array<{ file: string; universal: boolean; isSkill: boolean }> = [];
  for (const c of candidates) {
    const full = join(dir, c.rel);
    if (!existsSync(full)) continue;
    try {
      const st = statSync(full);
      if (st.isFile() && st.size <= 256 * 1024) {
        out.push({ file: full, universal: c.universal, isSkill: c.isSkill });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

/** Discover projects under `roots` safely without entering build/cache/binary trees. */
export function discoverDiskProjects(
  roots: string[],
  opts: { maxDepth?: number; maxProjects?: number; includeCodexSkills?: boolean } = {},
): DiscoveredRepo[] {
  const maxDepth = opts.maxDepth ?? 3;
  const maxProjects = opts.maxProjects ?? 300;
  const includeCodexSkills = opts.includeCodexSkills ?? true;
  const seenPaths = new Set<string>();
  const repos: DiscoveredRepo[] = [];

  const walk = (dir: string, depth: number) => {
    if (repos.length >= maxProjects || depth > maxDepth) return;
    const norm = resolve(dir).replace(/\\/g, '/').toLowerCase();
    if (seenPaths.has(norm)) return;

    const name = basename(dir);
    if (depth > 0 && SKIP_DIR_RE.test(name)) return;
    if (!includeCodexSkills && /codex-skills/i.test(norm)) return;

    if (depth > 0 && isProjectRoot(dir)) {
      seenPaths.add(norm);
      const stacks = detectExtendedStacks(dir);
      const baseline = detectProjectBaselineDetail(dir).level;
      const scopeId = deriveProjectScope(dir);
      const kind: DiscoveredRepo['kind'] = existsSync(join(dir, 'SKILL.md'))
        ? 'skill'
        : stacks.includes('dsh-plugin')
          ? 'dsh-plugin'
          : existsSync(join(dir, 'apps')) || existsSync(join(dir, 'packages'))
            ? 'monorepo'
            : 'app';

      const docs = collectProjectDocs(dir);
      const extractedRules: NewAntibody[] = [];
      for (const doc of docs) {
        try {
          const text = readFileSync(doc.file, 'utf8');
          extractedRules.push(
            ...extractEngineeringRules(text, {
              projectName: name,
              rootPath: dir,
              scopeId,
              universal: doc.universal && kind === 'skill',
              isSkill: doc.isSkill,
            }),
          );
        } catch {
          // ignore unreadable doc
        }
      }

      repos.push({
        scopeId,
        name,
        rootPath: resolve(dir),
        kind,
        stacks,
        baseline,
        extractedRules,
      });
      // Do not descend inside a regular app repo (only descend into organizational folders
      // like D:\Project, D:\大创, D:\codex-skills, D:\deepseek harness project).
      if (kind !== 'monorepo' && !/^(?:project|codex-skills|deepseek harness project|大创|数学建模大赛agent|安全渗透测试|ai\+信息素养大赛|智阅矩阵scholarmatrix)$/i.test(name)) {
        return;
      }
    }

    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIR_RE.test(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };

  for (const root of roots) {
    if (existsSync(root)) walk(resolve(root), 0);
  }
  return repos;
}

/**
 * Ingest discovered workspace profiles and scoped/universal engineering pitfalls
 * across local roots into the immune store.
 */
export function ingestDiskCorpus(
  store: ImmuneStore,
  opts: DiskIngestOptions = {},
): DiskIngestReport {
  const roots = opts.roots && opts.roots.length > 0 ? opts.roots : ['D:\\'];
  const maxRulesPerProject = opts.maxRulesPerProject ?? 12;
  const dryRun = opts.dryRun === true;
  const repos = discoverDiskProjects(roots, {
    maxDepth: opts.maxDepth ?? 3,
    maxProjects: opts.maxProjects ?? 150,
    includeCodexSkills: opts.includeCodexSkills ?? true,
  });

  let rulesExtracted = 0;
  let rulesInserted = 0;
  let universalRules = 0;
  let scopedRules = 0;
  let skippedLowQuality = 0;
  let profilesRecorded = 0;

  const projects: DiskIngestReport['projects'] = [];
  const now = Date.now();

  for (const repo of repos) {
    const picked = repo.extractedRules.slice(0, maxRulesPerProject);
    rulesExtracted += picked.length;
    for (const rule of picked) {
      if ((rule.rubric_score ?? 0) < 55) {
        skippedLowQuality += 1;
        continue;
      }
      if (rule.project_scope === '*') universalRules += 1;
      else scopedRules += 1;
      if (!dryRun) {
        const id = store.insertShared(rule, {
          generic: rule.project_scope === '*',
          humanHint: true,
        });
        if (id !== null) rulesInserted += 1;
      }
    }

    if (!dryRun) {
      const profile: WorkspaceProfile = {
        scope_id: repo.scopeId,
        name: repo.name,
        root_path: abstractMachinePaths(repo.rootPath),
        stack: repo.stacks.join(','),
        baseline: repo.baseline,
        rules_count: picked.length,
        source: repo.kind,
        last_scanned_at: now,
      };
      store.upsertWorkspaceProfile(profile);
      profilesRecorded += 1;
    }

    projects.push({
      name: repo.name,
      scopeId: repo.scopeId,
      kind: repo.kind,
      stacks: repo.stacks,
      rules: picked.length,
      path: repo.rootPath,
    });
  }

  return {
    roots,
    projectsScanned: repos.length,
    profilesRecorded,
    rulesExtracted,
    rulesInserted,
    universalRules,
    scopedRules,
    skippedLowQuality,
    dryRun,
    projects,
  };
}
