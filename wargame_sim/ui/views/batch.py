"""Прогоны: один сценарий много раз — вероятности, распределения, графики (§9).

Параметры прогона стоят над результатами, а не в шапке экрана: там три
поля без подписей делили место с четырьмя кнопками, а ниже пустовала вся
остальная страница.

Экран ничего не считает сам: он запускает :func:`core.batch.run_batch` в
отдельном потоке и показывает то, что вернул движок. Прогон i использует сид
``base_seed + i``, поэтому любой прогон повторяется поштучно на пульте боя.
"""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.models import MAX_SEED, BatchResult, Distribution, RunRecord, Winner
from core.report import batch_csv, batch_markdown, batch_text, winner_label
from core.storage import write_text
from ui import theme as t
from ui.charts import losses_histogram, outcomes_chart, turns_chart
from ui.shell import screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["batch"]

#: Пределы, в которых имеет смысл запускать массовый прогон.
MIN_RUNS = 1
MAX_RUNS = 10000
MAX_PROCESSES = 64
#: Сколько строк таблицы прогонов показывать сразу.
TABLE_LIMIT = 200

RUN_COLUMNS: tuple[c.Col, ...] = (
    c.Col("#", 44, numeric=True),
    c.Col("Сид", 70, numeric=True),
    c.Col("Исход", 96, pad_left=10),
    c.Col("Причина", expand=True),
    c.Col("Ходов", 70, numeric=True),
    c.Col("Потери A", 90, numeric=True),
    c.Col("Потери B", 90, numeric=True),
    c.Col("Техн. A", 90, numeric=True),
    c.Col("Техн. B", 90, numeric=True),
)

DIST_COLUMNS: tuple[c.Col, ...] = (
    c.Col("Распределения", expand=True),
    c.Col("среднее", 80, numeric=True),
    c.Col("медиана", 80, numeric=True),
    c.Col("p10", 70, numeric=True),
    c.Col("p90", 70, numeric=True),
    c.Col("мин", 70, numeric=True),
    c.Col("макс", 70, numeric=True),
)


def big_number(value: str, label: str, *, color: str | None = None) -> ft.Control:
    """Крупное число вероятности с подписью под ним."""
    return ft.Column(
        [
            ft.Text(
                value,
                style=t.mono(
                    size=t.SIZE_BIG_NUM, weight=t.W600, color=color or t.TEXT, spacing=-0.6
                ),
            ),
            ft.Text(label, style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3)),
        ],
        spacing=2,
        tight=True,
    )


def dist_row(label: str, dist: Distribution, *, last: bool = False) -> ft.Control:
    return c.table_row(
        DIST_COLUMNS,
        [
            t.text(label, size=t.SIZE_ROW, color=t.TEXT_2),
            t.num(f"{dist.mean:.1f}"),
            t.num(f"{dist.median:.1f}"),
            t.num(f"{dist.p10:.1f}"),
            t.num(f"{dist.p90:.1f}"),
            t.num(f"{dist.minimum:.0f}"),
            t.num(f"{dist.maximum:.0f}"),
        ],
        last=last,
    )


def build(app: AppState) -> ft.View:
    scenario = app.scenario

    progress = ft.ProgressBar(value=0, visible=False, color=t.TEXT, bgcolor=t.TRACK, height=2)
    status = ft.Text(style=t.mono(size=t.SIZE_META, color=t.TEXT_3))
    results = ft.Container(expand=True)
    cancel_holder = ft.Container()

    def say(text: str) -> None:
        status.value = text
        app.refresh(status)

    # -- параметры ----------------------------------------------------------
    runs_field = c.labeled(
        "Прогонов",
        c.number_field(
            app.batch_runs,
            lambda value: setattr(app, "batch_runs", int(value)),
            minimum=MIN_RUNS,
            maximum=MAX_RUNS,
            integer=True,
            width=110,
        ),
        width=110,
    )
    seed_field = c.labeled(
        "Базовый сид",
        c.number_field(
            app.batch_seed,
            lambda value: setattr(app, "batch_seed", int(value)),
            minimum=0,
            maximum=MAX_SEED,
            integer=True,
            width=130,
        ),
        width=130,
    )
    processes_field = c.labeled(
        "Процессов · 0 — сколько ядер",
        c.number_field(
            app.batch_processes,
            lambda value: setattr(app, "batch_processes", int(value)),
            minimum=0,
            maximum=MAX_PROCESSES,
            integer=True,
            width=190,
        ),
        width=190,
    )

    # -- запуск -------------------------------------------------------------
    def render_cancel() -> None:
        """Одна кнопка: «Запустить», пока прогонов нет, «Отменить» — пока идут.

        Раньше рядом всегда стояли обе, и «Отменить» большую часть времени
        была серой и ничего не делала.
        """
        cancel_holder.content = (
            c.secondary_button("Отменить", cancel, icon=ft.Icons.CANCEL_OUTLINED)
            if app.batch_running
            else c.primary_button("Запустить", start, icon=ft.Icons.PLAY_ARROW)
        )
        app.refresh(cancel_holder)

    def cancel() -> None:
        app.cancel_batch()
        say("Отмена…")

    def on_progress(done: int, total: int) -> None:
        progress.value = done / total if total else 0
        say(f"прогон {done} из {total}")
        app.refresh(progress)

    def start() -> None:
        if app.batch_running:
            return

        def work() -> None:
            try:
                app.run_batch(
                    app.batch_runs,
                    app.batch_seed,
                    processes=app.batch_processes or None,
                    progress=on_progress,
                )
                say(f"{app.batch_runs} прогонов · готово")
            except Exception as error:
                say(f"ошибка прогона: {error}")
            finally:
                progress.visible = False
                render_cancel()
                render_results()
                app.refresh(progress)

        progress.visible = True
        progress.value = 0
        app.batch_running = True
        render_cancel()
        say("запуск…")
        app.refresh(progress)
        if app.page is None:
            app.batch_running = False
            work()
        else:
            app.page.run_thread(work)

    def export(kind: str) -> None:
        if app.batch is None:
            app.notify("Сначала запустите прогоны.")
            return
        app.ask_directory(
            f"Куда выгрузить сводку ({kind.upper()})",
            lambda directory: _write(kind, directory),
        )

    def _write(kind: str, directory: Path) -> None:
        if app.batch is None:
            return
        stem = f"batch_{app.batch.scenario_id}_{app.batch.base_seed}"
        if kind == "md":
            path = write_text(directory / f"{stem}.md", batch_markdown(app.batch))
        else:
            path = write_text(directory / f"{stem}.csv", batch_csv(app.batch))
        app.notify(f"Выгружено: {path}")

    def use_seed(record: RunRecord) -> None:
        """Подставить сид прогона в настройку боя — прогон повторится точно."""
        app.scenario.master_seed = record.seed
        app.engine = None
        app.result = None
        app.notify(f"Сид {record.seed} подставлен в сценарий")
        app.go(ROUTES["battle_setup"])

    # -- отрисовка результатов ---------------------------------------------
    def probabilities(batch: BatchResult) -> ft.Control:
        share_a = batch.win_probability_a
        share_b = batch.win_probability_b
        share_draw = batch.draw_probability
        numbers = ft.Row(
            [
                big_number(f"{share_a * 100:.1f}%", "победа A"),
                big_number(f"{share_b * 100:.1f}%", "победа B"),
                big_number(f"{share_draw * 100:.1f}%", "ничья", color=t.TEXT_3),
            ],
            spacing=32,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.END,
        )
        bar = ft.Column(
            [
                c.stacked_bar(
                    [(share_a, t.TEXT), (share_b, t.NEUTRAL_B), (share_draw, t.NEUTRAL_DRAW)]
                ),
                ft.Text(
                    f"победа A {share_a * 100:.0f}% · победа B {share_b * 100:.0f}%"
                    f" · ничья {share_draw * 100:.0f}%",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                ),
            ],
            spacing=6,
            tight=True,
            expand=True,
        )
        header = ft.Row(
            [
                t.card_title("Вероятности исходов"),
                c.spacer(),
                ft.Text(
                    f"{batch.runs} прогонов · сид {batch.base_seed}…"
                    f"{batch.base_seed + batch.runs - 1}",
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                ),
            ],
            spacing=8,
        )
        return c.card(
            [
                header,
                ft.Row(
                    [numbers, bar],
                    spacing=32,
                    vertical_alignment=ft.CrossAxisAlignment.END,
                ),
            ],
            padding=18,
            spacing=t.GAP_IN,
        )

    def run_row(record: RunRecord, *, last: bool) -> ft.Control:
        draw = record.winner == Winner.DRAW
        worse_a = record.losses_a >= record.losses_b
        return c.table_row(
            RUN_COLUMNS,
            [
                t.num(str(record.index), color=t.TEXT_MUTED),
                t.num(str(record.seed)),
                t.text(
                    winner_label(record.winner),
                    size=t.SIZE_ROW,
                    weight=t.W500,
                    color=t.TEXT_3 if draw else t.TEXT,
                ),
                t.text(str(record.end_reason), size=t.SIZE_ROW, color=t.TEXT_3),
                t.num(str(record.turns)),
                t.num(str(record.losses_a), color=t.LOSS if worse_a else t.TEXT),
                t.num(str(record.losses_b), color=t.TEXT if worse_a else t.LOSS),
                t.num(str(record.vehicle_losses_a)),
                t.num(str(record.vehicle_losses_b)),
            ],
            last=last,
            on_click=lambda: use_seed(record),
        )

    def end_reason_card(batch: BatchResult) -> ft.Control:
        rows = [
            c.bar(name, count, maximum=batch.runs, display=t.num(str(count), weight=t.W500))
            for name, count in batch.end_reasons.items()
        ]
        return c.card(
            [t.card_title("Способы завершения"), *(rows or [c.empty_hint("Нет данных.")])],
            spacing=t.GAP_SM,
        )

    def charts_card(batch: BatchResult) -> ft.Control:
        images = [
            ("Распределение потерь", losses_histogram(batch)),
            ("Длительность боя", turns_chart(batch)),
            ("Распределение исходов", outcomes_chart(batch)),
        ]
        return c.framed_card(
            "Графики",
            ft.Container(
                content=ft.Column(
                    [
                        ft.Container(
                            content=ft.Image(src=data, fit=ft.BoxFit.FIT_WIDTH, tooltip=title),
                            border=ft.Border.all(1, t.TRACK),
                            border_radius=t.R_BUTTON,
                            bgcolor=t.SURFACE_ALT,
                            clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
                        )
                        for title, data in images
                    ],
                    spacing=t.GAP_IN,
                    scroll=ft.ScrollMode.AUTO,
                    expand=True,
                ),
                padding=t.PAD_CARD,
                expand=True,
            ),
            expand=True,
        )

    def render_results() -> None:
        batch = app.batch
        if batch is None:
            results.content = c.card(
                [
                    c.empty_state(
                        "Прогоны ещё не запускались",
                        "Сценарий сыграется столько раз, сколько указано, — каждый "
                        "со своим сидом. Здесь появятся вероятности исходов, разброс "
                        "потерь и длительности и таблица всех прогонов.",
                        icon=ft.Icons.INSIGHTS_OUTLINED,
                    )
                ],
                expand=True,
            )
            app.refresh(results)
            return

        shown = batch.records[:TABLE_LIMIT]
        runs_card = c.framed_card(
            f"Прогоны · {batch.runs}",
            ft.Column(
                [
                    c.table_head(RUN_COLUMNS),
                    ft.Column(
                        [
                            run_row(record, last=index == len(shown) - 1)
                            for index, record in enumerate(shown)
                        ],
                        spacing=0,
                        scroll=ft.ScrollMode.AUTO,
                        expand=True,
                    ),
                ],
                spacing=0,
                expand=True,
            ),
            trailing=[
                ft.Text(
                    "строка подставляет сид в настройку боя",
                    style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3),
                )
            ],
            expand=True,
        )

        distributions = ft.Container(
            content=ft.Column(
                [
                    c.table_head(DIST_COLUMNS),
                    dist_row("Ходы", batch.turns),
                    dist_row("Потери A", batch.losses_a),
                    dist_row("Потери B", batch.losses_b),
                    dist_row("Потери техники A", batch.vehicle_losses_a),
                    dist_row("Потери техники B", batch.vehicle_losses_b, last=True),
                ],
                spacing=0,
                tight=True,
            ),
            bgcolor=t.CARD_BG,
            border=ft.Border.all(1, t.BORDER),
            border_radius=t.R_CARD,
            clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
        )

        summary = c.card(
            [
                t.card_title("Сводка текстом"),
                ft.Text(
                    batch_text(batch),
                    style=t.sans(size=t.SIZE_ROW, color=t.TEXT_2, height=1.55),
                    selectable=True,
                ),
            ]
        )

        left = ft.Column(
            [probabilities(batch), distributions, runs_card], spacing=t.GAP, expand=True
        )
        right = ft.Column(
            [end_reason_card(batch), charts_card(batch), summary], spacing=t.GAP, expand=True
        )
        results.content = c.columns(left, right, right_width=400)
        app.refresh(results)

    render_cancel()
    render_results()

    environment = scenario.environment
    params = c.card(
        [
            ft.Row(
                [
                    runs_field,
                    seed_field,
                    processes_field,
                    ft.Column(
                        [
                            t.caption("Сценарий"),
                            t.text(
                                f"{scenario.battalion_a.name} · {scenario.battalion_a.order}"
                                f" → {scenario.battalion_b.name} · {scenario.battalion_b.order}",
                                size=t.SIZE_ROW,
                                no_wrap=True,
                            ),
                            ft.Text(
                                f"{environment.terrain} · {environment.time_of_day} · "
                                f"{environment.weather} · прогон i идёт с сидом base + i",
                                style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                                no_wrap=True,
                            ),
                        ],
                        spacing=3,
                        tight=True,
                        expand=True,
                    ),
                    status,
                ],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.END,
            ),
            progress,
        ],
        spacing=t.GAP_SM,
    )

    return screen(
        app,
        active="batch",
        title="Прогоны",
        subtitle=f"«{scenario.name}» много раз подряд: вероятности и разброс исходов",
        actions=[
            cancel_holder,
            c.more_menu(
                [
                    c.MenuItem(
                        "Выгрузить отчёт Markdown",
                        lambda: export("md"),
                        icon=ft.Icons.DESCRIPTION,
                    ),
                    c.MenuItem(
                        "Выгрузить таблицу CSV", lambda: export("csv"), icon=ft.Icons.TABLE_CHART
                    ),
                ]
            ),
        ],
        body=ft.Column([params, results], spacing=t.GAP, expand=True),
    )
