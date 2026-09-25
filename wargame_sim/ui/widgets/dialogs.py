"""Модальные окна: подтверждение, ввод имени, выбор, деление группы.

Раньше их в интерфейсе не было вовсе — единственным «диалогом» был
снек-бар. Из-за этого удаление папки происходило по одному щелчку без
подтверждения, имя новой папки было всегда «Новая папка», а деление
группы шло вслепую: выбрал 2/3/4 — и смотри, что получилось.

Формул здесь нет: раскладку людей и машин по подгруппам считает
``core.formation.apportion`` — та же функция, которой потом делит движок,
поэтому предпросмотр показывает ровно то, что произойдёт.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import flet as ft

from core import formation
from core.models import Element
from ui import theme as t
from ui.widgets import common as c

#: Ширина поля доли в диалоге деления.
SHARE_W = 62

#: Ширина списка выбора в диалоге `pick`.
PICK_W = 380

#: На сколько частей можно разделить группу одним действием.
PARTS_CHOICES: tuple[tuple[str, str], ...] = (("2", "2"), ("3", "3"), ("4", "4"), ("5", "5"))


def _frame(
    title: str,
    body: ft.Control,
    actions: Sequence[ft.Control],
    *,
    width: int = 460,
) -> ft.AlertDialog:
    """Общая рамка окна — в тех же токенах, что и остальной интерфейс."""
    return ft.AlertDialog(
        modal=True,
        bgcolor=t.CARD_BG,
        shape=ft.RoundedRectangleBorder(radius=t.R_CARD),
        title=ft.Text(title, style=t.sans(size=t.SIZE_TITLE, weight=t.W600)),
        content=ft.Container(content=body, width=width),
        actions=list(actions),
        actions_alignment=ft.MainAxisAlignment.END,
    )


def confirm(
    app,
    title: str,
    message: str,
    *,
    confirm_label: str,
    on_confirm: Callable[[], None],
    cancel_label: str = "Отмена",
    danger: bool = False,
) -> None:
    """Спросить перед необратимым действием.

    ``cancel_label`` — потому что не всякий вопрос отменяют: у сообщения
    о конце боя вторая кнопка значит «остаться на пульте», а не «отмена».
    """

    def accept() -> None:
        app.close_dialog()
        on_confirm()

    app.show_dialog(
        _frame(
            title,
            c.note(message),
            [
                c.tertiary_button(cancel_label, app.close_dialog),
                c.primary_button(
                    confirm_label,
                    accept,
                    icon=ft.Icons.DELETE_OUTLINE if danger else None,
                ),
            ],
            width=380,
        )
    )


def ask_name(
    app,
    title: str,
    label: str,
    value: str,
    *,
    confirm_label: str,
    on_confirm: Callable[[str], None],
) -> None:
    """Спросить имя — при создании и при переименовании.

    Курсор сразу в поле, Enter подтверждает: окно из одного поля, в котором
    надо сперва прицелиться мышью, — это лишний щелчок на каждую папку.
    Escape закрывает окно — его ловит обработчик клавиатуры приложения.
    """
    holder = {"value": value}
    field, raw = c.text_field(value, lambda text: holder.update(value=text), expand=True)
    raw.autofocus = True

    def accept() -> None:
        name = holder["value"].strip()
        if not name:
            return
        app.close_dialog()
        on_confirm(name)

    raw.on_submit = lambda *_: (holder.update(value=raw.value or ""), accept())

    app.show_dialog(
        _frame(
            title,
            c.labeled(label, field),
            [
                c.tertiary_button("Отмена", app.close_dialog),
                c.primary_button(confirm_label, accept),
            ],
            width=400,
        )
    )


def pick(
    app,
    title: str,
    message: str,
    options: Sequence[tuple[str, str]],
    *,
    confirm_label: str,
    on_pick: Callable[[str], None],
    value: str = "",
) -> None:
    """Спросить адресата действия — когда его нельзя угадать за ГМ."""
    holder = {"value": value or (options[0][0] if options else "")}
    body = ft.Column(
        [
            c.note(message),
            c.select(
                holder["value"],
                list(options),
                lambda picked: holder.update(value=picked),
                width=PICK_W,
            ),
        ],
        spacing=t.GAP_IN,
        tight=True,
    )

    def accept() -> None:
        chosen = holder["value"]
        if not chosen:
            return
        app.close_dialog()
        on_pick(chosen)

    app.show_dialog(
        _frame(
            title,
            body,
            [
                c.tertiary_button("Отмена", app.close_dialog),
                c.primary_button(confirm_label, accept),
            ],
            width=440,
        )
    )


# --------------------------------------------------------------------------
# Деление группы
# --------------------------------------------------------------------------
PREVIEW: tuple[c.Col, ...] = (
    c.Col("Подгруппа", expand=True),
    c.Col("Доля", 56, numeric=True),
    c.Col("Л/с", 70, numeric=True),
    c.Col("Техника", 74, numeric=True),
)


def _preview_rows(element: Element, shares: Sequence[float]) -> list[ft.Control]:
    """Что достанется каждой подгруппе — теми же числами, что и в бою."""
    personnel = formation.apportion(element.personnel_current, shares)
    vehicles = formation.apportion(element.vehicles_current, shares)
    rows: list[ft.Control] = []
    for index, share in enumerate(shares):
        rows.append(
            c.table_row(
                PREVIEW,
                [
                    t.text(f"{index + 1}-я часть", size=t.SIZE_ROW),
                    t.num(c.share_label(share)),
                    t.num(str(personnel[index])),
                    t.num(str(vehicles[index])) if element.has_vehicles else c.dash(),
                ],
                last=index == len(shares) - 1,
            )
        )
    return rows


def split_group(
    app,
    element: Element,
    *,
    on_split: Callable[[int, list[float]], None],
    parts: int = 2,
) -> None:
    """Окно деления: сколько частей, какие доли и что из этого выйдет.

    Доли произвольные — ровно то, чего не хватало: раньше делить можно
    было только поровну, хотя ядро умело иначе.
    """
    state: dict[str, object] = {"parts": parts, "shares": [1.0] * parts}
    preview = ft.Container()
    fields = ft.Row(spacing=t.GAP_SM, wrap=True, run_spacing=t.GAP_SM)
    note = ft.Container()

    def shares() -> list[float]:
        return list(state["shares"])  # type: ignore[arg-type]

    def redraw() -> None:
        values = shares()
        fields.controls = [
            c.labeled(
                f"{index + 1}-я",
                c.number_field(
                    value,
                    lambda new, i=index: set_share(i, new),
                    minimum=1,
                    maximum=99,
                    integer=True,
                    width=SHARE_W,
                    nested=True,
                ),
                width=SHARE_W,
            )
            for index, value in enumerate(values)
        ]
        preview.content = ft.Column(
            [c.table_head(PREVIEW), *_preview_rows(element, values)], spacing=0, tight=True
        )
        note.content = c.note(
            f"Делится то, что в строю сейчас: {element.personnel_current} чел."
            + (f", {element.vehicles_current} ед. техники." if element.has_vehicles else ".")
            + " Подгруппы получают и свою долю уже понесённых потерь."
        )
        c.safe_update(fields, preview, note)

    def set_share(index: int, value: float) -> None:
        values = shares()
        values[index] = max(1.0, value)
        state["shares"] = values
        redraw()

    def set_parts(raw: str) -> None:
        count = int(raw)
        state["parts"] = count
        state["shares"] = [1.0] * count
        redraw()

    def accept() -> None:
        app.close_dialog()
        on_split(int(state["parts"]), shares())

    redraw()
    body = ft.Column(
        [
            c.labeled(
                "На сколько частей",
                c.segmented(PARTS_CHOICES, str(parts), set_parts, size=t.SIZE_ROW),
            ),
            c.labeled("Доли", fields),
            c.divider(),
            preview,
            note,
        ],
        spacing=t.GAP_IN,
        tight=True,
    )
    app.show_dialog(
        _frame(
            f"Разделить «{element.name}»",
            body,
            [
                c.tertiary_button("Отмена", app.close_dialog),
                c.primary_button("Разделить", accept, icon=ft.Icons.CALL_SPLIT),
            ],
            width=520,
        )
    )
