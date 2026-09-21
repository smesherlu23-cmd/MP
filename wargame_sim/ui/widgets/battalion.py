"""Карточки и сводки по отряду. Все числа приходят из core.

Дерево групп живёт отдельно, в :mod:`ui.widgets.orbat`.
"""

from __future__ import annotations

from collections.abc import Sequence

import flet as ft

from core.config import AppConfig
from core.models import Battalion, Element
from ui import theme as t
from ui.widgets import common as c


def side_letter(side: str) -> ft.Control:
    """Буква стороны — стороны различаются буквой, а не цветом."""
    return ft.Text(side, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED))


def type_label(element: Element, config: AppConfig) -> str:
    """Человеческое название типа элемента вместо ключа конфига."""
    entry = config.element_types.element_types.get(element.type)
    return entry.label.lower() if entry else element.type


def side_panel(battalion: Battalion, side: str, *, losses: int, vehicle_losses: int) -> ft.Control:
    """Карточка стороны: шесть метрик полосами и строка итогов."""
    summary = battalion.summary()
    personnel_ratio = float(summary["personnel_ratio"]) * 100
    vehicles_full = int(summary["vehicles_full"])
    vehicles_current = int(summary["vehicles_current"])
    vehicles_ratio = (vehicles_current / vehicles_full * 100) if vehicles_full else 0

    def metric(label: str, value: float, display: ft.Control | None = None, color: str = t.TEXT):
        return c.bar(label, value, display=display, color=color)

    grid = ft.Column(
        [
            ft.Row(
                [
                    metric(
                        "Личный состав",
                        personnel_ratio,
                        c.fraction(summary["personnel_current"], summary["personnel_full"]),
                    ),
                    metric(
                        "Техника",
                        vehicles_ratio,
                        c.fraction(summary["vehicles_current"], vehicles_full)
                        if vehicles_full
                        else c.dash(),
                    ),
                ],
                spacing=18,
            ),
            ft.Row(
                [
                    metric("Мораль", float(summary["morale"])),
                    metric("Подавление", float(summary["suppression"]), color=t.WARN),
                ],
                spacing=18,
            ),
            ft.Row(
                [
                    metric("Боеспособность", float(summary["combat_power"])),
                    metric("Организация", float(summary["organisation"])),
                ],
                spacing=18,
            ),
        ],
        spacing=t.GAP_SM,
        tight=True,
    )

    totals = ft.Container(
        content=ft.Row(
            [
                _total("потери", str(losses), accent=True),
                _total("техн.", str(vehicle_losses), accent=True),
                _total("снабж.", f"{summary['supply']:.0f}"),
                _total("устал.", f"{summary['fatigue']:.0f}"),
            ],
            spacing=16,
        ),
        padding=ft.Padding.only(top=t.GAP_SM),
        border=t.border_top(t.BORDER_CARD),
        margin=ft.Margin.only(top=2),
    )

    header = ft.Row(
        [
            ft.Text(side, style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED, spacing=1.1)),
            ft.Text(battalion.name, style=t.sans(size=t.SIZE_TITLE, weight=t.W600), expand=True),
            ft.Text(str(battalion.order), style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3)),
        ],
        spacing=8,
        vertical_alignment=ft.CrossAxisAlignment.CENTER,
    )

    return c.card([header, grid, totals], expand=True, spacing=t.GAP_IN)


def _total(label: str, value: str, *, accent: bool = False) -> ft.Control:
    return ft.Row(
        [
            ft.Text(label, style=t.mono(size=t.SIZE_META, color=t.TEXT_3)),
            ft.Text(
                value,
                style=t.mono(
                    size=t.SIZE_META,
                    weight=t.W600 if accent else t.W400,
                    color=t.LOSS if accent else t.TEXT_3,
                ),
            ),
        ],
        spacing=5,
        tight=True,
    )


def summary_rows(
    battalion: Battalion,
    config: AppConfig,
) -> Sequence[tuple[str, ft.Control] | None]:
    """Пары «показатель — значение» для карточки сводки батальона.

    Выключенный тумблером параметр не показывается вовсе: он не участвует
    в расчёте, и держать его в сводке — значит врать ГМ (§4.5).
    """
    s = battalion.summary()
    toggles = config.tog
    rows: list[tuple[str, ft.Control] | None] = [
        ("Состояние", t.text(str(s["state"]), size=t.SIZE_ROW)),
        ("Приказ", t.text(str(battalion.order), size=t.SIZE_ROW)),
        (
            "Задача",
            t.text(
                battalion.task or "не задана",
                size=t.SIZE_ROW,
                color=t.TEXT if battalion.task else t.TEXT_PLACEHOLDER,
            ),
        ),
        None,
        ("Элементов", t.num(f"{s['elements_alive']} из {s['elements']}")),
        ("Личный состав", c.fraction(s["personnel_current"], s["personnel_full"])),
        ("Техника", c.fraction(s["vehicles_current"], s["vehicles_full"])),
        None,
        ("Мораль", t.num(f"{s['morale']:.0f}")),
        ("Опыт (средний)", t.num(f"{s['experience']:.1f}")),
        ("Слаженность", t.num(f"{s['cohesion']:.0f}")),
        ("Связь", t.num(f"{battalion.communications:.0f}")),
    ]
    if toggles.commander_influence:
        rows.append(("Командир", t.num(f"{battalion.commander_influence:.0f}")))
    rows.append(("Подавление", t.num(f"{s['suppression']:.0f}")))
    if toggles.fatigue:
        rows.append(("Усталость", t.num(f"{s['fatigue']:.0f}")))
    rows.append(None)
    rows.append(("Боезапас", t.num(f"{s['ammo']:.0f}%")))
    if toggles.fuel:
        rows.append(("Топливо", t.num(f"{s['fuel']:.0f}%")))
    if toggles.equipment:
        rows.append(("Снаряжение", t.num(f"{s['equipment']:.0f}%")))
    rows.append(("Снабжение", t.num(f"{s['supply']:.0f}%")))
    return rows


def summary_card(
    battalion: Battalion,
    config: AppConfig,
    *,
    side: str,
) -> ft.Control:
    """Правая карточка сводки: пары значений и две полосы внизу."""
    body: list[ft.Control] = []
    for row in summary_rows(battalion, config):
        if row is None:
            body.append(c.divider())
        else:
            body.append(c.kv_line(row[0], row[1]))

    summary = battalion.summary()
    body.append(c.divider())
    body.append(c.bar("Боеспособность", float(summary["combat_power"])))
    body.append(c.bar("Организация", float(summary["organisation"])))

    header = ft.Row(
        [
            ft.Text(side, style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED, spacing=1.1)),
            ft.Text(battalion.name, style=t.sans(size=t.SIZE_BODY, weight=t.W600), expand=True),
        ],
        spacing=8,
    )
    return ft.Column([header, *body], spacing=0, tight=True)
