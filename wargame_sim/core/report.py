"""Отчёты: текстовый вывод исхода, Markdown, HTML и CSV (§9, §11)."""

from __future__ import annotations

import csv
import html
import io

from core.models import BatchResult, BattleResult, SideReport

# --------------------------------------------------------------------------
# Бой
# --------------------------------------------------------------------------
_SIDE_ROWS: tuple[tuple[str, str], ...] = (
    ("Личный состав, начало", "personnel_start"),
    ("Личный состав, конец", "personnel_end"),
    ("Потери л/с", "personnel_lost"),
    ("Доля потерь", "personnel_loss_ratio"),
    ("Техника, начало", "vehicles_start"),
    ("Техника, конец", "vehicles_end"),
    ("Потери техники", "vehicles_lost"),
    ("Мораль", "morale"),
    ("Остаточная боеспособность", "combat_power"),
    ("Организация", "organisation"),
    ("Снабжение", "supply"),
    ("Боезапас", "ammo"),
    ("Топливо", "fuel"),
    ("Снаряжение", "equipment"),
    ("Усталость", "fatigue"),
    ("Подавление", "suppression"),
    ("Состояние", "state"),
    ("Задача выполнена", "task_completed"),
)


def outcome_text(result: BattleResult) -> str:
    """Человекопонятный исход боя — то, что ГМ читает первым."""
    lines = [result.summary_text, ""]
    for report in (result.side_a, result.side_b):
        lines.append(
            f"{report.side} — {report.name}: потери {report.personnel_lost} чел. "
            f"({report.personnel_loss_ratio * 100:.0f}%), "
            f"техники {report.vehicles_lost} ед.; "
            f"осталось {report.personnel_end} чел., "
            f"боеспособность {report.combat_power:.0f}%, "
            f"организация {report.organisation:.0f}%, "
            f"снабжение {report.supply:.0f}%; состояние — {report.state}."
        )
    lines.append("")
    lines.append(f"Продолжительность: {result.turns} ход(ов) из {result.max_turns}.")
    lines.append(f"Сид: {result.master_seed} (повтор даёт тот же результат).")
    return "\n".join(lines)


def _format(value: object) -> str:
    if isinstance(value, bool):
        return "да" if value else "нет"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def side_table_rows(report: SideReport) -> list[tuple[str, str]]:
    return [(label, _format(getattr(report, field))) for label, field in _SIDE_ROWS]


def result_markdown(result: BattleResult, *, include_log: bool = True) -> str:
    """Полный отчёт по бою в Markdown."""
    lines = [
        f"# Бой: {result.scenario_name}",
        "",
        f"- Сид: `{result.master_seed}`",
        f"- Ходов: {result.turns} из {result.max_turns}",
        f"- Исход: **{result.winner}** ({result.end_reason})",
        f"- Хеш журнала: `{result.log_hash}`",
        "",
        "## Итог",
        "",
        "```",
        outcome_text(result),
        "```",
        "",
        "## Сводка по сторонам",
        "",
        f"| Показатель | A — {result.side_a.name} | B — {result.side_b.name} |",
        "|---|---|---|",
    ]
    rows_a = dict(side_table_rows(result.side_a))
    rows_b = dict(side_table_rows(result.side_b))
    for label, _ in _SIDE_ROWS:
        lines.append(f"| {label} | {rows_a[label]} | {rows_b[label]} |")

    for report in (result.side_a, result.side_b):
        lines += [
            "",
            f"## Элементы — {report.side}: {report.name}",
            "",
            "| Элемент | Тип | Л/с начало | Л/с конец | Потери | Техника | Потери техн. |"
            " Мораль | Подавл. | Усталость | Боезапас | Приказ | Боеспособен |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for element in report.elements:
            lines.append(
                f"| {element.name} | {element.type} | {element.personnel_start} | "
                f"{element.personnel_end} | {element.personnel_lost} | "
                f"{element.vehicles_end}/{element.vehicles_start} | {element.vehicles_lost} | "
                f"{element.morale:.0f} | {element.suppression:.0f} | {element.fatigue:.0f} | "
                f"{element.ammo:.0f} | {element.order} | "
                f"{'да' if element.alive else 'нет'} |"
            )

    if include_log:
        lines += ["", "## Журнал", ""]
        for entry in result.log:
            head = f"**ход {entry.turn} · {entry.phase}**"
            if entry.actor:
                head += f" · {entry.actor}"
            if entry.target:
                head += f" → {entry.target}"
            lines.append(f"- {head}: {entry.text or entry.event}")
            if entry.breakdown:
                factors = ", ".join(f"{f.factor} = {f.value:g}" for f in entry.breakdown)
                lines.append(f"  - модификаторы: {factors}")
    return "\n".join(lines) + "\n"


def result_html(result: BattleResult, *, include_log: bool = True) -> str:
    """Тот же отчёт в HTML — для печати и просмотра вне программы."""
    escape = html.escape

    def table(rows: list[tuple[str, str, str]]) -> str:
        body = "".join(
            f"<tr><th>{escape(label)}</th><td>{escape(a)}</td><td>{escape(b)}</td></tr>"
            for label, a, b in rows
        )
        return (
            "<table><thead><tr><th>Показатель</th>"
            f"<th>A — {escape(result.side_a.name)}</th>"
            f"<th>B — {escape(result.side_b.name)}</th></tr></thead>"
            f"<tbody>{body}</tbody></table>"
        )

    rows_a = dict(side_table_rows(result.side_a))
    rows_b = dict(side_table_rows(result.side_b))
    summary_rows = [(label, rows_a[label], rows_b[label]) for label, _ in _SIDE_ROWS]

    log_html = ""
    if include_log:
        items = []
        for entry in result.log:
            head = f"ход {entry.turn} · {entry.phase}"
            if entry.actor:
                head += f" · {entry.actor}"
            if entry.target:
                head += f" → {entry.target}"
            factors = (
                "<br><small>"
                + escape(", ".join(f"{f.factor} = {f.value:g}" for f in entry.breakdown))
                + "</small>"
                if entry.breakdown
                else ""
            )
            items.append(
                f"<li><b>{escape(head)}</b>: {escape(entry.text or entry.event)}{factors}</li>"
            )
        log_html = "<h2>Журнал</h2><ul class='log'>" + "".join(items) + "</ul>"

    return (
        "<!doctype html><html lang='ru'><head><meta charset='utf-8'>"
        f"<title>Бой: {escape(result.scenario_name)}</title>"
        "<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:60rem}"
        "table{border-collapse:collapse;margin:1rem 0;width:100%}"
        "th,td{border:1px solid #bbb;padding:.35rem .6rem;text-align:left}"
        "th{background:#f2f2f2}.log li{margin:.25rem 0}"
        "pre{background:#f6f6f6;padding:1rem;white-space:pre-wrap}</style></head><body>"
        f"<h1>Бой: {escape(result.scenario_name)}</h1>"
        f"<p>Сид <code>{result.master_seed}</code>, ходов {result.turns} из "
        f"{result.max_turns}, исход <b>{escape(str(result.winner))}</b> "
        f"({escape(str(result.end_reason))}).</p>"
        f"<pre>{escape(outcome_text(result))}</pre>"
        "<h2>Сводка по сторонам</h2>" + table(summary_rows) + log_html + "</body></html>"
    )


def result_csv(result: BattleResult) -> str:
    """Таблица по элементам обеих сторон в CSV."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "сторона",
            "элемент",
            "тип",
            "л/с начало",
            "л/с конец",
            "потери л/с",
            "техника начало",
            "техника конец",
            "потери техники",
            "состояние техники",
            "мораль",
            "подавление",
            "усталость",
            "боезапас",
            "топливо",
            "снаряжение",
            "приказ",
            "боеспособен",
        ]
    )
    for report in (result.side_a, result.side_b):
        for element in report.elements:
            writer.writerow(
                [
                    report.side,
                    element.name,
                    element.type,
                    element.personnel_start,
                    element.personnel_end,
                    element.personnel_lost,
                    element.vehicles_start,
                    element.vehicles_end,
                    element.vehicles_lost,
                    f"{element.vehicle_condition:.1f}",
                    f"{element.morale:.1f}",
                    f"{element.suppression:.1f}",
                    f"{element.fatigue:.1f}",
                    f"{element.ammo:.1f}",
                    f"{element.fuel:.1f}",
                    f"{element.equipment:.1f}",
                    element.order,
                    "да" if element.alive else "нет",
                ]
            )
    return buffer.getvalue()


# --------------------------------------------------------------------------
# Массовое моделирование
# --------------------------------------------------------------------------
def batch_text(batch: BatchResult) -> str:
    """Короткая сводка по N прогонам для консоли."""
    lines = [
        f"Сценарий: {batch.scenario_name} · прогонов {batch.runs} · базовый сид {batch.base_seed}",
        f"Победа A: {batch.win_probability_a * 100:.1f}%   "
        f"Победа B: {batch.win_probability_b * 100:.1f}%   "
        f"Ничья: {batch.draw_probability * 100:.1f}%",
        f"Ходов: среднее {batch.turns.mean:.1f}, медиана {batch.turns.median:.1f}, "
        f"p10 {batch.turns.p10:.1f}, p90 {batch.turns.p90:.1f}",
        f"Потери A: среднее {batch.losses_a.mean:.0f}, медиана {batch.losses_a.median:.0f}, "
        f"p10 {batch.losses_a.p10:.0f}, p90 {batch.losses_a.p90:.0f}",
        f"Потери B: среднее {batch.losses_b.mean:.0f}, медиана {batch.losses_b.median:.0f}, "
        f"p10 {batch.losses_b.p10:.0f}, p90 {batch.losses_b.p90:.0f}",
        f"Потери техники A: среднее {batch.vehicle_losses_a.mean:.1f}, "
        f"B: среднее {batch.vehicle_losses_b.mean:.1f}",
        "Способы завершения: "
        + ", ".join(f"{name} — {count}" for name, count in batch.end_reasons.items()),
    ]
    return "\n".join(lines)


def batch_markdown(batch: BatchResult) -> str:
    """Сводка и таблица прогонов в Markdown."""
    lines = [
        f"# Массовое моделирование: {batch.scenario_name}",
        "",
        f"- Прогонов: {batch.runs}",
        f"- Базовый сид: `{batch.base_seed}`",
        "",
        "## Вероятности исходов",
        "",
        "| Исход | Вероятность |",
        "|---|---|",
        f"| Победа A | {batch.win_probability_a * 100:.1f}% |",
        f"| Победа B | {batch.win_probability_b * 100:.1f}% |",
        f"| Ничья (лимит ходов) | {batch.draw_probability * 100:.1f}% |",
        "",
        "## Распределения",
        "",
        "| Показатель | среднее | медиана | p10 | p50 | p90 | мин | макс |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for label, dist in (
        ("Ходы", batch.turns),
        ("Потери A", batch.losses_a),
        ("Потери B", batch.losses_b),
        ("Потери техники A", batch.vehicle_losses_a),
        ("Потери техники B", batch.vehicle_losses_b),
    ):
        lines.append(
            f"| {label} | {dist.mean:.2f} | {dist.median:.2f} | {dist.p10:.2f} | "
            f"{dist.p50:.2f} | {dist.p90:.2f} | {dist.minimum:.2f} | {dist.maximum:.2f} |"
        )
    lines += [
        "",
        "## Способы завершения",
        "",
        "| Способ | Прогонов |",
        "|---|---|",
    ]
    for name, count in batch.end_reasons.items():
        lines.append(f"| {name} | {count} |")
    lines += [
        "",
        "## Прогоны",
        "",
        "| # | Сид | Исход | Причина | Ходов | Потери A | Потери B |",
        "|---|---|---|---|---|---|---|",
    ]
    for record in batch.records:
        lines.append(
            f"| {record.index} | {record.seed} | {record.winner} | {record.end_reason} | "
            f"{record.turns} | {record.losses_a} | {record.losses_b} |"
        )
    return "\n".join(lines) + "\n"


def batch_csv(batch: BatchResult) -> str:
    """Все прогоны в CSV — для внешнего анализа."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "прогон",
            "сид",
            "исход",
            "причина",
            "ходов",
            "потери A",
            "потери B",
            "доля потерь A",
            "доля потерь B",
            "потери техники A",
            "потери техники B",
            "боеспособность A",
            "боеспособность B",
        ]
    )
    for record in batch.records:
        writer.writerow(
            [
                record.index,
                record.seed,
                record.winner,
                record.end_reason,
                record.turns,
                record.losses_a,
                record.losses_b,
                f"{record.loss_ratio_a:.4f}",
                f"{record.loss_ratio_b:.4f}",
                record.vehicle_losses_a,
                record.vehicle_losses_b,
                f"{record.combat_power_a:.2f}",
                f"{record.combat_power_b:.2f}",
            ]
        )
    return buffer.getvalue()
