"""Редактор коэффициентов: разделы, валидация, сброс, тумблеры (§5, §10)."""

from __future__ import annotations

import flet as ft

from core.config import ConfigError
from core.config.schema import TogglesBody
from ui.state import ROUTES, AppState
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    choice,
    error_banner,
    link_button,
    page_title,
    text_button,
    toggle,
    two_columns,
)

ROUTE = ROUTES["config"]

#: Человекочитаемые названия разделов конфигурации.
SECTION_LABELS: dict[str, str] = {
    "terrain": "Местность",
    "weather": "Погода",
    "time_of_day": "Время суток",
    "orders": "Приказы",
    "element_types": "Типы элементов",
    "experience": "Опыт",
    "morale": "Мораль",
    "combat": "Ядро расчёта",
    "supply": "Снабжение",
    "fatigue": "Усталость",
    "toggles": "Опциональные параметры",
}

#: Подписи тумблеров опциональных параметров (§4.5).
TOGGLE_LABELS: dict[str, str] = {
    "fuel": "Топливо",
    "equipment": "Снаряжение",
    "vehicle_condition": "Состояние техники",
    "readiness": "Готовность",
    "commander_influence": "Влияние командира",
    "intel": "Разведданные",
    "fatigue": "Усталость",
}


def build(app: AppState, section: str = "combat") -> ft.View:
    store = app.store
    sections = store.sections()
    if section not in sections:
        section = sections[0]

    message = ft.Text("", size=12, opacity=0.75)
    error_holder = ft.Container()
    editor = ft.TextField(
        value="",
        multiline=True,
        min_lines=18,
        max_lines=40,
        text_style=ft.TextStyle(font_family="monospace", size=12),
        dense=True,
    )
    toggles_holder = ft.Column(spacing=4, tight=True)

    def load_section() -> None:
        try:
            editor.value = store.raw_text(section)
            error_holder.content = None
        except ConfigError as error:
            error_holder.content = error_banner(str(error))
        app.refresh(editor, error_holder)

    def apply() -> None:
        """Проверить и применить правку — сразу, без перезапуска (§14.3)."""
        try:
            store.save_text(section, editor.value or "")
        except ConfigError as error:
            error_holder.content = error_banner(str(error))
            message.value = "Изменения не применены — файл остался прежним."
            app.refresh(error_holder, message)
            return
        app.reload_config()
        error_holder.content = None
        message.value = "Применено. Новые коэффициенты действуют со следующего расчёта."
        app.refresh(error_holder, message)

    def reset() -> None:
        try:
            store.reset_section(section)
        except ConfigError as error:
            error_holder.content = error_banner(str(error))
            app.refresh(error_holder)
            return
        app.reload_config()
        load_section()
        message.value = "Раздел сброшен к эталонным значениям из config/defaults."
        app.refresh(message)

    def reset_all() -> None:
        store.reset_all()
        app.reload_config()
        load_section()
        message.value = "Все разделы сброшены к значениям по умолчанию."
        app.refresh(message)

    def switch_section(value: str) -> None:
        app.go(f"{ROUTE}?section={value}")

    def set_toggle(name: str, value: bool) -> None:
        data = store.raw("toggles")
        data.setdefault("toggles", {})[name] = value
        try:
            store.save("toggles", data)
        except ConfigError as error:
            error_holder.content = error_banner(str(error))
            app.refresh(error_holder)
            return
        app.reload_config()
        render_toggles()
        message.value = (
            f"«{TOGGLE_LABELS.get(name, name)}» "
            + ("учитывается в расчёте." if value else "выключен: модификатор равен 1.0.")
        )
        app.refresh(message)

    def render_toggles() -> None:
        current = app.config.tog
        toggles_holder.controls = [
            toggle(
                TOGGLE_LABELS.get(name, name),
                bool(getattr(current, name)),
                lambda value, key=name: set_toggle(key, value),
            )
            for name in TogglesBody.model_fields
        ]
        app.refresh(toggles_holder)

    load_section()
    render_toggles()

    return ft.View(
        route=ROUTE,
        controls=[
            ft.Column(
                [
                    page_title(
                        "Коэффициенты",
                        "Любая правка применяется без перезапуска. Эталонные значения "
                        "лежат в config/defaults и не перезаписываются.",
                    ),
                    ft.Row(
                        [
                            link_button(
                "На главную", ROUTES["home"], app.go, icon=ft.Icons.ARROW_BACK),
                            choice(
                                "Раздел",
                                [(name, SECTION_LABELS.get(name, name)) for name in sections],
                                section,
                                switch_section,
                                width=240,
                            ),
                            action_button("Применить", apply, icon=ft.Icons.CHECK),
                            text_button("Сбросить раздел", reset, icon=ft.Icons.RESTORE),
                            text_button("Сбросить всё", reset_all),
                        ],
                        spacing=GAP,
                        wrap=True,
                    ),
                    message,
                    error_holder,
                    two_columns(
                        card(
                            f"{SECTION_LABELS.get(section, section)} — {section}.yaml",
                            [editor],
                            stretch=True,
                        ),
                        card(
                            "Опциональные параметры",
                            [
                                ft.Text(
                                    "Выключенный параметр не участвует в формулах "
                                    "и скрывается в интерфейсе.",
                                    size=12,
                                    opacity=0.7,
                                ),
                                toggles_holder,
                            ],
                        ),
                    ),
                ],
                spacing=GAP,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            )
        ],
        padding=PAD,
    )
