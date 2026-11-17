/**
 * Offline self-contained stylesheet for the standalone dashboard.
 * Must contain zero external `http(s)://` references (`AGENTS.md #14`).
 */
export const DASHBOARD_CSS = `  :root {
    --bg: #0d1016; --bg-soft: #121722; --panel: #161c27; --panel-2: #1b2331;
    --line: #242e3d; --line-soft: #1e2634;
    --text: #e8edf5; --muted: #94a1b5; --faint: #6c7a8e;
    --accent: #4f9cf9; --accent-soft: rgba(79,156,249,.13);
    --ok: #37c98a; --ok-soft: rgba(55,201,138,.13);
    --warn: #e3a53f; --bad: #e56565; --bad-soft: rgba(229,101,101,.12);
    --radius: 12px; --radius-sm: 8px;
    --shadow: 0 1px 0 rgba(255,255,255,.03), 0 10px 28px -18px rgba(0,0,0,.75);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f7fa; --bg-soft: #ffffff; --panel: #ffffff; --panel-2: #f1f4f9;
      --line: #e2e7ef; --line-soft: #edf1f6;
      --text: #1a2331; --muted: #5c6878; --faint: #8a94a4;
      --accent: #2f7cf0; --accent-soft: rgba(47,124,240,.10);
      --ok: #12915f; --ok-soft: rgba(18,145,95,.10);
      --warn: #a86a12; --bad: #c23b3b; --bad-soft: rgba(194,59,59,.09);
      --shadow: 0 1px 2px rgba(16,24,40,.05), 0 10px 24px -20px rgba(16,24,40,.35);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background:
      radial-gradient(1100px 500px at 12% -10%, var(--accent-soft), transparent 60%),
      var(--bg);
    color: var(--text);
    font: 14px/1.55 "Segoe UI", system-ui, -apple-system, "Noto Sans SC", "PingFang SC", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1220px; margin: 0 auto; padding: 26px 22px 44px; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

  .top { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
  .mark {
    width: 40px; height: 40px; border-radius: 11px; flex: none;
    background: linear-gradient(150deg, var(--accent), #7a5cf0 85%);
    position: relative; box-shadow: 0 6px 18px -8px rgba(79,156,249,.8);
  }
  .mark::before {
    content: ""; position: absolute; inset: 9px; border-radius: 6px 6px 10px 10px;
    background: rgba(255,255,255,.92);
    clip-path: polygon(50% 0%, 100% 18%, 100% 58%, 50% 100%, 0 58%, 0 18%);
  }
  .mark::after {
    content: ""; position: absolute; left: 50%; top: 20px; width: 9px; height: 2px; margin-left: -4.5px;
    background: var(--accent); border-radius: 2px; box-shadow: 0 4px 0 var(--accent);
  }
  .titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  h1 { margin: 0; font-size: 19px; letter-spacing: .2px; font-weight: 650; }
  .sub { color: var(--muted); font-size: 12.5px; }
  .meta { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
    border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
    color: var(--muted); font-size: 11.5px; max-width: 54ch; min-width: 0; white-space: nowrap;
  }
  .chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); flex: none; }
  .chip code { color: var(--text); font-size: 11.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(144px, 1fr)); gap: 11px; margin-top: 18px; }
  .kpi {
    position: relative; background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 12px 14px 11px; box-shadow: var(--shadow);
    overflow: hidden;
  }
  .kpi::after {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--line);
  }
  .kpi[data-tone="ok"]::after { background: var(--ok); }
  .kpi[data-tone="warn"]::after { background: var(--warn); }
  .kpi[data-tone="bad"]::after { background: var(--bad); }
  .kpi[data-tone="accent"]::after { background: var(--accent); }
  .kpi .v { font-size: 22px; font-weight: 660; letter-spacing: -.2px; font-variant-numeric: tabular-nums; }
  .kpi .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }

  .evo { margin-top: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 16px; }
  .evo-h { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .evo-h b { font-size: 12.5px; letter-spacing: .02em; }
  .evo-h span { color: var(--muted); font-size: 11px; }
  .evo-bars { display: flex; gap: 16px; margin-top: 10px; }
  .evo-col { flex: 1; display: flex; align-items: flex-end; gap: 6px; height: 52px; }
  .evo-col i { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; opacity: .85; }
  .evo-col.alt i { background: var(--ok); opacity: .6; }
  .evo-f { margin-top: 8px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
  .evo-note { color: var(--faint); }

  .strip {
    display: flex; flex-wrap: wrap; align-items: center; gap: 7px;
    margin-top: 10px; font-size: 12px;
  }
  .strip[hidden] { display: none; }
  .strip .lbl {
    color: var(--muted); font-size: 11px; text-transform: uppercase;
    letter-spacing: .05em;
  }
  .strip .chip {
    border: 1px solid var(--line); background: var(--panel); color: var(--text);
    border-radius: 999px; padding: 3px 9px; font-variant-numeric: tabular-nums;
    box-shadow: var(--shadow);
  }
  .strip .chip[data-bad="1"] { border-color: var(--warn); }
  .strip .chip .x { color: var(--warn); margin-left: 4px; }
  .strip .chip.proof { border-color: var(--ok); color: var(--ok); }
  .strip .chip.bad { border-color: var(--bad); color: var(--bad); }

  .toolbar {
    margin-top: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 10px 12px; box-shadow: var(--shadow);
  }
  .search { position: relative; flex: 1 1 260px; min-width: 180px; display: flex; align-items: center; }
  .search .glass {
    position: absolute; left: 11px; width: 13px; height: 13px; border: 2px solid var(--faint);
    border-radius: 50%; pointer-events: none;
  }
  .search .glass::after {
    content: ""; position: absolute; right: -4px; bottom: -3px; width: 6px; height: 2px;
    background: var(--faint); transform: rotate(45deg); border-radius: 2px;
  }
  input[type=search] {
    width: 100%; padding: 9px 34px 9px 32px; font-size: 13.5px; color: var(--text);
    background: var(--bg-soft); border: 1px solid var(--line); border-radius: var(--radius-sm);
    transition: border-color .15s, box-shadow .15s;
  }
  input[type=search]::placeholder { color: var(--faint); }
  input[type=search]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .clear {
    position: absolute; right: 6px; width: 22px; height: 22px; border: 0; border-radius: 6px;
    background: transparent; color: var(--faint); cursor: pointer; font-size: 15px; line-height: 1;
    display: none;
  }
  .clear:hover { background: var(--panel-2); color: var(--text); }
  .clear.show { display: block; }

  .seg { display: inline-flex; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 999px; padding: 2px; flex-wrap: wrap; }
  .seg button {
    border: 0; background: transparent; color: var(--muted); cursor: pointer;
    padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-variant-numeric: tabular-nums;
    transition: background .15s, color .15s;
  }
  .seg button.on { background: var(--panel-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
  .seg button b { font-weight: 600; margin-left: 5px; color: var(--faint); }
  .seg button.on b { color: var(--accent); }

  .select { position: relative; }
  .select select {
    appearance: none; padding: 7px 28px 7px 11px; border-radius: var(--radius-sm);
    border: 1px solid var(--line); background: var(--bg-soft); color: var(--text); font-size: 12.5px; cursor: pointer;
  }
  .select::after {
    content: ""; position: absolute; right: 11px; top: 50%; width: 6px; height: 6px; margin-top: -5px;
    border-right: 1.5px solid var(--faint); border-bottom: 1.5px solid var(--faint);
    transform: rotate(45deg); pointer-events: none;
  }

  .panel { margin-top: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .meta-row { display: flex; justify-content: space-between; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--line-soft); color: var(--faint); font-size: 11.5px; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    position: sticky; top: 0; z-index: 1; text-align: left; padding: 9px 14px;
    background: var(--bg-soft); color: var(--muted); font-weight: 550; font-size: 11px;
    text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  tbody td { padding: 11px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr { transition: background .12s; }
  tbody tr:hover { background: var(--panel-2); }
  tr.is-retired td { opacity: .62; }
  tr.is-quarantined td { opacity: .72; }
  td.id { color: var(--faint); width: 46px; font-variant-numeric: tabular-nums; }
  td.trigger { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12.5px; max-width: 300px; word-break: break-word; color: var(--text); }
  td.text { max-width: 290px; word-break: break-word; color: var(--muted); }
  td.text:last-of-type { color: var(--text); }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
  .tag {
    display: inline-block; padding: 1px 6px; border-radius: 5px; font-size: 10.5px;
    border: 1px solid var(--line); background: var(--bg-soft); color: var(--muted);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }
  .tag.hi { border-color: var(--ok); color: var(--ok); }
  .tag.low { border-color: var(--warn); color: var(--warn); }
  .counts { font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--faint); }
  .counts b { color: var(--ok); font-weight: 600; }
  .counts .f { color: var(--bad); font-weight: 600; }
  .counts .sep { margin: 0 3px; opacity: .5; }

  .pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px;
    font-size: 11.5px; white-space: nowrap;
  }
  .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.active { color: var(--ok); background: var(--ok-soft); }
  .pill.retired { color: var(--muted); background: rgba(148,161,181,.12); }
  .pill.quarantined { color: var(--bad); background: var(--bad-soft); }

  .repair { margin-top: 3px; font-size: 11px; color: var(--faint); }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  button.act, a.act, label.act {
    border: 1px solid var(--line); background: transparent; color: var(--muted);
    border-radius: 7px; padding: 4px 10px; cursor: pointer; font-size: 12px; transition: all .12s;
    text-decoration: none; display: inline-flex; align-items: center; user-select: none;
  }
  button.act:hover, a.act:hover, label.act:hover { color: var(--text); border-color: var(--muted); background: var(--panel-2); }
  button.act.danger:hover { color: var(--bad); border-color: var(--bad); background: var(--bad-soft); }
  button.act:disabled { opacity: .45; cursor: progress; }

  .empty { padding: 46px 20px 52px; text-align: center; }
  .empty .glyph {
    width: 46px; height: 46px; margin: 0 auto 12px; border-radius: 12px;
    border: 1.5px dashed var(--line); position: relative;
  }
  .empty .glyph::before, .empty .glyph::after {
    content: ""; position: absolute; background: var(--line); border-radius: 2px;
  }
  .empty .glyph::before { left: 13px; right: 13px; top: 20px; height: 2px; }
  .empty .glyph::after { top: 13px; bottom: 13px; left: 21px; width: 2px; }
  .empty .t { font-weight: 600; }
  .empty .h { color: var(--muted); margin-top: 4px; font-size: 12.5px; }
  .skel { padding: 6px 0; }
  .skel .r { height: 38px; border-bottom: 1px solid var(--line-soft); display: flex; align-items: center; gap: 14px; padding: 0 14px; }
  .skel .b { height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--line-soft), var(--line), var(--line-soft)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
  .skel .b:nth-child(1) { width: 34px; } .skel .b:nth-child(2) { width: 26%; } .skel .b:nth-child(3) { width: 22%; } .skel .b:nth-child(4) { width: 18%; }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .skel .b { animation: none; } }

  footer { color: var(--faint); font-size: 11.5px; padding: 16px 4px 0; word-break: break-all; }
  footer .sep { margin: 0 6px; opacity: .5; }

  #toast {
    position: fixed; right: 18px; bottom: 18px; max-width: 340px;
    background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--accent);
    padding: 10px 14px; border-radius: var(--radius-sm); box-shadow: var(--shadow);
    color: var(--text); font-size: 12.5px; opacity: 0; transform: translateY(6px);
    transition: opacity .18s, transform .18s; pointer-events: none;
  }
  #toast.show { opacity: 1; transform: none; }
  #toast.bad { border-left-color: var(--bad); }

  @media (max-width: 780px) {
    .wrap { padding: 18px 14px 32px; }
    .meta { margin-left: 0; min-width: 0; width: 100%; }
    .chip { max-width: 100%; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    thead { display: none; }
    table, tbody, tr, td { display: block; width: 100%; }
    tbody tr { border-bottom: 1px solid var(--line); padding: 10px 4px; }
    tbody tr:last-child { border-bottom: 0; }
    tbody td { border: 0; padding: 4px 12px; display: flex; gap: 12px; }
    tbody td::before {
      content: attr(data-label); flex: 0 0 84px; color: var(--faint); font-size: 11px;
      text-transform: uppercase; letter-spacing: .05em; padding-top: 2px;
    }
    td.id { width: auto; }
    td.trigger, td.text { max-width: none; }
    .acts { flex-wrap: wrap; }
  }`;
