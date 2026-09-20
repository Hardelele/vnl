"""Разрешение логических адресов в Site и проверка модели.

Логический адрес (`A.dend.apical[2]@0.72`) хранится в исходнике; здесь он
превращается в `Site(instance, section, fraction)`. Всё, что невозможно
разрешить или что выглядит подозрительно, попадает в диагностику, а не
исчезает молча.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import ir, protocols
from .morphology import MorphologyError
from .parser import ParsedModel, PendingContact, PendingRecording, PendingStimulus

_VARS = frozenset(ir.RECORDED)


class ValidationError(ValueError):
    def __init__(self, diagnostics: list["Diagnostic"]) -> None:
        self.diagnostics = diagnostics
        super().__init__(
            "модель не прошла проверку:\n"
            + "\n".join(f"  {d}" for d in diagnostics if d.severity == "error")
        )


@dataclass(frozen=True)
class Diagnostic:
    severity: str  # error | warning
    where: str
    message: str

    def __str__(self) -> str:
        mark = "ОШИБКА " if self.severity == "error" else "предупр."
        return f"{mark} [{self.where}] {self.message}"


class _Resolver:
    def __init__(self, parsed: ParsedModel) -> None:
        self.parsed = parsed
        self.diagnostics: list[Diagnostic] = []
        self._notes: set[str] = set()

    def error(self, where: str, message: str) -> None:
        self.diagnostics.append(Diagnostic("error", where, message))

    def warn(self, where: str, message: str) -> None:
        self.diagnostics.append(Diagnostic("warning", where, message))

    # --- адреса --------------------------------------------------------

    def site(self, address: str, where: str, default_kind: str) -> ir.Site | None:
        instance_id, _, rest = address.partition(".")
        instance = self.parsed.instances.get(instance_id)
        if instance is None:
            known = ", ".join(sorted(self.parsed.instances)) or "нейронов нет"
            self.error(where, f"неизвестный нейрон {instance_id!r} (есть: {known})")
            return None
        cell_type = self.parsed.cell_types.get(instance.cell_type)
        if cell_type is None:
            self.error(
                where,
                f"нейрон {instance_id!r} ссылается на неизвестный тип "
                f"{instance.cell_type!r}",
            )
            return None
        morph = cell_type.morphology
        if not rest:
            rest = default_kind if default_kind in morph.sections else "soma"
        try:
            section, fraction, note = morph.resolve_with_note(rest)
        except MorphologyError as exc:
            self.error(where, str(exc))
            return None
        if note is not None and note not in self._notes:
            self._notes.add(note)
            self.warn(where, note)
        return ir.Site(instance=instance_id, section=section, fraction=fraction)

    def kind_of(self, site: ir.Site) -> str:
        instance = self.parsed.instances[site.instance]
        morph = self.parsed.cell_types[instance.cell_type].morphology
        return morph.kind_of(site.section)

    # --- сущности ------------------------------------------------------

    def contact(self, pending: PendingContact) -> ir.Contact | None:
        where = f"контакт {pending.id}"
        pre = self.site(pending.pre_address, where, default_kind="axon")
        post = self.site(pending.post_address, where, default_kind="soma")
        if pre is None or post is None:
            return None

        if pending.receptor not in ir.RECEPTORS:
            known = ", ".join(sorted(ir.RECEPTORS))
            self.error(
                where,
                f"неизвестный рецептор {pending.receptor!r} (есть: {known})",
            )
            return None

        if self.kind_of(post) == "axon":
            # Аксо-аксональный контакт в L1 не гасит чужой выброс, а вливает
            # проводимость в мембрану всей клетки -- то есть работает как
            # обычное сомальное торможение. Молчать об этом нельзя: модель
            # посчитается, но ответит не про то, что написано.
            self.warn(
                where,
                f"постсинаптическая сторона на аксоне ({post}); "
                "пресинаптическое торможение на уровне L1 не считается, "
                "контакт подействует на мембрану всей клетки",
            )

        pre_kind = self.kind_of(pre)
        if pre_kind == "dend":
            self.warn(
                where,
                f"пресинаптическая сторона на дендрите ({pre}); "
                f"дендро-дендритный контакт допустим, но проверьте, не опечатка ли",
            )

        transmitter = self.parsed.cell_types[
            self.parsed.instances[pre.instance].cell_type
        ].transmitter
        if transmitter == "gaba" and not ir.is_inhibitory_receptor(pending.receptor):
            self.warn(
                where,
                f"клетка {pre.instance} помечена как ГАМК-ергическая, "
                f"а рецептор {pending.receptor} возбуждающий",
            )
        if transmitter == "glutamate" and ir.is_inhibitory_receptor(pending.receptor):
            self.warn(
                where,
                f"клетка {pre.instance} помечена как глутаматергическая, "
                f"а рецептор {pending.receptor} тормозный",
            )

        if pending.weight < 0:
            self.error(where, "вес контакта отрицателен; знак задаётся рецептором")
        if pending.delay < self.parsed.run.dt:
            self.error(
                where,
                f"задержка {pending.delay} мс меньше шага интегрирования "
                f"{self.parsed.run.dt} мс",
            )

        plasticity = pending.plasticity
        if plasticity.rule not in ("none", "stdp", "stdp_rl"):
            self.error(where, f"неизвестное правило пластичности {plasticity.rule!r}")
        if plasticity.rule == "stdp_rl":
            if plasticity.modulator is None:
                if len(self.parsed.modulators) == 1:
                    plasticity.modulator = next(iter(self.parsed.modulators))
                else:
                    self.error(
                        where,
                        "для stdp_rl нужен modulator = <id>: "
                        "модуляторов в модели не один",
                    )
            elif plasticity.modulator not in self.parsed.modulators:
                self.error(
                    where, f"неизвестный модулятор {plasticity.modulator!r}"
                )
        if plasticity.enabled and plasticity.w_max <= plasticity.w_min:
            self.error(where, "w_max должен быть больше w_min")

        return ir.Contact(
            id=pending.id,
            pre=pre,
            post=post,
            receptor=pending.receptor,
            weight=pending.weight,
            delay=pending.delay,
            dynamics=pending.dynamics,
            plasticity=plasticity,
        )

    def stimulus(self, pending: PendingStimulus) -> ir.Stimulus | None:
        where = f"стимул {pending.id}"
        target = self.site(pending.target_address, where, default_kind="soma")
        if target is None:
            return None
        if pending.kind not in protocols.KINDS:
            self.error(
                where,
                f"неизвестный вид стимула {pending.kind!r}; "
                f"есть {', '.join(protocols.KINDS)}",
            )
            return None
        if pending.kind == "poisson" and pending.rate <= 0:
            self.error(where, "для poisson нужна положительная rate")
        if pending.kind == "spikes" and not pending.times:
            self.error(where, 'для spikes нужен times = "10 20 30"')
        if pending.kind != "current" and pending.amplitude <= 0:
            self.error(where, "нужен положительный weight входного контакта")
        if pending.receptor not in ir.RECEPTORS:
            self.error(where, f"неизвестный рецептор {pending.receptor!r}")
            return None
        stimulus = ir.Stimulus(
            id=pending.id,
            target=target,
            kind=pending.kind,
            amplitude=pending.amplitude,
            rate=pending.rate,
            times=pending.times,
            start=pending.start,
            stop=pending.stop,
            receptor=pending.receptor,
            **pending.shape,  # type: ignore[arg-type]
        )
        # Шаблон проверяется тем же разворачиванием, каким он поедет в солвер:
        # «8 импульсов на 0 Гц» ловится здесь, до прогона, и называет параметр,
        # а не падает где-то внутри интегрирования. Отдельного списка правил
        # для шаблона нет -- правило одно, и оно в `protocols`.
        for problem in protocols.problems(stimulus):
            self.error(where, problem)
        return stimulus

    def recording(self, pending: PendingRecording) -> ir.Recording | None:
        where = f"запись {pending.id}"
        target = self.site(pending.target_address, where, default_kind="soma")
        if target is None:
            return None
        if pending.var not in _VARS:
            self.error(
                where,
                f"нельзя записывать {pending.var!r}; доступно: "
                f"{', '.join(sorted(_VARS))}",
            )
            return None
        return ir.Recording(id=pending.id, target=target, var=pending.var)

    def modulators(self) -> dict[str, ir.Modulator]:
        out: dict[str, ir.Modulator] = {}
        for name, modulator in self.parsed.modulators.items():
            where = f"модулятор {name}"
            missing = [s for s in modulator.sources if s not in self.parsed.instances]
            if missing:
                self.error(where, f"неизвестные источники: {', '.join(missing)}")
                continue
            if not modulator.sources:
                self.warn(where, "нет источников: концентрация всегда нулевая")
            out[name] = modulator
        return out


def _check_adex(resolver: _Resolver, cell_type: ir.CellType) -> None:
    """Проверки, без которых клетка `adex` считается не тем, чем выглядит.

    Каждая из них ловит случай, где уравнение остаётся считаемым, но перестаёт
    быть тем, что человек описал. Молчать про такое хуже, чем отказать:
    получится числовой ответ, по которому нельзя догадаться, что спросили не
    то. Проверять здесь, а не в симуляторе, затем, что `vnl check` обязан
    сказать это до прогона.
    """
    where = f"тип клетки {cell_type.id}"
    point = cell_type.point_model
    if point.delta_t <= 0.0:
        resolver.error(
            where,
            f"delta_t = {point.delta_t:g} мВ: резкость разгона обязана быть "
            "положительной, иначе экспоненциального члена нет вовсе и клетка "
            "сводится к lif с порогом на v_peak",
        )
    if point.tau_w <= 0.0:
        resolver.error(
            where,
            f"tau_w = {point.tau_w:g} мс: постоянная тока адаптации обязана "
            "быть положительной, иначе ток ничего не помнит и ни пачки, ни "
            "отдачи из него не получится",
        )
    if point.v_peak <= point.v_threshold:
        resolver.error(
            where,
            f"v_peak = {point.v_peak:g} мВ не выше v_t = {point.v_threshold:g} мВ: "
            "разряд признавался бы раньше, чем начинается разгон, и "
            "экспоненциальный член никогда не заработал бы",
        )
    if point.v_reset >= point.v_peak:
        resolver.error(
            where,
            f"v_reset = {point.v_reset:g} мВ не ниже v_peak = {point.v_peak:g} мВ: "
            "после сброса клетка сразу выше потенциала разряда и будет "
            "разряжаться до конца прогона независимо от входа; для пачки "
            "v_reset ставят между v_t и v_peak",
        )
    if point.adaptation:
        resolver.warn(
            where,
            f"adaptation = {point.adaptation:g} мВ у adex не читается: "
            "адаптация здесь выражена током w, и задаётся она через b и tau_w",
        )


def resolve(parsed: ParsedModel, strict: bool = True) -> tuple[ir.Model, list[Diagnostic]]:
    """ParsedModel -> Model с разрешёнными адресами.

    strict=True поднимает ValidationError, если есть ошибки.
    """
    resolver = _Resolver(parsed)

    for cell_type in parsed.cell_types.values():
        kind = cell_type.point_model.kind
        if kind not in ir.POINT_MODELS:
            known = ", ".join(ir.POINT_MODELS)
            resolver.error(
                f"тип клетки {cell_type.id}",
                f"точечная модель {kind!r} не реализована (есть: {known}); "
                "считать её как другую значило бы молча подменить физику",
            )
        elif kind == "adex":
            _check_adex(resolver, cell_type)

    for instance in parsed.instances.values():
        if instance.cell_type not in parsed.cell_types:
            known = ", ".join(sorted(parsed.cell_types)) or "типов нет"
            resolver.error(
                f"нейрон {instance.id}",
                f"неизвестный тип клетки {instance.cell_type!r} (есть: {known})",
            )

    model = ir.Model(
        name=parsed.name,
        cell_types=parsed.cell_types,
        instances=parsed.instances,
        contacts=[
            contact
            for contact in (resolver.contact(p) for p in parsed.contacts)
            if contact is not None
        ],
        modulators=resolver.modulators(),
        stimuli=[
            stim
            for stim in (resolver.stimulus(p) for p in parsed.stimuli)
            if stim is not None
        ],
        recordings=[
            rec
            for rec in (resolver.recording(p) for p in parsed.recordings)
            if rec is not None
        ],
        run=parsed.run,
        source=parsed.source,
    )

    # Две записи одной величины с одного участка писали бы в одну трассу по
    # два значения за шаг и разъезжались со шкалой времени -- дубль отбрасываем.
    unique: list[ir.Recording] = []
    seen_records: set[tuple[str, str, float, str]] = set()
    for recording in model.recordings:
        key = (
            recording.target.instance,
            recording.target.section,
            recording.target.fraction,
            recording.var,
        )
        if key in seen_records:
            resolver.warn(
                f"запись {recording.id}",
                f"повтор записи {recording.target}.{recording.var}: пропущена",
            )
            continue
        seen_records.add(key)
        unique.append(recording)
    model.recordings = unique

    seen: set[str] = set()
    for contact in model.contacts:
        if contact.id in seen:
            resolver.error(f"контакт {contact.id}", "повторяющийся идентификатор")
        seen.add(contact.id)

    # Протоколы, на которых движку верить нельзя: не отказ, но и не молчание
    # (#508). Условие живёт в `protocols` -- там же, где сам протокол, -- и
    # оттуда же его берёт песочница через `compose`.
    for caution in protocols.cautions(model):
        resolver.warn("протокол", caution)

    if not model.instances:
        resolver.warn("модель", "в модели нет ни одного нейрона")
    if not model.recordings:
        resolver.warn("модель", "нет ни одной записи: прогон ничего не вернёт")

    if strict and any(d.severity == "error" for d in resolver.diagnostics):
        raise ValidationError(resolver.diagnostics)
    return model, resolver.diagnostics


def load(text: str, source: str | None = None, strict: bool = True):
    from .parser import parse

    return resolve(parse(text, source=source), strict=strict)
