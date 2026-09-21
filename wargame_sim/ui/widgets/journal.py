"""Журнал боя и блок «Требует внимания».

Журнал показывается тремя уровнями детальности: только текст события,
плюс строка сработавших модификаторов, плюс строка изменений полей.
Модификаторы и before/after движок пишет всегда — детальность влияет
только на то, что видно (§8).
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import flet as ft

from core.log import LogEntry
from core.models import Battalion
from ui import theme as t
from ui.state import ALL, DETAIL_ALL, DETAIL_EVENTS, DETAIL_FACTORS
from ui.widgets import common as c

#: Понятные подписи типов событий для фильтра.
EVENT_LABELS: dict[str, str] = {
    "turn_started": "начало хода",
    "battle_finished": "конец боя",
    "recovered": "восстановление",
    "contact": "обнаружение",
    "initiative": "инициатива",
    "fire_allocated": "целеуказание",
    "firepower": "огневая мощь",
    "resilience": "устойчивость",
    "pressure": "давление",
    "losses_inflicted": "потери",
    "suppressed": "подавление",
    "supply_spent": "снабжение",
    "fatigue_gained": "усталость",
    "morale_changed": "мораль",
    "panic": "паника",
    "retreat_order": "переход к отступлению",
    "element_destroyed": "элемент небоеспособен",
    "battalion_routed": "разгром отряда",
    "task_completed": "задача выполнена",
}

#: События, которые попадают в «ключевые» на экране итога.
KEY_EVENTS = frozenset(
    {
        "panic",
        "retreat_order",
        "element_destroyed",
        "battalion_routed",
        "task_completed",
        "battle_finished",
    }
)

#: Подсветка чисел в тексте события: потери и отрицательная дельта морали.
_NUMBER = re.compile(r"(\d+(?:[.,]\d+)?)")


def event_label(event: str) -> str:
    return EVENT_LABELS.get(event, event)


def _highlight(entry: LogEntry) -> ft.Control:
    """Текст события; числа потерь и падение морали — акцентом."""
    text = entry.text or entry.event
    accent = entry.event in {"losses_inflicted", "panic", "element_destroyed", "battalion_routed"}
    drop = entry.event == "morale_changed" and "−" in text

    if not (accent or drop):
        return ft.Text(text, style=t.sans(size=t.SIZE_ROW, height=1.45))

    spans: list[ft.TextSpan] = []
    for piece in _NUMBER.split(text):
        if not piece:
            continue
        is_number = bool(_NUMBER.fullmatch(piece))
        spans.append(
            ft.TextSpan(
                piece,
                style=t.sans(
                    size=t.SIZE_ROW,
                    weight=t.W600 if is_number else t.W400,
                    color=t.LOSS if is_number else t.TEXT,
                    height=1.45,
                ),
            )
        )
    return ft.Text(spans=spans, style=t.sans(size=t.SIZE_ROW, height=1.45))


def entry_tile(entry: LogEntry, detail: str, *, last: bool = False) -> ft.Control:
    """Одна запись журнала."""
    address = " → ".join(part for part in (entry.actor, entry.target) if part)
    head = ft.Row(
        [
            ft.Text(
                f"{entry.turn} · {event_label(entry.event)}",
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
            ),
            ft.Text(
                address,
                style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                expand=True,
                no_wrap=True,
            ),
        ],
        spacing=8,
    )

    parts: list[ft.Control] = [head, _highlight(entry)]

    if detail in (DETAIL_FACTORS, DETAIL_ALL) and entry.breakdown:
        factors = " · ".join(f"{f.factor} {f.value:g}" for f in entry.breakdown)
        parts.append(
            ft.Text(factors, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED, height=1.5))
        )

    if detail == DETAIL_ALL:
        changed = [
            f"{key} {entry.before[key]} → {entry.after[key]}"
            for key in entry.before
            if key in entry.after and entry.before[key] != entry.after[key]
        ]
        if changed:
            parts.append(
                ft.Text(
                    " · ".join(changed),
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_2, height=1.5),
                )
            )

    return ft.Container(
        content=ft.Column(parts, spacing=3, tight=True),
        padding=ft.Padding.symmetric(vertical=10, horizontal=14),
        border=None if last else t.border_bottom(t.BORDER_INNER),
    )


class EntriesView:
    """Журнал, который дописывает новое вместо полной перерисовки.

    Показываются **последние** записи, а не первые: за бой их набегает
    около 2600, и обрезка с начала оставляла ГМ первые два хода — после
    очередного хода в журнале не было видно ровно того, что произошло.
    Начало по-прежнему достаётся фильтром по ходу.

    Запись журнала неизменна, поэтому и плитка неизменна: если список
    вырос с конца — а так бывает всегда, кроме смены фильтра, — строятся
    только новые плитки. Приказ или деление добавляют одну запись, и
    раньше из-за неё перестраивались все триста.
    """

    def __init__(self, *, limit: int = 300) -> None:
        self._limit = limit
        self._detail = ""
        #: Показанное окно записей и длина всего отфильтрованного списка.
        self._window: list[LogEntry] = []
        self._total = 0
        self._notice = ft.Container(visible=False)
        self._empty = ft.Container(visible=False)
        self._tiles = ft.Column(spacing=0, tight=True)
        self.control: ft.Control = ft.Column(
            [self._notice, self._empty, self._tiles],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        )

    def render(self, entries: Sequence[LogEntry], detail: str) -> None:
        """Обновить журнал под текущий фильтр и детальность."""
        items = list(entries)
        if detail == self._detail and self._is_growth(items):
            self._append(items)
        else:
            self._rebuild(items, detail)
        c.safe_update(self._notice, self._empty, self._tiles)

    # -- внутреннее ---------------------------------------------------------
    def _is_growth(self, items: Sequence[LogEntry]) -> bool:
        """Тот же список, только длиннее: показанное окно совпало по объектам."""
        if not self._window or len(items) < self._total:
            return False
        start = self._total - len(self._window)
        window = items[start : self._total]
        if len(window) != len(self._window):
            return False
        return all(new is old for new, old in zip(window, self._window, strict=True))

    def _rebuild(self, items: Sequence[LogEntry], detail: str) -> None:
        self._detail = detail
        hidden = max(len(items) - self._limit, 0)
        self._window = list(items[hidden:])
        self._total = len(items)
        self._tiles.controls = [entry_tile(entry, detail) for entry in self._window]
        self._paint_notice(hidden, empty=not items)

    def _append(self, items: Sequence[LogEntry]) -> None:
        fresh = items[self._total :]
        self._tiles.controls = [
            *self._tiles.controls,
            *(entry_tile(entry, self._detail) for entry in fresh),
        ]
        self._window = [*self._window, *fresh]
        self._total = len(items)
        extra = max(len(self._window) - self._limit, 0)
        if extra:
            self._tiles.controls = self._tiles.controls[extra:]
            self._window = self._window[extra:]
        self._paint_notice(self._total - len(self._window), empty=not items)

    def _paint_notice(self, hidden: int, *, empty: bool) -> None:
        self._empty.visible = empty
        self._empty.content = (
            c.empty_hint("Записей нет — измените фильтр или сделайте ход.")
            if empty
            else None
        )
        self._notice.visible = bool(hidden)
        self._notice.content = (
            ft.Container(
                content=ft.Text(
                    f"ранних записей скрыто: {hidden} — показаны последние "
                    f"{len(self._window)}, начало смотрите фильтром по ходу",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                ),
                padding=ft.Padding.symmetric(vertical=8, horizontal=14),
                border=t.border_bottom(t.BORDER_INNER),
            )
            if hidden
            else None
        )


def key_events(entries: Sequence[LogEntry], *, limit: int = 8) -> list[LogEntry]:
    """Ключевые события боя: переломы, а не каждый выстрел."""
    return [entry for entry in entries if entry.event in KEY_EVENTS][:limit]


def key_event_tile(entry: LogEntry, *, last: bool = False) -> ft.Control:
    """Запись в списке ключевых событий на экране итога."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Container(
                    content=ft.Text(
                        str(entry.turn), style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED)
                    ),
                    width=22,
                ),
                ft.Text(
                    entry.text or entry.event,
                    style=t.sans(size=t.SIZE_ROW, height=1.45),
                    expand=True,
                ),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.START,
        ),
        padding=ft.Padding.symmetric(vertical=8, horizontal=14),
        border=None if last else t.border_bottom(t.BORDER_INNER),
    )


# --------------------------------------------------------------------------
# «Требует внимания»
# --------------------------------------------------------------------------
def attention_rows(
    battalions: Sequence[tuple[str, Battalion]], threshold: float, *, limit: int = 4
) -> list[tuple[str, str, float]]:
    """Элементы с моралью ниже порога — по возрастанию морали.

    Возвращает тройки (сторона, текст, мораль). Блок не исчезает, когда
    таких элементов нет: пустой список — это тоже ответ.
    """
    found: list[tuple[str, str, float]] = []
    for side, battalion in battalions:
        for element in battalion.alive_elements:
            if element.morale < threshold:
                found.append((side, element.name, element.morale))
    found.sort(key=lambda row: row[2])
    return found[:limit]


def attention_card(
    rows: Sequence[tuple[str, str, float]], threshold: float
) -> ft.Control:
    """Карточка «Требует внимания» с порогом в шапке."""
    if rows:
        body: ft.Control = ft.Column(
            [
                ft.Container(
                    content=ft.Row(
                        [
                            ft.Container(
                                content=ft.Text(
                                    side, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED)
                                ),
                                width=16,
                            ),
                            ft.Text(
                                f"{name}: мораль падает",
                                style=t.sans(size=t.SIZE_ROW, height=1.45),
                                expand=True,
                            ),
                            ft.Text(
                                f"{morale:.0f}",
                                style=t.mono(size=t.SIZE_ROW, weight=t.W600, color=t.LOSS),
                            ),
                        ],
                        spacing=8,
                    ),
                    padding=ft.Padding.symmetric(vertical=6, horizontal=t.PAD_CARD),
                )
                for side, name, morale in rows
            ],
            spacing=0,
            tight=True,
        )
    else:
        body = ft.Container(
            content=ft.Text(
                "Все элементы держатся выше порога.",
                style=t.sans(size=t.SIZE_ROW, color=t.TEXT_PLACEHOLDER),
            ),
            padding=ft.Padding.symmetric(vertical=10, horizontal=t.PAD_CARD),
        )

    return c.framed_card(
        "Требует внимания",
        ft.Container(content=body, padding=ft.Padding.only(top=6, bottom=6)),
        icon=ft.Icons.WARNING_AMBER_OUTLINED,
        trailing=[
            ft.Text(
                f"мораль < {threshold:.0f}", style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED)
            )
        ],
    )


def filter_options(values: Sequence[str], all_label: str) -> list[tuple[str, str]]:
    """Опции фильтра: «все» плюс перечисленные значения."""
    return [(ALL, all_label), *[(value, value) for value in values]]


DETAIL_OPTIONS: tuple[tuple[str, str], ...] = (
    (DETAIL_EVENTS, "события"),
    (DETAIL_FACTORS, "модификаторы"),
    (DETAIL_ALL, "всё"),
)
