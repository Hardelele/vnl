"""Разрешение логических адресов в Site и проверка модели.

Логический адрес (`A.dend.apical[2]@0.72`) хранится в исходнике; здесь он
превращается в `Site(instance, section, fraction)`. Всё, что невозможно
разрешить или что выглядит подозрительно, попадает в диагностику, а не
исчезает молча.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from . import ir, protocols
from .morphology import MorphologyError
from .parser import (
    ParsedModel,
    parse_grid,
    PendingContact,
    PendingExpectation,
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
        self._say("error", where, message)

    def warn(self, where: str, message: str) -> None:
        self._say("warning", where, message)

    def _say(self, severity: str, where: str, message: str) -> None:
        """Сказать -- но не повторяться слово в слово.

        До слоёв клеток повтор был невозможен: у каждой стрелки свой контакт и
        свой `where`. Стрелка в слой из 576 клеток -- одна написанная строка, и
        претензия к ней («задержка меньше шага») тоже одна, сколько бы связей
        из неё ни вышло. 576 одинаковых строк в отчёте не добавляют ни одного
        слова и прячут за собой все остальные (#580).
        """
        note = Diagnostic(severity, where, message)
        if note in self.diagnostics:
            return
        self.diagnostics.append(note)

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

    # --- слои и поля ----------------------------------------------------

    def population_of(self, address: str) -> ir.Population | None:
        """Слой, к которому обращается адрес `R.soma`, или `None`.

        Слой узнаётся по имени в начале адреса -- ровно там же, где резолвер
        ищет нейрон. Для человека `R` и `R[3,7]` отличаются написанным
        индексом, а не видом стрелки: `R.soma` -- весь слой, `R[3,7].soma` --
        одна его клетка, и написанный индекс здесь и есть разница между
        «каждый к своему» и «вот в эту».
        """
        head = ir.head_of(address)
        if address[len(head):].startswith("["):
            return None
        return self.parsed.populations.get(head)

    @staticmethod
    def _member_address(address: str, member: str) -> str:
        """`R.soma` + `R[3,7]` -> `R[3,7].soma`."""
        _, _, rest = address.partition(".")
        return f"{member}.{rest}" if rest else member

    def spread(
        self, pre_address: str, post_address: str, where: str
    ) -> list[tuple[str, str]] | None:
        """Стрелка со слоями -> список обычных стрелок (#580).

        Три правила, и все три -- про то, что человек и так имел в виду:

        * слой в слой одного размера -- каждый к своему (`R[3,7] -> S[3,7]`).
          Ради этого слой и заводят: соседство в сетке обязано что-то значить,
          иначе не нужна была бы и сетка;
        * слой в клетку -- все к одной, клетка в слой -- одна ко всем;
        * слои разных размеров -- отказ с обоими числами. Молча растянуть
          16x16 на 24x24 значило бы выдумать соседство, которого человек не
          писал, а усечь -- потерять две трети схемы без единого слова.
        """
        pre_pop = self.population_of(pre_address)
        post_pop = self.population_of(post_address)
        if pre_pop is None and post_pop is None:
            return [(pre_address, post_address)]
        if pre_pop is not None and post_pop is not None:
            if (pre_pop.rows, pre_pop.cols) != (post_pop.rows, post_pop.cols):
                self.error(
                    where,
                    f"слои разного размера: {pre_pop.id} -- "
                    f"{pre_pop.rows}x{pre_pop.cols}, {post_pop.id} -- "
                    f"{post_pop.rows}x{post_pop.cols}; «каждый к своему» "
                    "требует одной сетки",
                )
                return None
            return [
                (
                    self._member_address(pre_address, pre_member),
                    self._member_address(post_address, post_member),
                )
                for pre_member, post_member in zip(
                    pre_pop.members(), post_pop.members()
                )
            ]
        if pre_pop is not None:
            return [
                (self._member_address(pre_address, member), post_address)
                for member in pre_pop.members()
            ]
        assert post_pop is not None
        return [
            (pre_address, self._member_address(post_address, member))
            for member in post_pop.members()
        ]

    def elements(
        self, sensor: ir.Sensor, address: str, where: str
    ) -> list[tuple[int, int]] | None:
        """То же, что `ir.Sensor.select`, только отказ -- диагностикой.

        Разбор адреса один на весь проект (см. `Sensor.select`): здесь только
        перевод его отказа в ту же диагностику, которой резолвер говорит про
        всё остальное.
        """
        try:
            return sensor.select(address)
        except ValueError as exc:
            self.error(where, str(exc))
            return None

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

    def contact(
        self, pending: PendingContact, where: str | None = None
    ) -> ir.Contact | None:
        # `where` приходит извне, когда стрелка развёрнута по слою: претензия
        # относится к написанной строке, а не к 576 её следствиям (#580).
        where = where or f"контакт {pending.id}"
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
        params = dict(pending.params)
        # Сетка и каналы вынимаются до чисел рода: они про размер двери, а не
        # про то, во что превращается величина, и спрашивать о них реестр
        # родов бессмысленно -- поле бывает у любого рода.
        written_grid = params.pop("grid", None)
        written_channels = params.pop("channels", None)
        grid = (1, 1)
        if written_grid is not None:
            parsed_grid = parse_grid(written_grid)
            if parsed_grid is None:
                self.error(
                    where,
                    f"сетка {written_grid!r} непонятна; пишется как 24x24",
                )
                return None
            grid = parsed_grid
        channels: tuple[str, ...] = ()
        if written_channels is not None:
            name = str(written_channels)
            if name not in protocols.SENSOR_CHANNELS:
                known = ", ".join(protocols.SENSOR_CHANNELS)
                self.error(
                    where, f"неизвестный набор каналов {name!r} (есть: {known})"
                )
                return None
            channels = protocols.SENSOR_CHANNELS[name]
        numbers = self._numbers(
            where,
            protocols.sensor_defaults(pending.kind),
            params,
            "сенсора",
        )
        if numbers is None:
            return None
        sensor = ir.Sensor(
            id=pending.id,
            kind=pending.kind,
            grid=grid,
            channels=channels,
            **numbers,
        )
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

    def sensor_links(
        self, pending: PendingContact, sensor: ir.Sensor
    ) -> list[ir.SensorLink]:
        """`key -> MN.soma { weight = 2nS }` -- подключение сенсора к точке.

        Разбирается тем же оператором, что и связь между клетками, и проверки
        здесь те же: рецептор из списка, вес неотрицателен, задержка не меньше
        шага. Расходиться им нельзя -- для человека это одна и та же стрелка.

        У поля стрелка одна, а связей столько, сколько величин она называет
        (#580): `eye.r -> R.soma` при сетке 24x24 -- это 576 связей, и каждая
        знает свой элемент. Разворачивается здесь, а не в симуляторе, по той же
        причине, по которой здесь разворачивается слой клеток: дальше по пути
        стоит обычная связь, и ни прогон, ни отчёт, ни экспорт не обязаны знать
        про сетки.
        """
        where = f"сенсор {sensor.id}"
        if pending.receptor not in ir.RECEPTORS:
            known = ", ".join(sorted(ir.RECEPTORS))
            self.error(
                where, f"неизвестный рецептор {pending.receptor!r} (есть: {known})"
            )
            return []
        if pending.weight < 0:
            self.error(where, "вес не бывает отрицательным: знак задаёт реверсал")
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

        _, _, rest = pending.pre_address.partition(".")
        if not sensor.is_field:
            if rest:
                self.error(
                    where,
                    f"у сенсора нет участков: {pending.pre_address!r} -- "
                    "подключается он целиком",
                )
                return []
            places = [(0, 0)]
        else:
            found = self.elements(sensor, pending.pre_address, where)
            if found is None:
                return []
            places = found

        targets = self._sensor_targets(sensor, pending, places, where)
        if targets is None:
            return []

        links: list[ir.SensorLink] = []
        for index, address in targets:
            post = self.site(address, where, default_kind="soma")
            if post is None:
                return []
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
            links.append(
                ir.SensorLink(
                    target=post,
                    receptor=pending.receptor,
                    weight=pending.weight,
                    delay=pending.delay,
                    reversal_override=pending.reversal,
                    index=index,
                )
            )
        return links

    def _sensor_targets(
        self,
        sensor: ir.Sensor,
        pending: PendingContact,
        places: list[tuple[int, int]],
        where: str,
    ) -> list[tuple[int, str]] | None:
        """Какая величина в какую точку: (номер величины, адрес точки).

        Слой той же сетки -- попиксельно, одиночная клетка -- все величины в
        неё (так и собирают сумматор яркости), один элемент в слой -- во все
        его клетки. Несовпадение сеток -- отказ с обоими числами: см. `spread`.
        """
        population = self.population_of(pending.post_address)
        if population is None:
            return [(index, pending.post_address) for _, index in places]
        pixels = {pixel for pixel, _ in places}
        if len(pixels) == population.size:
            members = population.members()
            return [
                (index, self._member_address(pending.post_address, members[pixel]))
                for pixel, index in places
            ]
        if len(pixels) == 1:
            return [
                (index, self._member_address(pending.post_address, member))
                for _, index in places
                for member in population.members()
            ]
        self.error(
            where,
            f"поле {sensor.id} называет {len(pixels)} пикселей, а в слое "
            f"{population.id} клеток {population.size} "
            f"({population.rows}x{population.cols}): «каждый к своему» требует "
            "одной сетки",
        )
        return None

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


_EXPECT_PARAMS = {"start", "stop", "base", "index", "level"}


def _expectation(
    resolver: _Resolver, model: ir.Model, pending: PendingExpectation
) -> ir.Expectation | None:
    """`E.soma.g_exc.max = 2.09nS` -> `ir.Expectation` с проверенным адресом.

    Проверяется здесь всё, что можно проверить без прогона: есть ли такой
    нейрон, записана ли величина, знакомо ли уточнение. Ожидание на незаписанную
    трассу -- самая обидная ошибка этого оператора: прогон молча не найдёт
    величину, и «проверка прошла» будет значить «проверять было нечего».
    """
    where = f"expect (строка {pending.line})"
    head, _, measure = pending.path.rpartition(".")

    target = ""
    if measure in ir.NEURON_MEASURES:
        if not head or "." in head:
            resolver.error(
                where,
                f"{pending.path!r}: величина растра пишется как <нейрон>.{measure}",
            )
            return None
        if head not in resolver.parsed.instances:
            known = ", ".join(sorted(resolver.parsed.instances)) or "нейронов нет"
            resolver.error(where, f"неизвестный нейрон {head!r} (есть: {known})")
            return None
        target = head
    elif measure in ir.TRACE_MEASURES:
        address, _, var = head.rpartition(".")
        if not var or var not in ir.RECORDED:
            resolver.error(
                where,
                f"{pending.path!r}: величина трассы пишется как "
                f"<нейрон>.<участок>.<что>.{measure}, где <что> -- одно из "
                f"{', '.join(sorted(ir.RECORDED))}",
            )
            return None
        if not address:
            resolver.error(where, f"{pending.path!r}: не сказано, у какой клетки")
            return None
        site = resolver.site(address, where, "soma")
        if site is None:
            return None
        target = ir.trace_key(site.instance, site.section, var)
        if target not in {
            ir.trace_key(r.target.instance, r.target.section, r.var)
            for r in model.recordings
        }:
            resolver.error(
                where,
                f"величина {target} не записана: ожидание сверять не с чем; "
                f"нужна строка record {site.instance}.{site.section}.{var}",
            )
            return None
    else:
        known = ", ".join(sorted({*ir.NEURON_MEASURES, *ir.TRACE_MEASURES}))
        resolver.error(where, f"неизвестная величина {measure!r} (есть: {known})")
        return None

    unknown = set(pending.params) - _EXPECT_PARAMS
    if unknown:
        resolver.error(
            where,
            f"непонятное уточнение {', '.join(sorted(unknown))} "
            f"(есть: {', '.join(sorted(_EXPECT_PARAMS))}, tol)",
        )
        return None

    if pending.sweep:
        # Ряд развёртки -- одно утверждение: «13, 11, 6». Ряд не той длины
        # означает, что число вариантов и число заявленных значений разошлись,
        # и молча сверить первые три из четырёх было бы худшим исходом.
        from .sweep import SweepError, parse_spec

        try:
            _, values = parse_spec(pending.sweep)
        except SweepError as exc:
            resolver.error(where, f"развёртка {pending.sweep!r}: {exc}")
            return None
        if len(values) != len(pending.values):
            resolver.error(
                where,
                f"у развёртки {pending.sweep!r} вариантов {len(values)}, "
                f"а заявленных чисел {len(pending.values)}",
            )
            return None
    elif len(pending.values) != 1:
        resolver.error(where, "ряд чисел бывает только у развёртки")
        return None

    if measure == "spikes" and any(
        abs(value - round(value)) > 1e-9 for value in pending.values
    ):
        resolver.error(where, "спайки целые: дробное ожидание сверять не с чем")
        return None

    return ir.Expectation(
        measure=measure,
        target=target,
        values=pending.values,
        tolerance=pending.tolerance,
        sweep=pending.sweep,
        start=float(pending.params.get("start", 0.0)),
        stop=float(pending.params.get("stop", float("inf"))),
        base=float(pending.params.get("base", 0.0)),
        index=int(pending.params.get("index", 1)),
        level=float(pending.params.get("level", 0.0)),
        text=f"{'sweep ' + pending.sweep + ' ' if pending.sweep else ''}"
        f"{pending.path}",
        unit=pending.unit,
        factor=pending.factor,
        line=pending.line,
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
        head = ir.head_of(pending_contact.pre_address)
        if head in sensors:
            sensors[head].targets.extend(
                resolver.sensor_links(pending_contact, sensors[head])
            )
            continue
        if head in motors or ir.head_of(pending_contact.post_address) in motors:
            resolver.error(
                f"контакт {pending_contact.id}",
                "мотор не соединяется стрелкой: он смотрит на клетку "
                "(from = ...) и отдаёт величину наружу",
            )
            continue
        if ir.head_of(pending_contact.post_address) in sensors:
            resolver.error(
                f"контакт {pending_contact.id}",
                "в сенсор ничего не входит: он дверь снаружи внутрь, а не "
                "клетка",
            )
            continue
        pairs = resolver.spread(
            pending_contact.pre_address,
            pending_contact.post_address,
            f"контакт {pending_contact.id}",
        )
        if pairs is None:
            continue
        for number, (pre_address, post_address) in enumerate(pairs):
            # Имя контакта остаётся именем написанной стрелки, а номер идёт
            # индексом: `c3[17]`. Так отчёт и трасса называют ту стрелку,
            # которую человек видит в тексте, а не выдуманное имя.
            contact = resolver.contact(
                replace(
                    pending_contact,
                    id=pending_contact.id
                    if len(pairs) == 1
                    else f"{pending_contact.id}[{number}]",
                    pre_address=pre_address,
                    post_address=post_address,
                ),
                where=f"контакт {pending_contact.id}",
            )
            if contact is not None:
                contacts.append(contact)

    model = ir.Model(
        name=parsed.name,
        cell_types=parsed.cell_types,
        instances=parsed.instances,
        populations=parsed.populations,
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

    # Ожидания разбираются последними: величина проверяется по списку записей,
    # а он окончателен только после отсева дублей.
    model.expectations = [
        expectation
        for expectation in (
            _expectation(resolver, model, pending) for pending in parsed.expectations
        )
        if expectation is not None
    ]

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

    # Что из написанного драйва не дойдёт до клетки (#512). Здесь, а не в
    # `resolver.stimulus`: окно и потолок меряются шагом и длительностью
    # прогона, а `run` к моменту разбора стимула ещё не обязан быть разобран --
    # порядок операторов в файле свободный.
    for severity, stim_id, message in protocols.delivery_problems(model):
        where = f"стимул {stim_id}"
        if severity == "error":
            resolver.error(where, message)
        else:
            resolver.warn(where, message)

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
