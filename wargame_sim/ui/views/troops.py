"""Сборка юнитов: типы солдат и их комплект.

Каждому типу выдаётся обмундирование, основное и доп. оружие и БК; из
этого считаются его огневая мощь, противотанковость и защищённость,
а из состава типа элемента — штат подразделения (`core.staff`).
"""

from __future__ import annotations

import flet as ft

from core.config import ConfigError
from core.config import folders as folder_ops
from core.config.introspect import PatchError, append_entry, patch_scalar, remove_entry
from core.staff import element_staff, soldier
from ui import theme as t
from ui.shell import aside_block, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import dialogs as dlg
from ui.widgets import library as lib

ROUTE = ROUTES["troops"]

SECTION = "troops"

#: Ширина поля в карточке.
FIELD_W = 190

COLUMNS: tuple[c.Col, ...] = (
    c.Col("Тип солдата", expand=True),
    c.Col("Обмундирование", 150),
    c.Col("Оружие", 136),
    c.Col("Доп. оружие", 136),
    c.Col("БК", 48, numeric=True),
    c.Col("Огонь", 56, numeric=True),
    c.Col("ПТ", 48, numeric=True),
    c.Col("", 58),
)

#: Поля нового типа солдата.
NEW_TROOP: dict[str, object] = {
    "label": "Новый тип",
    "folder": "",
    "gear": "Полевая_форма",
    "weapon": "Автомат",
    "secondary": "",
    "ammo": 80,
}


def build(app: AppState, troop_id: str = "", folder: str = "") -> ft.View:
    store = app.store
    config = app.config
    troops = config.troops.troops
    folders = list(config.troops.folders)

    names = list(troops)
    known_folders = folder_ops.tree(folders)
    open_folder = folder if folder in known_folders else ""
    if folder:
        app.selected_troop_folder = open_folder
    elif troop_id:
        app.selected_troop_folder = ""
    else:
        open_folder = app.selected_troop_folder
        open_folder = open_folder if open_folder in known_folders else ""

    selected = troop_id or app.selected_troop
    if selected not in troops:
        selected = names[0] if names else ""
    app.selected_troop = selected

    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))
    error_holder = ft.Container()

    def say(text: str) -> None:
        message.value = text
        app.refresh(message)

    def write(text: str) -> bool:
        try:
            store.save_text(SECTION, text)
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
        app.selected_troop = name
        app.selected_troop_folder = ""
        app.go(f"{ROUTE}?troop_id={name}" if name else ROUTE)

    def go_folder(path: str) -> None:
        app.selected_troop_folder = path
        app.go(f"{ROUTE}?folder={path}")

    def set_field(name: str, key: str, value: object) -> None:
        try:
            patched = patch_scalar(store.raw_text(SECTION), (SECTION, name, key), value)
        except (ConfigError, PatchError):
            say(f"Не нашёл «{key}» у типа «{name}» — поправьте в разделе коэффициентов.")
            return
        if write(patched):
            say(f"{name}: {key} = {value or 'не задано'}.")

    def create() -> None:
        base, index = "Новый тип", 2
        name = base
        while name in troops:
            name, index = f"{base} {index}", index + 1
        fields = dict(NEW_TROOP)
        fields["label"] = name
        try:
            patched = append_entry(store.raw_text(SECTION), (SECTION,), name, fields)
        except (ConfigError, PatchError):
            say("Не удалось создать тип — проверьте troops.yaml.")
            return
        if write(patched):
            app.notify(f"Создан тип «{name}»")
            go(name)

    def duplicate(name: str) -> None:
        copy_name, index = f"{name} (копия)", 2
        while copy_name in troops:
            copy_name, index = f"{name} (копия {index})", index + 1
        fields = troops[name].model_dump()
        fields["label"] = f"{fields['label']} (копия)"
        try:
            patched = append_entry(store.raw_text(SECTION), (SECTION,), copy_name, fields)
        except (ConfigError, PatchError):
            say("Не удалось скопировать — проверьте troops.yaml.")
            return
        if write(patched):
            go(copy_name)

    def remove(name: str) -> None:
        places = app.materiel_usage(SECTION, name)
        if places:
            say(f"«{name}» стоит в составе: {', '.join(places[:3])}. Сначала уберите из состава.")
            return
        if len(troops) == 1:
            say("Это последний тип солдата — его нельзя удалить.")
            return
        try:
            patched = remove_entry(store.raw_text(SECTION), (SECTION, name))
        except (ConfigError, PatchError):
            say("Не удалось удалить — проверьте troops.yaml.")
            return
        if write(patched):
            app.notify(f"Удалён тип «{name}»")
            go()

    # -- папки --------------------------------------------------------------
    def create_folder(parent: str = "") -> None:
        dlg.ask_name(
            app,
            "Новая папка" if not parent else f"Папка внутри «{folder_ops.name_of(parent)}»",
            "Имя папки",
            "Новая папка",
            confirm_label="Создать",
            on_confirm=lambda name: _create_folder(parent, name),
        )

    def _create_folder(parent: str, name: str) -> None:
        if not name.strip():
            return
        raw = store.raw(SECTION)
        try:
            patched, path = folder_ops.create(store.raw_text(SECTION), raw, parent, name)
        except (ConfigError, PatchError):
            say("Не удалось создать папку — проверьте troops.yaml.")
            return
        if write(patched):
            app.notify(f"Создана папка «{path}»")
            go_folder(path)

    def ask_rename_folder(path: str) -> None:
        dlg.ask_name(
            app,
            f"Переименовать «{folder_ops.name_of(path)}»",
            "Имя папки",
            folder_ops.name_of(path),
            confirm_label="Переименовать",
            on_confirm=lambda name: rename_folder(name, path),
        )

    def rename_folder(new_name: str, path: str = "") -> None:
        target = path or open_folder
        if not target or not new_name.strip():
            return
        raw = store.raw(SECTION)
        try:
            patched, moved = folder_ops.rename(
                store.raw_text(SECTION), raw, SECTION, target, new_name
            )
        except (ConfigError, PatchError):
            say("Не удалось переименовать папку.")
            return
        if write(patched):
            go_folder(moved)

    def move_folder(new_parent: str) -> None:
        if not open_folder:
            return
        raw = store.raw(SECTION)
        try:
            patched, path = folder_ops.move(
                store.raw_text(SECTION), raw, SECTION, open_folder, new_parent
            )
        except (ConfigError, PatchError):
            say("Папку нельзя перенести внутрь самой себя.")
            return
        if write(patched):
            go_folder(path)

    def delete_folder(path: str = "") -> None:
        target = path or open_folder
        if not target:
            return
        dlg.confirm(
            app,
            f"Удалить папку «{folder_ops.name_of(target)}»?",
            "Типы и вложенные папки поднимутся на уровень выше — ничего "
            "не пропадёт, но структура изменится.",
            confirm_label="Удалить",
            danger=True,
            on_confirm=lambda: _delete_folder(target),
        )

    def _delete_folder(target: str) -> None:
        raw = store.raw(SECTION)
        try:
            patched = folder_ops.remove(store.raw_text(SECTION), raw, SECTION, target)
        except (ConfigError, PatchError):
            say("Не удалось удалить папку.")
            return
        if write(patched):
            app.notify(f"Удалена папка «{target}»")
            go_folder(folder_ops.parent_of(target))

    def reset_library() -> None:
        try:
            store.reset_section(SECTION)
        except ConfigError as error:
            error_holder.content = c.error_banner(str(error))
            app.refresh(error_holder)
            return
        app.reload_config()
        say("Типы солдат сброшены к эталону из config/defaults.")
        go()

    # -- список -------------------------------------------------------------
    def folder_menu(path: str) -> list[c.MenuItem]:
        """Действия над папкой — по правой кнопке прямо на её строке."""
        if not path:
            return [
                c.MenuItem(
                    "Создать папку",
                    lambda: create_folder(""),
                    icon=ft.Icons.CREATE_NEW_FOLDER_OUTLINED,
                )
            ]
        return [
            c.MenuItem(
                "Переименовать…",
                lambda: ask_rename_folder(path),
                icon=ft.Icons.EDIT_OUTLINED,
            ),
            c.MenuItem(
                "Создать вложенную…",
                lambda: create_folder(path),
                icon=ft.Icons.CREATE_NEW_FOLDER_OUTLINED,
            ),
            c.MenuItem(
                "Удалить папку…",
                lambda: delete_folder(path),
                icon=ft.Icons.DELETE_OUTLINE,
                danger=True,
            ),
        ]

    def troop_menu(name: str) -> list[c.MenuItem]:
        return [
            c.MenuItem("Открыть", lambda: go(name), icon=ft.Icons.OPEN_IN_NEW),
            c.MenuItem("Копировать", lambda: duplicate(name), icon=ft.Icons.CONTENT_COPY),
            c.MenuItem(
                "Удалить…", lambda: ask_remove(name), icon=ft.Icons.DELETE_OUTLINE, danger=True
            ),
        ]

    def ask_remove(name: str) -> None:
        places = app.materiel_usage(SECTION, name)
        if places:
            say(f"«{name}» стоит в составе: {', '.join(places[:3])}. Сначала уберите из состава.")
            return
        if len(troops) == 1:
            say("Это последний тип солдата — его нельзя удалить.")
            return
        dlg.confirm(
            app,
            f"Удалить «{troops[name].label}»?",
            "Тип исчезнет из библиотеки. Вернуть его можно только сбросом "
            "библиотеки к эталону.",
            confirm_label="Удалить",
            danger=True,
            on_confirm=lambda: remove(name),
        )

    def troop_row(name: str, *, last: bool) -> ft.Control:
        entry = troops[name]
        values = soldier(name, config)
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
                    lambda: ask_remove(name),
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
                    entry.label,
                    size=t.SIZE_ROW,
                    weight=t.W500 if name == selected else t.W400,
                    no_wrap=True,
                ),
                t.text(
                    config.gear_entry(entry.gear).label,
                    size=t.SIZE_META,
                    color=t.TEXT_3,
                    no_wrap=True,
                ),
                t.text(
                    config.weapon(entry.weapon).label,
                    size=t.SIZE_META,
                    color=t.TEXT_3,
                    no_wrap=True,
                ),
                t.text(
                    config.weapon(entry.secondary).label if entry.secondary else "—",
                    size=t.SIZE_META,
                    color=t.TEXT_3 if entry.secondary else t.TEXT_PLACEHOLDER,
                    no_wrap=True,
                ),
                t.num(str(entry.ammo)),
                t.num(f"{values.firepower:.0f}"),
                t.num(f"{values.anti_tank:.0f}"),
                actions,
            ],
            height=t.TABLE_ROW_TALL_H,
            bgcolor=t.ROW_EXPANDED if name == selected and not open_folder else None,
            last=last,
            on_click=lambda: go(name),
            menu=troop_menu(name),
        )

    rows: list[ft.Control] = []
    for path, folder_names in lib.folder_entries(troops, folders):
        if path or folder_names:
            rows.append(
                lib.folder_header(
                    path,
                    len(folder_names),
                    selected=bool(path) and path == open_folder,
                    on_click=(lambda p=path: go_folder(p)) if path else None,
                    menu=folder_menu(path),
                )
            )
        if not folder_names:
            if path:
                rows.append(c.empty_hint("Папка пуста."))
            continue
        rows.extend(
            troop_row(name, last=index == len(folder_names) - 1)
            for index, name in enumerate(folder_names)
        )

    body: ft.Control = (
        ft.Column(rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
        if names
        else c.empty_hint("Типов солдат пока нет — создайте первый.")
    )

    list_card = c.framed_card(
        f"Типы солдат · {len(names)}",
        ft.Column([c.table_head(COLUMNS), body], spacing=0, expand=True),
        trailing=[
            c.secondary_button(
                "Создать папку",
                lambda: create_folder(open_folder),
                icon=ft.Icons.CREATE_NEW_FOLDER_OUTLINED,
                height=t.BUTTON_SM_H,
            )
        ],
        footer=c.card_footer(
            [
                ft.Text(
                    "комплект солдата — блок в config/troops.yaml",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                )
            ]
        ),
        expand=True,
    )

    # -- карточка -----------------------------------------------------------
    def card_body(name: str) -> ft.Control:
        entry = troops[name]
        values = soldier(name, config)

        title_field, _ = c.text_field(
            entry.label,
            lambda value: set_field(name, "label", value),
            width=FIELD_W * 2 + t.GAP_IN,
        )
        weapon_options = [(key, item.label) for key, item in config.weapons.weapons.items()]
        gear_options = [(key, item.label) for key, item in config.gear.gear.items()]
        folder_options = lib.folder_options(folders)

        kit = c.flow(
            [
                c.labeled(
                    "Обмундирование",
                    c.select(
                        entry.gear,
                        gear_options,
                        lambda value: set_field(name, "gear", value),
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                ),
                c.labeled(
                    "Оружие",
                    c.select(
                        entry.weapon,
                        weapon_options,
                        lambda value: set_field(name, "weapon", value),
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                ),
                c.labeled(
                    "Доп. оружие",
                    c.select(
                        entry.secondary,
                        [("", "нет"), *weapon_options],
                        lambda value: set_field(name, "secondary", value),
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                ),
                c.labeled(
                    "Боекомплект · справочно",
                    c.number_field(
                        entry.ammo,
                        lambda value: set_field(name, "ammo", int(value)),
                        minimum=0,
                        maximum=1000,
                        integer=True,
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                ),
            ]
        )

        gear = config.gear_entry(entry.gear)
        computed = ft.Column(
            [
                c.kv_line("Огневая мощь", t.num(f"{values.firepower:.1f}", weight=t.W500)),
                c.kv_line("Противотанковая мощь", t.num(f"{values.anti_tank:.1f}", weight=t.W500)),
                c.kv_line("Защищённость", t.num(f"{values.protection:.0f}")),
                c.kv_line("Заметность", t.num(f"{gear.visibility:.0f}")),
                c.kv_line("Подвижность", t.num(f"{gear.mobility:.0f}")),
                c.kv_line("Усталость, ×", t.num(f"{gear.fatigue:g}")),
            ],
            spacing=0,
            tight=True,
        )

        places = app.materiel_usage(SECTION, name)
        in_units = ft.Column(
            [
                t.caption("В составе"),
                c.note(", ".join(places) if places else "нигде — тип можно удалить"),
            ],
            spacing=4,
            tight=True,
        )

        def section(title: str, content: ft.Control) -> ft.Control:
            return ft.Column(
                [
                    ft.Row(
                        [
                            t.caption(title),
                            ft.Container(height=1, bgcolor=t.BORDER_INNER, expand=True),
                        ],
                        spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    content,
                ],
                spacing=t.GAP_SM,
                tight=True,
            )

        return ft.Container(
            content=ft.Column(
                [
                    ft.Text(
                        f"ключ: {name}",
                        style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                    ),
                    c.labeled("Название", title_field, width=FIELD_W * 2 + t.GAP_IN),
                    c.labeled(
                        "Папка",
                        c.select(
                            entry.folder if entry.folder in known_folders else "",
                            folder_options,
                            lambda value: set_field(name, "folder", value),
                            width=FIELD_W,
                        ),
                        width=FIELD_W,
                    ),
                    section("Комплект", kit),
                    section("Что даёт подразделению", computed),
                    in_units,
                ],
                spacing=t.PAD_CARD,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            ),
            padding=t.PAD_CARD,
            expand=True,
        )

    if open_folder:
        inside = sum(
            1 for entry in troops.values() if folder_ops.is_inside(entry.folder or "", open_folder)
        )
        inside += sum(
            1
            for path in known_folders
            if path != open_folder and folder_ops.is_inside(path, open_folder)
        )
        detail = c.framed_card(
            lib.path_label(open_folder),
            lib.folder_card(
                open_folder,
                folders,
                inside=inside,
                on_rename=rename_folder,
                on_move=move_folder,
                on_delete=delete_folder,
            ),
            expand=True,
        )
    elif selected:
        detail = c.framed_card(troops[selected].label, card_body(selected), expand=True)
    else:
        detail = c.framed_card(
            "Тип солдата", c.empty_hint("Выберите тип в списке слева."), expand=True
        )

    # -- из чего складывается штат -----------------------------------------
    staffed = [
        (type_name, element_staff(type_name, config))
        for type_name in config.element_types.element_types
    ]
    staffed = [(name, summary) for name, summary in staffed if summary is not None]
    aside = aside_block(
        "Штат",
        [
            c.note(
                "Из состава типа элемента по этим карточкам считаются "
                "численность, огневая мощь и устойчивость подразделения.",
                size=t.SIZE_META,
            ),
            *[
                ft.Text(
                    f"{name}: {summary.personnel} чел., огонь {summary.attack:.0f}",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_3, height=1.5),
                )
                for name, summary in staffed[:6]
            ],
        ],
    )

    return screen(
        app,
        active="troops",
        active_child=selected,
        title="Сборка юнитов",
        subtitle="Типы солдат: кому что выдано",
        aside=aside,
        actions=[
            c.tertiary_button("Сбросить типы", reset_library, icon=ft.Icons.RESTORE),
            c.primary_button("Создать тип", create, icon=ft.Icons.ADD),
        ],
        body=ft.Column(
            [message, error_holder, c.columns(list_card, detail, right_width=420)],
            spacing=t.GAP_SM,
            expand=True,
        ),
    )
