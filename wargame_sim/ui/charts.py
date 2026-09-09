"""Графики: matplotlib рисует PNG, Flet показывает его как ft.Image (§10)."""

from __future__ import annotations

import io
from collections.abc import Sequence

import matplotlib

matplotlib.use("Agg")  # без окна и без интерактивного бэкенда

import matplotlib.pyplot as plt

from core.models import BatchResult

#: Размер и разрешение картинок, отдаваемых в интерфейс.
FIGSIZE = (6.4, 3.4)
DPI = 130


def _render(figure) -> bytes:
    buffer = io.BytesIO()
    figure.tight_layout()
    figure.savefig(buffer, format="png", dpi=DPI)
    plt.close(figure)
    return buffer.getvalue()


def losses_histogram(batch: BatchResult) -> bytes:
    """Гистограмма потерь обеих сторон."""
    losses_a = [record.losses_a for record in batch.records]
    losses_b = [record.losses_b for record in batch.records]
    figure, axes = plt.subplots(figsize=FIGSIZE)
    bins = max(8, min(25, len(batch.records) // 4 or 8))
    axes.hist([losses_a, losses_b], bins=bins, label=["Сторона A", "Сторона B"])
    axes.set_xlabel("Потери в личном составе, чел.")
    axes.set_ylabel("Прогонов")
    axes.set_title("Распределение потерь")
    axes.legend()
    axes.grid(alpha=0.25)
    return _render(figure)


def outcomes_chart(batch: BatchResult) -> bytes:
    """Столбики вероятностей исходов."""
    labels = ["Победа A", "Победа B", "Ничья"]
    values = [
        batch.win_probability_a * 100,
        batch.win_probability_b * 100,
        batch.draw_probability * 100,
    ]
    figure, axes = plt.subplots(figsize=FIGSIZE)
    bars = axes.bar(labels, values)
    axes.set_ylabel("Вероятность, %")
    axes.set_ylim(0, 100)
    axes.set_title("Распределение исходов")
    for bar, value in zip(bars, values, strict=True):
        axes.text(
            bar.get_x() + bar.get_width() / 2,
            value + 1.5,
            f"{value:.1f}%",
            ha="center",
            fontsize=9,
        )
    axes.grid(axis="y", alpha=0.25)
    return _render(figure)


def turns_chart(batch: BatchResult) -> bytes:
    """Распределение длительности боёв."""
    turns = [record.turns for record in batch.records]
    figure, axes = plt.subplots(figsize=FIGSIZE)
    axes.hist(turns, bins=range(min(turns), max(turns) + 2))
    axes.set_xlabel("Ходов до конца боя")
    axes.set_ylabel("Прогонов")
    axes.set_title("Длительность боя")
    axes.grid(alpha=0.25)
    return _render(figure)


def end_reasons_chart(batch: BatchResult) -> bytes:
    """Способы завершения боя."""
    names: Sequence[str] = list(batch.end_reasons)
    counts = [batch.end_reasons[name] for name in names]
    figure, axes = plt.subplots(figsize=FIGSIZE)
    axes.barh(list(names), counts)
    axes.set_xlabel("Прогонов")
    axes.set_title("Способы завершения")
    axes.grid(axis="x", alpha=0.25)
    return _render(figure)
