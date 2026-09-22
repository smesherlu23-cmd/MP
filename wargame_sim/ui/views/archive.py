"""Архив: проведённые бои и сохранённые сценарии, повтор по сиду (§10).

Поиск идёт по названию сценария и по сиду, фильтр — по исходу. Повтор
подставляет сид сохранённого боя в сценарий: бой воспроизводится ход в ход.
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
    c.Col("Ходов", 58, numeric=True, optional=3),
    c.Col("Сид", 62, numeric=True, optional=2),
    c.Col("Потери A", 78, numeric=True),
    c.Col("Потери B", 78, numeric=True),
    c.Col("", 72),
)


def matches(result: BattleResult, query: str, outcome: str) -> bool:
    """Строка проходит фильтр по исходу и поиску по названию или сиду."""
    if outcome != ALL and str(result.winner) != outcome:
        return False
    if not query:
        return True
    needle = query.strip().lower()
    return needle in result.scenario_name.lower() or needle in str(result.master_seed)


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
        """Повтор по сиду: тот же сценарий и тот же сид — тот же бой (§7)."""
        found = [item for _, item in app.scenarios() if item.id == result.scenario_id]
        if found:
            app.load_scenario(found[0])
        app.scenario.master_seed = result.master_seed
        app.start_battle()
        app.notify(f"Повтор по сиду {result.master_seed}")
        app.go(ROUTES["battle"].format(id=app.scenario.id))

    def open_scenario(scenario: Scenario) -> None:
        app.load_scenario(scenario)
        app.notify(f"Загружен сценарий «{scenario.name}»")
        app.go(ROUTES["battle_setup"])

    def ask_remove(path: Path, label: str, what: str) -> None:
        """Спросить перед удалением: файл с диска возврату не подлежит.

        Раньше это были два щелчка по одной кнопке с подписью «Точно?» —
        приём из терминала, а не из настольного приложения: подтверждение
        приходилось угадывать по сменившейся надписи.
        """
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
        # Кнопки-значки, а не подписи: строка и так открывается щелчком, а
        # полный набор действий лежит под правой кнопкой. Широкая колонка
        # действий съедала место у названия сценария в узком окне.
        actions = ft.Row(
            [
                c.spacer(),
                c.icon_button(
                    ft.Icons.REPLAY,
                    lambda: replay(result),
                    size=t.BUTTON_XS_H,
                    icon_size=15,
                    tooltip=f"Повтор по сиду {result.master_seed}",
                ),
                c.icon_button(
                    ft.Icons.DELETE_OUTLINE,
                    lambda: ask_remove(path, result.scenario_name, "запись о бое"),
                    size=t.BUTTON_XS_H,
                    icon_size=15,
                    color=t.LOSS,
                    tooltip="Удалить запись",
                ),
            ],
            spacing=6,
        )
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
                t.num(str(result.master_seed)),
                t.num(str(a), color=t.LOSS if a >= b else t.TEXT),
                t.num(str(b), color=t.LOSS if b > a else t.TEXT),
                actions,
            ],
            height=t.TABLE_ROW_TALL_H,
            last=last,
            on_click=lambda: open_result(result),
            menu=[
                c.MenuItem("Открыть", lambda: open_result(result), icon=ft.Icons.OPEN_IN_NEW),
                c.MenuItem(
                    f"Повтор по сиду {result.master_seed}",
                    lambda: replay(result),
                    icon=ft.Icons.REPLAY,
                ),
                c.MenuItem(
                    "Удалить…",
                    lambda: ask_remove(path, result.scenario_name, "запись о бое"),
                    icon=ft.Icons.DELETE_OUTLINE,
                    danger=True,
                ),
            ],
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
            results_body.content = c.empty_hint(
                f"Читаемых записей нет, а нечитаемых файлов {len(broken)} — "
                "см. предупреждение над таблицей."
            )
        else:
            results_body.content = c.empty_hint(
                "Ничего не найдено — снимите фильтр или очистите поиск."
            )
        broken_holder.content = (
            c.warn_banner(
                f"Не читается файлов результатов: {len(broken)}. Их нет в таблице. "
                + "; ".join(f"{path.name} — {reason}" for path, reason in broken[:2])
            )
            if broken
            else None
        )
        app.refresh(results_body, results_title, broken_holder)

    # -- сценарии -----------------------------------------------------------
    def scenario_block(path: Path, scenario: Scenario, *, last: bool) -> ft.Control:
        environment = scenario.environment
        block = ft.Container(
            content=ft.Column(
                [
                    ft.Row(
                        [
                            ft.Text(
                                scenario.name,
                                style=t.sans(size=t.SIZE_BODY, weight=t.W600),
                                expand=True,
                            ),
                            ft.Text(
                                f"сид {scenario.master_seed}",
                                style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED),
                            ),
                        ],
                        spacing=8,
                    ),
                    ft.Text(
                        f"{scenario.battalion_a.name} · {scenario.battalion_a.order}"
                        f" → {scenario.battalion_b.name} · {scenario.battalion_b.order}",
                        style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3, height=1.5),
                    ),
                    ft.Text(
                        f"{environment.terrain} · {environment.time_of_day}"
                        f" · {environment.weather} · предел {environment.max_turns}",
                        style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3, height=1.5),
                    ),
                    ft.Row(
                        [
                            c.secondary_button(
                                "Открыть",
                                lambda: open_scenario(scenario),
                                height=t.BUTTON_SM_H,
                            ),
                            c.tertiary_button(
                                "Удалить",
                                lambda: ask_remove(path, scenario.name, "сценарий"),
                                height=t.BUTTON_SM_H,
                                color=t.LOSS,
                            ),
                        ],
                        spacing=t.GAP_SM,
                    ),
                ],
                spacing=6,
                tight=True,
            ),
            padding=ft.Padding.symmetric(vertical=14, horizontal=t.PAD_CARD),
            border=None if last else t.border_bottom(t.BORDER_INNER),
        )
        return c.interactive(
            block,
            menu=[
                c.MenuItem(
                    "Открыть в подготовке",
                    lambda: open_scenario(scenario),
                    icon=ft.Icons.OPEN_IN_NEW,
                ),
                c.MenuItem(
                    "Удалить…",
                    lambda: ask_remove(path, scenario.name, "сценарий"),
                    icon=ft.Icons.DELETE_OUTLINE,
                    danger=True,
                ),
            ],
            hover=False,
        )

    def render_scenarios() -> None:
        scenarios = app.scenarios()
        if scenarios:
            scenarios_body.content = ft.Column(
                [
                    scenario_block(path, scenario, last=index == len(scenarios) - 1)
                    for index, (path, scenario) in enumerate(scenarios)
                ],
                spacing=0,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        else:
            scenarios_body.content = c.empty_hint("Сохранённых сценариев пока нет.")
        app.refresh(scenarios_body)

    # -- сборка -------------------------------------------------------------
    outcome_switch = ft.Container(
        content=c.segmented(OUTCOME_OPTIONS, app.archive_outcome, set_outcome)
    )
    search, focus_search = c.search_box(
        app.archive_query, set_query, placeholder="Поиск по сценарию или сиду"
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
                            "повтор по сиду воспроизводит бой ход в ход",
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
        f"Сценарии · {len(app.scenarios())}",
        scenarios_body,
        trailing=[
            c.icon_button(
                ft.Icons.ADD,
                lambda: app.go(ROUTES["battle_setup"]),
                size=t.BUTTON_XS_H,
                icon_size=16,
                tooltip="Собрать новый сценарий",
            )
        ],
        expand=True,
    )

    return screen(
        app,
        active="archive",
        title="Архив",
        subtitle="Сценарии и проведённые бои; любой можно повторить",
        actions=[search],
        body=ft.Column(
            [broken_holder, c.columns(results_card, scenarios_card, right_width=SCENARIOS_W)],
            spacing=t.GAP,
            expand=True,
        ),
    )
