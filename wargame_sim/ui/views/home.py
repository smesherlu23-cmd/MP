"""Обзор: текущий бой, незаконченные, последние бои и сценарии.

Раньше здесь стояли ещё три большие карточки-ссылки — «Подразделения»,
«Массовое моделирование», «Коэффициенты», — то есть та же навигация, что
слева, только крупнее. Обзор отвечает на один вопрос: что сейчас в бою и
что было, — и ведёт к одному действию: продолжить или начать бой.
"""

from __future__ import annotations

import flet as ft

from core.models import BattleResult, Scenario
from core.report import winner_label
from core.storage import delete_battle
from ui import theme as t
from ui.shell import screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import dialogs as dlg

ROUTE = ROUTES["home"]

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

    if engine is not None and engine.finished:
        state = f"окончен на ходу {turn}: {engine.winner} · {engine.end_reason}"
    elif turn > 0:
        state = f"идёт · ход {turn} из {limit}"
    else:
        state = f"не начат · предел {limit} ходов"
    header = ft.Row(
        [
            t.card_title("Текущий бой"),
            c.spacer(),
            ft.Text(
                f"{state} · сид {scenario.master_seed}",
                style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
            ),
        ],
        spacing=8,
    )

    return c.card([header, heading], padding=18, spacing=t.GAP_IN)


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


def scenario_row(scenario: Scenario, app: AppState, *, last: bool) -> ft.Control:
    """Сценарий строкой: щелчок заряжает его в подготовку боя."""
    environment = scenario.environment
    return c.list_row(
        scenario.name,
        f"{scenario.battalion_a.name} → {scenario.battalion_b.name} · "
        f"{environment.terrain} · {environment.time_of_day} · сид {scenario.master_seed}",
        on_click=lambda: _open_scenario(app, scenario),
        menu=[
            c.MenuItem(
                "Открыть в подготовке",
                lambda: _open_scenario(app, scenario),
                icon=ft.Icons.OPEN_IN_NEW,
            )
        ],
        last=last,
    )


def saved_battles_card(app: AppState) -> ft.Control | None:
    """Незаконченные бои с диска — их можно поднять и продолжить.

    Бой жил только в памяти, и закрытое окно стоило пятнадцати ходов.
    Теперь он пишется на диск после каждого хода, а отсюда поднимается.
    """
    saved = [
        (path, snapshot)
        for path, snapshot in app.saved_battles()
        if not snapshot.finished and snapshot.turn > 0
    ]
    if not saved:
        return None

    def resume(snapshot) -> None:
        app.resume_battle(snapshot)
        app.notify(f"Бой поднят с хода {snapshot.turn}")
        app.go(ROUTES["battle"].format(id=snapshot.scenario.id))

    def drop(path, snapshot) -> None:
        dlg.confirm(
            app,
            f"Забыть бой «{snapshot.title}»?",
            f"Сохранение с хода {snapshot.turn} будет удалено с диска. "
            "Продолжить этот бой после этого не получится.",
            confirm_label="Забыть",
            danger=True,
            on_confirm=lambda: _drop_battle(app, path),
        )

    rows = [
        c.list_row(
            snapshot.title,
            snapshot.summary,
            trailing=[
                c.secondary_button(
                    "Продолжить",
                    lambda s=snapshot: resume(s),
                    icon=ft.Icons.PLAY_ARROW,
                    height=t.BUTTON_SM_H,
                )
            ],
            on_click=lambda s=snapshot: resume(s),
            menu=[
                c.MenuItem("Продолжить", lambda s=snapshot: resume(s), icon=ft.Icons.PLAY_ARROW),
                c.MENU_DIVIDER,
                c.MenuItem(
                    "Забыть сохранение…",
                    lambda p=path, s=snapshot: drop(p, s),
                    icon=ft.Icons.DELETE_OUTLINE,
                    danger=True,
                ),
            ],
            last=index == len(saved) - 1,
        )
        for index, (path, snapshot) in enumerate(saved)
    ]
    return c.framed_card("Незаконченные бои", ft.Column(rows, spacing=0, tight=True))


def _drop_battle(app: AppState, path) -> None:
    delete_battle(path)
    app.notify("Сохранение удалено")
    app.go(ROUTES["home"])


def build(app: AppState) -> ft.View:
    results = app.results()[:8]
    scenarios = app.scenarios()[:8]

    if results:
        table_body: ft.Control = c.table(
            RESULT_COLUMNS,
            [
                result_row(result, app, last=index == len(results) - 1)
                for index, (_, result) in enumerate(results)
            ],
        )
    else:
        table_body = c.empty_state(
            "Проведённых боёв пока нет",
            "Законченный бой попадает сюда сам — с исходом, потерями и сидом.",
            icon=ft.Icons.HISTORY,
        )

    recent = c.framed_card(
        "Последние бои",
        table_body,
        trailing=[c.tertiary_button("Весь архив", lambda: app.go(ROUTES["archive"]))],
        expand=True,
    )

    unfinished = saved_battles_card(app)
    left = ft.Column(
        [
            current_battle_card(app),
            *([unfinished] if unfinished is not None else []),
            recent,
        ],
        spacing=t.GAP,
        expand=True,
    )

    scenario_body = (
        ft.Column(
            [
                scenario_row(scenario, app, last=index == len(scenarios) - 1)
                for index, (_, scenario) in enumerate(scenarios)
            ],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        )
        if scenarios
        else c.empty_state(
            "Сохранённых сценариев нет",
            "Сценарий сохраняется на подготовке боя — меню «Ещё действия».",
            icon=ft.Icons.BOOKMARK_BORDER,
        )
    )
    right = c.framed_card("Сценарии", scenario_body, expand=True)

    engine = app.engine
    going = engine is not None and engine.turn > 0 and not engine.finished
    battle_route = ROUTES["battle"].format(id=app.scenario.id)
    return screen(
        app,
        active="home",
        title="Обзор",
        subtitle="Что сейчас в бою и что было",
        actions=[
            c.secondary_button("К подготовке", lambda: app.go(ROUTES["battle_setup"]))
            if going
            else c.secondary_button("Открыть пульт", lambda: app.go(battle_route)),
            c.primary_button(
                "Продолжить бой" if going else "Новый бой",
                lambda: app.go(battle_route if going else ROUTES["battle_setup"]),
                icon=ft.Icons.PLAY_ARROW,
            ),
        ],
        body=c.columns(left, right, right_width=360),
    )


def _open_scenario(app: AppState, scenario: Scenario) -> None:
    app.load_scenario(scenario)
    app.go(ROUTES["battle_setup"])


def _open_result(app: AppState, result: BattleResult) -> None:
    app.result = result
    app.go(ROUTES["battle_result"].format(id=result.scenario_id))
