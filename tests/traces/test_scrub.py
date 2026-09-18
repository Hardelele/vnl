"""Скраббер: перемещение по таймлайну без JavaScript."""

import re

from vnl import traces


def test_scrubber_lets_you_move_along_the_timeline_without_js(block_for):
    _, _, block = block_for("disinhibition")
    assert "<script" not in block and "onmouse" not in block.lower()
    assert block.count('class="tr-hit"') == traces.SCRUB_ZONES
    assert block.count('class="tr-read') == traces.SCRUB_ZONES
    assert "tr-scrub" in block


def test_scrubber_shows_real_values_at_that_time(block_for):
    """Число в строке курсора -- это значение трассы в этой точке."""
    model, result, block = block_for("disinhibition")
    reads = re.findall(r'class="tr-read[^"]*"[^>]*>([^<]+)<', block)
    assert len(reads) == traces.SCRUB_ZONES

    zone = traces.SCRUB_ZONES // 2
    text = reads[zone]
    expected_time = (zone + 0.5) / traces.SCRUB_ZONES * model.run.duration
    assert text.startswith(f"{expected_time:.0f} мс")

    values = result.traces["PYR.soma:v"]
    index = zone * len(values) // traces.SCRUB_ZONES
    assert f"PYR {values[index]:.1f}".replace("-", "−") in text
    # спайк -- событие, поэтому отметка, а не число
    assert f"SST {traces.SPIKE_MARK}" in text or f"SST {traces.IDLE_MARK}" in text
