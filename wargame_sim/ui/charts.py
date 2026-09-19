"""Графики: matplotlib рисует PNG, Flet показывает его как ft.Image (§10).

Оформление берётся из :mod:`ui.theme`, поэтому картинки не выпадают из
общей палитры: цветом обозначены только потери, стороны различаются
светлым и тёмным, а не «синим и оранжевым».
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # без окна и без интерактивного бэкенда

import matplotlib.pyplot as plt
from matplotlib import font_manager

from core.models import BatchResult
from ui import theme as t

#: Размер и разрешение картинок, отдаваемых в интерфейс.
FIGSIZE = (6.4, 3.4)
DPI = 130

#: Толщина линий и прозрачность сетки — оформление, не расчёт.
GRID_ALPHA = 0.5
EDGE_WIDTH = 0.8

_FONTS_REGISTERED = False


def _font() -> str:
    """Тот же шрифт, что и в интерфейсе; если не нашёлся — системный."""
    global _FONTS_REGISTERED
    if not _FONTS_REGISTERED:
        assets = Path(__file__).resolve().parents[1] / "assets"
        for path in sorted(assets.glob("fonts/*.ttf")):
            font_manager.fontManager.addfont(str(path))
        _FONTS_REGISTERED = True
    available = {font.name for font in font_manager.fontManager.ttflist}
    return t.SANS if t.SANS in available else "sans-serif"


def _figure() -> tuple[plt.Figure, plt.Axes]:
    """Пустой график в оформлении приложения."""
    plt.rcParams["font.family"] = _font()
    figure, axes = plt.subplots(figsize=FIGSIZE)
    figure.patch.set_facecolor(t.SURFACE_ALT)
    axes.set_facecolor(t.SURFACE_ALT)
    for spine in axes.spines.values():
        spine.set_color(t.BORDER)
    axes.tick_params(colors=t.TEXT_2, labelsize=8)
    axes.xaxis.label.set_color(t.TEXT_3)
    axes.yaxis.label.set_color(t.TEXT_3)
    axes.title.set_color(t.TEXT)
    return figure, axes


def _render(figure: plt.Figure) -> bytes:
    buffer = io.BytesIO()
    figure.tight_layout()
    figure.savefig(buffer, format="png", dpi=DPI, facecolor=figure.get_facecolor())
    plt.close(figure)
    return buffer.getvalue()


def losses_histogram(batch: BatchResult) -> bytes:
    """Гистограмма потерь обеих сторон."""
    losses_a = [record.losses_a for record in batch.records]
    losses_b = [record.losses_b for record in batch.records]
    figure, axes = _figure()
    bins = max(8, min(25, len(batch.records) // 4 or 8))
    axes.hist(
        [losses_a, losses_b],
        bins=bins,
        color=[t.TEXT, t.NEUTRAL_B],
        edgecolor=t.CARD_BG,
        linewidth=EDGE_WIDTH,
        label=["Сторона A", "Сторона B"],
    )
    axes.set_xlabel("Потери в личном составе, чел.")
    axes.set_ylabel("Прогонов")
    axes.set_title("Распределение потерь")
    legend = axes.legend(frameon=False, fontsize=8)
    for text in legend.get_texts():
        text.set_color(t.TEXT_2)
    axes.grid(color=t.TRACK, alpha=GRID_ALPHA)
    axes.set_axisbelow(True)
    return _render(figure)


def outcomes_chart(batch: BatchResult) -> bytes:
    """Столбики вероятностей исходов."""
    labels = ["Победа A", "Победа B", "Ничья"]
    values = [
        batch.win_probability_a * 100,
        batch.win_probability_b * 100,
        batch.draw_probability * 100,
    ]
    figure, axes = _figure()
    bars = axes.bar(labels, values, color=[t.TEXT, t.NEUTRAL_B, t.NEUTRAL_DRAW])
    axes.set_ylabel("Вероятность, %")
    axes.set_ylim(0, 100)
    axes.set_title("Распределение исходов")
    for bar, value in zip(bars, values, strict=True):
        axes.text(
            bar.get_x() + bar.get_width() / 2,
            value + 1.5,
            f"{value:.1f}%",
            ha="center",
            fontsize=8,
            color=t.TEXT_2,
        )
    axes.grid(axis="y", color=t.TRACK, alpha=GRID_ALPHA)
    axes.set_axisbelow(True)
    return _render(figure)


def turns_chart(batch: BatchResult) -> bytes:
    """Распределение длительности боёв."""
    turns = [record.turns for record in batch.records]
    figure, axes = _figure()
    axes.hist(
        turns,
        bins=range(min(turns), max(turns) + 2),
        color=t.TEXT,
        edgecolor=t.CARD_BG,
        linewidth=EDGE_WIDTH,
    )
    axes.set_xlabel("Ходов до конца боя")
    axes.set_ylabel("Прогонов")
    axes.set_title("Длительность боя")
    axes.grid(color=t.TRACK, alpha=GRID_ALPHA)
    axes.set_axisbelow(True)
    return _render(figure)


def end_reasons_chart(batch: BatchResult) -> bytes:
    """Способы завершения боя."""
    names: Sequence[str] = list(batch.end_reasons)
    counts = [batch.end_reasons[name] for name in names]
    figure, axes = _figure()
    axes.barh(list(names), counts, color=t.TEXT)
    axes.set_xlabel("Прогонов")
    axes.set_title("Способы завершения")
    axes.grid(axis="x", color=t.TRACK, alpha=GRID_ALPHA)
    axes.set_axisbelow(True)
    return _render(figure)
