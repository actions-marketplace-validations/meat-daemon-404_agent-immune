/**
 * v3.0 Cross-Project Swarm Federation & Antibody Consensus Engine (`immune federate`).
 *
 * Aggregates antibody libraries across multiple workspaces or coding agents
 * (Claude Code, Cursor, Codex, Gemini CLI, Windsurf), filters out local paths
 * and secrets via `isTeamShareSafe`, clusters semantically equivalent lessons,
 * and computes a Swarm Consensus Score (0-100) to promote corroborated rules
 * into Universal Swarm Laws.
 */
import type { DiagnosableRule } from './diagnose.js';
import { signals } from './relevance.js';
import { cjkBigrams } from './store/tokenize.js';
import { canonicalRuleHash, isTeamShareSafe } from './team-sync.js';
import { packageVersion } from './version.js';
import { escapeSvgText } from './wrapped.js';

export type SwarmConsensusTier = 'universal-law' | 'proven-tactic' | 'local-probation';

export interface SwarmRuleSource {
  readonly sourceId: string;
  readonly rules: ReadonlyArray<DiagnosableRule>;
}

export interface FederatedAntibodyCluster {
  readonly clusterHash: string;
  readonly trigger_pattern: string;
  readonly symptom: string;
  readonly prescription: string;
  readonly tool_name: string | null;
  readonly sources: ReadonlyArray<string>;
  readonly sourceCount: number;
  readonly totalHits: number;
  readonly totalFails: number;
  readonly survivalPct: number;
  readonly consensusScore: number;
  readonly tier: SwarmConsensusTier;
}

export interface SwarmFederationReport {
  readonly totalSources: number;
  readonly totalInputRules: number;
  readonly withheldUnsafe: number;
  readonly clusters: ReadonlyArray<FederatedAntibodyCluster>;
  readonly universalLaws: ReadonlyArray<FederatedAntibodyCluster>;
  readonly averageConsensusScore: number;
}

function normTokens(text: string): Set<string> {
  const out = new Set<string>(signals(text));
  for (const bg of cjkBigrams(text)) {
    out.add(bg);
  }
  return out;
}

function compatibleTools(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.toLowerCase() === b.toLowerCase();
}

function escapeMdCell(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|').trim();
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) {
    if (b.has(tok)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function federateSwarmRules(
  sources: ReadonlyArray<SwarmRuleSource>,
  opts: { similarityThreshold?: number; minConsensusScore?: number } = {},
): SwarmFederationReport {
  const simThreshold = opts.similarityThreshold ?? 0.52;
  const minConsensus = opts.minConsensusScore ?? 0;

  interface MutableCluster {
    hash: string;
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    tool_name: string | null;
    tokens: Set<string>;
    sources: Set<string>;
    totalHits: number;
    totalFails: number;
    bestHit: number;
  }

  const buckets: MutableCluster[] = [];
  let totalInputRules = 0;
  let withheldUnsafe = 0;

  for (const src of sources) {
    for (const r of src.rules) {
      if (r.status && r.status !== 'active') continue;
      totalInputRules += 1;
      if (!isTeamShareSafe(r)) {
        withheldUnsafe += 1;
        continue;
      }

      const h = canonicalRuleHash(r.prescription);
      const combTokens = normTokens(`${r.trigger_pattern} ${r.prescription}`);
      const hits = Math.max(0, r.hit_count ?? 0);
      const fails = Math.max(0, r.fail_count ?? 0);
      const ruleTool = r.tool_name ?? null;

      let matched: MutableCluster | null = null;
      for (const b of buckets) {
        if (!compatibleTools(b.tool_name, ruleTool)) continue;
        if (b.hash === h || jaccardSimilarity(b.tokens, combTokens) >= simThreshold) {
          matched = b;
          break;
        }
      }

      if (!matched) {
        buckets.push({
          hash: h,
          trigger_pattern: r.trigger_pattern.trim(),
          symptom: r.symptom.trim(),
          prescription: r.prescription.trim(),
          tool_name: r.tool_name ?? null,
          tokens: combTokens,
          sources: new Set([src.sourceId]),
          totalHits: hits,
          totalFails: fails,
          bestHit: hits,
        });
      } else {
        matched.sources.add(src.sourceId);
        matched.totalHits += hits;
        matched.totalFails += fails;
        for (const t of combTokens) matched.tokens.add(t);
        if (hits > matched.bestHit) {
          matched.bestHit = hits;
          matched.trigger_pattern = r.trigger_pattern.trim();
          matched.symptom = r.symptom.trim();
          matched.prescription = r.prescription.trim();
          matched.tool_name = r.tool_name ?? matched.tool_name;
          matched.hash = h;
        }
      }
    }
  }

  const clusters: FederatedAntibodyCluster[] = buckets
    .map((b) => {
      const sourceCount = b.sources.size;
      const deliveries = Math.max(b.totalHits, b.totalFails);
      const survivalPct =
        deliveries === 0 ? 100 : Math.max(0, Math.round(((deliveries - b.totalFails) / deliveries) * 100));
      const corroborationPts = Math.min(35, (sourceCount - 1) * 18 + 10);
      const survivalPts = Math.round((survivalPct / 100) * 45);
      const volumePts = Math.min(20, Math.round(Math.log2(b.totalHits + 1) * 5));
      const consensusScore = Math.max(10, Math.min(100, corroborationPts + survivalPts + volumePts));

      const tier: SwarmConsensusTier =
        sourceCount >= 2 && consensusScore >= 72
          ? 'universal-law'
          : consensusScore >= 55
            ? 'proven-tactic'
            : 'local-probation';

      return {
        clusterHash: b.hash,
        trigger_pattern: b.trigger_pattern,
        symptom: b.symptom,
        prescription: b.prescription,
        tool_name: b.tool_name,
        sources: [...b.sources].sort(),
        sourceCount,
        totalHits: b.totalHits,
        totalFails: b.totalFails,
        survivalPct,
        consensusScore,
        tier,
      };
    })
    .filter((c) => c.consensusScore >= minConsensus)
    .sort((a, b) => b.consensusScore - a.consensusScore || b.sourceCount - a.sourceCount || b.totalHits - a.totalHits);

  const universalLaws = clusters.filter((c) => c.tier === 'universal-law');
  const averageConsensusScore =
    clusters.length > 0
      ? Math.round(clusters.reduce((s, c) => s + c.consensusScore, 0) / clusters.length)
      : 0;

  return {
    totalSources: sources.length,
    totalInputRules,
    withheldUnsafe,
    clusters,
    universalLaws,
    averageConsensusScore,
  };
}

export function renderFederationTerminal(report: SwarmFederationReport): string {
  const ver = packageVersion();
  const lines: string[] = [
    `╔══════════════════════════════════════════════════════════════════════════╗`,
    `║  🐝 AGENT IMMUNE v${ver} — SWARM ANTIBODY FEDERATION & CONSENSUS`.padEnd(75) + '║',
    `╚══════════════════════════════════════════════════════════════════════════╝`,
    `  Swarm Sources Federated : ${report.totalSources} workspace/agent source(s)`,
    `  Input Antibodies        : ${report.totalInputRules} (${report.withheldUnsafe} withheld by privacy gate)`,
    `  Consolidated Clusters   : ${report.clusters.length} (${report.universalLaws.length} promoted to Universal Swarm Law)`,
    `  Mean Consensus Score    : ${report.averageConsensusScore}/100`,
    '',
    '  Federated Antibody Lineage:',
  ];

  if (report.clusters.length === 0) {
    lines.push('    (No share-safe antibodies met the consensus threshold yet.)');
  } else {
    for (const c of report.clusters.slice(0, 10)) {
      const badge =
        c.tier === 'universal-law'
          ? '🌐 UNIVERSAL LAW'
          : c.tier === 'proven-tactic'
            ? '🛡️ PROVEN TACTIC'
            : '🧪 PROBATION';
      lines.push(
        `    • [${badge} · Consensus ${c.consensusScore}/100 · ${c.sourceCount} src · ${c.totalHits} hits] ${c.trigger_pattern}`,
        `      Sources : ${c.sources.join(', ')}`,
        `      Rx      : ${c.prescription}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderFederationMarkdown(report: SwarmFederationReport): string {
  const ver = packageVersion();
  const rows =
    report.clusters.length > 0
      ? report.clusters.map(
          (c) =>
            `| \`${c.tier}\` | **${c.consensusScore}/100** | ${c.sources.map((s) => `\`${escapeMdCell(s)}\``).join(', ')} | ${c.survivalPct}% (${c.totalHits}h/${c.totalFails}f) | \`${escapeMdCell(c.trigger_pattern)}\` | ${escapeMdCell(c.prescription)} |`,
        )
      : ['| — | — | — | — | *(No clusters met threshold)* | — |'];
  const lines: string[] = [
    `### 🐝 Swarm Antibody Federation & Consensus Report (\`v${ver}\`)`,
    '',
    `- **Federated Sources**: **${report.totalSources}**`,
    `- **Input Rules**: \`${report.totalInputRules}\` (\`${report.withheldUnsafe}\` filtered by share-safety gate)`,
    `- **Universal Swarm Laws Promoted**: **${report.universalLaws.length}** / ${report.clusters.length} clusters`,
    `- **Mean Consensus Score**: **${report.averageConsensusScore}/100**`,
    '',
    '| Tier | Consensus | Sources | Survival | Trigger | Prescription |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows,
    '',
  ];
  return lines.join('\n');
}

export function renderFederationSvg(report: SwarmFederationReport): string {
  const ver = packageVersion();
  const top = report.clusters.slice(0, 4);
  const rowsSvg =
    top.length > 0
      ? top
          .map((c, idx) => {
            const y = 185 + idx * 56;
            const barWidth = Math.max(24, Math.round((c.consensusScore / 100) * 200));
            const color = c.tier === 'universal-law' ? '#10b981' : c.tier === 'proven-tactic' ? '#38bdf8' : '#f59e0b';
            return [
              `<rect x="36" y="${y}" width="808" height="46" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>`,
              `<text x="52" y="${y + 20}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">${escapeSvgText(c.trigger_pattern.slice(0, 42))}</text>`,
              `<text x="52" y="${y + 37}" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11">${escapeSvgText(c.prescription.slice(0, 68))}</text>`,
              `<rect x="610" y="${y + 16}" width="200" height="14" rx="7" fill="#0f172a"/>`,
              `<rect x="610" y="${y + 16}" width="${barWidth}" height="14" rx="7" fill="${color}"/>`,
              `<text x="820" y="${y + 27}" fill="${color}" font-family="ui-monospace, monospace" font-size="12" font-weight="700" text-anchor="end">${c.consensusScore}%</text>`,
            ].join('');
          })
          .join('')
      : `<rect x="36" y="185" width="808" height="60" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/><text x="440" y="220" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="13" text-anchor="middle">No corroborated swarm clusters yet — run immune team-sync across repositories first.</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="440" viewBox="0 0 880 440" role="img" aria-label="Agent Immune v${escapeSvgText(ver)} Swarm Federation Consensus">`,
    `<rect width="880" height="440" rx="16" fill="#0f172a"/>`,
    `<rect x="16" y="16" width="848" height="408" rx="12" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>`,
    `<text x="36" y="54" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700" letter-spacing="1.5">AGENT-IMMUNE V${escapeSvgText(ver.toUpperCase())} · SWARM ANTIBODY FEDERATION</text>`,
    `<text x="36" y="86" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="800">${report.universalLaws.length} Universal Swarm Laws · ${report.averageConsensusScore}/100 Mean Consensus</text>`,
    `<text x="36" y="114" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="13">Federated across ${report.totalSources} source(s) · ${report.totalInputRules} input antibodies · ${report.withheldUnsafe} local/secret rules withheld</text>`,
    `<line x1="36" y1="136" x2="844" y2="136" stroke="#1e293b" stroke-width="1.5"/>`,
    `<text x="36" y="164" fill="#cbd5e1" font-family="ui-monospace, monospace" font-size="12" font-weight="700">TOP CORROBORATED SWARM ANTIBODY CLUSTERS</text>`,
    rowsSvg,
    `</svg>`,
  ].join('');
}
