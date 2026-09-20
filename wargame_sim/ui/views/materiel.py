"""Мат.часть: библиотеки техники, пехотного вооружения и обмундирования.

Три библиотеки устроены одинаково — папки, список, карточка записи, —
поэтому экран один, а различия описаны в :data:`LIBRARIES`. Записи живут
в YAML: правка поля пишется точечно (`patch_scalar`), создание и удаление —
блоками (`append_entry` / `remove_entry`), поэтому пояснения в конфигах
переживают любую операцию (§5).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import flet as ft

from core.config import ConfigError
from core.config.introspect import PatchError, append_entry, patch_scalar, remove_entry
from ui import theme as t
from ui.shell import aside_block, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["materiel"]

#: Запись без папки собирается сюда.
NO_FOLDER = "Без папки"

#: Ширина поля в карточке.
FIELD_W = 178


@dataclass(frozen=True)
class Num:
    """Числовое поле карточки."""

    key: str
    label: str
    minimum: float
    maximum: float
    integer: bool = False


@dataclass(frozen=True)
class Library:
    """Описание одной библиотеки мат.части."""

    key: str
    label: str
    subtitle: str
    item_word: str
    class_attr: str
    columns: tuple[c.Col, ...]
    groups: tuple[tuple[str, tuple[Num, ...]], ...]
    cells: Callable[[Any], list[ft.Control]]
    new_entry: dict[str, Any]
    folder_names: tuple[str, ...] = field(default_factory=tuple)


def _vehicle_cells(entry: Any) -> list[ft.Control]:
    return [
        t.text(entry.vehicle_class, size=t.SIZE_META, color=t.TEXT_3, no_wrap=True),
        t.num(str(entry.crew)),
        t.num(f"{entry.armour_front:.0f}/{entry.armour_side:.0f}"),
        t.num(f"{entry.firepower:.0f}"),
        t.num(f"{entry.anti_tank:.0f}"),
        t.num(f"{entry.mobility:.0f}"),
        t.num(f"{entry.visibility:.0f}"),
        t.num(f"{entry.reliability:.0f}"),
    ]


def _weapon_cells(entry: Any) -> list[ft.Control]:
    return [
        t.text(entry.weapon_class, size=t.SIZE_META, color=t.TEXT_3, no_wrap=True),
        t.num(str(entry.crew)),
        t.num(f"{entry.firepower:.0f}"),
        t.num(f"{entry.anti_tank:.0f}"),
        t.num(f"{entry.range:.0f}"),
        t.num(f"{entry.ammo_use:g}"),
    ]


def _gear_cells(entry: Any) -> list[ft.Control]:
    return [
        t.text(entry.gear_class, size=t.SIZE_META, color=t.TEXT_3, no_wrap=True),
        t.num(f"{entry.protection:.0f}"),
        t.num(f"{entry.visibility:.0f}"),
        t.num(f"{entry.mobility:.0f}"),
        t.num(f"{entry.fatigue:g}"),
    ]


LIBRARIES: dict[str, Library] = {
    "vehicles": Library(
        key="vehicles",
        label="Техника",
        subtitle="Машины, из которых собираются элементы",
        item_word="машину",
        class_attr="vehicle_class",
        columns=(
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
        ),
        groups=(
            (
                "Общее",
                (
                    Num("crew", "Экипаж, чел.", 0, 20, True),
                    Num("transport", "Возит пехоты, чел.", 0, 40, True),
                ),
            ),
            (
                "Защита",
                (
                    Num("armour_front", "Броня, лоб", 0, 100),
                    Num("armour_side", "Броня, борт", 0, 100),
                ),
            ),
            (
                "Вооружение",
                (
                    Num("firepower", "Огневая мощь", 0, 100),
                    Num("anti_tank", "Противотанковая мощь", 0, 100),
                ),
            ),
            (
                "Подвижность и заметность",
                (
                    Num("mobility", "Подвижность", 0, 100),
                    Num("visibility", "Заметность", 0, 100),
                ),
            ),
            (
                "Эксплуатация",
                (
                    Num("reliability", "Надёжность", 0, 100),
                    Num("fuel_use", "Расход топлива, ×", 0, 5),
                ),
            ),
        ),
        cells=_vehicle_cells,
        new_entry={
            "label": "Новая машина",
            "class": "прочее",
            "folder": "",
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
        },
    ),
    "weapons": Library(
        key="weapons",
        label="Пехотное вооружение",
        subtitle="Чем вооружены солдаты",
        item_word="оружие",
        class_attr="weapon_class",
        columns=(
            c.Col("Оружие", expand=True),
            c.Col("Класс", 110),
            c.Col("Расчёт", 66, numeric=True),
            c.Col("Огонь", 64, numeric=True),
            c.Col("ПТ", 56, numeric=True),
            c.Col("Дальность", 84, numeric=True),
            c.Col("Расход", 70, numeric=True),
            c.Col("", 64),
        ),
        groups=(
            ("Расчёт", (Num("crew", "Расчёт, чел.", 1, 10, True),)),
            (
                "Вооружение",
                (
                    Num("firepower", "Огневая мощь", 0, 100),
                    Num("anti_tank", "Противотанковая мощь", 0, 100),
                ),
            ),
            (
                "Применение",
                (
                    Num("range", "Дальность", 0, 100),
                    Num("ammo_use", "Расход боезапаса, ×", 0, 5),
                ),
            ),
        ),
        cells=_weapon_cells,
        new_entry={
            "label": "Новое оружие",
            "class": "стрелковое",
            "folder": "",
            "crew": 1,
            "firepower": 30.0,
            "anti_tank": 0.0,
            "range": 30.0,
            "ammo_use": 1.0,
        },
    ),
    "gear": Library(
        key="gear",
        label="Обмундирование",
        subtitle="Во что одет солдат",
        item_word="комплект",
        class_attr="gear_class",
        columns=(
            c.Col("Комплект", expand=True),
            c.Col("Класс", 110),
            c.Col("Защита", 70, numeric=True),
            c.Col("Заметность", 90, numeric=True),
            c.Col("Подвижность", 96, numeric=True),
            c.Col("Усталость", 80, numeric=True),
            c.Col("", 64),
        ),
        groups=(
            ("Защита", (Num("protection", "Защищённость", 0, 100),)),
            (
                "Цена комплекта",
                (
                    Num("visibility", "Заметность", 0, 100),
                    Num("mobility", "Подвижность", 0, 100),
                    Num("fatigue", "Усталость, ×", 0, 3),
                ),
            ),
        ),
        cells=_gear_cells,
        new_entry={
            "label": "Новый комплект",
            "class": "базовое",
            "folder": "",
            "protection": 20.0,
            "visibility": 50.0,
            "mobility": 70.0,
            "fatigue": 1.0,
        },
    ),
}


def entries_of(app: AppState, library: Library) -> dict[str, Any]:
    section = getattr(app.config, library.key)
    return getattr(section, library.key)


def folders_of(app: AppState, library: Library) -> list[str]:
    return list(getattr(app.config, library.key).folders)


def grouped(entries: dict[str, Any], folders: Sequence[str]) -> list[tuple[str, list[str]]]:
    """Записи по папкам: сначала объявленные папки, потом «без папки»."""
    buckets: dict[str, list[str]] = {name: [] for name in folders}
    loose: list[str] = []
    for name, entry in entries.items():
        folder = getattr(entry, "folder", "")
        if folder in buckets:
            buckets[folder].append(name)
        else:
            loose.append(name)
    result = list(buckets.items())
    if loose:
        result.append((NO_FOLDER, loose))
    return result


def build(app: AppState, library: str = "vehicles", item: str = "") -> ft.View:
    spec = LIBRARIES.get(library) or LIBRARIES["vehicles"]
    store = app.store
    entries = entries_of(app, spec)
    folders = folders_of(app, spec)

    names = list(entries)
    selected = item or app.selected_materiel.get(spec.key, "")
    if selected not in entries:
        selected = names[0] if names else ""
    app.selected_materiel[spec.key] = selected

    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))
    error_holder = ft.Container()

    def say(text: str) -> None:
        message.value = text
        app.refresh(message)

    def write(text: str) -> bool:
        try:
            store.save_text(spec.key, text)
        except ConfigError as error:
            error_holder.content = c.error_banner(str(error))
            app.refresh(error_holder)
            say("Изменения не применены — файл остался прежним.")
            return False
        app.reload_config()
        error_holder.content = None
        app.refresh(error_holder)
        return True

    def go(name: str = "") -> None:
        app.selected_materiel[spec.key] = name
        suffix = f"?item={name}" if name else ""
        app.go(ROUTE.format(library=spec.key) + suffix)

    # -- правки -------------------------------------------------------------
    def set_field(name: str, key: str, value: object) -> None:
        try:
            patched = patch_scalar(store.raw_text(spec.key), (spec.key, name, key), value)
        except (ConfigError, PatchError):
            say(f"Не нашёл «{key}» у записи «{name}» — поправьте в разделе коэффициентов.")
            return
        if write(patched):
            say(f"{name}: {key} = {value}.")

    def create() -> None:
        base = str(spec.new_entry["label"])
        name, index = base, 2
        while name in entries:
            name, index = f"{base} {index}", index + 1
        fields = dict(spec.new_entry)
        fields["label"] = name
        try:
            patched = append_entry(store.raw_text(spec.key), (spec.key,), name, fields)
        except (ConfigError, PatchError):
            say("Не удалось создать запись — проверьте файл библиотеки.")
            return
        if write(patched):
            app.notify(f"Создано: «{name}»")
            go(name)

    def duplicate(name: str) -> None:
        copy_name, index = f"{name} (копия)", 2
        while copy_name in entries:
            copy_name, index = f"{name} (копия {index})", index + 1
        fields = entries[name].model_dump(by_alias=True)
        fields["label"] = f"{fields['label']} (копия)"
        try:
            patched = append_entry(store.raw_text(spec.key), (spec.key,), copy_name, fields)
        except (ConfigError, PatchError):
            say("Не удалось скопировать — проверьте файл библиотеки.")
            return
        if write(patched):
            go(copy_name)

    def remove(name: str) -> None:
        places = app.materiel_usage(spec.key, name)
        if places:
            say(f"«{name}» ещё используется: {', '.join(places[:3])}. Сначала замените.")
            return
        if len(entries) == 1:
            say("Это последняя запись в библиотеке — её нельзя удалить.")
            return
        try:
            patched = remove_entry(store.raw_text(spec.key), (spec.key, name))
        except (ConfigError, PatchError):
            say("Не удалось удалить — проверьте файл библиотеки.")
            return
        if write(patched):
            app.notify(f"Удалено: «{name}»")
            go()

    def create_folder() -> None:
        base, index = "Новая папка", 2
        name = base
        while name in folders:
            name, index = f"{base} {index}", index + 1
        data = store.raw(spec.key)
        data.setdefault("folders", []).append(name)
        try:
            store.save(spec.key, data)
        except ConfigError as error:
            error_holder.content = c.error_banner(str(error))
            app.refresh(error_holder)
            return
        app.reload_config()
        app.notify(f"Создана папка «{name}»")
        go(selected)

    def reset_library() -> None:
        try:
            store.reset_section(spec.key)
        except ConfigError as error:
            error_holder.content = c.error_banner(str(error))
            app.refresh(error_holder)
            return
        app.reload_config()
        say("Библиотека сброшена к эталону из config/defaults.")
        go()

    # -- список -------------------------------------------------------------
    def folder_row(title: str, count: int) -> ft.Control:
        return ft.Container(
            content=ft.Row(
                [
                    ft.Icon(ft.Icons.FOLDER_OUTLINED, size=15, color=t.TEXT_MUTED),
                    t.caption(title),
                    c.spacer(),
                    ft.Text(str(count), style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED)),
                ],
                spacing=8,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            height=t.TABLE_HEAD_H,
            bgcolor=t.SURFACE_ALT,
            padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
            border=t.border_bottom(t.BORDER_INNER),
        )

    def entry_row(name: str, *, last: bool) -> ft.Control:
        entry = entries[name]
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
            spec.columns,
            [
                t.text(
                    entry.label,
                    size=t.SIZE_ROW,
                    weight=t.W500 if name == selected else t.W400,
                    no_wrap=True,
                ),
                *spec.cells(entry),
                actions,
            ],
            height=t.TABLE_ROW_TALL_H,
            bgcolor=t.ROW_EXPANDED if name == selected else None,
            last=last,
            on_click=lambda: go(name),
        )

    rows: list[ft.Control] = []
    for folder, folder_names in grouped(entries, folders):
        rows.append(folder_row(folder, len(folder_names)))
        if not folder_names:
            rows.append(c.empty_hint("Папка пуста."))
            continue
        rows.extend(
            entry_row(name, last=index == len(folder_names) - 1)
            for index, name in enumerate(folder_names)
        )

    body: ft.Control = (
        ft.Column(rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
        if names
        else c.empty_hint("Библиотека пуста — создайте первую запись.")
    )

    list_card = c.framed_card(
        f"{spec.label} · {len(names)}",
        ft.Column([c.table_head(spec.columns), body], spacing=0, expand=True),
        trailing=[
            c.secondary_button(
                "Создать папку", create_folder, icon=ft.Icons.CREATE_NEW_FOLDER_OUTLINED,
                height=t.BUTTON_SM_H,
            )
        ],
        footer=c.card_footer(
            [
                ft.Text(
                    f"запись библиотеки — блок в config/{spec.key}.yaml",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                )
            ]
        ),
        expand=True,
    )

    # -- карточка -----------------------------------------------------------
    def card_body(name: str) -> ft.Control:
        entry = entries[name]
        blocks: list[ft.Control] = []

        title_field, _ = c.text_field(
            entry.label,
            lambda value: set_field(name, "label", value),
            width=FIELD_W * 2 + t.GAP_IN,
        )
        class_field, _ = c.text_field(
            getattr(entry, spec.class_attr),
            lambda value: set_field(name, "class", value),
            width=FIELD_W,
        )
        folder_options = [("", NO_FOLDER), *[(f, f) for f in folders]]
        blocks.append(
            ft.Column(
                [
                    ft.Text(
                        f"ключ: {name}",
                        style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                    ),
                    c.labeled("Название", title_field, width=FIELD_W * 2 + t.GAP_IN),
                    c.flow(
                        [
                            c.labeled("Класс", class_field, width=FIELD_W),
                            c.labeled(
                                "Папка",
                                c.select(
                                    entry.folder if entry.folder in folders else "",
                                    folder_options,
                                    lambda value: set_field(name, "folder", value),
                                    width=FIELD_W,
                                ),
                                width=FIELD_W,
                            ),
                        ]
                    ),
                ],
                spacing=t.GAP_IN,
                tight=True,
            )
        )

        for group_title, fields in spec.groups:
            controls = [
                c.labeled(
                    num.label,
                    c.number_field(
                        float(getattr(entry, num.key)),
                        lambda value, k=num.key: set_field(name, k, value),
                        minimum=num.minimum,
                        maximum=num.maximum,
                        integer=num.integer,
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                )
                for num in fields
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

        places = app.materiel_usage(spec.key, name)
        blocks.append(
            ft.Column(
                [
                    t.caption("Где используется"),
                    c.note(", ".join(places) if places else "нигде — запись можно удалить"),
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
        c.framed_card(entries[selected].label, card_body(selected), expand=True)
        if selected
        else c.framed_card(
            spec.label, c.empty_hint("Выберите запись в списке слева."), expand=True
        )
    )

    return screen(
        app,
        active="materiel",
        active_child=spec.key,
        title=f"Мат.часть · {spec.label}",
        subtitle=spec.subtitle,
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
            c.primary_button(f"Создать {spec.item_word}", create, icon=ft.Icons.ADD),
        ],
        body=ft.Column(
            [message, error_holder, c.columns(list_card, detail, right_width=420)],
            spacing=t.GAP_SM,
            expand=True,
        ),
    )
