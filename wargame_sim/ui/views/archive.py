"""Архив: проведённые бои и сохранённые сценарии (§10).

Поиск идёт по названию сценария, фильтр — по исходу. «Сыграть заново»
поднимает тот же сценарий и начинает новый — сам по себе уникальный — бой.
"""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.models import BattleResult, Scenario, Winner
from core.report import winner_label
from core.storage import delete_file
from ui import theme as t
from ui.shell import screen
from ui.state import ALL, ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import dialogs as dlg

ROUTE = ROUTES["archive"]

#: Фильтр по исходу боя.
OUTCOME_OPTIONS: tuple[tuple[str, str], ...] = (
    (ALL, "все"),
    (str(Winner.A), "победа A"),
    (str(Winner.B), "победа B"),
    (str(Winner.DRAW), "ничья"),
)

RESULT_COLUMNS: tuple[c.Col, ...] = (
    c.Col("Сценарий", expand=True),
    c.Col("Исход", 86),
    c.Col("Причина", 110, optional=1),
    c.Col("Ходов", 58, numeric=True, optional=2),
    c.Col("Потери A", 78, numeric=True),
    c.Col("Потери B", 78, numeric=True),
    c.Col("", 28),
)


def matches(result: BattleResult, query: str, outcome: str) -> bool:
    """Строка проходит фильтр по исходу и поиску по названию сценария."""
    if outcome != ALL and str(result.winner) != outcome:
        return False
    if not query:
        return True
    needle = query.strip().lower()
    return needle in result.scenario_name.lower()


#: Ширина правой колонки со сценариями.
SCENARIOS_W = 400


def build(app: AppState) -> ft.View:
    results_body = ft.Container(expand=True)
    table = c.Table.fit(
        RESULT_COLUMNS, t.content_width(app.window_width, right=SCENARIOS_W)
    )
    #: Битые файлы результатов: молча пропускать их — значит врать, что
    #: боя не было.
    broken_holder = ft.Container()
    results_title = ft.Text(style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED, spacing=1.1))
    scenarios_body = ft.Container(expand=True)

    # -- действия -----------------------------------------------------------
    def open_result(result: BattleResult) -> None:
        app.result = result
        app.go(ROUTES["battle_result"].format(id=result.scenario_id))

    def replay(result: BattleResult) -> None:
        """Сыграть заново: тот же сценарий, новый — уникальный — бой."""
        found = [item for _, item in app.scenarios() if item.id == result.scenario_id]
        if found:
            app.load_scenario(found[0])
        app.start_battle()
        app.notify(f"Новый бой: «{app.scenario.name}»")
        app.go(ROUTES["battle"].format(id=app.scenario.id))

    def open_scenario(scenario: Scenario) -> None:
        app.load_scenario(scenario)
        app.notify(f"Загружен сценарий «{scenario.name}»")
        app.go(ROUTES["battle_setup"])

    def ask_remove(path: Path, label: str, what: str) -> None:
        """Спросить перед удалением: файл с диска возврату не подлежит."""
        dlg.confirm(
            app,
            f"Удалить {what} «{label}»?",
            f"Файл {path.name} будет удалён с диска. Отменить это нельзя.",
            confirm_label="Удалить",
            danger=True,
            on_confirm=lambda: remove(path, label),
        )

    def remove(path: Path, label: str) -> None:
        delete_file(path)
        app.notify(f"Удалено: {label}")
        app.go(ROUTE)

    def set_outcome(value: str) -> None:
        app.archive_outcome = value
        outcome_switch.content = c.segmented(OUTCOME_OPTIONS, value, set_outcome)
        render_results()
        app.refresh(outcome_switch)

    def set_query(value: str) -> None:
        app.archive_query = value
        render_results()

    # -- проведённые бои ----------------------------------------------------
    def result_row(path: Path, result: BattleResult, *, last: bool) -> ft.Control:
        a, b = result.side_a.personnel_lost, result.side_b.personnel_lost
        menu: list[c.MenuItem | None] = [
            c.MenuItem(
                "Сыграть заново",
                lambda: replay(result),
                icon=ft.Icons.REPLAY,
            ),
            c.MENU_DIVIDER,
            c.MenuItem(
                "Удалить…",
                lambda: ask_remove(path, result.scenario_name, "запись о бое"),
                icon=ft.Icons.DELETE_OUTLINE,
                danger=True,
            ),
        ]
        return table.row(
            [
                t.text(result.scenario_name, size=t.SIZE_ROW, weight=t.W500, no_wrap=True),
                t.text(
                    winner_label(result.winner),
                    size=t.SIZE_ROW,
                    weight=t.W500,
                    color=t.TEXT_3 if result.winner == Winner.DRAW else t.TEXT,
                ),
                t.text(str(result.end_reason), size=t.SIZE_ROW, color=t.TEXT_3),
                t.num(str(result.turns)),
                t.num(str(a), color=t.LOSS if a >= b else t.TEXT),
                t.num(str(b), color=t.LOSS if b > a else t.TEXT),
                c.row_menu(menu),
            ],
            height=t.TABLE_ROW_H + 6,
            last=last,
            on_click=lambda: open_result(result),
            menu=menu,
        )

    def render_results() -> None:
        broken = app.broken_results()
        found = [
            (path, result)
            for path, result in app.results()
            if matches(result, app.archive_query, app.archive_outcome)
        ]
        results_title.value = f"ПРОВЕДЁННЫЕ БОИ · {len(found)}"
        if found:
            results_body.content = ft.Column(
                [
                    result_row(path, result, last=index == len(found) - 1)
                    for index, (path, result) in enumerate(found)
                ],
                spacing=0,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        elif broken:
            results_body.content = c.empty_state(
                "Читаемых записей нет",
                f"Нечитаемых файлов {len(broken)} — см. предупреждение над таблицей.",
            )
        elif app.results():
            results_body.content = c.empty_state(
                "Ничего не найдено", "Снимите фильтр по исходу или очистите поиск."
            )
        else:
            results_body.content = c.empty_state(
                "Проведённых боёв пока нет",
                "Законченный бой попадает сюда сам — с исходом и потерями.",
                icon=ft.Icons.HISTORY,
            )
        broken_holder.content = (
            ft.Container(
                content=c.warn_banner(
                    f"Не читается файлов результатов: {len(broken)}. Их нет в таблице. "
                    + "; ".join(f"{path.name} — {reason}" for path, reason in broken[:2])
                ),
                margin=ft.Margin.only(bottom=t.GAP),
            )
            if broken
            else None
        )
        app.refresh(results_body, results_title, broken_holder)

    # -- сценарии -----------------------------------------------------------
    def scenario_row(path: Path, scenario: Scenario, *, last: bool) -> ft.Control:
        """Сценарий строкой: щелчок открывает его в подготовке, «⋯» — остальное."""
        environment = scenario.environment
        return c.list_row(
            scenario.name,
            f"{scenario.battalion_a.name} → {scenario.battalion_b.name} · "
            f"{environment.terrain} · {environment.time_of_day}",
            on_click=lambda: open_scenario(scenario),
            menu=[
                c.MenuItem(
                    "Открыть в подготовке",
                    lambda: open_scenario(scenario),
                    icon=ft.Icons.OPEN_IN_NEW,
                ),
                c.MENU_DIVIDER,
                c.MenuItem(
                    "Удалить…",
                    lambda: ask_remove(path, scenario.name, "сценарий"),
                    icon=ft.Icons.DELETE_OUTLINE,
                    danger=True,
                ),
            ],
            last=last,
        )

    def render_scenarios() -> None:
        scenarios = app.scenarios()
        if scenarios:
            scenarios_body.content = ft.Column(
                [
                    scenario_row(path, scenario, last=index == len(scenarios) - 1)
                    for index, (path, scenario) in enumerate(scenarios)
                ],
                spacing=0,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        else:
            scenarios_body.content = c.empty_state(
                "Сохранённых сценариев нет",
                "Сценарий сохраняется на подготовке боя — меню «Ещё действия».",
                icon=ft.Icons.BOOKMARK_BORDER,
            )
        app.refresh(scenarios_body)

    # -- сборка -------------------------------------------------------------
    outcome_switch = ft.Container(
        content=c.segmented(OUTCOME_OPTIONS, app.archive_outcome, set_outcome)
    )
    search, focus_search = c.search_box(
        app.archive_query, set_query, placeholder="Поиск по сценарию"
    )
    app.bind("Ctrl+F", focus_search)

    render_results()
    render_scenarios()

    results_card = ft.Container(
        content=ft.Column(
            [
                ft.Container(
                    content=ft.Row(
                        [results_title, c.spacer(), outcome_switch],
                        spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    height=t.CARD_HEADER_H,
                    padding=ft.Padding.symmetric(horizontal=t.PAD_CARD),
                    border=t.border_bottom(t.BORDER),
                ),
                ft.Column([table.head(), results_body], spacing=0, expand=True),
                c.card_footer(
                    [
                        ft.Text(
                            "«Сыграть заново» поднимает тот же сценарий и начинает новый бой",
                            style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                        )
                    ]
                ),
            ],
            spacing=0,
            expand=True,
        ),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
        expand=True,
    )

    scenarios_card = c.framed_card(
        f"Сценарии · {len(app.scenarios())}", scenarios_body, expand=True
    )

    return screen(
        app,
        active="archive",
        title="Архив",
        subtitle="Проведённые бои и сценарии",
        actions=[search],
        body=ft.Column(
            [broken_holder, c.columns(results_card, scenarios_card, right_width=SCENARIOS_W)],
            spacing=0,
            expand=True,
        ),
    )
