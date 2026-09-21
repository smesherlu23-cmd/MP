"""Токены дизайна: палитра, типографика, размеры, радиусы.

Единственный источник правды для оформления. В экранах и виджетах не должно
быть ни одного цвета или размера «россыпью» — только константы отсюда,
иначе редизайн снова расползётся по тридцати файлам.

Значения взяты из дизайн-хендоффа как есть. Цветом обозначаются только
потери, тревога и подавление; стороны A и B различаются буквой и положением,
а не цветом.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

import flet as ft


# --------------------------------------------------------------------------
# Цвета
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Palette:
    """Полный набор цветов одной темы.

    Поля названы как константы модуля в нижнем регистре: ``apply()``
    раскладывает палитру по глобальным именам, и экраны по-прежнему пишут
    ``t.CARD_BG``, не зная, светлая сейчас тема или тёмная.
    """

    name: str
    canvas: str  # полотно за окном приложения
    content_bg: str  # фон контентной области
    sidebar_bg: str  # фон боковой навигации
    nav_active: str  # плашка активного подпункта навигации
    surface_alt: str  # верхняя полоса, вложенные поля, строки стороны B
    card_bg: str  # фон карточки
    row_expanded: str  # фон раскрытой (выбранной) строки
    row_hover: str  # фон строки под курсором
    segment_bg: str  # фон сегментированного переключателя
    track: str  # дорожка полосы прогресса
    border: str  # основная граница
    border_inner: str  # граница между строками таблиц
    border_card: str  # граница внутри карточки (итоги)
    text: str  # основной текст; им же залиты основная кнопка и активный пункт
    text_inverse: str  # текст и значки поверх заливки цветом text
    text_2: str  # текст второго уровня
    text_3: str  # описания
    text_muted: str  # подписи и метаданные
    text_placeholder: str  # плейсхолдеры и прочерки
    toggle_off: str  # выключенный переключатель
    loss: str  # потери и тревога
    loss_hover: str  # ссылка при наведении
    warn: str  # подавление
    ok: str  # «бой идёт»
    neutral_b: str  # сторона B в диаграммах
    neutral_draw: str  # ничья в диаграммах

    @property
    def dark(self) -> bool:
        return self is DARK


#: Светлая тема — бумага дизайн-хендоффа, значения взяты как есть.
LIGHT = Palette(
    name="светлая",
    canvas="#E9E5DD",
    content_bg="#F2EFE9",
    sidebar_bg="#E7E2D9",
    nav_active="#DDD7CC",
    surface_alt="#F7F4EE",
    card_bg="#FBFAF6",
    row_expanded="#F0EDE6",
    row_hover="#F5F2EC",
    segment_bg="#EDEAE4",
    track="#E4DFD6",
    border="#DBD5CA",
    border_inner="#EFEBE3",
    border_card="#EAE5DC",
    text="#191815",
    text_inverse="#F7F4EE",
    text_2="#57534B",
    text_3="#6B665D",
    text_muted="#8A857B",
    text_placeholder="#A0998D",
    toggle_off="#D6D0C5",
    loss="#A83E28",
    loss_hover="#7E2C1B",
    warn="#A9761B",
    ok="#4E6B52",
    neutral_b="#8A857B",
    neutral_draw="#D6D0C5",
)

#: Тёмная тема — та же бумага при свете лампы, а не чёрный терминал: тот же
#: тёплый тон, перевёрнутая лестница светлот. Порядок слоёв сохранён —
#: карточка светлее содержимого, содержимое светлее полотна, — поэтому
#: вёрстка читается одинаково в обеих темах.
#: Акценты подняты по светлоте: на тёмном фоне прежний кирпичный #A83E28
#: не читается, а разница «потери / подавление» обязана оставаться видимой.
DARK = Palette(
    name="тёмная",
    canvas="#100F0E",
    content_bg="#171614",
    sidebar_bg="#131211",
    nav_active="#2A2724",
    surface_alt="#201E1B",
    card_bg="#232120",
    row_expanded="#2C2926",
    row_hover="#272522",
    segment_bg="#1B1A18",
    track="#332F2B",
    border="#3B3733",
    border_inner="#2B2926",
    border_card="#322E2A",
    text="#EDE9E1",
    text_inverse="#171614",
    text_2="#BEB8AC",
    text_3="#A49D92",
    text_muted="#847E74",
    text_placeholder="#6B665D",
    toggle_off="#3E3A35",
    loss="#E07359",
    loss_hover="#F28F76",
    warn="#D8A445",
    ok="#83A98A",
    neutral_b="#847E74",
    neutral_draw="#4A4641",
)

#: Действующая палитра. Меняется только через :func:`apply`.
palette: Palette = LIGHT

CANVAS: str = LIGHT.canvas
CONTENT_BG: str = LIGHT.content_bg
SIDEBAR_BG: str = LIGHT.sidebar_bg
NAV_ACTIVE: str = LIGHT.nav_active
SURFACE_ALT: str = LIGHT.surface_alt
CARD_BG: str = LIGHT.card_bg
ROW_EXPANDED: str = LIGHT.row_expanded
ROW_HOVER: str = LIGHT.row_hover
SEGMENT_BG: str = LIGHT.segment_bg
TRACK: str = LIGHT.track

BORDER: str = LIGHT.border
BORDER_INNER: str = LIGHT.border_inner
BORDER_CARD: str = LIGHT.border_card

TEXT: str = LIGHT.text
TEXT_INVERSE: str = LIGHT.text_inverse
TEXT_2: str = LIGHT.text_2
TEXT_3: str = LIGHT.text_3
TEXT_MUTED: str = LIGHT.text_muted
TEXT_PLACEHOLDER: str = LIGHT.text_placeholder
TOGGLE_OFF: str = LIGHT.toggle_off

LOSS: str = LIGHT.loss
LOSS_HOVER: str = LIGHT.loss_hover
WARN: str = LIGHT.warn
OK: str = LIGHT.ok
NEUTRAL_B: str = LIGHT.neutral_b
NEUTRAL_DRAW: str = LIGHT.neutral_draw


def apply(dark: bool) -> Palette:
    """Переключить палитру: разложить её по константам модуля.

    Экраны берут цвет по имени в момент отрисовки (``t.CARD_BG``), поэтому
    после переключения достаточно перестроить содержимое — искать цвета по
    файлам не нужно. Значения по умолчанию у функций модуля намеренно
    ``None``: аргумент по умолчанию вычисляется один раз при импорте и
    заморозил бы светлую тему навсегда.
    """
    global palette
    palette = DARK if dark else LIGHT
    for field in fields(palette):
        if field.name != "name":
            globals()[field.name.upper()] = getattr(palette, field.name)
    return palette


def is_dark() -> bool:
    return palette.dark


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
MENU_ITEM_H = 34  # пункт контекстного меню
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
    color: str | None = None,
    *,
    height: float | None = None,
    spacing: float | None = None,
) -> ft.TextStyle:
    """Стиль основного шрифта."""
    return ft.TextStyle(
        font_family=_family(SANS, weight),
        size=size,
        color=color or TEXT,
        height=height,
        letter_spacing=spacing,
    )


def mono(
    size: int = SIZE_ROW,
    weight: ft.FontWeight = W400,
    color: str | None = None,
    *,
    height: float | None = None,
    spacing: float | None = None,
) -> ft.TextStyle:
    """Стиль моноширинного шрифта — все числа и идентификаторы."""
    return ft.TextStyle(
        font_family=_family(MONO, weight),
        size=size,
        color=color or TEXT,
        height=height,
        letter_spacing=spacing,
    )


def text(
    value: str,
    size: int = SIZE_BODY,
    weight: ft.FontWeight = W400,
    color: str | None = None,
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
        color=color or TEXT,
        height=height,
        expand=expand,
        text_align=align,
        no_wrap=no_wrap or None,
    )


def num(
    value: str,
    size: int = SIZE_ROW,
    weight: ft.FontWeight = W400,
    color: str | None = None,
    *,
    expand: bool | int = False,
    align: ft.TextAlign | None = ft.TextAlign.RIGHT,
    spacing: float | None = None,
) -> ft.Text:
    """Число моноширинным шрифтом, по умолчанию по правому краю."""
    return ft.Text(
        value,
        size=size,
        color=color or TEXT,
        expand=expand,
        text_align=align,
        style=mono(size=size, weight=weight, color=color or TEXT, spacing=spacing),
    )


def caption(value: str, color: str | None = None, size: int = SIZE_LABEL) -> ft.Text:
    """Подпись поля или шапка таблицы: моно, разрядка, верхний регистр."""
    return ft.Text(value.upper(), style=mono(size=size, color=color or TEXT_MUTED, spacing=0.6))


def card_title(value: str, color: str | None = None) -> ft.Text:
    """Заголовок карточки: моно 11, разрядка .1em, верхний регистр."""
    return ft.Text(
        value.upper(), style=mono(size=SIZE_META, color=color or TEXT_MUTED, spacing=1.1)
    )


def border(color: str | None = None, width: int = 1) -> ft.Border:
    return ft.Border.all(width, color or BORDER)


def border_bottom(color: str | None = None, width: int = 1) -> ft.Border:
    return ft.Border.only(bottom=ft.BorderSide(width, color or BORDER_INNER))


def border_top(color: str | None = None, width: int = 1) -> ft.Border:
    return ft.Border.only(top=ft.BorderSide(width, color or BORDER_INNER))



def flet_theme() -> ft.Theme:
    """Материальная тема Flutter под действующую палитру.

    Нужна для того, что рисует не наша вёрстка, а сам Flutter: выпадающее
    меню списка, подсказка, всплывающее сообщение, полоса прокрутки. Без
    неё тёмный экран получал бы белое меню — та самая полумера, из-за
    которой «тёмная тема» была видна только на кнопке переключения.
    """
    scheme = ft.ColorScheme(
        primary=TEXT,
        on_primary=TEXT_INVERSE,
        secondary=TEXT_2,
        on_secondary=TEXT_INVERSE,
        surface=CARD_BG,
        on_surface=TEXT,
        surface_tint=ft.Colors.TRANSPARENT,
        error=LOSS,
        on_error=TEXT_INVERSE,
        outline=BORDER,
        outline_variant=BORDER_INNER,
        shadow=CANVAS,
        inverse_surface=TEXT,
        on_inverse_surface=TEXT_INVERSE,
    )
    return ft.Theme(
        font_family=SANS,
        color_scheme=scheme,
        canvas_color=CONTENT_BG,
        card_bgcolor=CARD_BG,
        divider_color=BORDER,
        hint_color=TEXT_PLACEHOLDER,
        disabled_color=TEXT_PLACEHOLDER,
        scrollbar_theme=ft.ScrollbarTheme(
            thumb_color=TRACK,
            track_color=ft.Colors.TRANSPARENT,
            thickness=6,
            radius=R_BAR,
        ),
        tooltip_theme=ft.TooltipTheme(
            text_style=sans(size=SIZE_ROW, color=TEXT_INVERSE),
        ),
        snackbar_theme=ft.SnackBarTheme(
            bgcolor=TEXT,
            content_text_style=sans(size=SIZE_BODY, color=TEXT_INVERSE),
        ),
    )


def theme_mode() -> ft.ThemeMode:
    """Режим страницы под действующую палитру."""
    return ft.ThemeMode.DARK if palette.dark else ft.ThemeMode.LIGHT


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
