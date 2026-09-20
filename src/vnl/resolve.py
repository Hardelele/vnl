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
from .parser import (
    ParsedModel,
    PendingContact,
    PendingMotor,
    PendingRecording,
    PendingSensor,
    PendingStimulus,
)

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

    def _written_reversal(
        self,
        where: str,
        written: float | None,
        reversal: float,
        point: ir.PointModel,
        post: ir.Site,
    ) -> None:
        """Сказать вслух про подозрительный написанный реверсал.

        Проверяется написанное руками, а не взятое из реестра. `ampa` со своим
        нулём выше порога любой клетки, и ругайся мы на реестр -- предупреждение
        выпадало бы на каждую вторую связь в каждой схеме, то есть приучило бы
        их не читать. Написанный реверсал -- другое дело: человек нарочно вышел
        за реестр, и цена опечатки в знаке здесь максимальная, потому что модель
        посчитается и ответит неправдой.

        Случай ниже покоя тут не повторяется: про него уже говорит общий разбор
        полярности (`контакт через ampa тормозный (реверсал -70 мВ)`), и
        второе сообщение о том же числе было бы шумом.

        Отказа нет: реверсал выше порога -- законная вещь, просто он превращает
        контакт в генератор разрядов, и знать об этом надо заранее, а не по
        странной трассе.
        """
        if written is None or reversal < point.v_threshold:
            return
        self.warn(
            where,
            f"написан реверсал {reversal:g} мВ -- не ниже порога клетки "
            f"{post.instance} ({point.v_threshold:g} мВ): пока проводимость "
            f"открыта, мембрану держит выше порога, и клетка разряжается "
            f"подряд, как от генератора. Шунту нужен реверсал около покоя "
            f"({point.v_rest:g} мВ)",
        )

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

        # Полярность считается по числу, а не по имени рецептора: с #496
        # реверсал пишется параметром, и `gaba_a` с реверсалом на уровне покоя
        # ничего не тормозит. Спрашивать здесь имя значило бы ругаться на
        # честно написанный шунт и молчать про `ampa` с реверсалом -80 мВ.
        reversal = (
            ir.RECEPTORS[pending.receptor].reversal
            if pending.reversal is None
            else pending.reversal
        )
        point = self.parsed.cell_types[
            self.parsed.instances[post.instance].cell_type
        ].point_model
        polarity = ir.synapse_polarity(reversal, point)
        self._written_reversal(where, pending.reversal, reversal, point, post)

        transmitter = self.parsed.cell_types[
            self.parsed.instances[pre.instance].cell_type
        ].transmitter
        # Спор -- это разный знак, а не разное имя. Шунт от ГАМК-клетки не спор:
        # так и устроено торможение с хлорным реверсалом на уровне покоя, и
        # ругаться на него значило бы ругаться на учебник.
        if transmitter == "gaba" and polarity == ir.POLARITY_EXC:
            self.warn(
                where,
                f"клетка {pre.instance} помечена как ГАМК-ергическая, "
                f"а контакт через {pending.receptor} возбуждающий "
                f"(реверсал {reversal:g} мВ)",
            )
        if transmitter == "glutamate" and polarity == ir.POLARITY_INH:
            self.warn(
                where,
                f"клетка {pre.instance} помечена как глутаматергическая, "
                f"а контакт через {pending.receptor} тормозный "
                f"(реверсал {reversal:g} мВ)",
            )

        if pending.weight < 0:
            self.error(
                where,
                "вес контакта отрицателен; знак задаёт реверсал, а не вес",
            )
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
            reversal_override=pending.reversal,
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
        if pending.kind != "current" and pending.reversal is not None:
            self._written_reversal(
                where,
                pending.reversal,
                pending.reversal,
                self.parsed.cell_types[
                    self.parsed.instances[target.instance].cell_type
                ].point_model,
                target,
            )
        if pending.kind == "current" and pending.reversal is not None:
            # Инжекция тока не открывает проводимости вовсе, реверсала у неё
            # нет. Молча проглотить число нельзя: человек ждал бы шунта.
            self.error(
                where,
                "у токового стимула нет реверсала: он вливает ток, а не "
                "открывает проводимость",
            )
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
            reversal_override=pending.reversal,
            **pending.shape,  # type: ignore[arg-type]
        )
        # Шаблон проверяется тем же разворачиванием, каким он поедет в солвер:
        # «8 импульсов на 0 Гц» ловится здесь, до прогона, и называет параметр,
        # а не падает где-то внутри интегрирования. Отдельного списка правил
        # для шаблона нет -- правило одно, и оно в `protocols`.
        for problem in protocols.problems(stimulus):
            self.error(where, problem)
        return stimulus

    # --- граница с миром ------------------------------------------------

    def _numbers(
        self, where: str, kind_defaults: dict, params: dict, what: str
    ) -> dict | None:
        """Числа рода: написанные поверх канонических, с отказом на опечатку.

        Молча проглоченное `windwo = 50ms` означало бы мотор с окном по
        умолчанию и человека, который до конца опыта уверен в обратном.
        Канонические числа берутся из реестра родов -- второго места, где
        написано «окно по умолчанию 50 мс», в проекте быть не должно.
        """
        unknown = sorted(key for key in params if key not in kind_defaults)
        if unknown:
            known = ", ".join(kind_defaults) or "их нет вовсе"
            self.error(
                where,
                f"у {what} нет параметров: {', '.join(unknown)} (есть: {known})",
            )
            return None
        return {
            name: float(params.get(name, canonical))
            for name, canonical in kind_defaults.items()
        }

    def sensor(self, pending: PendingSensor) -> ir.Sensor | None:
        where = f"сенсор {pending.id}"
        if pending.kind not in protocols.SENSOR_KINDS:
            self.error(
                where,
                f"неизвестный род сенсора {pending.kind!r}; "
                f"есть {', '.join(protocols.SENSOR_KIND_IDS)}",
            )
            return None
        numbers = self._numbers(
            where,
            protocols.sensor_defaults(pending.kind),
            pending.params,
            "сенсора",
        )
        if numbers is None:
            return None
        sensor = ir.Sensor(id=pending.id, kind=pending.kind, **numbers)
        for problem in protocols.sensor_problems(sensor):
            self.error(where, problem)
        return sensor

    def motor(self, pending: PendingMotor) -> ir.Motor | None:
        where = f"мотор {pending.id}"
        if pending.kind not in protocols.MOTOR_KINDS:
            self.error(
                where,
                f"неизвестный род мотора {pending.kind!r}; "
                f"есть {', '.join(protocols.MOTOR_KIND_IDS)}",
            )
            return None
        source = self.site(pending.source_address, where, default_kind="soma")
        if source is None:
            return None
        numbers = self._numbers(
            where, protocols.motor_defaults(pending.kind), pending.params, "мотора"
        )
        if numbers is None:
            return None
        motor = ir.Motor(
            id=pending.id, source=source, kind=pending.kind, **numbers
        )
        for problem in protocols.motor_problems(motor):
            self.error(where, problem)
        return motor

    def sensor_link(
        self, pending: PendingContact, sensor_id: str
    ) -> ir.SensorLink | None:
        """`key -> MN.soma { weight = 2nS }` -- подключение сенсора к точке.

        Разбирается тем же оператором, что и связь между клетками, и проверки
        здесь те же: рецептор из списка, вес неотрицателен, задержка не меньше
        шага. Расходиться им нельзя -- для человека это одна и та же стрелка.
        """
        where = f"сенсор {sensor_id}"
        _, _, rest = pending.pre_address.partition(".")
        if rest:
            self.error(
                where,
                f"у сенсора нет участков: {pending.pre_address!r} -- "
                "подключается он целиком",
            )
            return None
        post = self.site(pending.post_address, where, default_kind="soma")
        if post is None:
            return None
        if pending.receptor not in ir.RECEPTORS:
            known = ", ".join(sorted(ir.RECEPTORS))
            self.error(
                where, f"неизвестный рецептор {pending.receptor!r} (есть: {known})"
            )
            return None
        if pending.weight < 0:
            self.error(where, "вес не бывает отрицательным: знак задаёт реверсал")
        self._written_reversal(
            where,
            pending.reversal,
            ir.RECEPTORS[pending.receptor].reversal
            if pending.reversal is None
            else pending.reversal,
            self.parsed.cell_types[
                self.parsed.instances[post.instance].cell_type
            ].point_model,
            post,
        )
        if pending.delay < self.parsed.run.dt:
            self.error(
                where,
                f"задержка {pending.delay} мс меньше шага интегрирования "
                f"{self.parsed.run.dt} мс",
            )
        if pending.dynamics.enabled or pending.plasticity.enabled:
            # Не отказ: запись законная, и однажды сенсорный вход научится и
            # истощаться, и учиться. Но молчать нельзя -- сейчас эти числа не
            # читает никто, и человек ждал бы от прогона совсем другого.
            self.warn(
                where,
                "кратковременная динамика и пластичность на входе сенсора не "
                "считаются: у сенсора нет пресинаптической клетки, а правило "
                "STDP считает порядок её спайков",
            )
        return ir.SensorLink(
            target=post,
            receptor=pending.receptor,
            weight=pending.weight,
            delay=pending.delay,
            reversal_override=pending.reversal,
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


def _check_point_model(resolver: _Resolver, cell_type: ir.CellType) -> None:
    """Мембрана: отказы из `ir.point_model_problems` плюс своё предупреждение.

    Отказы считаются не здесь нарочно (#527). Те же правила спрашивает правка
    мембраны в песочнице, и держи их разбор у себя -- на холсте собиралось бы
    то, чего файл потом не примет. Проверять при разборе, а не в симуляторе,
    по-прежнему обязательно: `vnl check` должен сказать это до прогона.

    Предупреждение остаётся здесь, а не уезжает в общий список: оно про то,
    что посчитается, но не так, как человек, скорее всего, думал, -- отказывать
    по нему нельзя, а сказать есть куда только разбору, у которого для этого
    есть адрес места в файле.
    """
    where = f"тип клетки {cell_type.id}"
    point = cell_type.point_model
    for problem in ir.point_model_problems(point):
        resolver.error(where, problem)
    if point.kind == "adex" and point.adaptation:
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
        _check_point_model(resolver, cell_type)

    for instance in parsed.instances.values():
        if instance.cell_type not in parsed.cell_types:
            known = ", ".join(sorted(parsed.cell_types)) or "типов нет"
            resolver.error(
                f"нейрон {instance.id}",
                f"неизвестный тип клетки {instance.cell_type!r} (есть: {known})",
            )

    # Граница с миром разбирается до контактов: стрелка `key -> MN.soma`
    # выглядит как связь, и понять, что слева сенсор, можно только зная список
    # сенсоров целиком. Порядок объявлений в файле при этом свободный -- сенсор
    # разрешено объявить и после подключения.
    sensors: dict[str, ir.Sensor] = {}
    for pending_sensor in parsed.sensors:
        where = f"сенсор {pending_sensor.id}"
        if pending_sensor.id in sensors:
            resolver.error(where, "повторяющийся идентификатор")
            continue
        if pending_sensor.id in parsed.instances:
            resolver.error(
                where,
                "имя занято нейроном: в схеме они живут в одном пространстве "
                "имён, иначе стрелка не сказала бы, откуда идёт сигнал",
            )
            continue
        sensor = resolver.sensor(pending_sensor)
        if sensor is not None:
            sensors[sensor.id] = sensor

    motors: dict[str, ir.Motor] = {}
    for pending_motor in parsed.motors:
        where = f"мотор {pending_motor.id}"
        if pending_motor.id in motors:
            resolver.error(where, "повторяющийся идентификатор")
            continue
        if pending_motor.id in parsed.instances or pending_motor.id in sensors:
            resolver.error(where, "имя занято нейроном или сенсором")
            continue
        motor = resolver.motor(pending_motor)
        if motor is not None:
            motors[motor.id] = motor

    contacts: list[ir.Contact] = []
    for pending_contact in parsed.contacts:
        head = pending_contact.pre_address.partition(".")[0]
        if head in sensors:
            link = resolver.sensor_link(pending_contact, head)
            if link is not None:
                sensors[head].targets.append(link)
            continue
        if head in motors or pending_contact.post_address.partition(".")[0] in motors:
            resolver.error(
                f"контакт {pending_contact.id}",
                "мотор не соединяется стрелкой: он смотрит на клетку "
                "(from = ...) и отдаёт величину наружу",
            )
            continue
        if pending_contact.post_address.partition(".")[0] in sensors:
            resolver.error(
                f"контакт {pending_contact.id}",
                "в сенсор ничего не входит: он дверь снаружи внутрь, а не "
                "клетка",
            )
            continue
        contact = resolver.contact(pending_contact)
        if contact is not None:
            contacts.append(contact)

    model = ir.Model(
        name=parsed.name,
        cell_types=parsed.cell_types,
        instances=parsed.instances,
        contacts=contacts,
        sensors=sensors,
        motors=motors,
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

    for sensor in model.sensors.values():
        if not sensor.targets:
            # Не отказ: сенсор объявляют раньше, чем подключают, и схема в
            # работе -- нормальное состояние. Но молчать нельзя: величина в
            # такой сенсор входит и не доходит никуда.
            resolver.warn(
                f"сенсор {sensor.id}",
                "ни к чему не подключён: величина войдёт и никуда не пойдёт; "
                f"нужна стрелка вида {sensor.id} -> <нейрон>.soma",
            )

    if not model.instances:
        resolver.warn("модель", "в модели нет ни одного нейрона")
    if not model.recordings and not model.motors:
        # Мотор -- тоже ответ прогона, только не графиком, а числом: схема с
        # мотором и без записей возвращает величину, и звать её пустой нечестно.
        resolver.warn("модель", "нет ни одной записи: прогон ничего не вернёт")

    if strict and any(d.severity == "error" for d in resolver.diagnostics):
        raise ValidationError(resolver.diagnostics)
    return model, resolver.diagnostics


def load(text: str, source: str | None = None, strict: bool = True):
    from .parser import parse

    return resolve(parse(text, source=source), strict=strict)
