"""Оформление страницы: токены, базовая типографика, каркас документа.

Здесь живёт только общее для всей страницы. Оформление конкретных блоков
(схема, растр, трассы) лежит рядом с кодом, который эти блоки рисует, --
иначе правка одного блока заставляет лезть в общий CSS и мешает соседям.

Палитра -- дизайн-система Reckue: монохромная ink-рампа плюс единственный
синий акцент (sky). Токены скопированы в CSS значениями, а не через
@import файлов системы: страница обязана открываться из одного файла,
без сети и без соседних ресурсов.
"""

from __future__ import annotations

# Шрифты грузим с Google Fonts, но каждое семейство идёт со стеком
# системных запасных: страницу открывают и офлайн, и там не должно
# «поплыть» ничего, кроме собственно начертания.
BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700\
&family=Roboto+Mono:wght@400;500&display=swap');
:root {
  color-scheme: light dark;

  /* ink-рампа Reckue: холодный серый с еле заметной синевой */
  --ink-950: #101216;
  --ink-900: #16181e;
  --ink-700: #2a2e39;
  --ink-500: #565d6e;
  --ink-300: #a6adba;
  --ink-100: #e5e9ef;
  --ink-50:  #f5f7f9;

  /* поверхности и текст -- контракт, на который смотрят другие модули */
  --bg: var(--ink-50);
  --panel: #ffffff;
  --ink: var(--ink-900);
  --muted: var(--ink-500);
  --line: var(--ink-100);
  --subtle: #eff2f6;

  /* акцент: единственный синий, расходуется скупо */
  --accent: #1e7ad1;

  /* смысловые цвета сети; определяем тут, используют report/timeline/traces */
  --exc: #2e7d57;
  --inh: #c24039;
  --mod: #b47318;
  --trace: var(--accent);

  /* типографика */
  --font-sans: "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Roboto Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --text-2xs: 11px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 15px;
  --text-xl: 22px;
  --tracking-tight: -0.01em;
  --tracking-caps: 0.08em;

  /* сетка 4px */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-16: 64px;
  --page-max: 960px;
  --page-pad: 32px;
  /* Ширина левой колонки у блоков с временной осью. Общая на всю страницу:
     только так тик «100 мс» в активности сети и в записанных величинах
     стоит на одной вертикали и блоки читаются друг под другом. */
  --track-label: 168px;

  /* эффекты */
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(22, 24, 30, .07), 0 1px 3px rgba(22, 24, 30, .05);
}
/* Тёмная тема -- та же рампа, перевёрнутая: переопределяем только значения,
   структура и имена переменных остаются из :root. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: var(--ink-950);
    --panel: var(--ink-900);
    --ink: var(--ink-100);
    --muted: var(--ink-300);
    --line: var(--ink-700);
    --subtle: #1e212a;
    --accent: #3f9bee;
    --exc: #5cbf97;
    --inh: #e2807a;
    --mod: #d9a950;
    --shadow-sm: none;
  }
}
:root[data-theme="dark"] {
  --bg: var(--ink-950);
  --panel: var(--ink-900);
  --ink: var(--ink-100);
  --muted: var(--ink-300);
  --line: var(--ink-700);
  --subtle: #1e212a;
  --accent: #3f9bee;
  --exc: #5cbf97;
  --inh: #e2807a;
  --mod: #d9a950;
  --shadow-sm: none;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: var(--space-8) var(--page-pad) var(--space-16);
  background: var(--bg);
  color: var(--ink);
  font: 400 var(--text-base)/1.5 var(--font-sans);
  -webkit-text-size-adjust: 100%;
}
main { max-width: var(--page-max); margin: 0 auto; }

h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
  font-weight: 500;
  letter-spacing: var(--tracking-tight);
}
/* h2 -- не заголовок, а метка-эйбрау над секцией: спокойная, вторичная */
h2 {
  margin: var(--space-10) 0 var(--space-3);
  font-size: var(--text-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--muted);
}
/* подзаголовок несёт параметры прогона -- это данные, поэтому ровные разряды */
.sub {
  margin: 0 0 var(--space-2);
  color: var(--muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.sub.note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
}

section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--space-4);
  overflow-x: auto;
}
svg { display: block; width: 100%; height: auto; min-width: 460px; }

code, .mono, .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

table {
  border-collapse: collapse;
  width: auto;
  min-width: 280px;
  font-size: var(--text-sm);
}
th, td {
  text-align: left;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--line);
}
th {
  color: var(--muted);
  font-weight: 500;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
}
th.num, td.num {
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
td:first-child { padding-right: var(--space-8); }

ul.notes {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--muted);
  font-size: var(--text-sm);
}
ul.notes li { margin: var(--space-1) 0; }

.legend {
  display: flex;
  gap: var(--space-4) var(--space-6);
  flex-wrap: wrap;
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--text-xs);
}
.legend .e::before, .legend .i::before, .legend .m::before {
  content: "—";
  margin-right: var(--space-1);
  font-weight: 700;
}
.legend .e::before { color: var(--exc); }
.legend .i::before { color: var(--inh); }
.legend .m::before { color: var(--mod); }

/* Узкий экран: гутер не меньше 16px, страница не должна ехать вбок --
   широкие SVG прокручиваются внутри своей секции. */
@media (max-width: 640px) {
  :root { --page-pad: var(--space-4); --track-label: 92px; }
  body { padding-top: var(--space-5); }
  h2 { margin-top: var(--space-8); }
}
"""


def document(title: str, style: str, body: str) -> str:
    """Самодостаточная страница: без внешних скриптов, весь CSS внутри.

    Атрибут data-theme не выставляем: тему выбирает система, а ручной
    переключатель потребовал бы скрипта -- страница должна остаться
    статической.
    """
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
