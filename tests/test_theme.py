"""Проверки оформления страницы.

Тут не про красоту, а про контракт: соседние модули (report, timeline,
traces) рисуют своими классами, но цвета берут из переменных темы. Если
переменная исчезнет или окажется определена только в тёмной теме, блоки
молча станут чёрными -- такое проще ловить тестом, чем глазами.
"""

from __future__ import annotations

import re

from vnl import theme

# Переменные, на которые опираются другие модули. Переименование любой из
# них ломает соседей, поэтому список зафиксирован.
CONTRACT = ["--bg", "--panel", "--ink", "--muted", "--line",
            "--exc", "--inh", "--mod", "--trace"]


def _strip_at_blocks(css: str) -> str:
    """Убрать содержимое всех @media/@supports, оставив CSS верхнего уровня."""
    out = []
    index = 0
    while True:
        start = css.find("@media", index)
        if start < 0:
            out.append(css[index:])
            return "".join(out)
        out.append(css[index:start])
        depth = 0
        cursor = css.index("{", start)
        for position in range(cursor, len(css)):
            if css[position] == "{":
                depth += 1
            elif css[position] == "}":
                depth -= 1
                if depth == 0:
                    index = position + 1
                    break
        else:  # незакрытый блок -- сам по себе ошибка
            raise AssertionError("незакрытый @media в BASE_CSS")


def _bare_root_body() -> str:
    """Тело первого блока `:root {` вне каких-либо @media."""
    top = _strip_at_blocks(theme.BASE_CSS)
    match = re.search(r":root\s*\{([^}]*)\}", top)
    assert match, "в BASE_CSS нет правила для голого :root"
    return match.group(1)


def test_contract_variables_defined_on_bare_root():
    body = _bare_root_body()
    missing = [name for name in CONTRACT if f"{name}:" not in body]
    assert not missing, f"нет на голом :root: {missing}"


def test_no_color_lives_only_inside_media():
    """Переменная, определённая только в тёмной теме, в светлой пустая."""
    top_level = _strip_at_blocks(theme.BASE_CSS)
    defined_top = set(re.findall(r"(--[\w-]+)\s*:", top_level))
    inside_media = set()
    for block in re.findall(r"@media[^{]*\{(.*?\})\s*\}", theme.BASE_CSS, re.S):
        inside_media |= set(re.findall(r"(--[\w-]+)\s*:", block))
    assert not (inside_media - defined_top)


def test_dark_theme_overrides_match_the_media_query():
    """Ручной data-theme="dark" и системная тёмная должны совпадать."""
    media = re.search(
        r'@media \(prefers-color-scheme: dark\)\s*\{\s*'
        r':root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}',
        theme.BASE_CSS,
    )
    attribute = re.search(r':root\[data-theme="dark"\]\s*\{([^}]*)\}', theme.BASE_CSS)
    assert media and attribute
    to_pairs = lambda text: dict(  # noqa: E731
        tuple(part.strip() for part in line.split(":", 1))
        for line in text.strip().split(";")
        if line.strip()
    )
    assert to_pairs(media.group(1)) == to_pairs(attribute.group(1))


def test_body_has_explicit_background():
    """Без явного фона страница просвечивает белым в тёмной теме."""
    body_rule = re.search(r"\bbody\s*\{([^}]*)\}", theme.BASE_CSS)
    assert body_rule and "background: var(--bg)" in body_rule.group(1)


def test_fonts_have_offline_fallback():
    """Страницу открывают офлайн -- вебшрифт обязан иметь системный запас."""
    assert "@import url('https://fonts.googleapis.com/css2?" in theme.BASE_CSS
    sans = re.search(r"--font-sans:([^;]*);", theme.BASE_CSS).group(1)
    mono = re.search(r"--font-mono:([^;]*);", theme.BASE_CSS).group(1)
    assert "system-ui" in sans and "sans-serif" in sans
    assert "monospace" in mono


def test_import_comes_first_in_css():
    """CSS игнорирует @import после любого правила -- шрифты бы не загрузились."""
    assert theme.BASE_CSS.lstrip().startswith("@import")


def test_block_specific_rules_left_their_modules():
    """Оформление блоков переехало в report/timeline/traces -- здесь его нет."""
    moved = [".dend", ".axon", ".soma", ".cell-name", ".bouton",
             ".row-label", ".grid", ".spike", ".stim-band", ".axis",
             ".trace-line", ".trace-name"]
    assert [name for name in moved if name in theme.BASE_CSS] == []


def test_document_is_standalone_and_scriptless():
    page = theme.document("прогон", theme.BASE_CSS, "<main><h1>x</h1></main>")
    assert page.startswith("<!doctype html>")
    assert "<script" not in page
    # единственная внешняя ссылка -- шрифты; ни картинок, ни стилей со стороны
    external = re.findall(r"https?://[^\s'\"<>)]+", page)
    assert all(link.startswith("https://fonts.googleapis.com/") for link in external)


def test_rendered_page_pulls_no_external_scripts():
    from pathlib import Path

    from vnl.report import render
    from vnl.resolve import load
    from vnl.sim import simulate

    source = (Path(__file__).resolve().parents[1] / "examples" / "ffi.vnl")
    model, _ = load(source.read_text(encoding="utf-8"), source="examples/ffi.vnl")
    page = render(model, simulate(model))
    assert "<script" not in page and "http://" not in page
    for name in CONTRACT:
        assert f"{name}:" in page
