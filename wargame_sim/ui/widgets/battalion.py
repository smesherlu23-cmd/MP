"""Сводки по батальону и элементам. Все числа приходят из core."""

from __future__ import annotations

import flet as ft

from core.models import Battalion, Element
from ui.widgets.common import GAP, card, data_table, kv_rows, meter

#: Показатели, которые видит ГМ в панели состояния стороны (§10).
SUMMARY_FIELDS: tuple[tuple[str, str], ...] = (
    ("Личный состав", "personnel"),
    ("Техника", "vehicles"),
    ("Мораль", "morale"),
    ("Подавление", "suppression"),
    ("Снабжение", "supply"),
    ("Усталость", "fatigue"),
    ("Боеспособность", "combat_power"),
    ("Организация", "organisation"),
)


def battalion_rows(battalion: Battalion) -> list[tuple[str, str]]:
    """Строки сводки батальона — то же, что показывает `Battalion.summary()`."""
    summary = battalion.summary()
    return [
        ("Состояние", str(summary["state"])),
        ("Приказ", str(battalion.order)),
        ("Задача", battalion.task or "—"),
        ("Элементов", f"{summary['elements_alive']} из {summary['elements']}"),
        (
            "Личный состав",
            f"{summary['personnel_current']} из {summary['personnel_full']} "
            f"({float(summary['personnel_ratio']) * 100:.0f}%)",
        ),
        ("Техника", f"{summary['vehicles_current']} из {summary['vehicles_full']}"),
        ("Мораль", f"{summary['morale']:.0f}"),
        ("Опыт (средний)", f"{summary['experience']:.1f}"),
        ("Слаженность", f"{summary['cohesion']:.0f}"),
        ("Связь", f"{battalion.communications:.0f}"),
        ("Влияние командира", f"{battalion.commander_influence:.0f}"),
        ("Подавление", f"{summary['suppression']:.0f}"),
        ("Усталость", f"{summary['fatigue']:.0f}"),
        ("Боезапас", f"{summary['ammo']:.0f}%"),
        ("Топливо", f"{summary['fuel']:.0f}%"),
        ("Снаряжение", f"{summary['equipment']:.0f}%"),
        ("Снабжение", f"{summary['supply']:.0f}%"),
        ("Боеспособность", f"{summary['combat_power']:.0f}%"),
        ("Организация", f"{summary['organisation']:.0f}%"),
    ]


def battalion_summary(battalion: Battalion, *, title: str | None = None) -> ft.Control:
    """Карточка со сводкой батальона (пересобирается при каждой правке)."""
    heading = title or f"{battalion.side} — {battalion.name}"
    return card(heading, [kv_rows(battalion_rows(battalion))])


def state_panel(battalion: Battalion) -> ft.Control:
    """Панель состояния стороны во время боя: полоски ключевых показателей."""
    summary = battalion.summary()
    personnel = (
        f"{summary['personnel_current']} / {summary['personnel_full']}"
    )
    vehicles = f"{summary['vehicles_current']} / {summary['vehicles_full']}"
    return card(
        f"{battalion.side} — {battalion.name}",
        [
            ft.Text(f"Состояние: {summary['state']}", size=13, weight=ft.FontWeight.W_500),
            meter(
                "Личный состав",
                float(summary["personnel_ratio"]) * 100,
                hint=personnel,
            ),
            meter(
                "Техника",
                (summary["vehicles_current"] / summary["vehicles_full"] * 100)
                if summary["vehicles_full"]
                else 0,
                hint=vehicles,
            ),
            meter("Мораль", float(summary["morale"])),
            meter("Подавление", float(summary["suppression"])),
            meter("Снабжение", float(summary["supply"])),
            meter("Усталость", float(summary["fatigue"])),
            meter("Боеспособность", float(summary["combat_power"])),
            meter("Организация", float(summary["organisation"])),
        ],
    )


def element_rows(battalion: Battalion) -> list[list[str]]:
    return [
        [
            element.name,
            element.type,
            f"{element.personnel_current}/{element.personnel_full}",
            f"{element.vehicles_current}/{element.vehicles_full}" if element.has_vehicles else "—",
            f"{element.morale:.0f}",
            f"{element.suppression:.0f}",
            f"{element.fatigue:.0f}",
            f"{element.ammo:.0f}",
            str(battalion.order_for(element)),
            "да" if element.alive else "нет",
        ]
        for element in battalion.elements
    ]


ELEMENT_HEADERS = (
    "Элемент",
    "Тип",
    "Л/с",
    "Техника",
    "Мораль",
    "Подавл.",
    "Устал.",
    "Боезапас",
    "Приказ",
    "Боеспособен",
)


def elements_table(battalion: Battalion) -> ft.Control:
    return data_table(ELEMENT_HEADERS, element_rows(battalion))


def element_chip(element: Element, battalion: Battalion) -> ft.Control:
    """Компактная строка элемента для списка в конструкторе."""
    return ft.Row(
        [
            ft.Icon(
                ft.Icons.CHECK_CIRCLE_OUTLINE if element.alive else ft.Icons.CANCEL_OUTLINED,
                size=16,
            ),
            ft.Text(element.name, size=13, weight=ft.FontWeight.W_500, expand=3),
            ft.Text(element.type, size=12, opacity=0.7, expand=3),
            ft.Text(f"{element.personnel_current}/{element.personnel_full}", size=12, expand=2),
            ft.Text(str(battalion.order_for(element)), size=12, opacity=0.7, expand=2),
        ],
        spacing=GAP,
    )
