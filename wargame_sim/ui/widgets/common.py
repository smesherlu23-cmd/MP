"""Базовые элементы интерфейса: карточка, таблица, поля, полосы, кнопки.

Формул тут нет — только раскладка и передача значений в core (§2).
Все цвета и размеры берутся из :mod:`ui.theme`, ни одного «россыпью».
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Iterable, Sequence

import flet as ft

from ui import theme as t


def safe_update(control: ft.Control) -> None:
    """Обновить контрол, если он уже показан на странице.

    Экраны собираются до того, как попадают в стек View, поэтому часть
    обновлений происходит, когда обновлять ещё нечего — это не ошибка.
    """
    with contextlib.suppress(RuntimeError):
        control.update()


# --------------------------------------------------------------------------
# Кнопки: четыре уровня из хендоффа
# --------------------------------------------------------------------------
def _button(
    label: str,
    on_click: Callable[[], None] | None,
    *,
    bgcolor: str,
    color: str,
    border_color: str | None,
    height: int,
    icon: str | None,
    icon_size: int,
    size: int,
    weight: ft.FontWeight,
    tooltip: str,
    disabled: bool,
    expand: bool | int,
    pad_x: int,
) -> ft.Control:
    content: list[ft.Control] = []
    if icon:
        content.append(ft.Icon(icon, size=icon_size, color=color))
    if label:
        content.append(ft.Text(label, style=t.sans(size=size, weight=weight, color=color)))

    return ft.Container(
        content=ft.Row(
            content,
            spacing=6,
            alignment=ft.MainAxisAlignment.CENTER,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            tight=True,
        ),
        height=height,
        padding=ft.Padding.symmetric(horizontal=pad_x),
        bgcolor=bgcolor,
        border=ft.Border.all(1, border_color) if border_color else None,
        border_radius=t.R_BUTTON,
        alignment=ft.Alignment.CENTER,
        opacity=0.38 if disabled else 1.0,
        tooltip=tooltip or None,
        expand=expand,
        on_click=None if (disabled or on_click is None) else (lambda *_: on_click()),
    )


def primary_button(
    label: str,
    on_click: Callable[[], None] | None = None,
    *,
    icon: str | None = None,
    height: int = t.BUTTON_H,
    tooltip: str = "",
    disabled: bool = False,
    expand: bool | int = False,
) -> ft.Control:
    """Основная кнопка: тёмный фон, светлый текст."""
    return _button(
        label,
        on_click,
        bgcolor=t.TEXT,
        color=t.TEXT_INVERSE,
        border_color=None,
        height=height,
        icon=icon,
        icon_size=17,
        size=t.SIZE_BODY,
        weight=t.W500,
        tooltip=tooltip,
        disabled=disabled,
        expand=expand,
        pad_x=14,
    )


def secondary_button(
    label: str,
    on_click: Callable[[], None] | None = None,
    *,
    icon: str | None = None,
    height: int = t.BUTTON_H,
    tooltip: str = "",
    disabled: bool = False,
    expand: bool | int = False,
) -> ft.Control:
    """Второстепенная кнопка: светлый фон с границей."""
    return _button(
        label,
        on_click,
        bgcolor=t.CARD_BG,
        color=t.TEXT,
        border_color=t.BORDER,
        height=height,
        icon=icon,
        icon_size=16 if height <= t.BUTTON_SM_H else 17,
        size=t.SIZE_ROW if height <= t.BUTTON_SM_H else t.SIZE_BODY,
        weight=t.W500,
        tooltip=tooltip,
        disabled=disabled,
        expand=expand,
        pad_x=10 if height <= t.BUTTON_SM_H else 14,
    )


def tertiary_button(
    label: str,
    on_click: Callable[[], None] | None = None,
    *,
    icon: str | None = None,
    height: int = t.BUTTON_H,
    color: str | None = None,
    tooltip: str = "",
    disabled: bool = False,
) -> ft.Control:
    """Третьестепенная кнопка: без фона и границы."""
    return _button(
        label,
        on_click,
        bgcolor=None,
        color=color or t.TEXT_2,
        border_color=None,
        height=height,
        icon=icon,
        icon_size=16,
        size=t.SIZE_BODY if height > t.BUTTON_SM_H else t.SIZE_ROW,
        weight=t.W400,
        tooltip=tooltip,
        disabled=disabled,
        expand=False,
        pad_x=8,
    )


def icon_button(
    icon: str,
    on_click: Callable[[], None] | None = None,
    *,
    size: int = t.BUTTON_H,
    icon_size: int = 17,
    color: str | None = None,
    tooltip: str = "",
    bordered: bool = True,
) -> ft.Control:
    """Иконочная кнопка — квадрат со стороной ``size``."""
    return ft.Container(
        content=ft.Icon(icon, size=icon_size, color=color or t.TEXT_2),
        width=size,
        height=size,
        bgcolor=t.CARD_BG if bordered else None,
        border=ft.Border.all(1, t.BORDER) if bordered else None,
        border_radius=t.R_FIELD,
        alignment=ft.Alignment.CENTER,
        tooltip=tooltip or None,
        on_click=None if on_click is None else (lambda *_: on_click()),
    )


def chip(label: str, on_click: Callable[[], None] | None = None, *, icon: str = ft.Icons.ADD):
    """Чип-шаблон: скруглённая пилюля с иконкой."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Icon(icon, size=15, color=t.TEXT_2),
                ft.Text(label, style=t.sans(size=t.SIZE_ROW, color=t.TEXT)),
            ],
            spacing=6,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.CHIP_H,
        padding=ft.Padding.symmetric(horizontal=12),
        bgcolor=t.SURFACE_ALT,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CHIP,
        on_click=None if on_click is None else (lambda *_: on_click()),
    )


# --------------------------------------------------------------------------
# Карточка и её части
# --------------------------------------------------------------------------
def card(
    controls: Sequence[ft.Control],
    *,
    expand: bool | int = False,
    width: int | None = None,
    padding: int | None = t.PAD_CARD,
    spacing: int = t.GAP_IN,
) -> ft.Container:
    """Базовый контейнер контента."""
    return ft.Container(
        content=ft.Column(controls, spacing=spacing, tight=not expand, expand=bool(expand)),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        padding=padding,
        expand=expand,
        width=width,
    )


def card_header(
    title: str,
    *,
    trailing: Sequence[ft.Control] = (),
    icon: str | None = None,
    icon_color: str | None = None,
) -> ft.Control:
    """Шапка карточки: заголовок слева, контролы справа."""
    left: list[ft.Control] = []
    if icon:
        left.append(ft.Icon(icon, size=17, color=icon_color or t.LOSS))
    left.append(t.card_title(title))
    return ft.Container(
        content=ft.Row(
            [
                ft.Row(
                    left,
                    spacing=8,
                    tight=True,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                ),
                ft.Container(expand=True),
                *trailing,
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.CARD_HEADER_H,
        padding=ft.Padding.only(left=t.PAD_CARD, right=t.PAD_CARD),
        border=t.border_bottom(t.BORDER),
    )


def card_footer(
    controls: Sequence[ft.Control],
    *,
    height: int | None = t.CARD_FOOTER_H,
) -> ft.Control:
    """Подвал карточки, отбитый верхней границей.

    Однострочная подпись живёт в полосе фиксированной высоты; абзац —
    ``height=None``, иначе текст обрежется по нижней границе.
    """
    padding = (
        ft.Padding.only(left=t.PAD_CARD, right=t.PAD_CARD)
        if height
        else ft.Padding.symmetric(vertical=t.GAP_IN, horizontal=t.PAD_CARD)
    )
    return ft.Container(
        content=ft.Row(
            controls,
            spacing=t.GAP_SM,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=height,
        padding=padding,
        border=t.border_top(t.BORDER_INNER),
    )


def framed_card(
    title: str,
    body: ft.Control,
    *,
    trailing: Sequence[ft.Control] = (),
    footer: ft.Control | None = None,
    icon: str | None = None,
    icon_color: str | None = None,
    expand: bool | int = False,
    width: int | None = None,
) -> ft.Container:
    """Карточка с шапкой, телом на всю высоту и необязательным подвалом."""
    header = card_header(title, trailing=trailing, icon=icon, icon_color=icon_color)
    parts: list[ft.Control] = [header, body]
    if footer is not None:
        parts.append(footer)
    return ft.Container(
        content=ft.Column(parts, spacing=0, expand=bool(expand), tight=not expand),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        expand=expand,
        width=width,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
    )


# --------------------------------------------------------------------------
# Таблица
# --------------------------------------------------------------------------
class Col:
    """Описание колонки таблицы."""

    def __init__(
        self,
        title: str,
        width: int | None = None,
        *,
        expand: bool | int = False,
        numeric: bool = False,
        pad_left: int = 0,
    ) -> None:
        self.title = title
        self.width = width
        self.expand = expand
        self.numeric = numeric
        self.pad_left = pad_left


def _cell(control: ft.Control, col: Col) -> ft.Control:
    # Клип обязателен: длинное имя группы иначе вылезает поверх соседней
    # колонки, и строка читается как каша (поймано на дереве отряда).
    return ft.Container(
        content=control,
        width=col.width,
        expand=col.expand,
        padding=ft.Padding.only(left=col.pad_left) if col.pad_left else None,
        alignment=ft.Alignment.CENTER_RIGHT if col.numeric else ft.Alignment.CENTER_LEFT,
        clip_behavior=ft.ClipBehavior.HARD_EDGE,
    )


def table_head(columns: Sequence[Col]) -> ft.Control:
    """Шапка таблицы."""
    return ft.Container(
        content=ft.Row(
            [_cell(t.caption(c.title), c) for c in columns],
            spacing=t.GAP_SM,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.TABLE_HEAD_H,
        bgcolor=t.SURFACE_ALT,
        padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
        border=t.border_bottom(t.BORDER),
    )


def table_row(
    columns: Sequence[Col],
    cells: Sequence[ft.Control],
    *,
    height: int = t.TABLE_ROW_H,
    bgcolor: str | None = None,
    last: bool = False,
    on_click: Callable[[], None] | None = None,
) -> ft.Control:
    """Строка таблицы."""
    return ft.Container(
        content=ft.Row(
            [_cell(cell, col) for col, cell in zip(columns, cells, strict=False)],
            spacing=t.GAP_SM,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=height,
        bgcolor=bgcolor,
        padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
        border=None if last else t.border_bottom(t.BORDER_INNER),
        on_click=None if on_click is None else (lambda *_: on_click()),
    )


def table(
    columns: Sequence[Col],
    rows: Sequence[ft.Control],
    *,
    expand: bool | int = True,
    scroll: bool = True,
) -> ft.Control:
    """Таблица: шапка плюс прокручиваемое тело."""
    body: ft.Control = ft.Column(
        list(rows),
        spacing=0,
        expand=bool(expand),
        scroll=ft.ScrollMode.AUTO if scroll else None,
    )
    return ft.Column([table_head(columns), body], spacing=0, expand=bool(expand))


def fraction(current: object, total: object, *, size: int = t.SIZE_ROW) -> ft.Control:
    """Дробь «в строю / штат» — знаменатель приглушённым цветом."""
    return ft.Row(
        [
            ft.Text(str(current), style=t.mono(size=size, color=t.TEXT)),
            ft.Text(f"/{total}", style=t.mono(size=size, color=t.TEXT_PLACEHOLDER)),
        ],
        spacing=0,
        tight=True,
        alignment=ft.MainAxisAlignment.END,
    )


def dash() -> ft.Control:
    """Прочерк на месте отсутствующего числа."""
    return t.num("—", color=t.TEXT_PLACEHOLDER)


# --------------------------------------------------------------------------
# Полосы прогресса
# --------------------------------------------------------------------------
def bar(
    label: str,
    value: float,
    *,
    maximum: float = 100.0,
    display: ft.Control | None = None,
    color: str | None = None,
    expand: bool | int = True,
) -> ft.Control:
    """Метрика стороны: подпись и значение сверху, полоса снизу."""
    ratio = 0.0 if maximum == 0 else max(0.0, min(1.0, value / maximum))
    return ft.Column(
        [
            ft.Row(
                [
                    ft.Text(label, style=t.sans(size=t.SIZE_META, color=t.TEXT_3), expand=True),
                    display or t.num(f"{value:.0f}", weight=t.W500),
                ],
                spacing=6,
                vertical_alignment=ft.CrossAxisAlignment.END,
            ),
            _bar_track(ratio, color or t.TEXT),
        ],
        spacing=3,
        tight=True,
        expand=expand,
    )


def _bar_track(ratio: float, color: str) -> ft.Control:
    """Дорожка с заполнением: доля задаётся через flex двух половин."""
    filled = max(1, round(ratio * t.BAR_FLEX))
    rest = max(0, t.BAR_FLEX - filled)
    parts: list[ft.Control] = [
        ft.Container(bgcolor=color, border_radius=t.R_BAR, expand=filled)
    ]
    if rest:
        parts.append(ft.Container(expand=rest))
    return ft.Container(
        content=ft.Row(parts, spacing=0),
        height=t.BAR_H,
        bgcolor=t.TRACK,
        border_radius=t.R_BAR,
    )


def stacked_bar(segments: Sequence[tuple[float, str]]) -> ft.Control:
    """Составная полоса: список пар (доля 0..1, цвет)."""
    parts = [
        ft.Container(bgcolor=color, expand=max(1, round(share * t.BAR_FLEX)))
        for share, color in segments
        if share > 0
    ]
    return ft.Container(
        content=ft.Row(parts or [ft.Container(bgcolor=t.TRACK, expand=True)], spacing=0),
        height=t.BAR_STACKED_H,
        bgcolor=t.TRACK,
        border_radius=t.BAR_STACKED_H // 2,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
    )


# --------------------------------------------------------------------------
# Поля ввода
# --------------------------------------------------------------------------
def _field_shell(
    control: ft.Control,
    *,
    width: int | None,
    expand: bool | int,
    nested: bool,
    height: int = t.FIELD_H,
):
    return ft.Container(
        content=control,
        height=height,
        width=width,
        expand=expand,
        bgcolor=t.CARD_BG if nested else t.SURFACE_ALT,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_FIELD,
        padding=ft.Padding.only(left=10, right=6),
        alignment=ft.Alignment.CENTER_LEFT,
    )


def labeled(
    label: str,
    control: ft.Control,
    *,
    width: int | None = None,
    expand: bool | int = False,
) -> ft.Control:
    """Поле с подписью сверху.

    С заданной шириной возвращается контейнер, а не колонка: в строке с
    переносом (``flow``) колонка с шириной рисуется серым прямоугольником,
    а контейнер — нормально.
    """
    column = ft.Column([t.caption(label), control], spacing=4, tight=True, expand=expand)
    if width is None:
        return column
    return ft.Container(content=column, width=width)


def text_field(
    value: str,
    on_change: Callable[[str], None],
    *,
    placeholder: str = "",
    width: int | None = None,
    expand: bool | int = False,
    nested: bool = False,
    mono_text: bool = False,
) -> tuple[ft.Control, ft.TextField]:
    """Текстовое поле. Возвращает обёртку и сам TextField."""
    style = t.mono(size=t.SIZE_BODY) if mono_text else t.sans(size=t.SIZE_BODY)
    field = ft.TextField(
        value=value,
        border=ft.InputBorder.NONE,
        content_padding=ft.Padding.symmetric(vertical=0),
        text_style=style,
        hint_text=placeholder or None,
        hint_style=t.sans(size=t.SIZE_BODY, color=t.TEXT_PLACEHOLDER),
        cursor_color=t.TEXT,
        dense=True,
    )

    def handle(*_: object) -> None:
        on_change(field.value or "")

    field.on_blur = handle
    field.on_submit = handle
    return _field_shell(field, width=width, expand=expand, nested=nested), field


def number_field(
    value: float,
    on_change: Callable[[float], None],
    *,
    minimum: float,
    maximum: float,
    integer: bool = False,
    width: int | None = None,
    expand: bool | int = False,
    nested: bool = False,
) -> ft.Control:
    """Числовое поле с ограничением диапазона.

    Значение вне диапазона не применяется: поле краснеет и возвращается
    к прежнему содержимому по подсказке в тултипе.
    """
    shown = f"{int(value)}" if integer else f"{value:g}"
    field = ft.TextField(
        value=shown,
        border=ft.InputBorder.NONE,
        content_padding=ft.Padding.symmetric(vertical=0),
        text_style=t.mono(size=t.SIZE_BODY),
        cursor_color=t.TEXT,
        keyboard_type=ft.KeyboardType.NUMBER,
        dense=True,
    )
    shell = _field_shell(field, width=width, expand=expand, nested=nested)
    bounds = f"{_bound(minimum)}…{_bound(maximum)}"
    shell.tooltip = f"допустимо {bounds}"

    def handle(*_: object) -> None:
        raw = (field.value or "").replace(",", ".").strip()
        try:
            parsed = float(raw)
        except ValueError:
            shell.border = ft.Border.all(1, t.LOSS)
            safe_update(shell)
            return
        if parsed < minimum or parsed > maximum:
            shell.border = ft.Border.all(1, t.LOSS)
            safe_update(shell)
            return
        shell.border = ft.Border.all(1, t.BORDER)
        safe_update(shell)
        on_change(int(parsed) if integer else parsed)

    field.on_blur = handle
    field.on_submit = handle
    return shell


def _bound(value: float) -> str:
    return f"{int(value)}" if float(value).is_integer() else f"{value:g}"


def select(
    value: str,
    options: Sequence[tuple[str, str]],
    on_change: Callable[[str], None],
    *,
    width: int | None = None,
    expand: bool | int = False,
    nested: bool = False,
    height: int = t.FIELD_H,
    size: int = t.SIZE_BODY,
) -> ft.Control:
    """Выпадающий список в оформлении поля."""
    dropdown = ft.Dropdown(
        value=value,
        options=[ft.DropdownOption(key=key, text=label) for key, label in options],
        border=ft.InputBorder.NONE,
        content_padding=ft.Padding.symmetric(vertical=0),
        text_style=t.sans(size=size),
        dense=True,
        expand=True,
        trailing_icon=ft.Icons.EXPAND_MORE,
        selected_trailing_icon=ft.Icons.EXPAND_LESS,
        # Само меню рисует Flutter, а не наша вёрстка: без этих двух строк
        # в тёмной теме список раскрывался белым прямоугольником.
        bgcolor=t.SURFACE_ALT,
        menu_style=ft.MenuStyle(
            bgcolor=t.SURFACE_ALT,
            shadow_color=t.CANVAS,
            side=ft.BorderSide(1, t.BORDER),
        ),
    )

    def handle(*_: object) -> None:
        if dropdown.value is not None:
            on_change(str(dropdown.value))

    dropdown.on_select = handle
    dropdown.on_change = handle
    return _field_shell(dropdown, width=width, expand=expand, nested=nested, height=height)


def toggle(label: str, value: bool, on_change: Callable[[bool], None]) -> ft.Control:
    """Переключатель опционального параметра."""
    switch = ft.Switch(
        value=value,
        thumb_color=t.CARD_BG,
        track_color={
            ft.ControlState.SELECTED: t.TEXT,
            ft.ControlState.DEFAULT: t.TOGGLE_OFF,
        },
        track_outline_color=ft.Colors.TRANSPARENT,
        track_outline_width=0,
        scale=0.8,
    )

    def handle(*_: object) -> None:
        on_change(bool(switch.value))

    switch.on_change = handle
    return ft.Container(
        content=ft.Row(
            [
                switch,
                ft.Text(
                    label,
                    style=t.sans(size=t.SIZE_BODY, color=t.TEXT if value else t.TEXT_MUTED),
                ),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.TOGGLE_H + 12,
    )


def segmented(
    options: Sequence[tuple[str, str]],
    value: str,
    on_change: Callable[[str], None],
    *,
    size: int = t.SIZE_ROW,
) -> ft.Control:
    """Сегментированный переключатель."""
    segments: list[ft.Control] = []
    for key, label in options:
        active = key == value
        segments.append(
            ft.Container(
                content=ft.Text(
                    label,
                    style=t.sans(
                        size=size,
                        weight=t.W500 if active else t.W400,
                        color=t.TEXT if active else t.TEXT_3,
                    ),
                ),
                padding=ft.Padding.symmetric(vertical=4, horizontal=11),
                bgcolor=t.CARD_BG if active else None,
                border_radius=t.R_SEGMENT,
                on_click=None if active else (lambda *_, k=key: on_change(k)),
            )
        )
    return ft.Container(
        content=ft.Row(segments, spacing=2, tight=True),
        bgcolor=t.SEGMENT_BG,
        border_radius=t.R_SEGMENT + 2,
        padding=2,
    )


# --------------------------------------------------------------------------
# Раскладка и мелочи
# --------------------------------------------------------------------------
def columns(left: ft.Control, right: ft.Control, *, right_width: int) -> ft.Control:
    """Левая тянущаяся колонка и правая фиксированной ширины."""
    return ft.Row(
        [
            ft.Container(content=left, expand=True),
            ft.Container(content=right, width=right_width),
        ],
        spacing=t.GAP,
        vertical_alignment=ft.CrossAxisAlignment.START,
        expand=True,
    )


def kv_line(label: str, value: ft.Control, *, height: int = 24) -> ft.Control:
    """Строка «подпись — значение» в карточке сводки."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Text(label, style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3), expand=True),
                value,
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=height,
    )


def divider(*, vertical_margin: int = 8) -> ft.Control:
    return ft.Container(
        height=1,
        bgcolor=t.BORDER_INNER,
        margin=ft.Margin.symmetric(vertical=vertical_margin),
    )


def note(value: str, *, size: int = t.SIZE_ROW, color: str | None = None) -> ft.Control:
    """Пояснительный абзац."""
    return ft.Text(value, style=t.sans(size=size, color=color or t.TEXT_3, height=1.55))


def empty_hint(value: str) -> ft.Control:
    return ft.Container(
        content=ft.Text(value, style=t.sans(size=t.SIZE_ROW, color=t.TEXT_PLACEHOLDER)),
        padding=t.PAD_CARD,
        alignment=ft.Alignment.CENTER,
    )


def error_banner(message: str) -> ft.Control:
    """Понятное сообщение об ошибке вместо падения (§5)."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Icon(ft.Icons.ERROR_OUTLINE, color=t.LOSS, size=18),
                ft.Text(message, style=t.sans(size=t.SIZE_ROW, color=t.LOSS), expand=True),
            ],
            spacing=t.GAP_SM,
        ),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.LOSS),
        border_radius=t.R_CARD,
        padding=t.PAD_CARD,
    )


def spacer() -> ft.Control:
    return ft.Container(expand=True)


def flow(controls: Iterable[ft.Control], *, spacing: int = t.GAP_IN) -> ft.Control:
    """Строка с переносом.

    Ребёнок обязан быть контейнером со своей шириной: у колонки и у
    растягивающегося ребёнка ширина не определена, и Flet рисует серый
    прямоугольник вместо содержимого. Колонку с шириной заворачиваем сами.
    """
    items: list[ft.Control] = []
    for control in controls:
        width = getattr(control, "width", None)
        if isinstance(control, ft.Column) and width:
            control = ft.Container(content=control, width=width)
        items.append(control)
    return ft.Row(items, spacing=spacing, run_spacing=spacing, wrap=True)
