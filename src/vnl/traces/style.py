"""CSS блока трасс.

Живёт рядом с кодом блока, а не в общей теме: правка одного блока не должна
заставлять лезть в общий стиль и мешать соседям. Цвета -- только токены темы,
свои классы -- с префиксом tr-.
"""

STYLE = """
/* Блок трасс. Все классы с префиксом tr-, цвета -- только токены темы. */
section.tr-card { padding: 0; overflow: hidden; }
.tr-block { display: flex; flex-direction: column; gap: var(--space-5);
  padding: var(--space-5) 0; }
.tr-fig { margin: 0; }
.tr-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-3);
}
.tr-name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink);
}
.tr-kind { font-size: var(--text-xs); color: var(--muted); }
.tr-stat {
  margin-left: auto;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  white-space: nowrap;
}
.tr-num { color: var(--ink); }
.tr-dim { color: var(--muted); }

/* Левый жёлоб под подписи уровней одинаков у всех графиков и совпадает с
   колонкой меток в активности сети: ось времени на странице одна, и её тики
   обязаны стоять на одной вертикали во всех блоках. */
.tr-row { display: grid;
  grid-template-columns: var(--track-label, 168px) 1fr; align-items: stretch; }
.tr-ygut { position: relative; }
.tr-lvl {
  position: absolute;
  right: var(--space-2);
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-plot {
  position: relative;
  border-left: 1px solid var(--line);
  background: var(--bg);
  border-radius: var(--radius-xs, 3px);
}
.tr-plot-v { height: 132px; }
.tr-plot-g, .tr-plot-w { height: 96px; }
.tr-plot-spikes { height: 34px; }
/* min-width сбрасываем: у этого SVG нет своего масштаба текста, поэтому он
   спокойно живёт и на 400px, не заставляя страницу ехать вбок. */
.tr-canvas { display: block; width: 100%; height: 100%; min-width: 0; }

.tr-gridx, .tr-gridy {
  stroke: var(--line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.tr-gridy { opacity: .7; }
.tr-zero {
  stroke: var(--muted);
  stroke-width: 1;
  opacity: .5;
  vector-effect: non-scaling-stroke;
}
.tr-threshold, .tr-start {
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}
.tr-line {
  fill: none;
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.tr-line-v { stroke: var(--trace); }
.tr-line-g { stroke: var(--trace); stroke-width: 1.2; }
.tr-line-g.tr-tone-exc { stroke: var(--exc); }
.tr-line-g.tr-tone-inh { stroke: var(--inh); }
.tr-area.tr-tone-exc { fill: var(--exc); }
.tr-area.tr-tone-inh { fill: var(--inh); }
.tr-line-w { stroke: var(--mod); stroke-width: 2; }
.tr-area { fill: var(--trace); opacity: .16; stroke: none; }
.tr-spike { stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.tr-spike-exc { stroke: var(--exc); }
.tr-spike-inh { stroke: var(--inh); }

.tr-thr-label {
  position: absolute;
  right: var(--space-2);
  transform: translateY(-120%);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
  background: var(--bg);
  padding: 0 var(--space-1);
}
.tr-thr-under { transform: translateY(20%); }

.tr-timerow { margin-top: calc(-1 * var(--space-2)); }
.tr-ticks {
  position: relative;
  height: 18px;
  border-top: 1px solid var(--line);
}
.tr-tick {
  position: absolute;
  top: var(--space-1);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-tick { transform: translateX(-50%); }
.tr-tick:first-child { transform: none; }
.tr-tick-last { transform: translateX(-100%); }

/* Скраббер: сквозной курсор по времени. Раскладка держится на том, что
   зоны накрывают ровно колонку графиков -- тот же трек, что и у строк. */
.tr-block { position: relative; }
.tr-bar { height: 14px; }
.tr-scrub {
  position: absolute;
  left: var(--track-label, 168px);
  right: 0;
  top: var(--space-5);
  bottom: var(--space-5);
  z-index: 1;
}
.tr-hint {
  position: absolute;
  top: 0;
  left: 0;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-scrub:hover .tr-hint { opacity: 0; }
/* Зоны -- флекс-полоски равной ширины: тогда подпись можно позиционировать
   от всего слоя, а не от зоны, и на узком экране развернуть её во всю ширину.
   Курсор рисуем внутренней тенью, а не рамкой: рамка сдвинула бы раскладку. */
.tr-scrub { display: flex; }
.tr-hit { flex: 1 1 0; }
.tr-hit:hover { box-shadow: inset 1px 0 0 var(--ink); }
.tr-read {
  position: absolute;
  top: 0;
  display: none;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--ink);
  background: var(--panel);
  padding: 0 var(--space-1);
}
.tr-read-l { transform: none; }
.tr-read-r { transform: translateX(-100%); }
.tr-hit:hover .tr-read { display: block; }
/* На тач-устройствах hover не существует -- слой только мешал бы. */
@media (hover: none) {
  .tr-scrub { display: none; }
  .tr-bar { display: none; }
}

@media (max-width: 520px) {
  .tr-stat { margin-left: 0; width: 100%; }
  /* Узко: строка курсора не влезает рядом с ним -- кладём её на всю
     ширину блока и разрешаем перенос. */
  .tr-bar { height: 28px; }
  .tr-read, .tr-read-l, .tr-read-r {
    left: 0 !important;
    right: 0;
    transform: none;
    white-space: normal;
    font-size: 10px;
    padding: 0;
  }
}
"""
