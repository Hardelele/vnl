"""Парсер поверхностного синтаксиса .vnl в IR.

Текстовый файл -- исходник; визуальный редактор будет его проекцией, а не
отдельным форматом проекта.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import ir, protocols
from .morphology import Morphology, Section
from .units import looks_like_quantity, parse_quantity

_TOKEN = re.compile(
    r"""
    (?P<space>[ \t]+)
  | (?P<comment>\#[^\n]*)
  | (?P<newline>\r?\n)
  | (?P<arrow>->)
  | (?P<lbrace>\{)
  | (?P<rbrace>\})
  | (?P<eq>=)
  | (?P<colon>:)
  | (?P<comma>,)
  | (?P<semicolon>;)
  | (?P<string>"[^"]*")
  | (?P<quantity>[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[a-zA-Zµ]*)
  | (?P<name>[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*(?:\[\d+\])?(?:@[0-9.]+)?)
    """,
    re.VERBOSE,
)

_VARS = frozenset(ir.RECORDED)


class ParseError(SyntaxError):
    pass


@dataclass(frozen=True)
class Token:
    kind: str
    text: str
    line: int


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    line = 1
    pos = 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ParseError(f"строка {line}: непонятный символ {text[pos]!r}")
        kind = m.lastgroup
        assert kind is not None
        value = m.group()
        pos = m.end()
        if kind == "newline":
            tokens.append(Token("newline", "\n", line))
            line += 1
        elif kind in ("space", "comment"):
            continue
        else:
            tokens.append(Token(kind, value, line))
    tokens.append(Token("eof", "", line))
    return tokens


class _Cursor:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.i = 0

    @property
    def now(self) -> Token:
        return self.tokens[self.i]

    def take(self, *kinds: str) -> Token:
        token = self.now
        if kinds and token.kind not in kinds:
            raise ParseError(
                f"строка {token.line}: ожидалось {'/'.join(kinds)}, "
                f"а встретилось {token.text!r}"
            )
        self.i += 1
        return token

    def accept(self, kind: str) -> Token | None:
        if self.now.kind == kind:
            return self.take()
        return None

    def skip_separators(self) -> None:
        while self.now.kind in ("newline", "semicolon", "comma"):
            self.i += 1


def _coerce(text: str) -> Any:
    if text.startswith('"'):
        return text[1:-1]
    if looks_like_quantity(text):
        return parse_quantity(text)[0]
    if text in ("true", "false"):
        return text == "true"
    return text


def _parse_block(cur: _Cursor) -> dict[str, Any]:
    """{ k = v, k = v, k = name { ... } } -> dict."""
    cur.take("lbrace")
    out: dict[str, Any] = {}
    while True:
        cur.skip_separators()
        if cur.accept("rbrace"):
            return out
        if cur.now.kind == "eof":
            raise ParseError(f"строка {cur.now.line}: незакрытая скобка")
        key = cur.take("name").text
        cur.take("eq")
        if cur.now.kind == "lbrace":
            out[key] = _parse_block(cur)
        else:
            token = cur.take("name", "quantity", "string")
            if cur.now.kind == "lbrace":  # правило с параметрами: stdp { ... }
                out[key] = {"_kind": token.text, **_parse_block(cur)}
            else:
                out[key] = _coerce(token.text)


def _parse_flat_params(cur: _Cursor) -> dict[str, Any]:
    """key=val key=val ... до конца строки."""
    out: dict[str, Any] = {}
    while cur.now.kind == "name":
        save = cur.i
        key = cur.take("name").text
        if not cur.accept("eq"):
            cur.i = save
            break
        token = cur.take("name", "quantity", "string")
        out[key] = _coerce(token.text)
        cur.accept("comma")
    return out


def _parse_morphology(cur: _Cursor) -> Morphology:
    name = cur.take("name").text
    morph = Morphology(name=name)
    cur.take("lbrace")
    while True:
        cur.skip_separators()
        if cur.accept("rbrace"):
            break
        if cur.now.kind == "eof":
            raise ParseError(f"морфология {name!r}: незакрытая скобка")
        path = cur.take("name").text
        parent: str | None = None
        if cur.now.kind == "name" and cur.now.text == "from":
            cur.take("name")
            parent = cur.take("name").text
        params = _parse_flat_params(cur)
        count = 1
        base = path
        indexed = re.match(r"^(?P<base>.+)\[(?P<n>\d+)\]$", path)
        if indexed:
            base, count = indexed.group("base"), int(indexed.group("n"))
        kind = base.split(".")[0]
        if kind not in ("soma", "dend", "axon"):
            raise ParseError(
                f"морфология {name!r}: участок {path!r} должен начинаться "
                f"с soma, dend или axon"
            )
        if parent is None and kind != "soma":
            parent = "soma"
        for index in range(count):
            section_id = f"{base}[{index}]" if indexed else base
            morph.add(
                Section(
                    id=section_id,
                    kind=kind,
                    parent=parent,
                    length=float(params.get("len", 100.0)),
                    diam=float(params.get("diam", 2.0)),
                    lambda_dc=float(params.get("lambda", 250.0)),
                )
            )
    if "soma" not in morph.sections:
        raise ParseError(f"морфология {name!r}: нет секции soma")
    return morph


_POINT_KEYS = {
    "tau_m": "tau_m",
    "v_rest": "v_rest",
    "rest": "v_rest",
    "v_reset": "v_reset",
    "threshold": "v_threshold",
    "v_threshold": "v_threshold",
    "refractory": "refractory",
    "r_in": "r_in",
    "adaptation": "adaptation",
    "tau_adaptation": "tau_adaptation",
    # `adex`: у него `v_threshold` -- не порог, а точка разгона, и в тексте
    # схемы её привычнее звать `v_t`. Это тот же псевдоним, что `threshold`,
    # только для второго вида модели.
    "v_t": "v_threshold",
    "delta_t": "delta_t",
    "v_peak": "v_peak",
    "tau_w": "tau_w",
    "a": "w_coupling",
    "b": "w_increment",
}


def _build_point_model(params: dict[str, Any]) -> ir.PointModel:
    kwargs: dict[str, Any] = {}
    for key, value in params.items():
        if key in _POINT_KEYS:
            kwargs[_POINT_KEYS[key]] = float(value)
    kind = params.get("point", "lif")
    return ir.PointModel(kind=str(kind), **kwargs)


def _short_term(spec: Any, kind: str) -> dict[str, Any]:
    if not spec:
        return {}
    if not isinstance(spec, dict):
        raise ParseError(f"описание {kind} должно быть блоком, а не {spec!r}")
    out: dict[str, Any] = {}
    for key in ("u", "tau_rec", "tau_facil"):
        if key in spec:
            out[key] = float(spec[key])
    if kind == "depression" and "tau_rec" not in out:
        out["tau_rec"] = 800.0
    if kind == "facilitation" and "tau_facil" not in out:
        out["tau_facil"] = 100.0
    return out


def _build_plasticity(spec: Any) -> ir.Plasticity:
    if isinstance(spec, str):
        return ir.Plasticity(rule=spec)
    if not isinstance(spec, dict):
        raise ParseError(f"непонятное описание пластичности: {spec!r}")
    rule = str(spec.get("_kind", spec.get("rule", "stdp")))
    plast = ir.Plasticity(rule=rule, modulator=spec.get("modulator"))
    for key, value in spec.items():
        if key in ("_kind", "rule", "modulator"):
            continue
        if not hasattr(plast, key):
            raise ParseError(f"у пластичности нет параметра {key!r}")
        setattr(plast, key, float(value))
    return plast


# Промежуточные записи: адреса ещё не разрешены в Site -- это делает resolve.


@dataclass
class PendingContact:
    id: str
    pre_address: str
    post_address: str
    receptor: str
    weight: float
    delay: float
    dynamics: ir.ShortTermDynamics
    plasticity: ir.Plasticity


@dataclass
class PendingStimulus:
    id: str
    target_address: str
    kind: str
    amplitude: float
    rate: float
    times: tuple[float, ...]
    start: float
    stop: float
    receptor: str
    #: Числа шаблона протокола: те же имена, что у полей `ir.Stimulus`.
    #: Словарём, потому что на этом шаге род ещё не проверен -- разбирать
    #: `train` как `tbs` парсер не должен, он только записывает написанное.
    shape: dict[str, float] = field(default_factory=dict)


@dataclass
class PendingRecording:
    id: str
    target_address: str
    var: str


@dataclass
class ParsedModel:
    """Результат разбора: IR без разрешённых адресов."""

    name: str
    source: str | None
    cell_types: dict[str, ir.CellType]
    instances: dict[str, ir.Instance]
    modulators: dict[str, ir.Modulator]
    contacts: list[PendingContact]
    stimuli: list[PendingStimulus]
    recordings: list[PendingRecording]
    run: ir.RunSpec


class Parser:
    def __init__(self, text: str, source: str | None = None) -> None:
        self.cur = _Cursor(tokenize(text))
        self.source = source
        self.name = "model"
        self.morphologies: dict[str, Morphology] = {}
        self.cell_types: dict[str, ir.CellType] = {}
        self.instances: dict[str, ir.Instance] = {}
        self.modulators: dict[str, ir.Modulator] = {}
        self.contacts: list[PendingContact] = []
        self.stimuli: list[PendingStimulus] = []
        self.recordings: list[PendingRecording] = []
        self.run = ir.RunSpec()

    def parse(self) -> ParsedModel:
        cur = self.cur
        handlers = {
            "model": self._stmt_model,
            "morphology": self._stmt_morphology,
            "cell": self._stmt_cell,
            "neuron": self._stmt_neuron,
            "modulator": self._stmt_modulator,
            "stim": self._stmt_stim,
            "record": self._stmt_record,
            "run": self._stmt_run,
        }
        while True:
            cur.skip_separators()
            if cur.now.kind == "eof":
                break
            token = cur.now
            if token.kind != "name":
                raise ParseError(
                    f"строка {token.line}: неожиданный токен {token.text!r}"
                )
            handler = handlers.get(token.text)
            if handler is not None:
                cur.take("name")
                handler()
            else:
                self._stmt_contact()
        return ParsedModel(
            name=self.name,
            source=self.source,
            cell_types=self.cell_types,
            instances=self.instances,
            modulators=self.modulators,
            contacts=self.contacts,
            stimuli=self.stimuli,
            recordings=self.recordings,
            run=self.run,
        )

    # --- операторы -----------------------------------------------------

    def _stmt_model(self) -> None:
        self.name = self.cur.take("name", "string").text.strip('"')

    def _stmt_morphology(self) -> None:
        morph = _parse_morphology(self.cur)
        self.morphologies[morph.name] = morph

    def _stmt_cell(self) -> None:
        cur = self.cur
        name = cur.take("name").text
        tags: list[str] = []
        if cur.accept("colon"):
            while True:
                tags.append(cur.take("name").text)
                if not cur.accept("comma"):
                    break
        params: dict[str, Any] = {}
        if cur.now.kind == "lbrace":
            params = _parse_block(cur)
        morph_name = params.get("morphology")
        if morph_name is None:
            morph = Morphology.point(f"{name}.point")
        elif morph_name not in self.morphologies:
            raise ParseError(
                f"клетка {name!r}: неизвестная морфология {morph_name!r}"
            )
        else:
            morph = self.morphologies[str(morph_name)]
        transmitter = params.get("transmitter")
        if transmitter is None:
            for tag in tags:
                if tag in ("glutamate", "gaba", "acetylcholine", "dopamine"):
                    transmitter = tag
                    break
        self.cell_types[name] = ir.CellType(
            id=name,
            tags=tuple(tags),
            transmitter=None if transmitter is None else str(transmitter),
            morphology=morph,
            point_model=_build_point_model(params),
        )

    def _stmt_neuron(self) -> None:
        cur = self.cur
        name = cur.take("name").text
        cur.take("colon")
        cell_type = cur.take("name").text
        tags: list[str] = []
        while cur.accept("comma"):
            tags.append(cur.take("name").text)
        self.instances[name] = ir.Instance(
            id=name, cell_type=cell_type, tags=tuple(tags)
        )

    def _stmt_modulator(self) -> None:
        cur = self.cur
        name = cur.take("name").text
        transmitter = "dopamine"
        if cur.accept("colon"):
            transmitter = cur.take("name").text
        sources: list[str] = []
        if cur.now.kind == "name" and cur.now.text == "from":
            cur.take("name")
            while True:
                sources.append(cur.take("name").text)
                if not cur.accept("comma"):
                    break
        params = _parse_block(cur) if cur.now.kind == "lbrace" else {}
        self.modulators[name] = ir.Modulator(
            id=name,
            transmitter=transmitter,
            sources=tuple(sources),
            gain=float(params.get("gain", 1.0)),
            tau=float(params.get("tau", 200.0)),
        )

    def _stmt_contact(self) -> None:
        cur = self.cur
        pre = cur.take("name").text
        cur.take("arrow")
        post = cur.take("name").text
        params = _parse_block(cur) if cur.now.kind == "lbrace" else {}
        dynamics = ir.ShortTermDynamics(
            **{
                **_short_term(params.get("depression"), "depression"),
                **_short_term(params.get("facilitation"), "facilitation"),
                **_short_term(params.get("dynamics"), "dynamics"),
            }
        )
        plasticity = (
            _build_plasticity(params["plasticity"])
            if "plasticity" in params
            else ir.Plasticity()
        )
        self.contacts.append(
            PendingContact(
                id=str(params.get("id", f"c{len(self.contacts) + 1}")),
                pre_address=pre,
                post_address=post,
                receptor=str(params.get("receptor", "ampa")),
                weight=float(params.get("weight", 1.0)),
                delay=float(params.get("delay", 1.0)),
                dynamics=dynamics,
                plasticity=plasticity,
            )
        )

    def _stmt_stim(self) -> None:
        cur = self.cur
        name = cur.take("name").text
        cur.take("arrow")
        target = cur.take("name").text
        kind = "current"
        if cur.accept("colon"):
            kind = cur.take("name").text
        params = (
            _parse_block(cur)
            if cur.now.kind == "lbrace"
            else _parse_flat_params(cur)
        )
        times = str(params.get("times", ""))
        # Числа шаблона: написанные перекрывают канонические. Канонические
        # берутся из реестра, а не пишутся здесь, потому что «поезд по
        # умолчанию -- 8 импульсов на 20 Гц» -- предметное знание, и второе
        # его место разошлось бы с первым (#508). Неизвестный род сюда не
        # доедет: о нём скажет резолвер, а `defaults` до тех пор пусто.
        #
        # Только шаблоны: у `poisson` частоту по умолчанию не подставляем
        # нарочно. `poisson` без `rate` -- это недописанный стимул, и молча
        # выданные 250 Гц спрятали бы описку, которую сегодня видно отказом.
        # У шаблона же готовые числа -- половина смысла: протокол на то и
        # протокол, что его канонические значения известны.
        shape = protocols.defaults(kind) if kind in protocols.TEMPLATES else {}
        for key, canonical in list(shape.items()):
            if key in params:
                # Счётное остаётся счётным: `n = 8` -- это восемь импульсов, а
                # не 8.0, и в хранилище оно обязано лечь тем же типом, каким
                # объявлено в `ir.Stimulus`.
                shape[key] = (
                    int(params[key])
                    if isinstance(canonical, int)
                    else float(params[key])
                )
        self.stimuli.append(
            PendingStimulus(
                id=name,
                target_address=target,
                kind=kind,
                amplitude=float(params.get("amplitude", params.get("weight", 0.0))),
                rate=float(params.get("rate", 0.0)),
                times=tuple(float(x) for x in times.replace(",", " ").split() if x),
                start=float(params.get("start", 0.0)),
                stop=float(params.get("stop", float("inf"))),
                receptor=str(params.get("receptor", "ampa")),
                shape=shape,
            )
        )

    def _stmt_record(self) -> None:
        cur = self.cur
        address = cur.take("name").text
        var = "v"
        if cur.accept("colon"):
            var = cur.take("name").text
        else:
            head, _, tail = address.rpartition(".")
            if tail in _VARS and head:
                address, var = head, tail
        self.recordings.append(
            PendingRecording(
                id=f"r{len(self.recordings) + 1}",
                target_address=address,
                var=var,
            )
        )

    def _stmt_run(self) -> None:
        params = _parse_block(self.cur)
        level = str(params.get("level", "L1"))
        if level not in ("L0", "L1", "L2"):
            raise ParseError(f"неизвестный уровень детализации: {level!r}")
        self.run = ir.RunSpec(
            dt=float(params.get("dt", 0.1)),
            duration=float(params.get("duration", 500.0)),
            level=level,  # type: ignore[arg-type]
            seed=int(params.get("seed", 1)),
        )


def parse(text: str, source: str | None = None) -> ParsedModel:
    return Parser(text, source=source).parse()
