"""Главная: текущий бой, быстрые переходы и последние бои."""

from __future__ import annotations

import flet as ft

from core.models import BattleResult, Scenario
from core.report import winner_label
from ui import theme as t
from ui.shell import scenario_aside, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["home"]

#: Карточки-ссылки на разделы: маршрут, иконка, заголовок, описание.
LINKS: tuple[tuple[str, str, str, str], ...] = (
    (
        ROUTES["units"],
        ft.Icons.GROUPS_OUTLINED,
        "Подразделения",
        "Создать и отредактировать батальоны",
    ),
    (
        ROUTES["batch"],
        ft.Icons.INSIGHTS_OUTLINED,
        "Массовое моделирование",
        "N прогонов и статистика",
    ),
    (
        ROUTES["config"],
        ft.Icons.TUNE_OUTLINED,
        "Коэффициенты",
        "Редактор конфигурации и тумблеры",
    ),
)

RESULT_COLUMNS: tuple[c.Col, ...] = (
    c.Col("Сценарий", expand=True),
    c.Col("Исход", 110),
    c.Col("Причина", 130),
    c.Col("Ходов", 60, numeric=True),
    c.Col("Сид", 70, numeric=True),
    c.Col("Потери A", 90, numeric=True),
    c.Col("Потери B", 90, numeric=True),
)


def big_number(value: str, label: str, *, accent: bool = False) -> ft.Control:
    """Крупное число со подписью под ним."""
    return ft.Column(
        [
            ft.Text(
                value,
                style=t.mono(
                    size=t.SIZE_SUMMARY_NUM,
                    weight=t.W600,
                    color=t.LOSS if accent else t.TEXT,
                ),
                text_align=ft.TextAlign.RIGHT,
            ),
            ft.Text(
                label,
                style=t.sans(size=t.SIZE_META, color=t.TEXT_MUTED),
                text_align=ft.TextAlign.RIGHT,
            ),
        ],
        spacing=1,
        tight=True,
        horizontal_alignment=ft.CrossAxisAlignment.END,
    )


def current_battle_card(app: AppState) -> ft.Control:
    """Карточка текущего боя: кто, где и с каким счётом."""
    scenario = app.scenario
    engine = app.engine
    turn = engine.turn if engine else 0
    limit = scenario.environment.max_turns

    if engine is not None:
        a = engine.state.battalion("A")
        b = engine.state.battalion("B")
        losses = (
            engine.state.side("A").total_personnel_lost()
            + engine.state.side("B").total_personnel_lost()
        )
        a_personnel, b_personnel = a.personnel_current, b.personnel_current
    else:
        a_personnel = scenario.battalion_a.personnel_current
        b_personnel = scenario.battalion_b.personnel_current
        losses = 0

    heading = ft.Row(
        [
            ft.Column(
                [
                    ft.Text(scenario.name, style=t.sans(size=t.SIZE_BLOCK, weight=t.W600)),
                    ft.Text(
                        f"{scenario.battalion_a.name} · {scenario.battalion_a.order}"
                        f"  →  {scenario.battalion_b.name} · {scenario.battalion_b.order}",
                        style=t.sans(size=t.SIZE_BODY, color=t.TEXT_3),
                    ),
                ],
                spacing=4,
                tight=True,
                expand=True,
            ),
            ft.Row(
                [
                    big_number(str(a_personnel), "л/с A"),
                    big_number(str(b_personnel), "л/с B"),
                    big_number(str(losses), "потерь всего", accent=True),
                ],
                spacing=26,
                tight=True,
            ),
        ],
        spacing=t.GAP,
        vertical_alignment=ft.CrossAxisAlignment.CENTER,
    )

    header = ft.Row(
        [
            t.card_title("Текущий бой"),
            c.spacer(),
            ft.Text(
                f"ход {turn} / {limit} · сид {scenario.master_seed}",
                style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
            ),
        ],
        spacing=8,
    )

    return c.card([header, heading], padding=18, spacing=t.GAP_IN)


def link_card(route: str, icon: str, title: str, hint: str, app: AppState) -> ft.Control:
    return ft.Container(
        content=ft.Column(
            [
                ft.Icon(icon, size=20, color=t.TEXT_2),
                ft.Text(title, style=t.sans(size=t.SIZE_TITLE, weight=t.W600)),
                ft.Text(hint, style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3, height=1.45)),
            ],
            spacing=6,
            tight=True,
        ),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        padding=t.PAD_CARD,
        expand=True,
        on_click=lambda *_: app.go(route),
    )


def result_row(result: BattleResult, app: AppState, *, last: bool) -> ft.Control:
    """Строка в таблице последних боёв."""
    a, b = result.side_a.personnel_lost, result.side_b.personnel_lost
    return c.table_row(
        RESULT_COLUMNS,
        [
            t.text(result.scenario_name, size=t.SIZE_ROW, weight=t.W500),
            t.text(winner_label(result.winner), size=t.SIZE_ROW, weight=t.W500),
            t.text(str(result.end_reason), size=t.SIZE_ROW, color=t.TEXT_3),
            t.num(str(result.turns)),
            t.num(str(result.master_seed)),
            t.num(str(a), color=t.LOSS if a >= b else t.TEXT),
            t.num(str(b), color=t.LOSS if b > a else t.TEXT),
        ],
        height=t.TABLE_ROW_H + 2,
        last=last,
        on_click=lambda: _open_result(app, result),
    )


def scenario_block(scenario: Scenario, app: AppState, *, last: bool) -> ft.Control:
    environment = scenario.environment
    return ft.Container(
        content=ft.Column(
            [
                ft.Text(scenario.name, style=t.sans(size=t.SIZE_BODY, weight=t.W500)),
                ft.Text(
                    f"{scenario.battalion_a.name} · {scenario.battalion_a.order}"
                    f" → {scenario.battalion_b.name} · {scenario.battalion_b.order}",
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_3, height=1.5),
                ),
                ft.Text(
                    f"{environment.terrain} · {environment.time_of_day} ·"
                    f" {environment.weather} · сид {scenario.master_seed}",
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_3, height=1.5),
                ),
            ],
            spacing=2,
            tight=True,
        ),
        padding=ft.Padding.symmetric(vertical=12, horizontal=t.PAD_CARD),
        border=None if last else t.border_bottom(t.BORDER_INNER),
        on_click=lambda *_: _open_scenario(app, scenario),
    )


def build(app: AppState) -> ft.View:
    results = app.results()[:6]
    scenarios = app.scenarios()[:4]

    if results:
        table_body: ft.Control = c.table(
            RESULT_COLUMNS,
            [
                result_row(result, app, last=index == len(results) - 1)
                for index, (_, result) in enumerate(results)
            ],
        )
    else:
        table_body = ft.Column(
            [c.table_head(RESULT_COLUMNS), c.empty_hint("Сохранённых боёв пока нет.")],
            spacing=0,
            expand=True,
        )

    recent = c.framed_card(
        "Последние бои",
        table_body,
        trailing=[c.tertiary_button("Весь архив", lambda: app.go(ROUTES["archive"]))],
        expand=True,
    )

    left = ft.Column(
        [
            current_battle_card(app),
            ft.Row(
                [link_card(route, icon, title, hint, app) for route, icon, title, hint in LINKS],
                spacing=t.GAP,
            ),
            recent,
        ],
        spacing=t.GAP,
        expand=True,
    )

    scenario_body = (
        ft.Column(
            [
                scenario_block(scenario, app, last=index == len(scenarios) - 1)
                for index, (_, scenario) in enumerate(scenarios)
            ],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        )
        if scenarios
        else c.empty_hint("Сохранённых сценариев пока нет.")
    )

    right = c.framed_card(
        "Сценарии",
        scenario_body,
        trailing=[
            c.icon_button(
                ft.Icons.ADD,
                lambda: app.go(ROUTES["battle_setup"]),
                size=t.BUTTON_XS_H,
                icon_size=16,
                tooltip="Собрать новый сценарий",
            )
        ],
        footer=c.card_footer(
            [
                ft.Column(
                    [
                        t.caption("Конфигурация"),
                        c.note(
                            "Правки коэффициентов применяются без перезапуска. "
                            "Эталонные значения в config/defaults не перезаписываются.",
                            size=t.SIZE_ROW,
                        ),
                    ],
                    spacing=4,
                    tight=True,
                    expand=True,
                )
            ],
            height=None,
        ),
        expand=True,
    )

    scenario = app.scenario
    return screen(
        app,
        active="home",
        title="Главная",
        subtitle="Текущий бой и переход в нужный раздел",
        aside=scenario_aside(app),
        actions=[
            c.secondary_button("Настроить бой", lambda: app.go(ROUTES["battle_setup"])),
            c.primary_button(
                "Продолжить бой" if app.engine is not None else "Начать бой",
                lambda: app.go(ROUTES["battle"].format(id=scenario.id)),
                icon=ft.Icons.PLAY_ARROW,
            ),
        ],
        body=c.columns(left, right, right_width=340),
    )


def _open_scenario(app: AppState, scenario: Scenario) -> None:
    app.load_scenario(scenario)
    app.go(ROUTES["battle_setup"])


def _open_result(app: AppState, result: BattleResult) -> None:
    app.result = result
    app.go(ROUTES["battle_result"].format(id=result.scenario_id))
