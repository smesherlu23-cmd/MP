"""Главная: ссылки на разделы, последние бои и сценарии."""

from __future__ import annotations

import flet as ft

from ui.state import ROUTES, AppState
from ui.widgets.common import GAP, PAD, card, empty_hint, error_banner, link_button, page_title

ROUTE = ROUTES["home"]

#: Разделы приложения: маршрут, название, пояснение, иконка.
SECTIONS: tuple[tuple[str, str, str, str], ...] = (
    (ROUTES["units"], "Подразделения", "Создать и отредактировать батальоны", ft.Icons.GROUPS),
    (ROUTES["battle_setup"], "Новый бой", "Стороны, условия, приказы и сид", ft.Icons.PLAY_ARROW),
    (ROUTES["batch"], "Массовое моделирование", "N прогонов и статистика", ft.Icons.INSIGHTS),
    (ROUTES["config"], "Коэффициенты", "Редактор конфигурации и тумблеры", ft.Icons.TUNE),
    (ROUTES["archive"], "Архив", "Сохранённые бои и сценарии, повтор по сиду", ft.Icons.ARCHIVE),
)


def build(app: AppState) -> ft.View:
    controls: list[ft.Control] = [
        page_title(
            "Симулятор боя",
            "Настольный инструмент ГМ: моделирует боестолкновение двух батальонов "
            "и объясняет, почему цифры изменились.",
        )
    ]

    if app.config_error:
        controls.append(error_banner(app.config_error))

    controls.append(
        ft.Row(
            [
                ft.Container(
                    content=ft.Column(
                        [
                            ft.Row([ft.Icon(icon), ft.Text(title, weight=ft.FontWeight.W_600)]),
                            ft.Text(hint, size=12, opacity=0.7),
                        ],
                        spacing=6,
                        tight=True,
                    ),
                    padding=PAD,
                    border_radius=10,
                    border=ft.Border.all(1, ft.Colors.OUTLINE_VARIANT),
                    width=250,
                    on_click=lambda *_, target=route: app.go(target),
                )
                for route, title, hint, icon in SECTIONS
            ],
            spacing=GAP,
            wrap=True,
        )
    )

    scenario = app.scenario
    controls.append(
        card(
            "Текущий сценарий",
            [
                ft.Text(
                    f"{scenario.name} — {scenario.battalion_a.name} против "
                    f"{scenario.battalion_b.name}",
                    size=13,
                ),
                ft.Text(
                    f"Местность: {scenario.environment.terrain}, "
                    f"{scenario.environment.time_of_day}, {scenario.environment.weather}; "
                    f"сид {scenario.master_seed}.",
                    size=12,
                    opacity=0.7,
                ),
                ft.Row(
                    [
                        link_button("Настроить бой", ROUTES["battle_setup"], app.go),
                        link_button(
                            "К бою", ROUTES["battle"].format(id=scenario.id), app.go
                        ),
                    ],
                    spacing=GAP,
                ),
            ],
        )
    )

    scenarios = app.scenarios()[:5]
    controls.append(
        card(
            "Сценарии",
            [
                ft.Column(
                    [
                        ft.ListTile(
                            title=ft.Text(item.name, size=13),
                            subtitle=ft.Text(
                                f"{item.battalion_a.name} против {item.battalion_b.name} · "
                                f"сид {item.master_seed}",
                                size=12,
                            ),
                            on_click=lambda *_, chosen=item: _open_scenario(app, chosen),
                        )
                        for _, item in scenarios
                    ],
                    spacing=0,
                    tight=True,
                )
                if scenarios
                else empty_hint("Сохранённых сценариев пока нет.")
            ],
        )
    )

    results = app.results()[:5]
    controls.append(
        card(
            "Последние бои",
            [
                ft.Column(
                    [
                        ft.ListTile(
                            title=ft.Text(
                                f"{item.scenario_name} — {item.winner} ({item.end_reason})",
                                size=13,
                            ),
                            subtitle=ft.Text(
                                f"ходов {item.turns}, сид {item.master_seed}", size=12
                            ),
                            on_click=lambda *_, chosen=item: _open_result(app, chosen),
                        )
                        for _, item in results
                    ],
                    spacing=0,
                    tight=True,
                )
                if results
                else empty_hint("Сохранённых боёв пока нет.")
            ],
        )
    )

    return ft.View(
        route=ROUTE,
        controls=[ft.Column(controls, spacing=GAP, scroll=ft.ScrollMode.AUTO, expand=True)],
        padding=PAD,
    )


def _open_scenario(app: AppState, scenario) -> None:
    app.load_scenario(scenario)
    app.go(ROUTES["battle_setup"])


def _open_result(app: AppState, result) -> None:
    app.result = result
    app.go(ROUTES["battle_result"].format(id=result.scenario_id))
