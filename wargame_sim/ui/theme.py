"""Токены дизайна: палитра, типографика, размеры, радиусы.

Единственный источник правды для оформления. В экранах и виджетах не должно
быть ни одного цвета или размера «россыпью» — только константы отсюда,
иначе редизайн снова расползётся по тридцати файлам.

Значения взяты из дизайн-хендоффа как есть. Цветом обозначаются только
потери, тревога и подавление; стороны A и B различаются буквой и положением,
а не цветом.
"""

from __future__ import annotations

import flet as ft

# --------------------------------------------------------------------------
# Цвета
# --------------------------------------------------------------------------
CANVAS = "#E9E5DD"  # полотно за окном приложения
CONTENT_BG = "#F2EFE9"  # фон контентной области
SIDEBAR_BG = "#E7E2D9"  # фон боковой навигации
SURFACE_ALT = "#F7F4EE"  # верхняя полоса, вложенные поля, строки стороны B
CARD_BG = "#FBFAF6"  # фон карточки
ROW_EXPANDED = "#F0EDE6"  # фон раскрытой строки
SEGMENT_BG = "#EDEAE4"  # фон сегментированного переключателя
TRACK = "#E4DFD6"  # дорожка полосы прогресса

BORDER = "#DBD5CA"  # основная граница
BORDER_INNER = "#EFEBE3"  # граница между строками таблиц
BORDER_CARD = "#EAE5DC"  # граница внутри карточки (итоги)

TEXT = "#191815"  # основной текст
TEXT_ON_DARK = "#F7F4EE"  # текст на тёмном
TEXT_2 = "#57534B"  # текст второго уровня
TEXT_3 = "#6B665D"  # описания
TEXT_MUTED = "#8A857B"  # подписи и метаданные
TEXT_PLACEHOLDER = "#A0998D"  # плейсхолдеры и прочерки
TOGGLE_OFF = "#D6D0C5"  # выключенный переключатель

LOSS = "#A83E28"  # потери и тревога
LOSS_HOVER = "#7E2C1B"  # ссылка при наведении
WARN = "#A9761B"  # подавление
OK = "#4E6B52"  # «бой идёт»
NEUTRAL_B = "#8A857B"  # сторона B в диаграммах
NEUTRAL_DRAW = "#D6D0C5"  # ничья в диаграммах

# --------------------------------------------------------------------------
# Типографика
# --------------------------------------------------------------------------
SANS = "IBM Plex Sans"
MONO = "IBM Plex Mono"

W400 = ft.FontWeight.W_400
W500 = ft.FontWeight.W_500
W600 = ft.FontWeight.W_600

#: Минимальный размер — 10, и только для моноширинных подписей.
SIZE_HERO = 34  # заголовок страницы-обложки
SIZE_BIG_NUM = 30  # крупное число (вероятности)
SIZE_SUMMARY_NUM = 22  # крупное число в сводке главной
SIZE_TURN_NUM = 20  # номер хода
SIZE_BLOCK = 20  # заголовок блока в контенте
SIZE_SCREEN = 16  # заголовок экрана в верхней полосе
SIZE_TITLE = 14  # название карточки-ссылки, батальона
SIZE_BODY = 13  # основной текст, кнопка, пункт навигации
SIZE_ROW = 12  # строка таблицы, поле, описание
SIZE_META = 11  # заголовок карточки, метаданные
SIZE_LABEL = 10  # подпись поля, шапка таблицы

# --------------------------------------------------------------------------
# Размеры
# --------------------------------------------------------------------------
SIDEBAR_W = 212
TOPBAR_H = 58
NAV_ITEM_H = 34
NAV_SUB_H = 29
BUTTON_H = 34
BUTTON_SM_H = 28
BUTTON_XS_H = 26
FIELD_H = 31
CHIP_H = 30
CARD_HEADER_H = 40
TABLE_HEAD_H = 26
TABLE_ROW_H = 28
TABLE_ROW_TALL_H = 42
CARD_FOOTER_H = 32
BAR_H = 4
BAR_STACKED_H = 10
TOGGLE_W = 36
TOGGLE_H = 20

#: Во flex нет дробей, поэтому доля полосы задаётся целыми долями этой
#: величины: 1000 даёт десятые доли процента — глазу этого хватает.
BAR_FLEX = 1000

#: Зазор между карточками и внутри них.
GAP = 14
GAP_IN = 10
GAP_SM = 8
PAD_CARD = 16
PAD_CONTENT_X = 20
PAD_CONTENT_Y = 18
PAD_ROW_X = 16

# --------------------------------------------------------------------------
# Радиусы
# --------------------------------------------------------------------------
R_WINDOW = 14
R_CARD = 12
R_TURN = 9
R_BUTTON = 8
R_FIELD = 7
R_SEGMENT = 5
R_BAR = 2
R_CHIP = 15


def _family(base: str, weight: ft.FontWeight) -> str:
    """Семейство под нужное начертание.

    В Flet одно семейство — один файл, поэтому 500 и 600 зарегистрированы
    отдельными семействами. Если просто попросить ``weight=W_600`` у
    обычного начертания, Flutter подделает жирность синтетически и текст
    поплывёт — поэтому начертание выбирается семейством, а вес всегда
    остаётся нормальным.
    """
    if weight == W600:
        return f"{base} SemiBold"
    if weight == W500:
        return f"{base} Medium"
    return base


def sans(
    size: int = SIZE_BODY,
    weight: ft.FontWeight = W400,
    color: str = TEXT,
    *,
    height: float | None = None,
    spacing: float | None = None,
) -> ft.TextStyle:
    """Стиль основного шрифта."""
    return ft.TextStyle(
        font_family=_family(SANS, weight),
        size=size,
        color=color,
        height=height,
        letter_spacing=spacing,
    )


def mono(
    size: int = SIZE_ROW,
    weight: ft.FontWeight = W400,
    color: str = TEXT,
    *,
    height: float | None = None,
    spacing: float | None = None,
) -> ft.TextStyle:
    """Стиль моноширинного шрифта — все числа и идентификаторы."""
    return ft.TextStyle(
        font_family=_family(MONO, weight),
        size=size,
        color=color,
        height=height,
        letter_spacing=spacing,
    )


def text(
    value: str,
    size: int = SIZE_BODY,
    weight: ft.FontWeight = W400,
    color: str = TEXT,
    *,
    height: float | None = None,
    expand: bool | int = False,
    align: ft.TextAlign | None = None,
    no_wrap: bool = False,
) -> ft.Text:
    """Текст основным шрифтом."""
    return ft.Text(
        value,
        font_family=_family(SANS, weight),
        size=size,
        color=color,
        height=height,
        expand=expand,
        text_align=align,
        no_wrap=no_wrap or None,
    )


def num(
    value: str,
    size: int = SIZE_ROW,
    weight: ft.FontWeight = W400,
    color: str = TEXT,
    *,
    expand: bool | int = False,
    align: ft.TextAlign | None = ft.TextAlign.RIGHT,
    spacing: float | None = None,
) -> ft.Text:
    """Число моноширинным шрифтом, по умолчанию по правому краю."""
    return ft.Text(
        value,
        size=size,
        color=color,
        expand=expand,
        text_align=align,
        style=mono(size=size, weight=weight, color=color, spacing=spacing),
    )


def caption(value: str, color: str = TEXT_MUTED, size: int = SIZE_LABEL) -> ft.Text:
    """Подпись поля или шапка таблицы: моно, разрядка, верхний регистр."""
    return ft.Text(value.upper(), style=mono(size=size, color=color, spacing=0.6))


def card_title(value: str, color: str = TEXT_MUTED) -> ft.Text:
    """Заголовок карточки: моно 11, разрядка .1em, верхний регистр."""
    return ft.Text(value.upper(), style=mono(size=SIZE_META, color=color, spacing=1.1))


def border(color: str = BORDER, width: int = 1) -> ft.Border:
    return ft.Border.all(width, color)


def border_bottom(color: str = BORDER_INNER, width: int = 1) -> ft.Border:
    return ft.Border.only(bottom=ft.BorderSide(width, color))


def border_top(color: str = BORDER_INNER, width: int = 1) -> ft.Border:
    return ft.Border.only(top=ft.BorderSide(width, color))


#: Шрифты приложения. Файлы лежат в ``wargame_sim/assets/fonts`` и грузятся
#: с диска — приложение не ходит в сеть (§2 SPEC).
FONT_FILES: dict[str, str] = {
    SANS: "fonts/IBMPlexSans-400.ttf",
    f"{SANS} Medium": "fonts/IBMPlexSans-500.ttf",
    f"{SANS} SemiBold": "fonts/IBMPlexSans-600.ttf",
    MONO: "fonts/IBMPlexMono-400.ttf",
    f"{MONO} Medium": "fonts/IBMPlexMono-500.ttf",
    f"{MONO} SemiBold": "fonts/IBMPlexMono-600.ttf",
}
