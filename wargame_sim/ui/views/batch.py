"""Массовое моделирование: параметры, прогресс, статистика, графики (§9)."""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.batch import DEFAULT_RUNS
from core.models import MAX_SEED
from core.report import batch_csv, batch_markdown, batch_text
from core.storage import write_text
from ui.charts import end_reasons_chart, losses_histogram, outcomes_chart, turns_chart
from ui.state import ROUTES, AppState
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    data_table,
    empty_hint,
    error_banner,
    kv_rows,
    link_button,
    number_field,
    page_title,
    text_button,
)

ROUTE = ROUTES["batch"]

#: Пределы, в которых имеет смысл запускать массовый прогон.
MIN_RUNS = 1
MAX_RUNS = 10000
#: Сколько строк таблицы прогонов показывать сразу.
TABLE_LIMIT = 200


def build(app: AppState) -> ft.View:
    scenario = app.scenario
    settings = {"runs": DEFAULT_RUNS, "seed": scenario.master_seed, "processes": 0}

    progress = ft.ProgressBar(value=0, visible=False)
    progress_text = ft.Text("", size=12, opacity=0.75)
    message = ft.Text("", size=12, opacity=0.75)
    results_holder = ft.Column(spacing=GAP, tight=True)
    cancel_button = ft.OutlinedButton(
        "Отменить", icon=ft.Icons.CANCEL, disabled=True, on_click=lambda *_: cancel()
    )

    def cancel() -> None:
        app.cancel_batch()
        progress_text.value = "Отмена…"
        app.refresh(progress_text)

    def on_progress(done: int, total: int) -> None:
        progress.value = done / total if total else 0
        progress_text.value = f"Прогон {done} из {total}"
        app.refresh(progress, progress_text)

    def render_results() -> None:
        batch = app.batch
        if batch is None:
            results_holder.controls = [empty_hint("Прогоны ещё не запускались.")]
            app.refresh(results_holder)
            return

        table_rows = [
            [
                str(record.index),
                str(record.seed),
                str(record.winner),
                str(record.end_reason),
                str(record.turns),
                str(record.losses_a),
                str(record.losses_b),
                str(record.vehicle_losses_a),
                str(record.vehicle_losses_b),
            ]
            for record in batch.records[:TABLE_LIMIT]
        ]

        def distribution_rows() -> list[list[str]]:
            return [
                [
                    label,
                    f"{dist.mean:.1f}",
                    f"{dist.median:.1f}",
                    f"{dist.p10:.1f}",
                    f"{dist.p50:.1f}",
                    f"{dist.p90:.1f}",
                    f"{dist.minimum:.0f}",
                    f"{dist.maximum:.0f}",
                ]
                for label, dist in (
                    ("Ходы", batch.turns),
                    ("Потери A", batch.losses_a),
                    ("Потери B", batch.losses_b),
                    ("Потери техники A", batch.vehicle_losses_a),
                    ("Потери техники B", batch.vehicle_losses_b),
                )
            ]

        results_holder.controls = [
            card(
                "Вероятности исходов",
                [
                    kv_rows(
                        [
                            ("Победа A", f"{batch.win_probability_a * 100:.1f}%"),
                            ("Победа B", f"{batch.win_probability_b * 100:.1f}%"),
                            ("Ничья (лимит ходов)", f"{batch.draw_probability * 100:.1f}%"),
                            ("Прогонов", str(batch.runs)),
                            ("Базовый сид", str(batch.base_seed)),
                        ]
                    )
                ],
            ),
            card(
                "Распределения",
                [
                    data_table(
                        ("Показатель", "среднее", "медиана", "p10", "p50", "p90", "мин", "макс"),
                        distribution_rows(),
                    )
                ],
            ),
            card(
                "Способы завершения",
                [
                    kv_rows(
                        [(name, str(count)) for name, count in batch.end_reasons.items()]
                    )
                ],
            ),
            card(
                "Графики",
                [
                    ft.Row(
                        [
                            ft.Image(src=losses_histogram(batch), width=430),
                            ft.Image(src=outcomes_chart(batch), width=430),
                            ft.Image(src=turns_chart(batch), width=430),
                            ft.Image(src=end_reasons_chart(batch), width=430),
                        ],
                        spacing=GAP,
                        wrap=True,
                    )
                ],
            ),
            card(
                f"Прогоны (показано {len(table_rows)} из {batch.runs})",
                [
                    data_table(
                        (
                            "#",
                            "Сид",
                            "Исход",
                            "Причина",
                            "Ходов",
                            "Потери A",
                            "Потери B",
                            "Техника A",
                            "Техника B",
                        ),
                        table_rows,
                    ),
                    ft.Text(
                        "Любой прогон открывается покомпонентно: подставьте его сид "
                        "в настройке боя и запустите — результат совпадёт точно.",
                        size=12,
                        opacity=0.7,
                    ),
                ],
            ),
            card("Сводка текстом", [ft.Text(batch_text(batch), size=13, selectable=True)]),
        ]
        app.refresh(results_holder)

    def start() -> None:
        if app.batch_running:
            return

        def work() -> None:
            try:
                app.run_batch(
                    int(settings["runs"]),
                    int(settings["seed"]),
                    processes=int(settings["processes"]) or None,
                    progress=on_progress,
                )
                message.value = "Готово."
            except Exception as error:
                message.value = f"Ошибка прогона: {error}"
            finally:
                progress.visible = False
                cancel_button.disabled = True
                render_results()
                app.refresh(progress, cancel_button, message)

        progress.visible = True
        progress.value = 0
        cancel_button.disabled = False
        message.value = ""
        app.refresh(progress, cancel_button, message)
        if app.page is None:
            work()
        else:
            app.page.run_thread(work)

    def export(kind: str) -> None:
        if app.batch is None:
            return
        directory = Path(app.results_dir)
        stem = f"batch_{app.batch.scenario_id}_{app.batch.base_seed}"
        if kind == "md":
            path = write_text(directory / f"{stem}.md", batch_markdown(app.batch))
        else:
            path = write_text(directory / f"{stem}.csv", batch_csv(app.batch))
        message.value = f"Выгружено: {path}"
        app.refresh(message)

    render_results()

    controls: list[ft.Control] = [
        page_title(
            "Массовое моделирование",
            f"Сценарий «{scenario.name}»: прогон i использует сид base_seed + i.",
        )
    ]
    if app.config_error:
        controls.append(error_banner(app.config_error))
    controls += [
        ft.Row(
            [
                link_button(
                "На главную", ROUTES["home"], app.go, icon=ft.Icons.ARROW_BACK),
                link_button("Настройка боя", ROUTES["battle_setup"], app.go),
            ],
            spacing=GAP,
            wrap=True,
        ),
        card(
            "Параметры",
            [
                ft.Row(
                    [
                        number_field(
                            "Прогонов",
                            settings["runs"],
                            minimum=MIN_RUNS,
                            maximum=MAX_RUNS,
                            integer=True,
                            hint=f"по умолчанию {DEFAULT_RUNS}",
                            on_change=lambda value: settings.update(runs=int(value)),
                        ),
                        number_field(
                            "Базовый сид",
                            settings["seed"],
                            minimum=0,
                            maximum=MAX_SEED,
                            integer=True,
                            on_change=lambda value: settings.update(seed=int(value)),
                        ),
                        number_field(
                            "Процессов",
                            settings["processes"],
                            minimum=0,
                            maximum=64,
                            integer=True,
                            hint="0 — по числу ядер",
                            on_change=lambda value: settings.update(processes=int(value)),
                        ),
                        action_button("Запустить", start, icon=ft.Icons.PLAY_ARROW),
                        cancel_button,
                        text_button("Экспорт Markdown", lambda: export("md")),
                        text_button("Экспорт CSV", lambda: export("csv")),
                    ],
                    spacing=GAP,
                    wrap=True,
                ),
                progress,
                progress_text,
                message,
            ],
        ),
        results_holder,
    ]

    return ft.View(
        route=ROUTE,
        controls=[ft.Column(controls, spacing=GAP, scroll=ft.ScrollMode.AUTO, expand=True)],
        padding=PAD,
    )
