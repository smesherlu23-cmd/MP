"""Настройка боя: стороны, окружение, укрепления, разведданные, приказы, сид."""

from __future__ import annotations

import random

import flet as ft

from core.models import (
    MAX_SEED,
    IntelLevel,
    Order,
    Side,
    Terrain,
    TimeOfDay,
    Weather,
    new_id,
)
from ui.state import ROUTES, AppState
from ui.widgets.battalion import battalion_summary
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    choice,
    error_banner,
    link_button,
    number_field,
    page_title,
    text_button,
    text_input,
    two_columns,
)

ROUTE = ROUTES["battle_setup"]



def build(app: AppState) -> ft.View:
    scenario = app.scenario
    environment = scenario.environment
    config = app.config
    toggles = config.tog

    summary_a = ft.Container(content=battalion_summary(scenario.battalion_a), expand=True)
    summary_b = ft.Container(content=battalion_summary(scenario.battalion_b), expand=True)
    message = ft.Text("", size=12, opacity=0.75)

    def touch() -> None:
        app.engine = None
        summary_a.content = battalion_summary(scenario.battalion_a)
        summary_b.content = battalion_summary(scenario.battalion_b)
        app.refresh(summary_a, summary_b)

    def set_environment(attribute: str, value) -> None:
        setattr(environment, attribute, value)
        touch()

    def set_side(side: Side, attribute: str, value) -> None:
        battalion = scenario.battalion(side)
        setattr(battalion, attribute, value)
        touch()

    def pick_unit(side: Side, unit_id: str) -> None:
        found = app.unit(unit_id)
        if found is None:
            return
        battalion = found[1].model_copy(deep=True)
        battalion.side = side
        if side == Side.A:
            scenario.battalion_a = battalion
        else:
            scenario.battalion_b = battalion
        touch()

    def set_seed(value: float) -> None:
        scenario.master_seed = int(value)
        app.engine = None

    def random_seed() -> None:
        scenario.master_seed = random.randint(0, MAX_SEED)
        app.notify(f"Новый сид: {scenario.master_seed}")
        app.go(ROUTE)

    def save() -> None:
        if not scenario.id:
            scenario.id = new_id("scn")
        path = app.save_scenario(scenario)
        message.value = f"Сценарий сохранён: {path}"
        app.refresh(message)

    def start() -> None:
        app.start_battle()
        app.go(ROUTES["battle"].format(id=scenario.id))

    unit_options = [(battalion.id, battalion.name) for _, battalion in app.units()]

    def side_card(side: Side) -> ft.Control:
        battalion = scenario.battalion(side)
        controls: list[ft.Control] = [
            ft.Row(
                [
                    choice(
                        f"Подразделение стороны {side}",
                        unit_options or [(battalion.id, battalion.name)],
                        battalion.id,
                        lambda value, s=side: pick_unit(s, value),
                        width=240,
                    ),
                    choice(
                        "Приказ",
                        [(str(order), str(order)) for order in Order],
                        str(battalion.order),
                        lambda value, s=side: set_side(s, "order", Order(value)),
                    ),
                ],
                spacing=GAP,
                wrap=True,
            ),
            text_input(
                "Задача боя",
                battalion.task,
                lambda value, s=side: set_side(s, "task", value),
            ),
            ft.Row(
                [
                    number_field(
                        "Укрепления",
                        environment.fortification("A" if side == Side.A else "B"),
                        minimum=0,
                        maximum=5,
                        integer=True,
                        hint="0…5",
                        on_change=lambda value, s=side: set_environment(
                            "fortification_A" if s == Side.A else "fortification_B", int(value)
                        ),
                    ),
                    number_field(
                        "Связь",
                        battalion.communications,
                        minimum=0,
                        maximum=100,
                        on_change=lambda value, s=side: set_side(s, "communications", value),
                    ),
                ],
                spacing=GAP,
                wrap=True,
            ),
        ]
        if toggles.intel:
            controls.append(
                choice(
                    "Разведданные",
                    [(str(level), str(level)) for level in IntelLevel],
                    str(environment.intel("A" if side == Side.A else "B")),
                    lambda value, s=side: set_environment(
                        "intel_A" if s == Side.A else "intel_B", IntelLevel(value)
                    ),
                )
            )
        if toggles.commander_influence:
            controls.append(
                number_field(
                    "Влияние командира",
                    battalion.commander_influence,
                    minimum=0,
                    maximum=100,
                    on_change=lambda value, s=side: set_side(s, "commander_influence", value),
                )
            )
        return card(f"Сторона {side} — {battalion.name}", controls, expand=True)

    conditions = card(
        "Условия боя",
        [
            ft.Row(
                [
                    choice(
                        "Местность",
                        [(str(item), str(item)) for item in Terrain],
                        str(environment.terrain),
                        lambda value: set_environment("terrain", Terrain(value)),
                    ),
                    choice(
                        "Время суток",
                        [(str(item), str(item)) for item in TimeOfDay],
                        str(environment.time_of_day),
                        lambda value: set_environment("time_of_day", TimeOfDay(value)),
                    ),
                    choice(
                        "Погода",
                        [(str(item), str(item)) for item in Weather],
                        str(environment.weather),
                        lambda value: set_environment("weather", Weather(value)),
                    ),
                    number_field(
                        "Предел ходов",
                        environment.max_turns,
                        minimum=1,
                        maximum=500,
                        integer=True,
                        hint="max_turns",
                        on_change=lambda value: set_environment("max_turns", int(value)),
                    ),
                ],
                spacing=GAP,
                wrap=True,
            )
        ],
    )

    seed_card = card(
        "Случайность",
        [
            ft.Row(
                [
                    number_field(
                        "Сид боя",
                        scenario.master_seed,
                        minimum=0,
                        maximum=MAX_SEED,
                        integer=True,
                        hint="один и тот же сид даёт один и тот же бой",
                        on_change=set_seed,
                        width=260,
                    ),
                    text_button("Случайный сид", random_seed, icon=ft.Icons.CASINO),
                ],
                spacing=GAP,
                wrap=True,
            ),
            text_input(
                "Название сценария", scenario.name, lambda value: setattr(scenario, "name", value)
            ),
            text_input("Заметки", scenario.notes, lambda value: setattr(scenario, "notes", value)),
        ],
    )

    controls: list[ft.Control] = [
        page_title("Настройка боя", "Кто, где и с какой задачей вступает в бой."),
    ]
    if app.config_error:
        controls.append(error_banner(app.config_error))
    controls += [
        ft.Row(
            [
                link_button(
                "На главную", ROUTES["home"], app.go, icon=ft.Icons.ARROW_BACK),
                link_button("Подразделения", ROUTES["units"], app.go),
                action_button("Начать бой", start, icon=ft.Icons.PLAY_ARROW),
                text_button("Сохранить сценарий", save, icon=ft.Icons.SAVE),
                link_button("Массовое моделирование", ROUTES["batch"], app.go),
            ],
            spacing=GAP,
            wrap=True,
        ),
        message,
        two_columns(side_card(Side.A), side_card(Side.B)),
        conditions,
        seed_card,
        two_columns(summary_a, summary_b),
    ]

    return ft.View(
        route=ROUTE,
        controls=[ft.Column(controls, spacing=GAP, scroll=ft.ScrollMode.AUTO, expand=True)],
        padding=PAD,
    )
