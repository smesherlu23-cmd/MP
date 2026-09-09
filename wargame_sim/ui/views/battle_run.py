"""Прогон боя: шаг, 5 ходов, до конца; панели состояния и журнал хода."""

from __future__ import annotations

import flet as ft

from ui.state import ROUTES, AppState
from ui.widgets.battalion import elements_table, state_panel
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    error_banner,
    link_button,
    page_title,
    text_button,
    two_columns,
)
from ui.widgets.journal import ALL, entries_list, filter_bar

ROUTE = ROUTES["battle"]

#: Сколько ходов делает кнопка «несколько ходов».
FEW_TURNS = 5


def build(app: AppState, battle_id: str) -> ft.View:
    engine = app.ensure_battle()
    scenario = app.scenario

    state = {"turn": ALL, "actor": ALL, "event": ALL}
    panels = ft.Container()
    tables = ft.Column(spacing=GAP, tight=True)
    journal_holder = ft.Container(expand=True)
    filters_holder = ft.Container()
    header = ft.Text("", size=14, weight=ft.FontWeight.W_600)
    busy = ft.ProgressBar(visible=False)

    def visible_entries() -> list:
        turn = None if state["turn"] == ALL else int(state["turn"])
        if turn is None and not engine.finished and engine.turn:
            turn = engine.turn  # по умолчанию показываем журнал текущего хода
        return engine.log.filter(
            turn=turn,
            element=None if state["actor"] == ALL else state["actor"],
            event=None if state["event"] == ALL else state["event"],
        )

    def redraw() -> None:
        header.value = (
            f"Ход {engine.turn} из {scenario.environment.max_turns} · "
            + ("бой окончен" if engine.finished else "бой идёт")
            + f" · сид {engine.master_seed}"
        )
        panels.content = two_columns(
            state_panel(engine.state.battalion("A")),
            state_panel(engine.state.battalion("B")),
        )
        tables.controls = [
            card(f"Элементы A — {engine.state.battalion('A').name}",
                 [elements_table(engine.state.battalion("A"))]),
            card(f"Элементы B — {engine.state.battalion('B').name}",
                 [elements_table(engine.state.battalion("B"))]),
        ]
        filters_holder.content = filter_bar(
            turns=engine.log.turns(),
            actors=engine.log.actors(),
            events=engine.log.events(),
            selected_turn=state["turn"],
            selected_actor=state["actor"],
            selected_event=state["event"],
            on_turn=lambda value: set_filter("turn", value),
            on_actor=lambda value: set_filter("actor", value),
            on_event=lambda value: set_filter("event", value),
        )
        journal_holder.content = entries_list(visible_entries())
        app.refresh(header, panels, tables, filters_holder, journal_holder)

    def set_filter(name: str, value: str) -> None:
        state[name] = value
        journal_holder.content = entries_list(visible_entries())
        app.refresh(journal_holder)

    def run_in_background(work) -> None:
        """Длинные расчёты — в отдельном потоке, UI не блокируется (§10)."""

        def task() -> None:
            try:
                work()
            finally:
                busy.visible = False
                redraw()
                app.refresh(busy)

        busy.visible = True
        app.refresh(busy)
        if app.page is None:
            task()
        else:
            app.page.run_thread(task)

    def step() -> None:
        run_in_background(engine.step)

    def few_turns() -> None:
        run_in_background(lambda: engine.run_turns(FEW_TURNS))

    def to_the_end() -> None:
        def work() -> None:
            engine.run()
            app.finish_battle()

        run_in_background(work)

    def restart() -> None:
        app.start_battle()
        app.go(ROUTE.format(id=battle_id))

    def show_result() -> None:
        app.finish_battle()
        app.go(ROUTES["battle_result"].format(id=battle_id))

    redraw()

    controls: list[ft.Control] = [
        page_title(f"Бой: {scenario.name}", scenario.notes or "")
    ]
    if app.config_error:
        controls.append(error_banner(app.config_error))
    controls += [
        ft.Row(
            [
                link_button(
                "Настройка", ROUTES["battle_setup"], app.go, icon=ft.Icons.ARROW_BACK),
                action_button("Шаг", step, icon=ft.Icons.SKIP_NEXT),
                action_button(f"{FEW_TURNS} ходов", few_turns, icon=ft.Icons.FAST_FORWARD),
                action_button("До конца", to_the_end, icon=ft.Icons.DONE_ALL),
                text_button("Заново", restart, icon=ft.Icons.REPLAY),
                text_button("Итог", show_result, icon=ft.Icons.ASSESSMENT),
            ],
            spacing=GAP,
            wrap=True,
        ),
        header,
        busy,
        panels,
        tables,
        card("Журнал", [filters_holder, journal_holder], expand=True),
    ]

    return ft.View(
        route=ROUTE.format(id=battle_id),
        controls=[ft.Column(controls, spacing=GAP, scroll=ft.ScrollMode.AUTO, expand=True)],
        padding=PAD,
    )
