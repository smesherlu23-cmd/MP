"""Итог боя: исход словами, сводка, элементы «начало → конец», экспорт (§9).

Все числа берутся из готового :class:`BattleResult` — экран ничего не
пересчитывает, поэтому показанное совпадает с выгруженным отчётом.
"""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.models import (
    BattalionState,
    BattleResult,
    ElementReport,
    Order,
    SideReport,
    Winner,
)
from core.report import outcome_text, result_csv, result_html, result_markdown
from core.storage import write_text
from ui import theme as t
from ui.shell import scenario_aside, screen
from ui.state import ROUTES, SIDE_A, SIDE_B, SIDE_BOTH, AppState
from ui.widgets import common as c
from ui.widgets import journal as j

ROUTE = ROUTES["battle_result"]

SIDE_OPTIONS: tuple[tuple[str, str], ...] = (
    (SIDE_BOTH, "A и B"),
    (SIDE_A, "только A"),
    (SIDE_B, "только B"),
)

#: Колонки таблицы «элементы: начало → конец».
ELEMENT_COLUMNS: tuple[c.Col, ...] = (
    c.Col("С", 24),
    c.Col("Элемент", expand=True),
    c.Col("Л/с", 92, numeric=True),
    c.Col("Потери", 72, numeric=True),
    c.Col("Техника", 72, numeric=True),
    c.Col("Потери т.", 78, numeric=True),
    c.Col("Мораль", 62, numeric=True),
    c.Col("Подавл.", 62, numeric=True),
    c.Col("Приказ на конец", 150, pad_left=14),
)


def summary_columns(result: BattleResult) -> tuple[c.Col, ...]:
    return (
        c.Col("Сводка по сторонам", expand=True),
        c.Col(f"A — {result.side_a.name}", 160, numeric=True),
        c.Col(f"B — {result.side_b.name}", 160, numeric=True),
    )


def loss_text(lost: int, ratio: float) -> str:
    """Потери так, как их читает ГМ: сколько и какая это доля."""
    return f"{lost} · {ratio * 100:.0f}%"


def outcome_badge(result: BattleResult) -> ft.Control:
    """Плашка исхода: кто победил, почему и на каком ходу."""
    winner = str(result.winner)
    title = "Ничья" if result.winner == Winner.DRAW else f"Победа {winner}"
    return ft.Container(
        content=ft.Row(
            [
                ft.Text(
                    title,
                    style=t.sans(size=t.SIZE_TITLE, weight=t.W600, color=t.TEXT_INVERSE),
                ),
                ft.Text(
                    f"{result.end_reason} · ход {result.turns}",
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_INVERSE),
                    opacity=0.75,
                ),
            ],
            spacing=10,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        padding=ft.Padding.symmetric(vertical=6, horizontal=12),
        bgcolor=t.TEXT,
        border_radius=t.R_BUTTON,
    )


def defeated_note(result: BattleResult) -> str:
    """Одной строкой: что случилось с проигравшей стороной."""
    for report in (result.side_a, result.side_b):
        if report.state in (BattalionState.ROUTED, BattalionState.PANIC, BattalionState.RETREATING):
            return f"{report.name} — {report.state}"
    if result.side_a.task_completed or result.side_b.task_completed:
        done = result.side_a if result.side_a.task_completed else result.side_b
        return f"{done.name} выполнил боевую задачу"
    return "обе стороны удержались в строю"


def build(app: AppState, battle_id: str) -> ft.View:
    # Итог собирается только по законченному бою. У незаконченного движок
    # подставит «ничью по лимиту ходов» — и экран покажет конец, которого
    # не было. Проверка стоит здесь, а не в кнопке: на этот маршрут ведут
    # ещё подпункт навигации и карточка с главной.
    engine = app.engine
    unfinished = engine is not None and not engine.finished
    # Через `finish_battle`, а не `engine.result()` напрямую: итог считается
    # один раз и законченный бой при этом попадает в архив. На этот маршрут
    # ведёт и подпункт навигации, куда можно прийти, минуя пульт.
    result = app.result
    if result is None and engine is not None and engine.finished:
        result = app.finish_battle()
    if result is None:
        return screen(
            app,
            active="battle",
            active_child="result",
            title="Итог боя",
            subtitle=f"Бой идёт, ход {engine.turn}" if unfinished else "Бой ещё не проводился",
            actions=[
                c.primary_button(
                    "К пульту боя",
                    lambda: app.go(ROUTES["battle"].format(id=battle_id)),
                    icon=ft.Icons.SHIELD_OUTLINED,
                )
                if unfinished
                else c.primary_button(
                    "К настройке боя",
                    lambda: app.go(ROUTES["battle_setup"]),
                    icon=ft.Icons.TUNE,
                )
            ],
            body=c.empty_hint(
                "Бой ещё идёт. Итог складывается по законченному бою: "
                "победитель, причина и остаточная боеспособность."
                if unfinished
                else "Сначала проведите бой — итог появится здесь."
            ),
        )

    config = app.config
    panic_level = config.mor.thresholds.panic
    loser = _loser(result)
    elements_body = ft.Container(expand=True)
    elements_count = ft.Text(style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED))

    # -- действия -----------------------------------------------------------
    def export(kind: str) -> None:
        """Отчёт об исходе — в папку, которую выберет ГМ."""
        app.ask_directory(
            f"Куда выгрузить отчёт ({kind.upper()})",
            lambda directory: _write(kind, directory),
        )

    def _write(kind: str, directory: Path) -> None:
        stem = f"{result.scenario_id}_{result.master_seed}"
        if kind == "md":
            path = write_text(directory / f"{stem}.md", result_markdown(result))
        elif kind == "html":
            path = write_text(directory / f"{stem}.html", result_html(result))
        else:
            path = write_text(directory / f"{stem}.csv", result_csv(result))
        app.notify(f"Выгружено: {path}")

    def to_archive() -> None:
        """Повторная попытка записи: сам итог архивируется при конце боя."""
        path = app.archive_result(result)
        if path is None:
            app.notify("Каталог данных недоступен на запись — итог не сохранён")
            return
        app.result_path = path
        app.notify(f"Сохранено в архив: {path.name}")

    def replay() -> None:
        """Повтор по сиду: тот же сценарий и тот же сид — тот же бой (§7)."""
        app.scenario.master_seed = result.master_seed
        app.start_battle()
        app.go(ROUTES["battle"].format(id=app.scenario.id))

    def set_side(value: str) -> None:
        app.result_side_filter = value
        side_switch.content = c.segmented(SIDE_OPTIONS, value, set_side)
        redraw_elements()
        app.refresh(side_switch)

    # -- таблица элементов --------------------------------------------------
    def element_row(side: str, element: ElementReport, *, last: bool) -> ft.Control:
        panic = element.order == str(Order.PANIC)
        return c.table_row(
            ELEMENT_COLUMNS,
            [
                ft.Text(side, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED)),
                t.text(element.name, size=t.SIZE_ROW),
                t.num(f"{element.personnel_start} → {element.personnel_end}"),
                t.num(
                    str(element.personnel_lost),
                    color=t.LOSS if element.personnel_lost else t.TEXT,
                ),
                t.num(f"{element.vehicles_start} → {element.vehicles_end}")
                if element.vehicles_start
                else c.dash(),
                t.num(
                    str(element.vehicles_lost),
                    color=t.LOSS if element.vehicles_lost else t.TEXT,
                )
                if element.vehicles_start
                else c.dash(),
                t.num(
                    f"{element.morale:.0f}",
                    color=t.LOSS if element.morale < panic_level else t.TEXT,
                ),
                t.num(f"{element.suppression:.0f}"),
                t.text(
                    element.order,
                    size=t.SIZE_META,
                    weight=t.W500 if panic else t.W400,
                    color=t.LOSS if panic else t.TEXT_3,
                ),
            ],
            bgcolor=t.SURFACE_ALT if side == "B" else None,
            last=last,
        )

    def redraw_elements() -> None:
        reports = {"A": result.side_a, "B": result.side_b}
        sides = ("A", "B") if app.result_side_filter == SIDE_BOTH else (app.result_side_filter,)
        pairs = [(side, element) for side in sides for element in reports[side].elements]
        elements_body.content = ft.Column(
            [
                element_row(side, element, last=index == len(pairs) - 1)
                for index, (side, element) in enumerate(pairs)
            ],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        )
        elements_count.value = f"строк {len(pairs)}"
        app.refresh(elements_body, elements_count)

    # -- сводка по сторонам -------------------------------------------------
    def summary_row(
        label: str,
        value_a: ft.Control,
        value_b: ft.Control,
        *,
        last: bool = False,
    ) -> ft.Control:
        return c.table_row(
            summary_columns(result),
            [t.text(label, size=t.SIZE_ROW, color=t.TEXT_2), value_a, value_b],
            height=t.TABLE_ROW_H,
            last=last,
        )

    def state_cell(report: SideReport) -> ft.Control:
        beaten = report.state in (BattalionState.ROUTED, BattalionState.PANIC)
        return t.num(
            report.state,
            weight=t.W500 if beaten else t.W400,
            color=t.LOSS if beaten else t.TEXT,
        )

    def loss_cell(report: SideReport, lost: int, ratio: float) -> ft.Control:
        return t.num(
            loss_text(lost, ratio),
            weight=t.W600 if report.side == loser else t.W400,
            color=t.LOSS,
        )

    a, b = result.side_a, result.side_b
    summary_rows = [
        summary_row("Состояние", state_cell(a), state_cell(b)),
        summary_row(
            "Личный состав",
            c.fraction(a.personnel_end, a.personnel_start),
            c.fraction(b.personnel_end, b.personnel_start),
        ),
        summary_row(
            "Потери в личном составе",
            loss_cell(a, a.personnel_lost, a.personnel_loss_ratio),
            loss_cell(b, b.personnel_lost, b.personnel_loss_ratio),
        ),
        summary_row(
            "Техника",
            c.fraction(a.vehicles_end, a.vehicles_start) if a.vehicles_start else c.dash(),
            c.fraction(b.vehicles_end, b.vehicles_start) if b.vehicles_start else c.dash(),
        ),
        summary_row(
            "Потери техники",
            t.num(str(a.vehicles_lost), color=t.LOSS if a.vehicles_lost else t.TEXT),
            t.num(str(b.vehicles_lost), color=t.LOSS if b.vehicles_lost else t.TEXT),
        ),
        summary_row("Мораль", t.num(f"{a.morale:.0f}"), t.num(f"{b.morale:.0f}")),
        summary_row(
            "Боеспособность",
            t.num(f"{a.combat_power:.0f}", weight=t.W500),
            t.num(f"{b.combat_power:.0f}", weight=t.W500),
        ),
        summary_row(
            "Организация",
            t.num(f"{a.organisation:.0f}", weight=t.W500),
            t.num(f"{b.organisation:.0f}", weight=t.W500),
        ),
        summary_row(
            "Снабжение",
            t.num(f"{a.supply:.0f}"),
            t.num(f"{b.supply:.0f}"),
            last=True,
        ),
    ]

    outcome_card = c.card(
        [
            ft.Row(
                [
                    outcome_badge(result),
                    ft.Text(
                        defeated_note(result),
                        style=t.sans(size=t.SIZE_BODY, color=t.TEXT_3),
                        expand=True,
                    ),
                ],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            ft.Text(
                outcome_text(result),
                style=t.sans(size=t.SIZE_BODY, height=1.6),
                selectable=True,
            ),
        ],
        padding=18,
        spacing=t.GAP_IN,
    )

    summary_card = ft.Container(
        content=ft.Column(
            [c.table_head(summary_columns(result)), *summary_rows], spacing=0, tight=True
        ),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
    )

    side_switch = ft.Container(
        content=c.segmented(SIDE_OPTIONS, app.result_side_filter, set_side)
    )
    redraw_elements()

    elements_card = c.framed_card(
        "Элементы · начало → конец",
        ft.Column([c.table_head(ELEMENT_COLUMNS), elements_body], spacing=0, expand=True),
        trailing=[side_switch, elements_count],
        expand=True,
    )

    # -- правая колонка -----------------------------------------------------
    archived = app.result_path is not None
    reproducibility = c.card(
        [
            t.card_title("Воспроизводимость"),
            c.kv_line("Сид", t.num(str(result.master_seed), weight=t.W500), height=22),
            c.kv_line("Хеш журнала", t.num(result.log_hash[:16] or "—"), height=22),
            c.kv_line("Записей", t.num(str(len(result.log))), height=22),
            c.kv_line(
                "В архиве",
                t.text(
                    app.result_path.name if archived else "не сохранён",
                    size=t.SIZE_ROW,
                    color=None if archived else t.WARN,
                    no_wrap=True,
                ),
                height=22,
            ),
            c.note("Тот же сценарий и тот же сид дают тот же бой ход в ход.", size=t.SIZE_META),
        ],
        spacing=2,
    )

    key = j.key_events(result.log)
    events_card = c.framed_card(
        "Ключевые события",
        ft.Column(
            [
                j.key_event_tile(entry, last=index == len(key) - 1)
                for index, entry in enumerate(key)
            ]
            or [c.empty_hint("Переломных событий не было.")],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        ),
        footer=c.card_footer(
            [
                ft.Text(
                    f"показаны {len(key)} из {len(result.log)} · полный журнал — на пульте боя",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                )
            ]
        ),
        expand=True,
    )

    left = ft.Column(
        [outcome_card, summary_card, elements_card], spacing=t.GAP, expand=True
    )
    right = ft.Column([reproducibility, events_card], spacing=t.GAP, expand=True)

    return screen(
        app,
        active="battle",
        active_child="result",
        title=f"Итог: {result.scenario_name}",
        subtitle=(
            f"ходов {result.turns} · сид {result.master_seed} · записей {len(result.log)}"
        ),
        mono_subtitle=True,
        aside=scenario_aside(app),
        actions=[
            c.secondary_button("Markdown", lambda: export("md"), height=t.BUTTON_SM_H),
            c.secondary_button("HTML", lambda: export("html"), height=t.BUTTON_SM_H),
            c.secondary_button("CSV", lambda: export("csv"), height=t.BUTTON_SM_H),
            c.secondary_button("Повтор по сиду", replay, icon=ft.Icons.REPLAY),
            *(
                ()
                if archived
                else (c.primary_button("В архив", to_archive, icon=ft.Icons.SAVE_OUTLINED),)
            ),
        ],
        body=c.columns(left, right, right_width=400),
    )


def _loser(result: BattleResult) -> str:
    """Сторона, признанная проигравшей: её потери выделяются жирным."""
    if result.winner == Winner.A:
        return "B"
    if result.winner == Winner.B:
        return "A"
    return ""
