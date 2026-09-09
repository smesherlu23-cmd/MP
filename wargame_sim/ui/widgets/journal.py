"""Просмотр журнала боя с фильтрами по ходу, элементу и типу события (§8)."""

from __future__ import annotations

from collections.abc import Callable, Sequence

import flet as ft

from core.log import LogEntry
from ui.widgets.common import GAP, choice, empty_hint

ALL = "*"

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
    "battalion_routed": "разгром батальона",
    "task_completed": "задача выполнена",
}


def event_label(event: str) -> str:
    return EVENT_LABELS.get(event, event)


def entry_tile(entry: LogEntry) -> ft.Control:
    """Одна запись журнала вместе с расшифровкой модификаторов."""
    header = f"ход {entry.turn} · {event_label(entry.event)}"
    if entry.actor:
        header += f" · {entry.actor}"
    if entry.target:
        header += f" → {entry.target}"

    parts: list[ft.Control] = [
        ft.Text(header, size=12, opacity=0.7),
        ft.Text(entry.text or entry.event, size=13, selectable=True),
    ]
    if entry.breakdown:
        factors = "  ·  ".join(f"{item.factor} = {item.value:g}" for item in entry.breakdown)
        parts.append(ft.Text(f"модификаторы: {factors}", size=11, opacity=0.65, selectable=True))
    changed = [
        f"{key}: {entry.before[key]} → {entry.after[key]}"
        for key in entry.before
        if key in entry.after and entry.before[key] != entry.after[key]
    ]
    if changed:
        parts.append(ft.Text("изменения: " + "; ".join(changed), size=11, opacity=0.65))

    return ft.Container(
        content=ft.Column(parts, spacing=2, tight=True),
        padding=ft.Padding.symmetric(vertical=6, horizontal=8),
        border=ft.Border.only(left=ft.BorderSide(2, ft.Colors.OUTLINE_VARIANT)),
    )


def entries_list(entries: Sequence[LogEntry], *, limit: int = 400) -> ft.Control:
    """Список записей; очень длинный журнал подрезается с подсказкой."""
    if not entries:
        return empty_hint("Записей нет — измените фильтр или сделайте ход.")
    shown = list(entries[:limit])
    controls: list[ft.Control] = [entry_tile(entry) for entry in shown]
    if len(entries) > limit:
        controls.append(
            ft.Text(
                f"…показаны первые {limit} из {len(entries)} записей. "
                "Сузьте фильтр или выгрузите журнал целиком.",
                size=12,
                opacity=0.7,
            )
        )
    return ft.Column(controls, spacing=4, scroll=ft.ScrollMode.AUTO, expand=True)


def filter_bar(
    *,
    turns: Sequence[int],
    actors: Sequence[str],
    events: Sequence[str],
    selected_turn: str,
    selected_actor: str,
    selected_event: str,
    on_turn: Callable[[str], None],
    on_actor: Callable[[str], None],
    on_event: Callable[[str], None],
) -> ft.Control:
    """Панель фильтров журнала."""
    return ft.Row(
        [
            choice(
                "Ход",
                [(ALL, "все ходы"), *[(str(turn), f"ход {turn}") for turn in turns]],
                selected_turn,
                on_turn,
                width=140,
            ),
            choice(
                "Элемент",
                [(ALL, "все элементы"), *[(actor, actor) for actor in actors]],
                selected_actor,
                on_actor,
                width=200,
            ),
            choice(
                "Событие",
                [(ALL, "все события"), *[(event, event_label(event)) for event in events]],
                selected_event,
                on_event,
                width=220,
            ),
        ],
        spacing=GAP,
        wrap=True,
    )
