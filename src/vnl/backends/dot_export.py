"""Экспорт схемы в DOT.

Формат обмена, как и NetPyNE: отдаёт граф наружу, ничего не решая о том,
как он будет нарисован. Раскладку DOT считает сам graphviz, поэтому здесь
нет ни координат, ни маршрутов -- только топология и знак связи.
"""

from __future__ import annotations

from .. import ir

#: Полярность -> наконечник стрелки DOT. Таблицей, чтобы новый исход
#: полярности нельзя было забыть здесь молча: `KeyError` громче стрелки,
#: нарисованной по умолчанию.
_ARROWS: dict[str, str] = {
    ir.POLARITY_EXC: "normal",
    ir.POLARITY_INH: "tee",
    ir.POLARITY_SHUNT: "odot",
}


def export(model: ir.Model) -> str:
    lines = [f"digraph {model.name} {{", "  rankdir=LR;", "  node [shape=circle];"]

    for instance in model.instances.values():
        cell_type = model.cell_types[instance.cell_type]
        shape = "square" if ir.is_inhibitory_cell(cell_type) else "circle"
        lines.append(
            f'  {instance.id} [shape={shape}, '
            f'label="{instance.id}\n{cell_type.id}"];'
        )

    for contact in model.contacts:
        # Тормозный контакт рисуется плашкой, а не стрелкой: знак связи
        # важнее направления, его должно быть видно без чтения подписи.
        # Шунт -- кружком: он не третий сорт торможения, а другая операция
        # (делит, а не вычитает), и плашка врала бы про механизм.
        # Полярность спрашивается по реверсалу, а не по имени рецептора:
        # `gaba_a` с реверсалом на уровне покоя -- это кружок, а не плашка.
        arrow = _ARROWS[model.polarity_of(contact)]
        label = f"{contact.post.section}@{contact.post.fraction:g}"
        lines.append(
            f"  {contact.pre.instance} -> {contact.post.instance} "
            f'[arrowhead={arrow}, label="{label}"];'
        )

    lines.append("}")
    return "\n".join(lines)
