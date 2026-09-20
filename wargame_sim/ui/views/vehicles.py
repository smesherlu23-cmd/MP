"""Конструктор техники: библиотека машин, из которой собираются элементы.

Карточка машины — это запись в ``config/vehicles.yaml``. Правки пишутся
точечно в текст файла, поэтому пояснения в конфиге остаются на месте, а
проверяет значения всё равно pydantic при сохранении (§5).
"""

from __future__ import annotations

import flet as ft

from core.config import ConfigError
from core.config.introspect import PatchError, append_entry, patch_scalar, remove_entry
from ui import theme as t
from ui.shell import aside_block, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["vehicles"]

SECTION = "vehicles"

#: Колонки списка машин.
COLUMNS: tuple[c.Col, ...] = (
    c.Col("Машина", expand=True),
    c.Col("Класс", 104),
    c.Col("Экипаж", 66, numeric=True),
    c.Col("Броня", 86, numeric=True),
    c.Col("Огонь", 64, numeric=True),
    c.Col("ПТ", 56, numeric=True),
    c.Col("Подв.", 60, numeric=True),
    c.Col("Замет.", 62, numeric=True),
    c.Col("Надёж.", 64, numeric=True),
    c.Col("", 64),
)

#: Группы карточки: заголовок и поля (ключ, подпись, минимум, максимум, целое).
GROUPS: tuple[tuple[str, tuple[tuple[str, str, float, float, bool], ...]], ...] = (
    (
        "Общее",
        (
            ("crew", "Экипаж, чел.", 0, 20, True),
            ("transport", "Возит пехоты, чел.", 0, 40, True),
        ),
    ),
    (
        "Защита",
        (
            ("armour_front", "Броня, лоб", 0, 100, False),
            ("armour_side", "Броня, борт", 0, 100, False),
        ),
    ),
    (
        "Вооружение",
        (
            ("firepower", "Огневая мощь", 0, 100, False),
            ("anti_tank", "Противотанковая мощь", 0, 100, False),
        ),
    ),
    (
        "Подвижность и заметность",
        (
            ("mobility", "Подвижность", 0, 100, False),
            ("visibility", "Заметность", 0, 100, False),
        ),
    ),
    (
        "Эксплуатация",
        (
            ("reliability", "Надёжность", 0, 100, False),
            ("fuel_use", "Расход топлива, ×", 0, 5, False),
        ),
    ),
)

#: Поля новой машины: середина шкалы, чтобы её сразу было с чем сравнить.
NEW_VEHICLE: dict[str, object] = {
    "label": "Новая машина",
    "class": "прочее",
    "crew": 2,
    "armour_front": 20.0,
    "armour_side": 12.0,
    "firepower": 10.0,
    "anti_tank": 10.0,
    "mobility": 50.0,
    "visibility": 50.0,
    "reliability": 85.0,
    "fuel_use": 1.0,
    "transport": 0,
}

#: Ширина поля в карточке машины.
FIELD_W = 178


def build(app: AppState, vehicle_id: str = "") -> ft.View:
    store = app.store
    config = app.config
    library = config.vehicles.vehicles

    names = list(library)
    selected = vehicle_id or app.selected_vehicle or (names[0] if names else "")
    if selected not in library:
        selected = names[0] if names else ""
    app.selected_vehicle = selected

    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))
    error_holder = ft.Container()

    def say(text: str) -> None:
        message.value = text
        app.refresh(message)

    def show_error(error: ConfigError | None) -> None:
        error_holder.content = None if error is None else c.error_banner(str(error))
        app.refresh(error_holder)

    def write(text: str, *, reopen: str | None = None) -> bool:
        try:
            store.save_text(SECTION, text)
        except ConfigError as error:
            show_error(error)
            say("Изменения не применены — файл остался прежним.")
            return False
        app.reload_config()
        show_error(None)
        if reopen is not None:
            app.selected_vehicle = reopen
        return True

    # -- где используется машина -------------------------------------------
    def used_by(name: str) -> list[str]:
        """Типы элементов и батальоны, в которых стоит эта машина."""
        places: list[str] = []
        for type_name, entry in config.element_types.element_types.items():
            if entry.defaults.vehicle_type == name:
                places.append(f"тип «{type_name}»")
        for _path, battalion in app.units():
            if any(
                group.vehicle_type == name
                for element in battalion.elements
                for group in element.vehicles
            ):
                places.append(f"батальон «{battalion.name}»")
        return places

    # -- правки -------------------------------------------------------------
    def set_field(name: str, key: str, value: object) -> None:
        try:
            patched = patch_scalar(store.raw_text(SECTION), (SECTION, name, key), value)
        except (ConfigError, PatchError):
            say(f"Не нашёл «{key}» у машины «{name}» — поправьте в разделе коэффициентов.")
            return
        if write(patched):
            say(f"{name}: {key} = {value}.")

    def create() -> None:
        base = "Новая машина"
        name, index = base, 2
        while name in library:
            name, index = f"{base} {index}", index + 1
        try:
            patched = append_entry(store.raw_text(SECTION), (SECTION,), name, NEW_VEHICLE)
        except (ConfigError, PatchError) as error:
            show_error(error if isinstance(error, ConfigError) else None)
            return
        if write(patched, reopen=name):
            app.notify(f"Создана «{name}»")
            app.go(f"{ROUTE}?vehicle_id={name}")

    def duplicate(name: str) -> None:
        copy_name, index = f"{name} (копия)", 2
        while copy_name in library:
            copy_name, index = f"{name} (копия {index})", index + 1
        fields = library[name].model_dump(by_alias=True)
        fields["label"] = f"{fields['label']} (копия)"
        try:
            patched = append_entry(store.raw_text(SECTION), (SECTION,), copy_name, fields)
        except (ConfigError, PatchError):
            say("Не удалось скопировать — проверьте vehicles.yaml.")
            return
        if write(patched, reopen=copy_name):
            app.go(f"{ROUTE}?vehicle_id={copy_name}")

    def remove(name: str) -> None:
        places = used_by(name)
        if places:
            say(f"«{name}» ещё используется: {', '.join(places[:3])}. Сначала замените технику.")
            return
        if len(library) == 1:
            say("Это последняя машина в библиотеке — её нельзя удалить.")
            return
        try:
            patched = remove_entry(store.raw_text(SECTION), (SECTION, name))
        except (ConfigError, PatchError):
            say("Не удалось удалить — проверьте vehicles.yaml.")
            return
        if write(patched, reopen=""):
            app.notify(f"Удалена «{name}»")
            app.go(ROUTE)

    def reset_library() -> None:
        try:
            store.reset_section(SECTION)
        except ConfigError as error:
            show_error(error)
            return
        app.reload_config()
        show_error(None)
        say("Библиотека сброшена к эталону из config/defaults.")
        app.go(ROUTE)

    def open_vehicle(name: str) -> None:
        app.selected_vehicle = name
        app.go(f"{ROUTE}?vehicle_id={name}")

    # -- список -------------------------------------------------------------
    def row(name: str, *, last: bool) -> ft.Control:
        entry = library[name]
        actions = ft.Row(
            [
                c.spacer(),
                c.icon_button(
                    ft.Icons.CONTENT_COPY,
                    lambda: duplicate(name),
                    size=t.BUTTON_XS_H,
                    icon_size=15,
                    tooltip="Копировать",
                ),
                c.icon_button(
                    ft.Icons.DELETE_OUTLINE,
                    lambda: remove(name),
                    size=t.BUTTON_XS_H,
                    icon_size=15,
                    color=t.LOSS,
                    tooltip="Удалить",
                ),
            ],
            spacing=4,
        )
        return c.table_row(
            COLUMNS,
            [
                t.text(
                    name,
                    size=t.SIZE_ROW,
                    weight=t.W500 if name == selected else t.W400,
                    no_wrap=True,
                ),
                t.text(entry.vehicle_class, size=t.SIZE_META, color=t.TEXT_3, no_wrap=True),
                t.num(str(entry.crew)),
                t.num(f"{entry.armour_front:.0f}/{entry.armour_side:.0f}"),
                t.num(f"{entry.firepower:.0f}"),
                t.num(f"{entry.anti_tank:.0f}"),
                t.num(f"{entry.mobility:.0f}"),
                t.num(f"{entry.visibility:.0f}"),
                t.num(f"{entry.reliability:.0f}"),
                actions,
            ],
            height=t.TABLE_ROW_TALL_H,
            bgcolor=t.ROW_EXPANDED if name == selected else None,
            last=last,
            on_click=lambda: open_vehicle(name),
        )

    if names:
        table: ft.Control = ft.Column(
            [row(name, last=index == len(names) - 1) for index, name in enumerate(names)],
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            expand=True,
        )
    else:
        table = c.empty_hint("Библиотека пуста — создайте первую машину.")

    list_card = c.framed_card(
        f"Машины · {len(names)}",
        ft.Column([c.table_head(COLUMNS), table], spacing=0, expand=True),
        footer=c.card_footer(
            [
                ft.Text(
                    "карточка машины — запись в config/vehicles.yaml",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                )
            ]
        ),
        expand=True,
    )

    # -- карточка -----------------------------------------------------------
    def card_body(name: str) -> ft.Control:
        entry = library[name]
        blocks: list[ft.Control] = []

        title_field, _ = c.text_field(
            entry.label,
            lambda value: set_field(name, "label", value),
            width=FIELD_W * 2 + t.GAP_IN,
        )
        class_field, _ = c.text_field(
            entry.vehicle_class,
            lambda value: set_field(name, "class", value),
            width=FIELD_W,
        )
        blocks.append(
            ft.Column(
                [
                    c.labeled("Название", title_field, width=FIELD_W * 2 + t.GAP_IN),
                    c.labeled("Класс", class_field, width=FIELD_W),
                ],
                spacing=t.GAP_IN,
                tight=True,
            )
        )

        for group_title, fields in GROUPS:
            controls = [
                c.labeled(
                    label,
                    c.number_field(
                        float(getattr(entry, key)),
                        lambda value, k=key: set_field(name, k, value),
                        minimum=low,
                        maximum=high,
                        integer=integer,
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                )
                for key, label, low, high, integer in fields
            ]
            blocks.append(
                ft.Column(
                    [
                        ft.Row(
                            [
                                t.caption(group_title),
                                ft.Container(height=1, bgcolor=t.BORDER_INNER, expand=True),
                            ],
                            spacing=8,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        c.flow(controls),
                    ],
                    spacing=t.GAP_SM,
                    tight=True,
                )
            )

        places = used_by(name)
        blocks.append(
            ft.Column(
                [
                    t.caption("Где используется"),
                    c.note(", ".join(places) if places else "нигде — машину можно удалить"),
                ],
                spacing=4,
                tight=True,
            )
        )
        return ft.Container(
            content=ft.Column(blocks, spacing=t.PAD_CARD, scroll=ft.ScrollMode.AUTO, expand=True),
            padding=t.PAD_CARD,
            expand=True,
        )

    detail = (
        c.framed_card(selected, card_body(selected), expand=True)
        if selected
        else c.framed_card(
            "Машина",
            c.empty_hint("Выберите машину в списке слева."),
            expand=True,
        )
    )

    return screen(
        app,
        active="vehicles",
        active_child=selected,
        title="Техника",
        subtitle="Библиотека машин, из которой собираются элементы",
        aside=aside_block(
            "Библиотека",
            [
                c.note(
                    "Правки применяются без перезапуска. Эталон — config/defaults.",
                    size=t.SIZE_META,
                )
            ],
        ),
        actions=[
            c.tertiary_button("Сбросить библиотеку", reset_library, icon=ft.Icons.RESTORE),
            c.primary_button("Создать машину", create, icon=ft.Icons.ADD),
        ],
        body=ft.Column(
            [
                message,
                error_holder,
                c.columns(list_card, detail, right_width=420),
            ],
            spacing=t.GAP_SM,
            expand=True,
        ),
    )
