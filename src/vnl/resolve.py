"""Разрешение логических адресов в Site и проверка модели.

Логический адрес (`A.dend.apical[2]@0.72`) хранится в исходнике; здесь он
превращается в `Site(instance, section, fraction)`. Всё, что невозможно
разрешить или что выглядит подозрительно, попадает в диагностику, а не
исчезает молча.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import ir
from .morphology import MorphologyError
from .parser import ParsedModel, PendingContact, PendingRecording, PendingStimulus

_VARS = {"v", "spikes", "g", "w"}
_EXCITATORY = {"ampa", "nmda", "nicotinic"}
_INHIBITORY = {"gaba_a", "gaba_b"}


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
        if transmitter == "gaba" and pending.receptor in _EXCITATORY:
            self.warn(
                where,
                f"клетка {pre.instance} помечена как ГАМК-ергическая, "
                f"а рецептор {pending.receptor} возбуждающий",
            )
        if transmitter == "glutamate" and pending.receptor in _INHIBITORY:
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
        if pending.kind not in ("current", "poisson", "spikes"):
            self.error(where, f"неизвестный вид стимула {pending.kind!r}")
            return None
        if pending.kind == "poisson" and pending.rate <= 0:
            self.error(where, "для poisson нужна положительная rate")
        if pending.kind == "spikes" and not pending.times:
            self.error(where, 'для spikes нужен times = "10 20 30"')
        if pending.kind in ("poisson", "spikes") and pending.amplitude <= 0:
            self.error(where, "нужен положительный weight входного контакта")
        if pending.receptor not in ir.RECEPTORS:
            self.error(where, f"неизвестный рецептор {pending.receptor!r}")
            return None
        return ir.Stimulus(
            id=pending.id,
            target=target,
            kind=pending.kind,
            amplitude=pending.amplitude,
            rate=pending.rate,
            times=pending.times,
            start=pending.start,
            stop=pending.stop,
            receptor=pending.receptor,
        )

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


def resolve(parsed: ParsedModel, strict: bool = True) -> tuple[ir.Model, list[Diagnostic]]:
    """ParsedModel -> Model с разрешёнными адресами.

    strict=True поднимает ValidationError, если есть ошибки.
    """
    resolver = _Resolver(parsed)

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

    seen: set[str] = set()
    for contact in model.contacts:
        if contact.id in seen:
            resolver.error(f"контакт {contact.id}", "повторяющийся идентификатор")
        seen.add(contact.id)

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
