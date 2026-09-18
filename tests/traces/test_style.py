"""Стиль блока: собственных цветов нет, классы не сталкиваются с чужими."""

import re

from vnl import traces


def test_style_is_exported_and_prefixed():
    assert traces.STYLE.strip()
    selectors = re.findall(r"^\.([a-z-]+)", traces.STYLE, re.MULTILINE)
    assert selectors and all(s.startswith("tr-") for s in selectors)


def test_colours_come_from_the_theme_only():
    """Свой #rrggbb сломал бы тёмную тему: она живёт в переменных."""
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", traces.STYLE)
