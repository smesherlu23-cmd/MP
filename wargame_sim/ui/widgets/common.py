"""Базовые элементы: карточки, поля с диапазоном, таблицы, навигация.

Формул тут нет — только раскладка и передача значений в core (§2).
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Iterable, Sequence

import flet as ft

#: Общие отступы и размеры интерфейса.
GAP = 10
PAD = 16
CARD_RADIUS = 10


def safe_update(control: ft.Control) -> None:
    """Обновить контрол, если он уже показан на странице.

    Экраны собираются до того, как попадают в стек View, поэтому часть
    обновлений происходит, когда обновлять ещё нечего — это не ошибка.
    """
    with contextlib.suppress(RuntimeError):
        control.update()


def page_title(text: str, subtitle: str = "") -> ft.Control:
    """Заголовок экрана с необязательным пояснением."""
    parts: list[ft.Control] = [ft.Text(text, size=22, weight=ft.FontWeight.BOLD)]
    if subtitle:
        parts.append(ft.Text(subtitle, size=13, opacity=0.7))
    return ft.Column(parts, spacing=2)


def card(
    title: str,
    controls: Sequence[ft.Control],
    *,
    expand: bool = False,
    stretch: bool = False,
) -> ft.Control:
    """Карточка-раздел с заголовком.

    ``stretch`` растягивает содержимое по ширине карточки — нужно там, где
    внутри лежит поле ввода, а не набор кнопок.
    """
    return ft.Container(
        content=ft.Column(
            [ft.Text(title, size=15, weight=ft.FontWeight.W_600), *controls],
            spacing=GAP,
            tight=True,
            horizontal_alignment=(
                ft.CrossAxisAlignment.STRETCH if stretch else ft.CrossAxisAlignment.START
            ),
        ),
        padding=PAD,
        border_radius=CARD_RADIUS,
        border=ft.Border.all(1, ft.Colors.OUTLINE_VARIANT),
        expand=expand,
    )


def link_button(text: str, route: str, go: Callable[[str], None], *, icon=None) -> ft.Control:
    """Переход между экранами оформляется ссылкой-кнопкой (§10)."""
    return ft.FilledTonalButton(text, icon=icon, on_click=lambda *_: go(route))


def action_button(text: str, handler: Callable[[], None], *, icon=None, tooltip: str = ""):
    return ft.FilledButton(
        text, icon=icon, tooltip=tooltip or None, on_click=lambda *_: handler()
    )


def text_button(text: str, handler: Callable[[], None], *, icon=None) -> ft.Control:
    return ft.TextButton(text, icon=icon, on_click=lambda *_: handler())


def kv_rows(rows: Iterable[tuple[str, str]]) -> ft.Control:
    """Двухколоночная таблица «показатель — значение»."""
    return ft.Column(
        [
            ft.Row(
                [
                    ft.Text(label, size=13, opacity=0.75, expand=3),
                    ft.Text(value, size=13, weight=ft.FontWeight.W_500, expand=2),
                ],
                spacing=GAP,
            )
            for label, value in rows
        ],
        spacing=4,
        tight=True,
    )


def data_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> ft.Control:
    """Таблица с горизонтальной прокруткой."""
    return ft.Row(
        [
            ft.DataTable(
                columns=[ft.DataColumn(ft.Text(header, size=12)) for header in headers],
                rows=[
                    ft.DataRow(cells=[ft.DataCell(ft.Text(str(cell), size=12)) for cell in row])
                    for row in rows
                ],
                column_spacing=18,
                heading_row_height=36,
                data_row_min_height=32,
                data_row_max_height=48,
            )
        ],
        scroll=ft.ScrollMode.AUTO,
    )


def _bound(value: float) -> str:
    """Подпись границы диапазона: целые — без экспоненты."""
    return f"{int(value)}" if float(value).is_integer() else f"{value:g}"


def number_field(
    label: str,
    value: float,
    *,
    minimum: float,
    maximum: float,
    on_change: Callable[[float], None],
    hint: str = "",
    integer: bool = False,
    width: int | None = 150,
) -> ft.TextField:
    """Числовое поле с ограничением диапазона и подсказкой (§10).

    Значение вне диапазона не применяется: поле краснеет и объясняет, что
    именно допустимо.
    """
    suffix = f"{_bound(minimum)}…{_bound(maximum)}"
    field = ft.TextField(
        label=label,
        value=f"{int(value)}" if integer else f"{value:g}",
        width=width,
        dense=True,
        helper=hint or suffix,
        keyboard_type=ft.KeyboardType.NUMBER,
    )

    def handle(*_: object) -> None:
        raw = (field.value or "").replace(",", ".").strip()
        try:
            parsed = float(raw)
        except ValueError:
            field.error = "нужно число"
            safe_update(field)
            return
        if parsed < minimum or parsed > maximum:
            field.error = f"допустимо {suffix}"
            safe_update(field)
            return
        field.error = None
        safe_update(field)
        on_change(int(parsed) if integer else parsed)

    field.on_blur = handle
    field.on_submit = handle
    return field


def text_input(
    label: str, value: str, on_change: Callable[[str], None], *, width: int | None = None
) -> ft.TextField:
    field = ft.TextField(label=label, value=value, width=width, dense=True)

    def handle(*_: object) -> None:
        on_change(field.value or "")

    field.on_blur = handle
    field.on_submit = handle
    return field


def choice(
    label: str,
    options: Sequence[tuple[str, str]],
    value: str,
    on_change: Callable[[str], None],
    *,
    width: int | None = 190,
) -> ft.Dropdown:
    """Выпадающий список: пары (значение, подпись)."""
    dropdown = ft.Dropdown(
        label=label,
        value=value,
        width=width,
        dense=True,
        options=[ft.DropdownOption(key=key, text=text) for key, text in options],
    )

    def handle(*_: object) -> None:
        if dropdown.value is not None:
            on_change(str(dropdown.value))

    dropdown.on_select = handle
    dropdown.on_change = handle
    return dropdown


def toggle(label: str, value: bool, on_change: Callable[[bool], None]) -> ft.Switch:
    switch = ft.Switch(label=label, value=value)

    def handle(*_: object) -> None:
        on_change(bool(switch.value))

    switch.on_change = handle
    return switch


def meter(label: str, value: float, *, maximum: float = 100, hint: str = "") -> ft.Control:
    """Полоска с подписью — мораль, подавление, снабжение и т. п."""
    ratio = 0.0 if maximum == 0 else max(0.0, min(1.0, value / maximum))
    return ft.Column(
        [
            ft.Row(
                [
                    ft.Text(label, size=12, opacity=0.75, expand=True),
                    ft.Text(hint or f"{value:.0f}", size=12, weight=ft.FontWeight.W_500),
                ],
                spacing=6,
            ),
            ft.ProgressBar(value=ratio, height=6, border_radius=3),
        ],
        spacing=2,
        tight=True,
    )


def two_columns(left: ft.Control, right: ft.Control) -> ft.Control:
    """Две равные колонки.

    Строка с переносом не умеет растягивать детей: у ребёнка с ``expand``
    внутри ``wrap`` ширина не определена, и Flutter рисует вместо него
    серый прямоугольник. Поэтому колонки раскладываются обычной строкой.
    """
    return ft.Row(
        [
            ft.Container(content=left, expand=True),
            ft.Container(content=right, expand=True),
        ],
        spacing=GAP,
        vertical_alignment=ft.CrossAxisAlignment.START,
    )


def empty_hint(text: str) -> ft.Control:
    return ft.Container(
        content=ft.Text(text, size=13, opacity=0.7),
        padding=PAD,
        alignment=ft.Alignment.CENTER,
    )


def error_banner(message: str) -> ft.Control:
    """Понятное сообщение об ошибке вместо падения (§5)."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Icon(ft.Icons.ERROR_OUTLINE, color=ft.Colors.ERROR),
                ft.Text(message, size=13, color=ft.Colors.ON_ERROR_CONTAINER, expand=True),
            ],
            spacing=GAP,
        ),
        bgcolor=ft.Colors.ERROR_CONTAINER,
        padding=PAD,
        border_radius=CARD_RADIUS,
    )
