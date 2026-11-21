/**
 * Embedded browser controller script for the standalone dashboard.
 * Uses plain ES5 syntax and string concatenation so nothing resembles template
 * interpolation (`AGENTS.md #14`). Zero external network calls.
 */
import type { Labels } from './labels.js';

export function renderClientScript(
  token: string,
  t: Labels,
  budget: string,
): string {
  const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<script>
(function () {
  var TOKEN = ${safeJson(token)};
  var T = ${safeJson(t)};
  var BUDGET = ${safeJson(budget)};
  var BUDGET_HINT = ${safeJson(t.budgetHint)};

  var kpisEl = document.getElementById('kpis');
  var byModelEl = document.getElementById('byModel');
  var insightsEl = document.getElementById('insights');
  var bodyEl = document.getElementById('body');
  var countEl = document.getElementById('count');
  var budgetEl = document.getElementById('budget');
  var qEl = document.getElementById('q');
  var clearEl = document.getElementById('clear');
  var sortEl = document.getElementById('sort');
  var toastEl = document.getElementById('toast');
  var tabProject = document.getElementById('tabProject');
  var tabShared = document.getElementById('tabShared');
  var tabQuarantined = document.getElementById('tabQuarantined');
  var tabWorkspaces = document.getElementById('tabWorkspaces');
  var tabExplain = document.getElementById('tabExplain');
  var tabGuard = document.getElementById('tabGuard');
  var tabInsights = document.getElementById('tabInsights');
  var hygieneBtn = document.getElementById('hygieneBtn');
  var nProject = document.getElementById('nProject');
  var nShared = document.getElementById('nShared');
  var nQuarantined = document.getElementById('nQuarantined');
  var nWorkspaces = document.getElementById('nWorkspaces');
  var nGuard = document.getElementById('nGuard');
  var tab = 'project';
  var guardState = { payload: '', tool: 'Bash', strict: false, verdict: null, events: null };
  var timer = null;
  var toastTimer = null;
  var seq = 0;

  function api(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 't=' + encodeURIComponent(TOKEN); }

  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.className = bad ? 'show bad' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = bad ? 'bad' : ''; }, 2200);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderByModel(rows, cross) {
    byModelEl.textContent = '';
    var known = rows.filter(function (r) { return r.model !== 'unknown'; });
    if (known.length === 0 && cross === 0) {
      byModelEl.hidden = true;
      return;
    }
    byModelEl.hidden = false;
    byModelEl.appendChild(el('span', 'lbl', T.byModel));
    known.slice(0, 6).forEach(function (r) {
      var chip = el('span', 'chip');
      var survival = r.hits > 0 ? Math.round((Math.max(0, r.hits - r.fails) * 100) / r.hits) : 100;
      chip.setAttribute('data-bad', r.fails > 0 ? '1' : '0');
      chip.appendChild(document.createTextNode(r.model + ' ' + r.hits + ' (' + survival + '%)'));
      if (r.fails > 0) chip.appendChild(el('span', 'x', '✗' + r.fails));
      chip.setAttribute('title', r.model + ': ' + r.hits + ' delivery(ies), ' + survival + '% held over ' + r.rules + ' rule(s)');
      byModelEl.appendChild(chip);
    });
    if (cross > 0) {
      byModelEl.appendChild(el('span', 'chip proof', T.crossModel + ' ' + cross));
    }
  }

  function renderInsights(s) {
    insightsEl.textContent = '';
    var triage = s.triage;
    var receipts = s.receipts;
    var gw = s.gateway;
    var hasTriage = triage && triage.totalEvents > 0;
    var hasReceipts = receipts && receipts.total > 0;
    var hasGateway = gw && gw.present;
    if (!hasTriage && !hasReceipts && !hasGateway) {
      insightsEl.hidden = true;
      return;
    }
    insightsEl.hidden = false;
    if (hasTriage) {
      insightsEl.appendChild(el('span', 'lbl', T.triageTitle));
      Object.keys(triage.byBucket || {}).forEach(function (k) {
        var count = triage.byBucket[k];
        if (count > 0) insightsEl.appendChild(el('span', 'chip', k + ': ' + count));
      });
    }
    if (hasReceipts) {
      insightsEl.appendChild(el('span', 'lbl', T.receiptsLabel));
      var cls = receipts.chainValid ? 'chip proof' : 'chip bad';
      var status = receipts.chainValid ? T.chainVerified : T.chainBroken;
      insightsEl.appendChild(el('span', cls, receipts.total + ' · ' + status));
    }
    if (hasGateway) {
      insightsEl.appendChild(el('span', 'lbl', 'Magpie'));
      insightsEl.appendChild(
        el(
          'span',
          'chip proof',
          gw.routingRequests + ' req · cache ' + gw.cacheHitRatePct + '% · retry+' + gw.retryRecovered,
        ),
      );
    }
  }

  function renderStats(s) {
    kpisEl.textContent = '';
    var cards = [
      [s.active, T.activeCount, 'ok'],
      [s.retired, T.retiredCount, 'warn'],
      [s.hits, T.injections, 'accent'],
      [s.shared, T.sharedCount, 'plain'],
    ];
    if ((s.quarantined || 0) > 0) {
      cards.push([s.quarantined, T.quarantinedCount, 'bad']);
    }
    if ((s.avgRubric || 0) > 0) {
      cards.push([s.avgRubric + '/100', T.avgRubric, s.avgRubric >= 60 ? 'ok' : 'warn']);
    }
    cards.forEach(function (c) {
      var card = el('div', 'kpi');
      if (c[2] !== 'plain') card.setAttribute('data-tone', c[2]);
      card.appendChild(el('div', 'v', String(c[0])));
      card.appendChild(el('div', 'k', c[1]));
      kpisEl.appendChild(card);
    });

    var budgetCard = el('div', 'kpi');
    budgetCard.setAttribute('data-tone', 'plain');
    budgetCard.appendChild(el('div', 'v', BUDGET));
    budgetCard.appendChild(el('div', 'k', T.budget));
    budgetCard.setAttribute('title', BUDGET_HINT);
    kpisEl.appendChild(budgetCard);
    budgetEl.textContent = T.budget + ' ' + BUDGET;
    budgetEl.setAttribute('title', BUDGET_HINT);

    var interceptedCard = el('div', 'kpi');
    interceptedCard.setAttribute('data-tone', 'plain');
    interceptedCard.appendChild(el('div', 'v', String(s.suppressedRepeats || 0)));
    interceptedCard.appendChild(el('div', 'k', T.intercepted));
    kpisEl.appendChild(interceptedCard);

    var fails = s.fails || 0;
    var keptCard = el('div', 'kpi');
    keptCard.setAttribute('data-tone', fails > 0 ? 'warn' : 'ok');
    keptCard.appendChild(el('div', 'v', String(Math.max(0, (s.hits || 0) - fails))));
    keptCard.appendChild(el('div', 'k', T.heldUp));
    kpisEl.appendChild(keptCard);

    var storageCard = el('div', 'kpi');
    storageCard.setAttribute('data-tone', 'plain');
    storageCard.appendChild(el('div', 'v', s.dbBytes != null ? Math.max(1, Math.round(s.dbBytes / 1024)) + ' KiB' : '—'));
    storageCard.appendChild(el('div', 'k', T.storage));
    storageCard.setAttribute('title', s.sessions + ' sessions · ' + s.jobsTotal + ' jobs (' + s.jobsPending + ' queued)');
    kpisEl.appendChild(storageCard);

    if ((s.llmDistilled || 0) + (s.llmFallbacks || 0) > 0) {
      var modelCard = el('div', 'kpi');
      modelCard.setAttribute('data-tone', s.llmFallbacks > 0 ? 'warn' : 'plain');
      modelCard.appendChild(el('div', 'v', String(s.llmDistilled || 0)));
      modelCard.appendChild(el('div', 'k', T.modelRules));
      kpisEl.appendChild(modelCard);
    }

    renderByModel(s.byModel || [], s.crossModelRules || 0);
    renderInsights(s);

    nProject.textContent = String(s.active + s.retired);
    nShared.textContent = String(s.shared);
    if (nQuarantined) nQuarantined.textContent = String(s.quarantined || 0);
    if (nWorkspaces) nWorkspaces.textContent = String(s.workspaces || 0);
    if (nGuard) nGuard.textContent = String(s.guardInterceptions || 0);
  }

  function sortRows(list) {
    var mode = sortEl.value;
    var copy = list.slice();
    copy.sort(function (a, b) {
      if (mode === 'hits') return (b.hit_count - a.hit_count) || (a.id - b.id);
      if (mode === 'fails') return (b.fail_count - a.fail_count) || (a.id - b.id);
      if (mode === 'rubric') return ((b.rubric_score || 0) - (a.rubric_score || 0)) || (b.hit_count - a.hit_count);
      return ((Number(b.updated_at) || 0) - (Number(a.updated_at) || 0)) || (b.id - a.id);
    });
    return copy;
  }

  function renderSkeleton() {
    bodyEl.textContent = '';
    var sk = el('div', 'skel');
    for (var i = 0; i < 4; i += 1) {
      var r = el('div', 'r');
      for (var j = 0; j < 4; j += 1) r.appendChild(el('div', 'b'));
      sk.appendChild(r);
    }
    bodyEl.appendChild(sk);
  }

  function cell(label, cls, build) {
    var td = el('td', cls);
    td.setAttribute('data-label', label);
    build(td);
    return td;
  }

  function renderEmpty(titleText, hintText) {
    var empty = el('div', 'empty');
    empty.appendChild(el('div', 'glyph'));
    empty.appendChild(el('div', 't', titleText));
    empty.appendChild(el('div', 'h', hintText));
    bodyEl.appendChild(empty);
  }

  function renderWorkspaces(list) {
    bodyEl.textContent = '';
    countEl.textContent = list.length + ' ' + T.results;
    if (list.length === 0) {
      renderEmpty(T.noWorkspaces, T.noWorkspacesHint);
      return;
    }
    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    [T.wsScope, T.wsRoot, T.wsStacks, T.wsRules].forEach(function (lbl) { hr.appendChild(el('th', '', lbl)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    list.forEach(function (w) {
      var tr = el('tr');
      var scopeId = w.scope_id || w.project_scope || '—';
      var rootPath = w.root_path || w.repo_root || '—';
      var stackStr = typeof w.stack === 'string' && w.stack ? w.stack : Array.isArray(w.stacks) ? w.stacks.join(', ') : '—';
      tr.appendChild(cell(T.wsScope, 'trigger', function (td) {
        if (w.name) td.appendChild(el('div', '', w.name));
        var scopeChip = el('span', 'tag link', scopeId);
        scopeChip.onclick = function () {
          qEl.value = 'scope:' + scopeId;
          syncClear();
          selectTab('project');
        };
        td.appendChild(scopeChip);
      }));
      tr.appendChild(cell(T.wsRoot, 'text', function (td) {
        td.textContent = rootPath;
        if (w.baseline || w.source) {
          var meta = el('div', 'tags');
          if (w.source) meta.appendChild(el('span', 'tag', w.source));
          if (w.baseline) meta.appendChild(el('span', 'tag', 'baseline:' + w.baseline));
          td.appendChild(meta);
        }
      }));
      tr.appendChild(cell(T.wsStacks, 'text', function (td) { td.textContent = stackStr || '—'; }));
      tr.appendChild(cell(T.wsRules, 'counts', function (td) { td.appendChild(el('b', '', String(w.rules_count || 0))); }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bodyEl.appendChild(table);
  }

  function renderExplainView(initialQuery, data) {
    bodyEl.textContent = '';
    var box = el('div', 'explain-box');
    var row = el('div', 'explain-row');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = initialQuery;
    inp.placeholder = T.explainPrompt;
    var btn = el('button', 'act', T.explainButton);
    btn.type = 'button';
    var runSim = function () {
      var val = inp.value.trim();
      qEl.value = val;
      syncClear();
      loadExplain(val);
    };
    btn.onclick = runSim;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSim(); });
    row.appendChild(inp);
    row.appendChild(btn);
    box.appendChild(row);
    if (data && data.addedConcepts && data.addedConcepts.length > 0) {
      var cLine = el('div', 'tags');
      cLine.appendChild(el('span', 'tag hi', T.explainConcepts + data.addedConcepts.join(' ')));
      box.appendChild(cLine);
    }
    if (data && data.renderedBlock) {
      box.appendChild(el('div', 'tags').appendChild(el('span', 'tag', T.explainPreview)).parentNode);
      box.appendChild(el('pre', 'explain-preview', data.renderedBlock));
    }
    bodyEl.appendChild(box);
    if (!data || !initialQuery.trim()) {
      countEl.textContent = '0 ' + T.results;
      renderEmpty(T.tabsExplain, T.explainHint);
      return;
    }
    var list = data.candidates || [];
    countEl.textContent = list.length + ' ' + T.results;
    if (list.length === 0) {
      renderEmpty(T.explainNoMatch, T.explainHint);
      return;
    }
    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    ['#', T.colTrigger, T.colDo, T.explainScore].forEach(function (lbl) { hr.appendChild(el('th', '', lbl)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    list.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(cell('#', 'id', function (td) { td.textContent = (c.source === 'shared' ? 'S#' : '#') + c.id; }));
      tr.appendChild(cell(T.colTrigger, 'trigger', function (td) {
        td.textContent = c.trigger_pattern;
        var tags = el('div', 'tags');
        (c.matchedTokens || []).slice(0, 4).forEach(function (tk) { tags.appendChild(el('span', 'tag hi', tk)); });
        (c.matchedBigrams || []).slice(0, 4).forEach(function (bg) { tags.appendChild(el('span', 'tag', bg)); });
        if (tags.childNodes.length > 0) td.appendChild(tags);
      }));
      tr.appendChild(cell(T.colDo, 'text', function (td) { td.textContent = c.prescription; }));
      tr.appendChild(cell(T.explainScore, 'counts', function (td) {
        var b = c.breakdown || {};
        td.appendChild(el('b', '', String(b.finalScore != null ? b.finalScore : 0)));
        var parts = [
          'bm25=' + (b.baseRelevance != null ? b.baseRelevance : 0),
          'lex×' + (b.lexicalMultiplier != null ? b.lexicalMultiplier : 1),
          'rub×' + (b.rubricMultiplier != null ? b.rubricMultiplier : 1),
          'hit×' + (b.hitMultiplier != null ? b.hitMultiplier : 1),
        ];
        if (b.pathAffinityBoost != null && b.pathAffinityBoost !== 1) parts.push('path×' + b.pathAffinityBoost);
        if (b.timeDecay != null && b.timeDecay !== 1) parts.push('decay×' + b.timeDecay);
        td.appendChild(el('div', 'tags', '').appendChild(el('span', 'tag', parts.join(' '))).parentNode);
      }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bodyEl.appendChild(table);
  }

  function loadExplain(queryText) {
    var trimmed = (queryText || '').trim();
    if (!trimmed) {
      renderExplainView('', null);
      return;
    }
    var mine = ++seq;
    renderSkeleton();
    fetch(api('/api/explain?q=' + encodeURIComponent(trimmed)), { headers: { 'accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        if (mine !== seq) return;
        renderExplainView(trimmed, data);
      })
      .catch(function (err) {
        if (mine !== seq) return;
        bodyEl.textContent = '';
        renderEmpty(T.loadFailed, String((err && err.message) || err));
      });
  }

  function renderGuardView() {
    bodyEl.textContent = '';
    var box = el('div', 'explain-box');
    var row = el('div', 'explain-row');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = guardState.payload;
    inp.placeholder = T.guardPrompt;
    var toolSel = document.createElement('select');
    ['Bash', 'Edit', 'Write'].forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (guardState.tool === name) opt.selected = true;
      toolSel.appendChild(opt);
    });
    var strictLbl = el('label', 'v4-check');
    var strictChk = document.createElement('input');
    strictChk.type = 'checkbox';
    strictChk.checked = guardState.strict;
    strictLbl.appendChild(strictChk);
    strictLbl.appendChild(document.createTextNode(T.guardStrict));
    var btn = el('button', 'act', T.guardButton);
    btn.type = 'button';
    var runEval = function () {
      guardState.payload = inp.value;
      guardState.tool = toolSel.value;
      guardState.strict = strictChk.checked;
      if (!guardState.payload.trim()) return;
      btn.disabled = true;
      fetch(api('/api/guard'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ payload: guardState.payload, toolName: guardState.tool, strict: guardState.strict }),
      })
        .then(function (r) { return r.json(); })
        .then(function (v) {
          if (v.error) { toast(v.error, true); return; }
          guardState.verdict = v;
          if (tab === 'guard') renderGuardView();
        })
        .catch(function () { toast(T.loadFailed, true); })
        .then(function () { btn.disabled = false; });
    };
    btn.onclick = runEval;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') runEval(); });
    row.appendChild(inp);
    row.appendChild(toolSel);
    row.appendChild(strictLbl);
    row.appendChild(btn);
    box.appendChild(row);

    var v = guardState.verdict;
    if (v) {
      var card = el('div', 'v4-verdict');
      var topTags = el('div', 'tags');
      var tone = v.decision === 'block' ? 'crit' : v.decision === 'allow' ? 'hi' : 'low';
      topTags.appendChild(el('span', 'tag ' + tone, String(v.decision || 'allow').toUpperCase()));
      topTags.appendChild(el('span', 'tag', 'blast ' + (v.blastRadiusScore || 0) + '/100'));
      topTags.appendChild(el('span', 'tag', String(v.severity || 'low').toUpperCase()));
      card.appendChild(topTags);

      var barRow = el('div', 'v4-bar-row');
      barRow.appendChild(el('span', '', 'Blast Radius'));
      var track = el('div', 'v4-bar-track');
      var fill = el('div', 'v4-bar-fill ' + (v.blastRadiusScore >= 80 ? 'bad' : v.blastRadiusScore >= 50 ? 'warn' : 'hi'));
      fill.style.width = Math.min(100, Math.max(2, v.blastRadiusScore || 0)) + '%';
      track.appendChild(fill);
      barRow.appendChild(track);
      barRow.appendChild(el('span', '', String(v.blastRadiusScore || 0) + '/100'));
      card.appendChild(barRow);

      card.appendChild(el('div', '', v.summary || ''));
      if (v.suggestedRewrite) {
        card.appendChild(el('div', 'v4-rewrite', T.guardSafeRewrite + v.suggestedRewrite));
      }
      if (Array.isArray(v.matches) && v.matches.length > 0) {
        v.matches.forEach(function (m) {
          var mt = el('div', 'tags');
          mt.appendChild(el('span', 'tag ' + (m.severity === 'critical' ? 'crit' : 'low'), m.id));
          mt.appendChild(el('span', 'tag', m.source));
          mt.appendChild(el('span', 'tag', m.prescription));
          card.appendChild(mt);
        });
      }
      box.appendChild(card);
    }
    bodyEl.appendChild(box);

    var ev = guardState.events;
    var list = (ev && ev.recent) || [];
    countEl.textContent = (ev ? ev.total : 0) + ' ' + T.guardCount;
    bodyEl.appendChild(el('div', 'v4-sec-title', T.guardAuditTitle + ' (' + (ev ? ev.total : 0) + ')'));
    if (list.length === 0) {
      renderEmpty(T.guardAuditTitle, T.guardNoEvents);
      return;
    }
    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    ['#', 'Decision', 'Tool / Policies', 'Payload / Rewrite'].forEach(function (lbl) { hr.appendChild(el('th', '', lbl)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    list.forEach(function (item) {
      var tr = el('tr');
      tr.appendChild(cell('#', 'id', function (td) { td.textContent = String(item.id); }));
      tr.appendChild(cell('Decision', '', function (td) {
        var cls = item.decision === 'block' ? 'quarantined' : item.decision === 'rewrite' ? 'retired' : 'active';
        td.appendChild(el('span', 'pill ' + cls, String(item.decision).toUpperCase() + ' ' + item.blast_radius));
      }));
      tr.appendChild(cell('Policies', 'trigger', function (td) {
        td.textContent = item.tool_name;
        var tags = el('div', 'tags');
        (item.policy_ids || []).forEach(function (pid) { tags.appendChild(el('span', 'tag low', pid)); });
        td.appendChild(tags);
      }));
      tr.appendChild(cell('Payload', 'text', function (td) {
        td.textContent = item.payload_preview;
        if (item.suggested_rewrite) {
          td.appendChild(el('div', 'repair', T.guardSafeRewrite + item.suggested_rewrite));
        }
      }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bodyEl.appendChild(table);
  }

  function loadGuard() {
    var mine = ++seq;
    renderSkeleton();
    fetch(api('/api/guard-events?limit=25'), { headers: { 'accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        if (mine !== seq) return;
        guardState.events = data;
        if (nGuard) nGuard.textContent = String(data.total || 0);
        renderGuardView();
      })
      .catch(function (err) {
        if (mine !== seq) return;
        bodyEl.textContent = '';
        renderEmpty(T.loadFailed, String((err && err.message) || err));
      });
  }

  function kvRow(k, v) {
    var r = el('div', 'v4-kv');
    r.appendChild(el('span', '', k));
    r.appendChild(el('b', '', String(v)));
    return r;
  }

  function renderInsightsView(ins, fed) {
    bodyEl.textContent = '';
    countEl.textContent = T.insightsScore + ': ' + (ins.immunityScore || 0) + '/100';
    var grid = el('div', 'v4-grid');

    var arch = ins.diagnosis || {};
    var c1 = el('div', 'v4-card');
    c1.appendChild(el('h3', '', T.insightsArchetype));
    c1.appendChild(kvRow(T.insightsScore, (ins.immunityScore || 0) + ' / 100'));
    c1.appendChild(kvRow('Archetype', (arch.archetype && arch.archetype.title) || '—'));
    c1.appendChild(kvRow('Overall Immunity', (arch.overallImmunityPct || 0) + '%'));
    (arch.radar || []).forEach(function (axis) {
      var pct = Number(axis.immunityPct || 0);
      var br = el('div', 'v4-bar-row');
      br.appendChild(el('span', '', axis.label));
      var track = el('div', 'v4-bar-track');
      var fill = el('div', 'v4-bar-fill ' + (pct >= 70 ? 'hi' : pct >= 40 ? 'warn' : 'bad'));
      fill.style.width = Math.max(4, Math.min(100, pct)) + '%';
      track.appendChild(fill);
      br.appendChild(track);
      br.appendChild(el('span', '', String(pct) + '%'));
      c1.appendChild(br);
    });
    grid.appendChild(c1);

    var aut = ins.autopsy || {};
    var rec = ins.receipts || {};
    var c2 = el('div', 'v4-card');
    c2.appendChild(el('h3', '', T.insightsAutopsy));
    c2.appendChild(kvRow('Prevented Loops', aut.savedLoops || 0));
    c2.appendChild(kvRow('Verified Held Tokens', rec.estimatedTokensSaved || 0));
    c2.appendChild(kvRow('Receipt Chain', rec.chainValid === false ? T.chainBroken : T.chainVerified));
    c2.appendChild(kvRow('Autopsy Tokens Est.', aut.tokensRescued || 0));
    c2.appendChild(kvRow('API Dollars Saved', '$' + Number(aut.usdSaved || 0).toFixed(2)));
    c2.appendChild(kvRow('Guard Interceptions', (ins.guardSummary && ins.guardSummary.total) || 0));
    grid.appendChild(c2);

    var dna = ins.workspaceDna || {};
    var lock = ins.lockfile || {};
    var c3 = el('div', 'v4-card');
    c3.appendChild(el('h3', '', T.insightsDna));
    c3.appendChild(kvRow('Package Manager', dna.packageManager || 'unknown'));
    c3.appendChild(kvRow('Stacks', (dna.stacks || []).join(', ') || '—'));
    c3.appendChild(kvRow('Recommended Packs', (dna.recommendedPacks || []).join(', ') || '—'));
    c3.appendChild(kvRow('Vaccine Lockfile', lock.exists ? (lock.valid ? 'VERIFIED (' + (lock.antibodyCount || 0) + ')' : 'INVALID: ' + (lock.reason || '')) : 'Not generated'));
    grid.appendChild(c3);

    var c4 = el('div', 'v4-card');
    c4.appendChild(el('h3', '', T.insightsFederation));
    c4.appendChild(kvRow('Sources Scanned', (fed && fed.totalSources) || 1));
    c4.appendChild(kvRow('Total Clusters', (fed && fed.clusters && fed.clusters.length) || 0));
    c4.appendChild(kvRow('Universal Swarm Laws', (fed && Array.isArray(fed.universalLaws) ? fed.universalLaws.length : 0)));
    c4.appendChild(kvRow('Avg Consensus Score', (fed && fed.averageConsensusScore) || 0));
    ((fed && fed.clusters) || []).slice(0, 4).forEach(function (cl) {
      c4.appendChild(kvRow('[' + cl.consensusScore + '] ' + cl.tier, String(cl.trigger_pattern || '').slice(0, 42)));
    });
    grid.appendChild(c4);

    bodyEl.appendChild(grid);
  }

  function loadInsights() {
    var mine = ++seq;
    renderSkeleton();
    Promise.all([
      fetch(api('/api/insights'), { headers: { 'accept': 'application/json' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch(api('/api/federate'), { headers: { 'accept': 'application/json' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ])
      .then(function (pair) {
        if (mine !== seq) return;
        renderInsightsView(pair[0], pair[1]);
      })
      .catch(function (err) {
        if (mine !== seq) return;
        bodyEl.textContent = '';
        renderEmpty(T.loadFailed, String((err && err.message) || err));
      });
  }

  function renderRows(list) {
    bodyEl.textContent = '';
    countEl.textContent = list.length + ' ' + T.results;
    if (list.length === 0) {
      if (tab === 'shared') renderEmpty(T.noShared, T.noSharedHint);
      else if (tab === 'quarantined') renderEmpty(T.noQuarantined, T.noQuarantinedHint);
      else renderEmpty(T.empty, T.emptyHint);
      return;
    }

    var table = el('table');
    var thead = el('thead');
    var headRow = el('tr');
    ['#', T.colTrigger, T.colAvoid, T.colDo, T.colStats, T.colStatus, T.colActions].forEach(function (label) {
      headRow.appendChild(el('th', '', label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    sortRows(list).forEach(function (a) {
      var tr = el('tr');
      if (a.status === 'retired') tr.className = 'is-retired';
      else if (a.status === 'quarantined') tr.className = 'is-quarantined';

      tr.appendChild(cell('#', 'id', function (td) { td.textContent = String(a.id); }));
      tr.appendChild(cell(T.colTrigger, 'trigger', function (td) {
        td.textContent = a.trigger_pattern;
        var tags = el('div', 'tags');
        if ((a.ignored_count || 0) >= 2) {
          tags.appendChild(el('span', 'tag crit', 'CRITICAL · ignored ' + a.ignored_count + '×'));
        }
        if (a.tool_name) {
          tags.appendChild(el('span', 'tag', a.tool_name));
        }
        if (a.quality_grade && a.quality_grade !== 'quarantined') {
          tags.appendChild(el('span', 'tag ' + (a.quality_grade === 'advice' ? 'hi' : ''), a.quality_grade));
        }
        if (a.project_scope && a.project_scope !== '*') {
          var sc = el('span', 'tag link', 'scope:' + a.project_scope);
          sc.onclick = function () {
            qEl.value = 'scope:' + a.project_scope;
            syncClear();
            load();
          };
          tags.appendChild(sc);
        }
        if (typeof a.rubric_score === 'number' && a.rubric_score > 0) {
          tags.appendChild(el('span', 'tag ' + (a.rubric_score >= 60 ? 'hi' : 'low'), 'rubric:' + a.rubric_score));
        }
        if (a.root_cause && a.root_cause !== 'unknown' && a.root_cause !== 'other') {
          tags.appendChild(el('span', 'tag', a.root_cause));
        }
        if (a.prescription_source && a.prescription_source !== 'rule') {
          tags.appendChild(el('span', 'tag', 'src:' + a.prescription_source));
        }
        if ((a.probation_at || 0) > 0 && a.status === 'active') {
          tags.appendChild(el('span', 'tag low', 'probation'));
        }
        if ((a.parent_id || 0) > 0) {
          tags.appendChild(el('span', 'tag', 'from #' + a.parent_id));
        }
        if (tags.childNodes.length > 0) td.appendChild(tags);
      }));
      tr.appendChild(cell(T.colAvoid, 'text', function (td) { td.textContent = a.symptom; }));
      tr.appendChild(cell(T.colDo, 'text', function (td) {
        td.textContent = a.prescription;
        var rp = Array.isArray(a.repair_path) ? a.repair_path : [];
        if (rp.length > 0) td.appendChild(el('div', 'repair', T.repairedBy + rp.join(' · ')));
      }));

      tr.appendChild(cell(T.colStats, 'counts', function (td) {
        td.appendChild(el('b', '', String(a.hit_count)));
        td.appendChild(el('span', 'sep', '/'));
        td.appendChild(el('span', 'f', String(a.fail_count)));
      }));

      tr.appendChild(cell(T.colStatus, '', function (td) {
        var lbl = a.status === 'active' ? T.active : a.status === 'quarantined' ? T.quarantined : T.retired;
        td.appendChild(el('span', 'pill ' + a.status, lbl));
      }));

      tr.appendChild(cell(T.colActions, '', function (td) {
        if (tab === 'shared') return;
        var acts = el('div', 'acts');
        var nextOp = a.status === 'active' ? 'retire' : 'restore';
        var nextLabel = a.status === 'active' ? T.retire : T.restore;
        var toggle = el('button', 'act', nextLabel);
        toggle.type = 'button';
        toggle.onclick = function () { send(nextOp, a.id, toggle); };
        acts.appendChild(toggle);

        var del = el('button', 'act danger', T.remove);
        del.type = 'button';
        del.onclick = function () {
          if (!window.confirm(T.confirmRemove)) return;
          send('delete', a.id, del);
        };
        acts.appendChild(del);
        td.appendChild(acts);
      }));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bodyEl.appendChild(table);
  }

  function load() {
    var q = qEl.value.trim();
    if (tab === 'explain') {
      loadExplain(q);
      return;
    }
    if (tab === 'guard') {
      loadGuard();
      return;
    }
    if (tab === 'insights') {
      loadInsights();
      return;
    }
    var mine = ++seq;
    renderSkeleton();
    if (tab === 'workspaces') {
      fetch(api('/api/workspaces'), { headers: { 'accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) {
          if (mine !== seq) return;
          renderWorkspaces(data.workspaces || []);
        })
        .catch(function (err) {
          if (mine !== seq) return;
          bodyEl.textContent = '';
          renderEmpty(T.loadFailed, String((err && err.message) || err));
          toast(T.loadFailed, true);
        });
      return;
    }
    var path = tab === 'shared'
      ? '/api/shared' + (q ? '?q=' + encodeURIComponent(q) : '')
      : tab === 'quarantined'
        ? '/api/quarantined' + (q ? '?q=' + encodeURIComponent(q) : '')
        : '/api/list' + (q ? '?q=' + encodeURIComponent(q) : '');
    fetch(api(path), { headers: { 'accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        if (mine !== seq) return;
        renderStats(data.stats);
        renderRows(data.antibodies);
      })
      .catch(function (err) {
        if (mine !== seq) return;
        bodyEl.textContent = '';
        renderEmpty(T.loadFailed, String((err && err.message) || err));
        toast(T.loadFailed, true);
      });
  }

  function send(op, id, button) {
    if (button) button.disabled = true;
    fetch(api('/api/action'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: op, id: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error, true); return; }
        toast(op === 'delete' ? T.toastDeleted + ' #' + id : op === 'retire' ? T.toastRetired + ' #' + id : T.toastRestored + ' #' + id);
        load();
      })
      .catch(function () { toast(T.loadFailed, true); })
      .then(function () { if (button) button.disabled = false; });
  }

  if (hygieneBtn) {
    hygieneBtn.addEventListener('click', function () {
      hygieneBtn.disabled = true;
      fetch(api('/api/hygiene'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) { toast(data.error, true); return; }
          var rep = data.report || {};
          toast(T.hygieneDone + ': q=' + (rep.quarantined || 0) + ' r=' + (rep.restored || 0) + ' scoped=' + (rep.scoped || 0));
          load();
        })
        .catch(function () { toast(T.loadFailed, true); })
        .then(function () { hygieneBtn.disabled = false; });
    });
  }

  function syncClear() { clearEl.className = qEl.value ? 'clear show' : 'clear'; }

  qEl.addEventListener('input', function () {
    syncClear();
    if (tab === 'workspaces' || tab === 'guard' || tab === 'insights') return;
    clearTimeout(timer);
    timer = setTimeout(load, 220);
  });
  clearEl.addEventListener('click', function () {
    qEl.value = '';
    syncClear();
    if (tab !== 'workspaces' && tab !== 'guard' && tab !== 'insights') load();
    qEl.focus();
  });
  sortEl.addEventListener('change', function () {
    if (tab !== 'workspaces' && tab !== 'explain' && tab !== 'guard' && tab !== 'insights') load();
  });

  var importFile = document.getElementById('importFile');
  var importWrap = document.getElementById('importWrap');
  if (importFile && importWrap) {
    importFile.addEventListener('change', function () {
      var file = importFile.files && importFile.files[0];
      importFile.value = '';
      if (!file) return;
      importWrap.setAttribute('data-busy', '1');
      var reader = new FileReader();
      reader.onload = function () {
        fetch(api('/api/import'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: String(reader.result || ''),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            importWrap.removeAttribute('data-busy');
            if (data.error) { toast(data.error, true); return; }
            toast(T.toastImported + ' +' + data.added + ' / ~' + data.merged);
            load();
          })
          .catch(function (err) {
            importWrap.removeAttribute('data-busy');
            toast(String((err && err.message) || err), true);
          });
      };
      reader.readAsText(file);
    });
  }

  document.addEventListener('keydown', function (e) {
    var active = document.activeElement;
    var inEditable =
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable);
    if (e.key === '/' && !inEditable) { e.preventDefault(); qEl.focus(); }
    if (e.key === 'Escape' && active === qEl) { qEl.value = ''; syncClear(); load(); }
  });

  function selectTab(next) {
    tab = next;
    [
      [tabProject, 'project'],
      [tabShared, 'shared'],
      [tabQuarantined, 'quarantined'],
      [tabWorkspaces, 'workspaces'],
      [tabExplain, 'explain'],
      [tabGuard, 'guard'],
      [tabInsights, 'insights'],
    ].forEach(function (pair) {
      if (!pair[0]) return;
      pair[0].className = next === pair[1] ? 'on' : '';
      pair[0].setAttribute('aria-selected', next === pair[1] ? 'true' : 'false');
    });
    load();
  }
  tabProject.onclick = function () { selectTab('project'); };
  tabShared.onclick = function () { selectTab('shared'); };
  if (tabQuarantined) tabQuarantined.onclick = function () { selectTab('quarantined'); };
  if (tabWorkspaces) tabWorkspaces.onclick = function () { selectTab('workspaces'); };
  if (tabExplain) tabExplain.onclick = function () { selectTab('explain'); };
  if (tabGuard) tabGuard.onclick = function () { selectTab('guard'); };
  if (tabInsights) tabInsights.onclick = function () { selectTab('insights'); };

  syncClear();
  load();
})();
</script>`;
}
