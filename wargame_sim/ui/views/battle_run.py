"""Пульт боя: ход, обе стороны, элементы и журнал — всё видно сразу.

Экран не прокручивается: каждая панель ограничена по высоте и прокручивает
своё содержимое сама. Прогон хода пересчитывает индикатор, карточки сторон,
таблицу элементов, блок «Требует внимания» и журнал.
"""

from __future__ import annotations

import flet as ft

from core.models import BattalionState
from ui import theme as t
from ui.shell import scenario_aside, screen
from ui.state import ALL, SIDE_A, SIDE_B, SIDE_BOTH, AppState
from ui.widgets import common as c
from ui.widgets import journal as j
from ui.widgets.battalion import RUN_COLUMNS, element_row, side_panel

ROUTE = "/battle/{id}"

#: Сколько ходов делает кнопка «+5 ходов».
FEW_TURNS = 5

SIDE_OPTIONS: tuple[tuple[str, str], ...] = (
    (SIDE_BOTH, "A и B"),
    (SIDE_A, "только A"),
    (SIDE_B, "только B"),
)


def turn_indicator(turn: int, limit: int, finished: bool, outcome: str) -> ft.Control:
    """Индикатор хода: номер с ведущим нулём и статус боя."""
    status = outcome if finished else "бой идёт"
    return ft.Container(
        content=ft.Row(
            [
                t.caption("Ход"),
                ft.Text(
                    f"{turn:02d}",
                    style=t.mono(size=t.SIZE_TURN_NUM, weight=t.W600, spacing=-0.4),
                ),
                ft.Text(f"/ {limit}", style=t.mono(size=t.SIZE_ROW, color=t.TEXT_MUTED)),
                ft.Container(width=1, height=18, bgcolor=t.BORDER),
                ft.Text(
                    status,
                    style=t.sans(
                        size=t.SIZE_ROW,
                        weight=t.W500,
                        color=t.LOSS if finished else t.OK,
                    ),
                ),
            ],
            spacing=10,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        padding=ft.Padding.symmetric(vertical=5, horizontal=12),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_TURN,
    )


def build(app: AppState, battle_id: str) -> ft.View:
    engine = app.ensure_battle()
    scenario = app.scenario
    config = app.config

    panels = ft.Container()
    elements_body = ft.Container(expand=True)
    elements_count = ft.Text(style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED))
    attention = ft.Container()
    journal_body = ft.Container(expand=True)
    journal_footer = ft.Row(spacing=8, vertical_alignment=ft.CrossAxisAlignment.CENTER)
    indicator = ft.Container()
    busy = ft.ProgressBar(visible=False, color=t.TEXT, bgcolor=t.TRACK, height=2)

    # -- данные боя ---------------------------------------------------------
    def side_losses(side: str) -> tuple[int, int]:
        state = engine.state.side(side)
        return state.total_personnel_lost(), state.total_vehicles_lost()

    def visible_entries() -> list:
        turn = None if app.journal_turn == ALL else int(app.journal_turn)
        return engine.log.filter(
            turn=turn,
            element=None if app.journal_element == ALL else app.journal_element,
            event=None if app.journal_event == ALL else app.journal_event,
        )

    def outcome_text() -> str:
        winner = engine.winner
        reason = engine.end_reason
        if winner is None:
            return "бой окончен"
        return f"{winner} · {reason}" if str(winner) != "ничья" else f"ничья · {reason}"

    # -- перерисовка --------------------------------------------------------
    def redraw_indicator() -> None:
        indicator.content = turn_indicator(
            engine.turn, scenario.environment.max_turns, engine.finished, outcome_text()
        )
        app.refresh(indicator)

    def redraw_panels() -> None:
        a_losses, a_vehicles = side_losses("A")
        b_losses, b_vehicles = side_losses("B")
        panels.content = ft.Row(
            [
                side_panel(
                    engine.state.battalion("A"), "A", losses=a_losses, vehicle_losses=a_vehicles
                ),
                side_panel(
                    engine.state.battalion("B"), "B", losses=b_losses, vehicle_losses=b_vehicles
                ),
            ],
            spacing=t.GAP,
            vertical_alignment=ft.CrossAxisAlignment.START,
        )
        app.refresh(panels)

    def redraw_elements() -> None:
        rows: list[ft.Control] = []
        sides = (
            ("A", "B")
            if app.run_side_filter == SIDE_BOTH
            else (app.run_side_filter,)
        )
        pairs = [
            (side, element)
            for side in sides
            for element in engine.state.battalion(side).elements
        ]
        for index, (side, element) in enumerate(pairs):
            rows.append(
                element_row(
                    element,
                    engine.state.battalion(side),
                    config,
                    side=side,
                    last=index == len(pairs) - 1,
                )
            )
        elements_body.content = ft.Column(
            rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True
        )
        elements_count.value = f"строк {len(pairs)}"
        app.refresh(elements_body, elements_count)

    def redraw_attention() -> None:
        rows = j.attention_rows(
            [("A", engine.state.battalion("A")), ("B", engine.state.battalion("B"))],
            app.alarm_morale,
        )
        attention.content = j.attention_card(rows, app.alarm_morale)
        app.refresh(attention)

    def redraw_journal() -> None:
        entries = visible_entries()
        journal_body.content = j.entries_list(entries, app.journal_detail)
        journal_footer.controls = [
            ft.Text(
                f"записей {len(engine.log)} · хеш {engine.log.digest()[:8]}",
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                expand=True,
            ),
            ft.Text(
                f"сид {engine.master_seed}",
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
            ),
        ]
        app.refresh(journal_body, journal_footer)

    def redraw_all() -> None:
        redraw_indicator()
        redraw_panels()
        redraw_elements()
        redraw_attention()
        redraw_journal()

    # -- действия -----------------------------------------------------------
    def run_in_background(work) -> None:
        """Длинные расчёты — в отдельном потоке, UI не блокируется (§10)."""

        def task() -> None:
            try:
                work()
            finally:
                busy.visible = False
                redraw_all()
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
        app.go(f"/battle/{battle_id}/result")

    def set_side_filter(value: str) -> None:
        app.run_side_filter = value
        side_switch.content = c.segmented(SIDE_OPTIONS, value, set_side_filter)
        redraw_elements()
        app.refresh(side_switch)

    def set_journal(attribute: str, value: str) -> None:
        setattr(app, attribute, value)
        rebuild_journal_controls()
        redraw_journal()

    # -- контролы журнала ---------------------------------------------------
    journal_controls = ft.Row(spacing=8, vertical_alignment=ft.CrossAxisAlignment.CENTER)

    def rebuild_journal_controls() -> None:
        journal_controls.controls = [
            c.segmented(
                j.DETAIL_OPTIONS, app.journal_detail,
                lambda value: set_journal("journal_detail", value),
                size=t.SIZE_META,
            ),
            c.select(
                app.journal_turn,
                j.filter_options([str(turn) for turn in engine.log.turns()], "все ходы"),
                lambda value: set_journal("journal_turn", value),
                width=124,
            ),
            c.select(
                app.journal_element,
                j.filter_options(engine.log.actors(), "все элементы"),
                lambda value: set_journal("journal_element", value),
                width=164,
            ),
            c.icon_button(
                ft.Icons.DOWNLOAD_OUTLINED,
                export_journal,
                size=t.BUTTON_XS_H,
                icon_size=15,
                tooltip="Выгрузить журнал целиком",
            ),
        ]
        app.refresh(journal_controls)

    def export_journal() -> None:
        from core.storage import write_text

        path = write_text(
            app.results_dir / f"journal_{scenario.id}_{engine.master_seed}.md",
            engine.log.to_markdown(),
        )
        app.notify(f"Журнал выгружен: {path.name}")

    side_switch = ft.Container(
        content=c.segmented(SIDE_OPTIONS, app.run_side_filter, set_side_filter)
    )

    # -- первичная сборка ---------------------------------------------------
    rebuild_journal_controls()
    redraw_all()

    elements_card = c.framed_card(
        "Элементы",
        ft.Column([c.table_head(RUN_COLUMNS), elements_body], spacing=0, expand=True),
        trailing=[side_switch, elements_count],
        expand=True,
    )

    journal_card = c.framed_card(
        "Журнал",
        journal_body,
        trailing=[journal_controls],
        footer=c.card_footer([journal_footer]),
        expand=True,
    )

    left = ft.Column([panels, elements_card], spacing=t.GAP, expand=True)
    right = ft.Column([attention, journal_card], spacing=t.GAP, expand=True)

    body = ft.Column(
        [
            busy,
            ft.Row(
                [
                    ft.Container(content=left, expand=True),
                    ft.Container(content=right, width=420),
                ],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.START,
                expand=True,
            ),
        ],
        spacing=0,
        expand=True,
    )

    sides = (
        f"{scenario.battalion_a.name} · {scenario.battalion_a.order}"
        f"  →  {scenario.battalion_b.name} · {scenario.battalion_b.order}"
    )

    return screen(
        app,
        active="battle",
        active_child="run",
        title=f"Бой: {scenario.name}",
        subtitle=sides,
        mono_subtitle=True,
        leading_extra=[ft.Container(width=8), indicator],
        actions=[
            c.primary_button("Шаг", step, icon=ft.Icons.SKIP_NEXT),
            c.secondary_button(f"+{FEW_TURNS} ходов", few_turns),
            c.secondary_button("До конца", to_the_end),
            c.icon_button(ft.Icons.REPLAY, restart, tooltip="Начать заново с тем же сидом"),
            c.secondary_button("Итог", show_result, icon=ft.Icons.ASSESSMENT_OUTLINED),
        ],
        aside=scenario_aside(app),
        body=body,
    )


def battle_state_label(state: BattalionState) -> str:
    """Подпись состояния батальона для панелей."""
    return str(state)
