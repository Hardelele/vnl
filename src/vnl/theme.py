"""Оформление страницы: токены, базовая типографика, каркас документа."""

from __future__ import annotations

BASE_CSS = """
:root {
  color-scheme: light dark;
  --bg: #fbfaf8;
  --panel: #ffffff;
  --ink: #1d1c1a;
  --muted: #6d6a64;
  --line: #ddd9d2;
  --exc: #1f6f5c;
  --inh: #a33b32;
  --trace: #3d5a9e;
  --mod: #8a6d2f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17181a; --panel: #1f2124; --ink: #ecebe8; --muted: #9a968f;
    --line: #34373c; --exc: #57bfa2; --inh: #e0796c; --trace: #8aa8e8; --mod: #d3ab5c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 28px 20px 60px;
  background: var(--bg); color: var(--ink);
  font: 15px/1.55 "Segoe UI", system-ui, sans-serif;
}
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.09em;
     color: var(--muted); margin: 34px 0 10px; font-weight: 600; }
.sub { color: var(--muted); margin: 0 0 8px; font-size: 0.92rem; }
section { background: var(--panel); border: 1px solid var(--line);
          border-radius: 10px; padding: 16px; overflow-x: auto; }
svg { display: block; width: 100%; height: auto; min-width: 460px; }
.dend { stroke: var(--muted); stroke-width: 2.4; stroke-linecap: round; opacity: .55; }
.axon { stroke: var(--muted); stroke-width: 1.6; stroke-dasharray: 3 3; opacity: .7; }
.edge { fill: none; stroke-width: 1.9; opacity: .9; }
.edge.exc { stroke: var(--exc); }
.edge.inh { stroke: var(--inh); }
.edge.mod { stroke: var(--mod); stroke-dasharray: 6 4; opacity: .85; }
.exc-fill { fill: var(--exc); } .inh-stroke { stroke: var(--inh); stroke-width: 2.4; }
.bouton.exc-fill { fill: var(--exc); } .bouton.inh-fill { fill: var(--inh); }
.soma { fill: var(--panel); stroke-width: 2; }
.exc-cell { stroke: var(--exc); } .inh-cell { stroke: var(--inh); }
.cell-name { text-anchor: middle; font-size: 12px; font-weight: 600; fill: var(--ink); }
.cell-type { font-size: 10px; fill: var(--muted); }
.row-label { font-size: 12px; fill: var(--muted); }
.row-count { text-anchor: end; font-size: 11px; fill: var(--muted);
             font-variant-numeric: tabular-nums; }
.grid { stroke: var(--line); stroke-width: 1; }
.stim-band { fill: var(--ink); opacity: .055; }
.axis.tick { text-anchor: middle; font-variant-numeric: tabular-nums; }
.axis.value { text-anchor: end; font-variant-numeric: tabular-nums; }
.row-base { stroke: var(--line); stroke-width: 1; }
.spike { stroke-width: 1.6; }
.exc-stroke { stroke: var(--exc); } .inh-stroke { stroke: var(--inh); }
.axis { font-size: 11px; fill: var(--muted); }
.axis.end { text-anchor: end; }
.trace-line { fill: none; stroke: var(--trace); stroke-width: 1.4; }
.trace-name { font-size: 11px; fill: var(--muted); }
.trace + .trace { margin-top: 6px; border-top: 1px solid var(--line); padding-top: 6px; }
table { border-collapse: collapse; width: auto; min-width: 280px;
         font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 14px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: 0.8rem; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums;
                 white-space: nowrap; }
td:first-child { padding-right: 32px; }
ul.notes { margin: 0; padding-left: 20px; color: var(--muted); font-size: 0.9rem; }
ul.notes li { margin: 3px 0; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; color: var(--muted);
          font-size: 0.85rem; margin-top: 10px; }
.legend .e::before, .legend .i::before, .legend .m::before {
  content: "—"; margin-right: 6px; font-weight: 700;
}
.legend .e::before { color: var(--exc); }
.legend .i::before { color: var(--inh); }
.legend .m::before { color: var(--mod); }
"""


def document(title: str, style: str, body: str) -> str:
    """Самодостаточная страница: без внешних скриптов, весь CSS внутри."""
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{style}</style>
</head>
<body>
{body}
</body>
</html>
"""
