"""Архив: сохранённые бои и сценарии, повтор по сиду."""

from __future__ import annotations

import flet as ft

from core.models import BattleResult, Scenario
from core.storage import delete_file
from ui.state import ROUTES, AppState
from ui.widgets.common import (
    GAP,
    PAD,
    card,
    data_table,
    empty_hint,
    link_button,
    page_title,
    text_button,
)

ROUTE = ROUTES["archive"]


def build(app: AppState) -> ft.View:
    message = ft.Text("", size=12, opacity=0.75)

    def open_scenario(scenario: Scenario) -> None:
        app.load_scenario(scenario)
        app.notify(f"Загружен сценарий «{scenario.name}»")
        app.go(ROUTES["battle_setup"])

    def replay(result: BattleResult) -> None:
        """Повтор по сиду: тот же сценарий, тот же сид — тот же бой (§7)."""
        found = [item for _, item in app.scenarios() if item.id == result.scenario_id]
        if found:
            app.load_scenario(found[0])
        app.scenario.master_seed = result.master_seed
        app.start_battle()
        app.notify(f"Повтор по сиду {result.master_seed}")
        app.go(ROUTES["battle"].format(id=app.scenario.id))

    def show(result: BattleResult) -> None:
        app.result = result
        app.go(ROUTES["battle_result"].format(id=result.scenario_id))

    def remove(path) -> None:
        delete_file(path)
        message.value = f"Удалено: {path.name}"
        app.go(ROUTE)

    scenarios = app.scenarios()
    results = app.results()

    scenario_controls: list[ft.Control] = (
        [
            ft.Row(
                [
                    ft.Column(
                        [
                            ft.Text(scenario.name, size=14, weight=ft.FontWeight.W_600),
                            ft.Text(
                                f"{scenario.battalion_a.name} против {scenario.battalion_b.name} · "
                                f"{scenario.environment.terrain}, "
                                f"{scenario.environment.time_of_day}, "
                                f"{scenario.environment.weather} · сид {scenario.master_seed}",
                                size=12,
                                opacity=0.7,
                            ),
                        ],
                        spacing=2,
                        expand=True,
                    ),
                    text_button("Открыть", lambda s=scenario: open_scenario(s)),
                    text_button("Удалить", lambda p=path: remove(p)),
                ],
                spacing=GAP,
                wrap=True,
            )
            for path, scenario in scenarios
        ]
        if scenarios
        else [empty_hint("Сохранённых сценариев пока нет.")]
    )

    result_rows = [
        [
            result.scenario_name,
            str(result.winner),
            str(result.end_reason),
            str(result.turns),
            str(result.master_seed),
            str(result.side_a.personnel_lost),
            str(result.side_b.personnel_lost),
        ]
        for _, result in results
    ]

    result_controls: list[ft.Control] = (
        [
            data_table(
                ("Сценарий", "Исход", "Причина", "Ходов", "Сид", "Потери A", "Потери B"),
                result_rows,
            ),
            ft.Row(
                [
                    ft.Row(
                        [
                            ft.Text(f"{result.scenario_name} · сид {result.master_seed}", size=12),
                            text_button("Открыть", lambda r=result: show(r)),
                            text_button("Повтор по сиду", lambda r=result: replay(r)),
                            text_button("Удалить", lambda p=path: remove(p)),
                        ],
                        spacing=6,
                    )
                    for path, result in results
                ],
                spacing=GAP,
                wrap=True,
            ),
        ]
        if results
        else [empty_hint("Сохранённых боёв пока нет.")]
    )

    return ft.View(
        route=ROUTE,
        controls=[
            ft.Column(
                [
                    page_title("Архив", "Сценарии и проведённые бои; любой можно повторить."),
                    ft.Row(
                        [
                            link_button(
                "На главную", ROUTES["home"], app.go, icon=ft.Icons.ARROW_BACK),
                            link_button("Настройка боя", ROUTES["battle_setup"], app.go),
                        ],
                        spacing=GAP,
                        wrap=True,
                    ),
                    message,
                    card("Сценарии", scenario_controls),
                    card("Проведённые бои", result_controls),
                ],
                spacing=GAP,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        ],
        padding=PAD,
    )
