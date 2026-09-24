"""Дерево групп отряда — общий виджет для пульта боя и подготовки.

Отряд показан так, как он устроен: старшая группа, под ней её подгруппы со
сдвигом. Группа с подгруппами показывает их сумму (``Battalion.rollup``) и
сама не воюет; лист — свои числа. Формул здесь нет: всё, что показывается,
посчитано в ``core``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import flet as ft

from core.models import COMMAND_ORDERS, Battalion, Element
from ui import theme as t
from ui.widgets import common as c

#: Сдвиг одного уровня вложенности.
INDENT = 14

#: Приказ группы: пусто — как у отряда целиком.
ORDER_OPTIONS: tuple[tuple[str, str], ...] = (
    ("", "по отряду"),
    *((str(order), str(order)) for order in COMMAND_ORDERS),
)

#: Сторона, имя, численность, мораль и приказ остаются при любой ширине —
#: без них пульт перестаёт быть пультом. Остальное уходит по очереди.
TREE_COLUMNS: tuple[c.Col, ...] = (
    c.Col("С", 22),
    c.Col("Группа", expand=True),
    c.Col("Масштаб", 84, optional=3),
    c.Col("Л/с", 76, numeric=True),
    c.Col("Техн.", 52, numeric=True, optional=2),
    c.Col("Мораль", 52, numeric=True),
    c.Col("Подавл.", 56, numeric=True, optional=1),
    c.Col("Боезап.", 54, numeric=True, optional=4),
    c.Col("Приказ", 128, pad_left=8),
)


@dataclass(frozen=True)
class Node:
    """Одна видимая строка дерева."""

    element: Element
    side: str
    depth: int
    children: int
    collapsed: bool

    @property
    def key(self) -> tuple[str, str]:
        return (self.side, self.element.id)

    @property
    def is_leaf(self) -> bool:
        return self.children == 0


def nodes(
    battalion: Battalion, side: str, collapsed: set[tuple[str, str]]
) -> list[Node]:
    """Видимые строки дерева: свёрнутая группа прячет всё своё поддерево."""
    visible: list[Node] = []
    hidden: set[str] = set()
    for element in battalion.ordered_elements:
        if element.parent in hidden:
            hidden.add(element.id)
            continue
        children = len(battalion.children_of(element.id))
        shut = children > 0 and (side, element.id) in collapsed
        if shut:
            hidden.add(element.id)
        visible.append(
            Node(
                element=element,
                side=side,
                depth=battalion.depth_of(element),
                children=children,
                collapsed=shut,
            )
        )
    return visible


def name_cell(
    node: Node,
    *,
    muted: bool,
    on_toggle: Callable[[], None] | None,
    counter: str | None = None,
) -> ft.Control:
    """Имя со сдвигом по уровню и «галочкой» раскрытия у старшей группы.

    ``counter`` — приписка справа от названия у старшей группы. По
    умолчанию это число подгрупп («из 3»); наряд сил ставит своё, потому
    что там важно не сколько подгрупп всего, а сколько из них в бою.
    """
    parts: list[ft.Control] = [ft.Container(width=node.depth * INDENT)]
    if node.children:
        parts.append(
            c.icon_button(
                ft.Icons.EXPAND_MORE if not node.collapsed else ft.Icons.CHEVRON_RIGHT,
                on_toggle or (lambda: None),
                size=18,
                icon_size=14,
            )
        )
    else:
        parts.append(ft.Container(width=18))
    parts.append(
        t.text(
            node.element.name,
            size=t.SIZE_ROW,
            weight=t.W500 if node.children else t.W400,
            color=t.TEXT_PLACEHOLDER if muted else t.TEXT,
            no_wrap=True,
        )
    )
    if node.children:
        parts.append(
            ft.Text(
                counter if counter is not None else f"из {node.children}",
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
            )
        )
    return ft.Row(parts, spacing=4, tight=True, vertical_alignment=ft.CrossAxisAlignment.CENTER)


def tree_row(
    table: c.Table,
    node: Node,
    battalion: Battalion,
    *,
    selected: bool = False,
    on_select: Callable[[], None] | None = None,
    on_toggle: Callable[[], None] | None = None,
    menu: Sequence[c.MenuItem] = (),
    last: bool = False,
) -> ft.Control:
    """Строка дерева: лист показывает себя, старшая группа — сумму подгрупп.

    Действия над группой доступны прямо здесь, по правой кнопке: искать их
    кнопками по экрану не надо.
    """
    element = node.element
    roll = battalion.rollup(element.id)
    reserve = roll.in_reserve
    dead = node.is_leaf and not element.alive
    muted = reserve or dead
    suppression = roll.suppression
    # Подавление выше 20 выделяется — это то, что ГМ должен заметить первым.
    high = suppression > 20 and not muted

    if dead:
        state = t.text("выбыла", size=t.SIZE_META, color=t.LOSS, no_wrap=True)
    elif reserve:
        state = t.text("резерв", size=t.SIZE_META, color=t.TEXT_PLACEHOLDER, no_wrap=True)
    else:
        state = t.text(str(element.echelon), size=t.SIZE_META, color=t.TEXT_3, no_wrap=True)

    order = (
        t.text(str(battalion.order_for(element)), size=t.SIZE_META, color=t.TEXT_3, no_wrap=True)
        if node.is_leaf
        else c.dash()
    )
    return table.row(
        [
            ft.Text(node.side, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED)),
            name_cell(node, muted=muted, on_toggle=on_toggle),
            state,
            c.fraction(roll.personnel_current, roll.personnel_full),
            c.fraction(roll.vehicles_current, roll.vehicles_full)
            if roll.vehicles_full
            else c.dash(),
            t.num(f"{roll.morale:.0f}") if not muted else c.dash(),
            t.num(
                f"{suppression:.0f}",
                weight=t.W500 if high else t.W400,
                color=t.WARN if high else t.TEXT,
            )
            if not muted
            else c.dash(),
            t.num(f"{roll.ammo:.0f}") if not muted else c.dash(),
            order,
        ],
        bgcolor=t.ROW_EXPANDED if selected else (t.SURFACE_ALT if node.side == "B" else None),
        last=last,
        on_click=on_select,
        menu=menu,
    )


def side_header(battalion: Battalion, side: str) -> ft.Control:
    """Полоса стороны над её деревом: буква, имя отряда и его масштаб."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Text(side, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED, spacing=1.1)),
                t.text(battalion.name, size=t.SIZE_ROW, weight=t.W600, no_wrap=True),
                c.spacer(),
                ft.Text(
                    f"{battalion.scale} · {len(battalion.engaged_elements)} в бою",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                ),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.TABLE_HEAD_H,
        bgcolor=t.SURFACE_ALT,
        padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
        border=t.border_bottom(t.BORDER_INNER),
    )


def hint(text: str) -> ft.Control:
    """Подсказка в подвале дерева, когда ничего не выбрано."""
    return ft.Text(text, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED), expand=True)


def selection_label(element: Element, battalion: Battalion) -> ft.Control:
    """Что именно выбрано — имя, масштаб и текущая численность."""
    roll = battalion.rollup(element.id)
    return ft.Row(
        [
            t.text(element.name, size=t.SIZE_ROW, weight=t.W600, no_wrap=True),
            ft.Text(
                f"{element.echelon} · {roll.personnel_current} чел."
                + (f" · {roll.vehicles_current} ед." if roll.vehicles_full else ""),
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
            ),
        ],
        spacing=8,
        tight=True,
        vertical_alignment=ft.CrossAxisAlignment.CENTER,
    )

