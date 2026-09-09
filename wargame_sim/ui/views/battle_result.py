"""Итог боя: текстовый вывод, таблицы, экспорт в Markdown, HTML и CSV."""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.report import (
    outcome_text,
    result_csv,
    result_html,
    result_markdown,
    side_table_rows,
)
from core.storage import write_text
from ui.state import ROUTES, AppState
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    data_table,
    empty_hint,
    kv_rows,
    link_button,
    page_title,
    text_button,
)
from ui.widgets.journal import entries_list

ROUTE = ROUTES["battle_result"]

ELEMENT_HEADERS = (
    "Элемент",
    "Тип",
    "Л/с начало",
    "Л/с конец",
    "Потери",
    "Техника",
    "Потери техн.",
    "Мораль",
    "Подавл.",
    "Боезапас",
    "Приказ",
    "Боеспособен",
)


def build(app: AppState, battle_id: str) -> ft.View:
    result = app.result or (app.engine.result() if app.engine else None)
    if result is None:
        return ft.View(
            route=ROUTE.format(id=battle_id),
            controls=[
                page_title("Итог боя"),
                empty_hint("Бой ещё не проводился — начните его на экране настройки."),
                link_button(
                "Настройка боя", ROUTES["battle_setup"], app.go),
            ],
            padding=PAD,
        )

    message = ft.Text("", size=12, opacity=0.75)

    def export(kind: str) -> None:
        directory = Path(app.results_dir)
        stem = f"{result.scenario_id}_{result.master_seed}"
        if kind == "md":
            path = write_text(directory / f"{stem}.md", result_markdown(result))
        elif kind == "html":
            path = write_text(directory / f"{stem}.html", result_html(result))
        else:
            path = write_text(directory / f"{stem}.csv", result_csv(result))
        message.value = f"Выгружено: {path}"
        app.refresh(message)

    def save() -> None:
        path = app.save_result(result)
        message.value = f"Результат сохранён: {path}"
        app.refresh(message)

    def replay() -> None:
        app.scenario.master_seed = result.master_seed
        app.start_battle()
        app.go(ROUTES["battle"].format(id=app.scenario.id))

    def element_rows(report) -> list[list[str]]:
        return [
            [
                element.name,
                element.type,
                str(element.personnel_start),
                str(element.personnel_end),
                str(element.personnel_lost),
                f"{element.vehicles_end}/{element.vehicles_start}",
                str(element.vehicles_lost),
                f"{element.morale:.0f}",
                f"{element.suppression:.0f}",
                f"{element.ammo:.0f}",
                element.order,
                "да" if element.alive else "нет",
            ]
            for element in report.elements
        ]

    rows_a = dict(side_table_rows(result.side_a))
    rows_b = dict(side_table_rows(result.side_b))
    comparison = [[label, rows_a[label], rows_b[label]] for label in rows_a]

    return ft.View(
        route=ROUTE.format(id=battle_id),
        controls=[
            ft.Column(
                [
                    page_title(
                        f"Итог: {result.scenario_name}",
                        f"{result.winner} — {result.end_reason}, ходов {result.turns}.",
                    ),
                    ft.Row(
                        [
                            link_button(
                "К бою", ROUTES["battle"].format(id=battle_id), app.go),
                            link_button("Настройка", ROUTES["battle_setup"], app.go),
                            action_button("Сохранить в архив", save, icon=ft.Icons.SAVE),
                            text_button("Экспорт Markdown", lambda: export("md")),
                            text_button("Экспорт HTML", lambda: export("html")),
                            text_button("Экспорт CSV", lambda: export("csv")),
                            text_button("Повтор по сиду", replay, icon=ft.Icons.REPLAY),
                        ],
                        spacing=GAP,
                        wrap=True,
                    ),
                    message,
                    card(
                        "Исход",
                        [ft.Text(outcome_text(result), size=13, selectable=True)],
                    ),
                    card(
                        "Сводка по сторонам",
                        [
                            data_table(
                                (
                                    "Показатель",
                                    f"A — {result.side_a.name}",
                                    f"B — {result.side_b.name}",
                                ),
                                comparison,
                            )
                        ],
                    ),
                    card(
                        f"Элементы A — {result.side_a.name}",
                        [data_table(ELEMENT_HEADERS, element_rows(result.side_a))],
                    ),
                    card(
                        f"Элементы B — {result.side_b.name}",
                        [data_table(ELEMENT_HEADERS, element_rows(result.side_b))],
                    ),
                    card(
                        "Воспроизводимость",
                        [
                            kv_rows(
                                [
                                    ("Сид", str(result.master_seed)),
                                    ("Хеш журнала", result.log_hash[:32] + "…"),
                                    ("Записей в журнале", str(len(result.log))),
                                ]
                            )
                        ],
                    ),
                    card("Журнал", [entries_list(result.log, limit=250)], expand=True),
                ],
                spacing=GAP,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        ],
        padding=PAD,
    )
