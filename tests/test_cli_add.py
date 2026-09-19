"""`vnl add`: положить готовую схему в библиотеку из терминала."""

from pathlib import Path

import pytest

from vnl.cli import main
from vnl.patterns import DRAFT_LEVEL
from vnl.store import Store

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
FFI = str(EXAMPLES / "ffi.vnl")


def test_a_level_outside_the_catalog_is_refused(tmp_path):
    """Ступени перечисляет каталог, и ступени механизмов среди них нет.

    Свойство одного контакта -- не схема, и класть его в библиотеку незачем:
    место такому в палитре примитивов. Отсюда и отказ на «M»: если бы ступень
    приняли молча, механизмы расползлись бы по каталогу как обычные схемы.
    """
    with pytest.raises(SystemExit):
        main(
            [
                "add",
                FFI,
                "--root",
                str(tmp_path),
                "--level",
                "M",
                "--port",
                "in=IN.soma",
            ]
        )
    assert not (tmp_path / "patterns").exists()


def test_without_a_level_it_lands_on_the_draft_step(tmp_path):
    """Умолчание -- первая ступень схем, а не «вычислительный примитив»."""
    main(["add", FFI, "--root", str(tmp_path), "--id", "x", "--port", "in=IN.soma"])
    assert Store(tmp_path).load_pattern("x").level == DRAFT_LEVEL


def test_a_pattern_with_ports_is_ready(tmp_path):
    code = main(
        [
            "add",
            FFI,
            "--root",
            str(tmp_path),
            "--name",
            "FFI",
            "--id",
            "ffi",
            "--port",
            "in=IN.soma",
            "--port",
            "out=E.soma",
        ]
    )
    assert code == 0

    pattern = Store(tmp_path).load_pattern("ffi")
    assert pattern.status == "ready"
    assert pattern.validate() == []
    assert [port.name for port in pattern.ports] == ["in", "out"]
    # Стимулы и записи уехали в витрину сами -- карточка сразу с демонстрацией.
    assert pattern.body.stimuli == []
    assert pattern.demo is not None and pattern.demo.stimuli


def test_without_ports_it_is_a_draft(tmp_path, capsys):
    main(["add", FFI, "--root", str(tmp_path), "--name", "Без портов"])
    pattern = Store(tmp_path).patterns()[0]
    assert pattern.status == "draft"
    assert "нет ни одного порта" in capsys.readouterr().err


def test_a_port_can_carry_its_own_name(tmp_path):
    main(
        [
            "add",
            str(EXAMPLES / "disinhibition.vnl"),
            "--root",
            str(tmp_path),
            "--id",
            "dis",
            "--level",
            "L1",
            "--port",
            "in=IN.soma",
            "--port",
            "dopamine:mod=VTA.soma",
        ]
    )
    pattern = Store(tmp_path).load_pattern("dis")
    assert pattern.level == "L1"
    modulating = pattern.port("dopamine")
    assert modulating.direction == "mod"
    assert modulating.site.instance == "VTA"


def test_a_place_inside_the_dendrite_survives(tmp_path):
    main(
        [
            "add",
            FFI,
            "--root",
            str(tmp_path),
            "--id",
            "ffi",
            "--port",
            "in=E.dend.apical[1]@0.6",
        ]
    )
    site = Store(tmp_path).load_pattern("ffi").port("in").site
    assert site.section == "dend.apical[1]"
    assert site.fraction == pytest.approx(0.6)


def test_a_wrong_port_is_named_not_guessed(tmp_path, capsys):
    """Неверный порт -- обычный исход работы: сообщение и код 1, а не трасса."""
    for spec in ("in", "вход=IN.soma", "in="):
        assert main(["add", FFI, "--root", str(tmp_path), "--port", spec]) == 1
        assert spec in capsys.readouterr().err
    assert Store(tmp_path).patterns() == [], "при отказе в библиотеку ничего не легло"


def test_the_second_pattern_of_the_same_name_gets_its_own_id(tmp_path):
    main(["add", FFI, "--root", str(tmp_path), "--name", "Схема"])
    main(["add", FFI, "--root", str(tmp_path), "--name", "Схема"])
    ids = sorted(item.id for item in Store(tmp_path).patterns())
    assert len(ids) == 2, "одноимённый паттерн не должен затирать прежний"


def test_a_port_can_carry_a_label(tmp_path):
    """Подпись порта -- то, что человек читает в интерфейсе, а не имя."""
    main(
        [
            "add",
            FFI,
            "--root",
            str(tmp_path),
            "--id",
            "ffi",
            "--port",
            "in=IN.soma",
            "--note",
            "in=вход схемы",
        ]
    )
    assert Store(tmp_path).load_pattern("ffi").port("in").note == "вход схемы"


def test_a_label_without_text_is_refused(tmp_path, capsys):
    assert main(["add", FFI, "--root", str(tmp_path), "--note", "in"]) == 1
    assert "имя=текст" in capsys.readouterr().err
