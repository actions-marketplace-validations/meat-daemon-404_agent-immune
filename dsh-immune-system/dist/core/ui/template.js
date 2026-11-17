import { maskHomePaths } from '../redact.js';
export function esc(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export function formatBudget(ms) {
    if (ms >= 1000) {
        const seconds = ms / 1000;
        return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
    }
    return `${Math.round(ms)} ms`;
}
export function evoStrip(evo, t) {
    const maxWeek = Math.max(1, ...evo.newRules, ...evo.episodes);
    const bars = (values) => values
        .map((value) => {
        const pct = Math.round((value / maxWeek) * 100);
        return `<i style="height:${pct}%"${value > 0 ? ` data-n="${value}"` : ''}></i>`;
    })
        .join('');
    const counters = [
        [t.evoLineage, evo.lineage],
        [t.evoOrigins, evo.fromUserCorrection],
        [t.evoDetours, evo.detours],
    ];
    const note = evo.probation > 0 || evo.supersededByEnv > 0
        ? ` · ${evo.probation} probation · ${evo.supersededByEnv} superseded-by-env`
        : '';
    return (`<div class="evo" role="group" aria-label="${esc(t.evoTitle)}">` +
        `<div class="evo-h"><b>${esc(t.evoTitle)}</b><span>${esc(t.evoNew)} ${evo.newRules.reduce((a, b) => a + b, 0)} · ${esc(t.evoEpisodes)} ${evo.episodes.reduce((a, b) => a + b, 0)}${esc(note)}</span></div>` +
        `<div class="evo-bars">` +
        `<div class="evo-col">${bars(evo.newRules)}</div>` +
        `<div class="evo-col alt">${bars(evo.episodes)}</div>` +
        `</div>` +
        `<div class="evo-f"><span>${counters.map(([label, value]) => `${label} ${value}`).join(' · ')}</span><span class="evo-note">${esc(t.evoNote)}</span></div>` +
        `</div>`);
}
export function renderHtmlShell(params) {
    const { locale, dbPath, token, css, labels: t, evolution, script } = params;
    const maskedPath = maskHomePaths(dbPath);
    return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark light">
<title>${esc(t.title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="mark" aria-hidden="true"></div>
    <div class="titles">
      <h1>${esc(t.title)}</h1>
      <div class="sub">${esc(t.subtitle)}</div>
    </div>
    <div class="meta">
      <span class="chip" title="${esc(maskedPath)}"><span class="dot"></span>${esc(t.localOnly)}<code>${esc(maskedPath)}</code></span>
    </div>
  </div>

  <div class="kpis" id="kpis" aria-live="polite"></div>
  ${evolution ? evoStrip(evolution, t) : ''}
  <div class="strip" id="byModel" hidden></div>
  <div class="strip" id="insights" hidden></div>

  <div class="toolbar">
    <div class="search">
      <span class="glass" aria-hidden="true"></span>
      <input id="q" type="search" placeholder="${esc(t.search)}" autocomplete="off" spellcheck="false" aria-label="${esc(t.search)}">
      <button class="clear" id="clear" type="button" title="${esc(t.clear)}" aria-label="${esc(t.clear)}">×</button>
    </div>
    <div class="seg" role="tablist">
      <button role="tab" class="on" id="tabProject" aria-selected="true">${esc(t.tabsProject)}<b id="nProject"></b></button>
      <button role="tab" id="tabShared" aria-selected="false">${esc(t.tabsShared)}<b id="nShared"></b></button>
      <button role="tab" id="tabQuarantined" aria-selected="false">${esc(t.tabsQuarantined)}<b id="nQuarantined"></b></button>
      <button role="tab" id="tabWorkspaces" aria-selected="false">${esc(t.tabsWorkspaces)}<b id="nWorkspaces"></b></button>
    </div>
    <label class="select">
      <select id="sort" aria-label="${esc(t.sort)}">
        <option value="recent">${esc(t.sortRecent)}</option>
        <option value="rubric">${esc(t.sortRubric)}</option>
        <option value="hits">${esc(t.sortHits)}</option>
        <option value="fails">${esc(t.sortFails)}</option>
      </select>
    </label>
    <button class="act" id="hygieneBtn" type="button">${esc(t.hygieneLabel)}</button>
    <a class="act" id="exportMd" href="/api/export?format=md&t=${esc(token)}" download="immune-library.md">${esc(t.exportLabel)}</a>
    <label class="act" id="importWrap">${esc(t.importLabel)}<input id="importFile" type="file" accept=".json,application/json" style="display:none"></label>
  </div>

  <div class="panel">
    <div class="meta-row"><span id="count"></span><span id="budget"></span></div>
    <div id="body"></div>
  </div>

  <footer>${esc(t.browseNote)}<span class="sep">·</span>${esc(t.localOnly)}</footer>
</div>
<div id="toast" role="status" aria-live="polite"></div>
${script}
</body>
</html>`;
}
