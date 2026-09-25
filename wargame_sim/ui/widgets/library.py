"""Дерево папок и карточка папки — общее для мат.части и сборки юнитов.

Папка — путь через «/». Список папок живёт в разделе конфига отдельно от
записей, поэтому пустая папка видна и не исчезает при перезагрузке.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import flet as ft

from core.config.folders import ROOT, SEPARATOR, depth, is_inside, name_of, parent_of, tree
from ui import theme as t
from ui.widgets import common as c

#: Подпись корня в выпадающих списках.
ROOT_LABEL = "Без папки"

#: Отступ одного уровня вложенности.
INDENT = 16


def folder_entries(
    entries: Mapping[str, Any], folders: Sequence[str]
) -> list[tuple[str, list[str]]]:
    """Папки в порядке дерева и записи в каждой; корень идёт последним."""
    known = tree(folders)
    buckets: dict[str, list[str]] = {path: [] for path in known}
    loose: list[str] = []
    for name, entry in entries.items():
        folder = getattr(entry, "folder", "") or ""
        if folder in buckets:
            buckets[folder].append(name)
        else:
            loose.append(name)
    rows = [(path, buckets[path]) for path in known]
    rows.append((ROOT, loose))
    return rows


def folder_options(folders: Sequence[str], *, exclude: str = "") -> list[tuple[str, str]]:
    """Опции выбора папки: корень плюс дерево, без самой папки и её потомков."""
    options = [(ROOT, ROOT_LABEL)]
    for path in tree(folders):
        if exclude and is_inside(path, exclude):
            continue
        options.append((path, "   " * depth(path) + name_of(path)))
    return options


def folder_header(
    path: str,
    count: int,
    *,
    selected: bool,
    on_click: Callable[[], None] | None,
    menu: Sequence[c.MenuItem] = (),
) -> ft.Control:
    """Строка папки в списке: отступ по уровню, счётчик справа.

    Действия над папкой — по правой кнопке. Раньше их приходилось искать
    в карточке справа: выбрать папку, перевести взгляд, найти поле имени,
    стереть, напечатать, щёлкнуть мимо, чтобы сохранилось.
    """
    title = name_of(path) if path else ROOT_LABEL
    row = ft.Container(
        content=ft.Row(
            [
                ft.Container(width=depth(path) * INDENT),
                ft.Icon(
                    ft.Icons.FOLDER_OPEN_OUTLINED if selected else ft.Icons.FOLDER_OUTLINED,
                    size=15,
                    color=t.TEXT_2 if selected else t.TEXT_MUTED,
                ),
                t.caption(title, color=t.TEXT_2 if selected else t.TEXT_MUTED),
                c.spacer(),
                ft.Text(str(count), style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED)),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.TABLE_HEAD_H,
        bgcolor=t.ROW_EXPANDED if selected else t.SURFACE_ALT,
        padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
        border=t.border_bottom(t.BORDER_INNER),
    )
    if on_click is None and not menu:
        return row
    return c.interactive(row, on_click=on_click, menu=menu)


def folder_card(
    path: str,
    folders: Sequence[str],
    *,
    inside: int,
    on_rename: Callable[[str], None],
    on_move: Callable[[str], None],
    on_delete: Callable[[], None],
    width: int = 190,
) -> ft.Control:
    """Карточка выбранной папки: имя, родитель, удаление."""
    name_field, _ = c.text_field(name_of(path), on_rename, width=width * 2 + t.GAP_IN)
    return ft.Container(
        content=ft.Column(
            [
                ft.Text(
                    f"путь: {path}",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                ),
                c.labeled("Имя папки", name_field, width=width * 2 + t.GAP_IN),
                c.labeled(
                    "Внутри папки",
                    c.select(
                        parent_of(path),
                        folder_options(folders, exclude=path),
                        on_move,
                        width=width,
                    ),
                    width=width,
                ),
                c.note(
                    f"Внутри {inside} запис(ей) и вложенных папок. При удалении они "
                    "поднимаются на уровень выше, ничего не пропадает."
                ),
                ft.Row(
                    [
                        c.secondary_button(
                            "Удалить папку",
                            on_delete,
                            icon=ft.Icons.DELETE_OUTLINE,
                            height=t.BUTTON_SM_H,
                        )
                    ],
                    spacing=t.GAP_SM,
                ),
            ],
            spacing=t.GAP_IN,
            tight=True,
        ),
        padding=t.PAD_CARD,
    )


def path_label(path: str) -> str:
    """Человекочитаемый путь для заголовка карточки."""
    return path.replace(SEPARATOR, " · ") if path else ROOT_LABEL
