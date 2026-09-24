"""Редактор отряда: шапка с параметрами, сводка строкой, боевой порядок деревом.

Живёт правой половиной экрана «Отряды» (:mod:`ui.views.units`): список слева,
выбранный отряд справа. Раньше это был отдельный экран, и чтобы перейти от
одного отряда к другому, надо было вернуться к списку и открыть следующий.

Правки сохраняются сразу и тут же пересчитывают сводку — это единственный
способ понять, что даёт правка. Одновременно раскрыта одна группа.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import flet as ft

from core import formation
from core.models import (
    COMMAND_ORDERS,
    ECHELON_ORDER,
    Battalion,
    Echelon,
    Element,
    Order,
    Side,
    VehicleGroup,
    new_id,
)
from core.samples import make_element
from core.storage import delete_file, write_json
from ui import theme as t
from ui.state import ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import dialogs as dlg
from ui.widgets import orbat as ob
from ui.widgets.battalion import type_label

ROUTE = ROUTES["unit"]

ECHELON_OPTIONS: tuple[tuple[str, str], ...] = tuple(
    (str(level), str(level)) for level in ECHELON_ORDER
)

#: `optional` — очередь на скрытие в узком окне: чем больше, тем раньше
#: колонка уходит. Имя, численность, приказ и «⋯» остаются всегда.
COLUMNS: tuple[c.Col, ...] = (
    c.Col("Группа", expand=True),
    c.Col("Тип", 130, optional=1),
    c.Col("Масштаб", 80, optional=3),
    c.Col("Л/с", 90, numeric=True),
    c.Col("Огн.", 60, numeric=True, optional=4),
    c.Col("Устойч.", 70, numeric=True, optional=5),
    c.Col("Опыт", 50, numeric=True, optional=6),
    c.Col("Мораль", 60, numeric=True, optional=2),
    c.Col("Приказ", 104, pad_left=14),
    c.Col("", 28),
)

#: Ширина списка отрядов слева от редактора.
LIST_W = 300

#: Поля группы в раскрытой панели: подпись, атрибут, диапазон, целое ли.
ELEMENT_FIELDS: tuple[tuple[str, str, float, float, bool], ...] = (
    ("Штат", "personnel_full", 0, 100000, True),
    ("В строю", "personnel_current", 0, 100000, True),
    ("Огневая мощь", "attack", 0, 100, False),
    ("Устойчивость", "defense", 0, 100, False),
    ("Опыт 1…4", "experience", 1, 4, True),
    ("Мораль", "morale", 0, 100, False),
    ("Слаженность", "cohesion", 0, 100, False),
    ("Готовность", "readiness", 0, 100, False),
    ("Боезапас %", "ammo", 0, 100, False),
    ("Топливо %", "fuel", 0, 100, False),
    ("Снаряжение %", "equipment", 0, 100, False),
    ("Усталость %", "fatigue", 0, 100, False),
)

#: Ширина числового поля в раскрытой группе.
FIELD_W = 118

#: Поля, скрываемые при выключенном тумблере (§4.5).
OPTIONAL_FIELDS = {
    "fuel": "fuel",
    "equipment": "equipment",
    "readiness": "readiness",
    "fatigue": "fatigue",
}


def build(app: AppState, unit_id: str) -> ft.View:
    """Прежний маршрут `/units/<id>` — тот же экран «Отряды» с выбранным отрядом."""
    from ui.views import units

    return units.build(app, unit_id=unit_id)


# --------------------------------------------------------------------------
# Действия над отрядом целиком — одни и те же в списке и в редакторе
# --------------------------------------------------------------------------
def unit_actions(
    app: AppState,
    path: Path,
    battalion: Battalion,
    *,
    on_changed: Callable[[str | None], None],
    with_battle: bool = True,
) -> list[c.MenuItem | None]:
    """Пункты меню отряда: «⋯» на строке списка и в шапке редактора.

    ``on_changed(id)`` — список надо перерисовать и выбрать этот отряд
    (``None`` — отряд удалён, выбрать какой-нибудь другой). В шапке
    редактора «В бой» — отдельная кнопка, поэтому там ``with_battle=False``.
    """

    def duplicate() -> None:
        copy = battalion.model_copy(deep=True)
        copy.id = new_id("bat")
        copy.name = f"{battalion.name} (копия)"
        app.save_unit(copy)
        app.notify(f"Скопирован «{battalion.name}»")
        on_changed(copy.id)

    def export() -> None:
        def write(directory: Path) -> None:
            target = write_json(
                directory / f"{path.stem}.json", battalion.model_dump(mode="json")
            )
            app.notify(f"Выгружено: {target}")

        app.ask_directory(f"Куда выгрузить «{battalion.name}»", write)

    def ask_remove() -> None:
        dlg.confirm(
            app,
            f"Удалить «{battalion.name}»?",
            f"Файл {path.name} будет удалён с диска. Отменить это нельзя — "
            "если отряд ещё понадобится, сначала выгрузите его в JSON.",
            confirm_label="Удалить",
            danger=True,
            on_confirm=remove,
        )

    def remove() -> None:
        delete_file(path)
        if app.open_unit and app.open_unit[0] == battalion.id:
            app.open_unit = None
        app.notify(f"Удалён «{battalion.name}»")
        on_changed(None)

    battle: list[c.MenuItem | None] = [
        c.MenuItem(
            "В бой стороной A",
            lambda: _use_in_battle(app, battalion, Side.A),
            icon=ft.Icons.MILITARY_TECH,
        ),
        c.MenuItem("В бой стороной B", lambda: _use_in_battle(app, battalion, Side.B)),
        c.MENU_DIVIDER,
    ]
    return [
        *(battle if with_battle else []),
        c.MenuItem("Копировать", duplicate, icon=ft.Icons.CONTENT_COPY),
        c.MenuItem("Выгрузить JSON", export, icon=ft.Icons.DOWNLOAD_OUTLINED),
        c.MENU_DIVIDER,
        c.MenuItem("Удалить…", ask_remove, icon=ft.Icons.DELETE_OUTLINE, danger=True),
    ]


def _use_in_battle(app: AppState, battalion: Battalion, side: Side) -> None:
    """Поставить подразделение в текущий сценарий выбранной стороной."""
    copy = battalion.model_copy(deep=True)
    copy.side = side
    if side == Side.A:
        app.scenario.battalion_a = copy
    else:
        app.scenario.battalion_b = copy
    app.engine = None
    app.notify(f"«{battalion.name}» назначен стороной {side}")
    app.go(ROUTES["battle_setup"])


# --------------------------------------------------------------------------
# Редактор
# --------------------------------------------------------------------------
def editor_pane(
    app: AppState,
    unit_path: Path,
    battalion: Battalion,
    *,
    on_changed: Callable[[str | None], None],
    available: int,
) -> ft.Control:
    """Редактор одного отряда.

    ``on_changed`` зовётся после сохранения, чтобы список слева показал
    новое имя и численность; ``available`` — ширина под таблицу групп.
    """
    config = app.config
    toggles = config.tog
    app.open_unit = (battalion.id, battalion.name)

    table = c.Table.fit(COLUMNS, available)
    stats_holder = ft.Container()
    elements_holder = ft.Column(spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
    count_holder = ft.Container()
    error_holder = ft.Container()

    # -- сохранение и перерисовка -------------------------------------------
    def save_and_refresh() -> None:
        app.save_unit(battalion)
        stats_holder.content = stats()
        elements_holder.controls = element_rows()
        count_holder.content = t.card_title(f"Боевой порядок · групп {len(battalion.elements)}")
        app.refresh(stats_holder, elements_holder, count_holder)

    def save_and_tell_list() -> None:
        """Имя и численность видны в списке — его тоже надо обновить."""
        save_and_refresh()
        on_changed(battalion.id)

    def show_error(message: str) -> None:
        error_holder.content = ft.Container(
            content=c.error_banner(message), margin=ft.Margin.only(bottom=t.GAP)
        )
        app.refresh(error_holder)

    def clear_error() -> None:
        if error_holder.content is not None:
            error_holder.content = None
            app.refresh(error_holder)

    def set_element(element: Element, attribute: str, value: object) -> None:
        previous = getattr(element, attribute)
        try:
            setattr(element, attribute, value)
        except ValueError as error:
            show_error(str(error).splitlines()[0])
            setattr(element, attribute, previous)
            return
        clear_error()
        save_and_tell_list()

    def set_battalion(attribute: str, value: object) -> None:
        setattr(battalion, attribute, value)
        save_and_tell_list()

    def toggle_expanded(element: Element) -> None:
        app.expanded_element = None if app.expanded_element == element.id else element.id
        elements_holder.controls = element_rows()
        app.refresh(elements_holder)

    # -- группы ---------------------------------------------------------------
    def add_element(type_name: str) -> None:
        entry = config.element_type(type_name)
        taken = {item.name for item in battalion.elements}
        name, index = entry.label, 2
        while name in taken:
            name, index = f"{entry.label} {index}", index + 1
        element = make_element(type_name, name, new_id(type_name), config)
        battalion.elements = [*battalion.elements, element]
        app.expanded_element = element.id
        save_and_tell_list()

    def ask_remove_element(element: Element) -> None:
        children = len(battalion.children_of(element.id))
        dlg.confirm(
            app,
            f"Удалить «{element.name}»?",
            (
                f"Подгрупп внутри: {children} — они поднимутся на место "
                "удалённой, как содержимое удалённой папки."
            )
            if children
            else "Группа исчезнет из боевого порядка.",
            confirm_label="Удалить",
            danger=True,
            on_confirm=lambda: remove_element(element),
        )

    def remove_element(element: Element) -> None:
        # Подгруппы не теряются вместе с родителем: они поднимаются на его
        # место, как содержимое удалённой папки в библиотеках.
        for child in battalion.children_of(element.id):
            child.parent = element.parent
        battalion.elements = [item for item in battalion.elements if item.id != element.id]
        if app.expanded_element == element.id:
            app.expanded_element = None
        save_and_tell_list()

    def add_vehicles(element: Element) -> None:
        element.vehicles = [
            *element.vehicles,
            VehicleGroup(vehicle_type="Техника", count_full=4, count_current=4),
        ]
        save_and_tell_list()

    def remove_vehicles(element: Element, group: VehicleGroup) -> None:
        element.vehicles = [item for item in element.vehicles if item is not group]
        save_and_tell_list()

    def set_vehicle(group: VehicleGroup, attribute: str, value: object) -> None:
        previous = getattr(group, attribute)
        try:
            setattr(group, attribute, value)
        except ValueError as error:
            show_error(str(error).splitlines()[0])
            setattr(group, attribute, previous)
            return
        clear_error()
        save_and_tell_list()

    def reshape(work: Callable[[], None]) -> None:
        """Перестроение с понятным отказом вместо падения."""
        try:
            work()
        except formation.FormationError as error:
            show_error(str(error))
            return
        clear_error()
        save_and_tell_list()

    def split_element(element: Element) -> None:
        """Деление — через окно с долями: видно, что достанется каждой части."""

        def apply_split(parts: int, shares: list[float]) -> None:
            app.split_parts = parts

            def work() -> None:
                children = formation.split(battalion, element.id, parts, shares=shares)
                app.expanded_element = children[0].id

            reshape(work)

        dlg.split_group(app, element, on_split=apply_split, parts=app.split_parts)

    def detach_element(element: Element) -> None:
        def work() -> None:
            children = formation.detach_vehicles(battalion, element.id, config)
            app.expanded_element = children[-1].id

        reshape(work)

    def merge_element(element: Element) -> None:
        reshape(lambda: formation.merge(battalion, element.id))

    def reassign_element(element: Element, parent_id: str) -> None:
        reshape(lambda: formation.reassign(battalion, element.id, parent_id or None))

    def element_menu(element: Element) -> list[c.MenuItem | None]:
        """Что можно сделать с группой — на её строке, «⋯» и правой кнопкой."""
        items: list[c.MenuItem | None] = [
            c.MenuItem(
                "Свернуть" if app.expanded_element == element.id else "Править",
                lambda: toggle_expanded(element),
                icon=ft.Icons.TUNE,
            ),
            c.MENU_DIVIDER,
            c.MenuItem("Разделить…", lambda: split_element(element), icon=ft.Icons.CALL_SPLIT),
        ]
        if element.has_vehicles:
            items.append(
                c.MenuItem(
                    "Отделить технику",
                    lambda: detach_element(element),
                    icon=ft.Icons.LOCAL_SHIPPING_OUTLINED,
                )
            )
        if battalion.children_of(element.id):
            items.append(
                c.MenuItem("Свести подгруппы", lambda: merge_element(element), icon=ft.Icons.MERGE)
            )
        items.append(
            c.MenuItem("Добавить технику", lambda: add_vehicles(element), icon=ft.Icons.ADD)
        )
        items.extend(
            [
                c.MENU_DIVIDER,
                c.MenuItem(
                    "Удалить…",
                    lambda: ask_remove_element(element),
                    icon=ft.Icons.DELETE_OUTLINE,
                    danger=True,
                ),
            ]
        )
        return items

    def parent_options(element: Element) -> list[tuple[str, str]]:
        """Кому группу можно подчинить: всем, кроме себя и своих подгрупп."""
        forbidden = {item.id for item in battalion.subtree(element.id)}
        return [
            ("", "самостоятельная"),
            *[
                (item.id, item.name)
                for item in battalion.ordered_elements
                if item.id not in forbidden
            ],
        ]

    # -- раскрытая группа -----------------------------------------------------
    def expanded_panel(element: Element) -> ft.Control:
        """Правка группы: кто она, сколько в ней людей и в каком состоянии.

        Подписи стоят над каждым полем: раньше пять выпадающих списков в
        шапке панели шли без подписей, и понять, какой из них «подчинена»,
        а какой «приказ», можно было только раскрыв каждый.
        """
        identity = c.flow(
            [
                c.labeled(
                    "Название",
                    c.text_field(
                        element.name,
                        lambda value, e=element: set_element(e, "name", value),
                        width=210,
                        nested=True,
                    )[0],
                    width=210,
                ),
                c.labeled(
                    "Тип",
                    c.select(
                        element.type,
                        [
                            (key, entry.label)
                            for key, entry in sorted(config.element_types.element_types.items())
                        ],
                        lambda value, e=element: set_element(e, "type", value),
                        width=190,
                        nested=True,
                    ),
                    width=190,
                ),
                c.labeled(
                    "Ступень",
                    c.select(
                        str(element.echelon),
                        ECHELON_OPTIONS,
                        lambda value, e=element: set_element(e, "echelon", Echelon(value)),
                        width=148,
                        nested=True,
                    ),
                    width=148,
                ),
                c.labeled(
                    "Подчинена",
                    c.select(
                        element.parent or "",
                        parent_options(element),
                        lambda value, e=element: reassign_element(e, value),
                        width=180,
                        nested=True,
                    ),
                    width=180,
                ),
                c.labeled(
                    "Приказ",
                    c.select(
                        str(element.order or ""),
                        [("", "как у отряда"), *[(str(o), str(o)) for o in COMMAND_ORDERS]],
                        lambda value, e=element: set_element(
                            e, "order", Order(value) if value else None
                        ),
                        width=160,
                        nested=True,
                    ),
                    width=160,
                ),
            ],
            spacing=t.GAP_SM,
        )

        fields: list[ft.Control] = []
        for label, attribute, minimum, maximum, integer in ELEMENT_FIELDS:
            toggle_name = OPTIONAL_FIELDS.get(attribute)
            if toggle_name and not getattr(toggles, toggle_name):
                continue
            fields.append(
                c.labeled(
                    label,
                    c.number_field(
                        float(getattr(element, attribute)),
                        lambda value, e=element, a=attribute: set_element(e, a, value),
                        minimum=minimum,
                        maximum=maximum,
                        integer=integer,
                        nested=True,
                        width=FIELD_W,
                    ),
                    width=FIELD_W,
                )
            )

        parts: list[ft.Control] = [identity, c.flow(fields, spacing=t.GAP_SM)]

        if element.vehicles:
            vehicle_rows: list[ft.Control] = [t.caption("Техника группы")]
            for group in element.vehicles:
                cells: list[ft.Control] = [
                    c.text_field(
                        group.vehicle_type,
                        lambda value, g=group: set_vehicle(g, "vehicle_type", value),
                        width=150,
                        nested=True,
                    )[0],
                    c.labeled(
                        "По штату",
                        c.number_field(
                            group.count_full,
                            lambda value, g=group: set_vehicle(g, "count_full", int(value)),
                            minimum=0,
                            maximum=10000,
                            integer=True,
                            width=90,
                            nested=True,
                        ),
                        width=90,
                    ),
                    c.labeled(
                        "В строю",
                        c.number_field(
                            group.count_current,
                            lambda value, g=group: set_vehicle(g, "count_current", int(value)),
                            minimum=0,
                            maximum=10000,
                            integer=True,
                            width=90,
                            nested=True,
                        ),
                        width=90,
                    ),
                ]
                if toggles.vehicle_condition:
                    cells.append(
                        c.labeled(
                            "Состояние",
                            c.number_field(
                                group.condition,
                                lambda value, g=group: set_vehicle(g, "condition", value),
                                minimum=0,
                                maximum=100,
                                width=90,
                                nested=True,
                            ),
                            width=90,
                        )
                    )
                cells.append(
                    c.icon_button(
                        ft.Icons.DELETE_OUTLINE,
                        lambda e=element, g=group: remove_vehicles(e, g),
                        size=t.BUTTON_XS_H,
                        icon_size=15,
                        color=t.LOSS,
                        tooltip="Убрать эту технику из группы",
                        bordered=False,
                    )
                )
                vehicle_rows.append(
                    ft.Row(cells, spacing=t.GAP_SM, vertical_alignment=ft.CrossAxisAlignment.END)
                )
            parts.append(
                ft.Container(
                    content=ft.Column(vehicle_rows, spacing=8, tight=True),
                    padding=ft.Padding.only(top=10),
                    border=t.border_top(t.BORDER_INNER),
                )
            )

        return ft.Container(
            content=ft.Column(parts, spacing=t.GAP_IN, tight=True),
            bgcolor=t.SURFACE_ALT,
            padding=ft.Padding.symmetric(vertical=14, horizontal=t.PAD_ROW_X),
            border=t.border_bottom(t.BORDER),
        )

    def element_rows() -> list[ft.Control]:
        if not battalion.elements:
            return [
                c.empty_state(
                    "В отряде пока нет групп",
                    "Добавьте группу нужного типа — числа посчитаются по её составу.",
                    icon=ft.Icons.GROUPS_OUTLINED,
                    action=add_group_menu(),
                )
            ]
        rows: list[ft.Control] = []
        ordered = battalion.ordered_elements
        for index, element in enumerate(ordered):
            expanded = app.expanded_element == element.id
            last = index == len(ordered) - 1
            children = len(battalion.children_of(element.id))
            roll = battalion.rollup(element.id)
            menu = element_menu(element)
            rows.append(
                table.row(
                    [
                        ft.Row(
                            [
                                ft.Container(width=battalion.depth_of(element) * ob.INDENT),
                                t.text(
                                    element.name,
                                    size=t.SIZE_ROW,
                                    weight=t.W600 if expanded or children else t.W400,
                                    no_wrap=True,
                                ),
                                ft.Text(
                                    f"из {children}",
                                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                                )
                                if children
                                else ft.Container(width=0),
                            ],
                            spacing=6,
                            tight=True,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        t.text(
                            type_label(element, config),
                            size=t.SIZE_META,
                            color=t.TEXT_3,
                            no_wrap=True,
                        ),
                        t.text(str(element.echelon), size=t.SIZE_META, color=t.TEXT_3),
                        c.fraction(roll.personnel_current, roll.personnel_full),
                        # У старшей группы собственные огонь и устойчивость в
                        # расчёт не идут — дерутся подгруппы, а не она.
                        t.num(f"{element.attack:.0f}") if not children else c.dash(),
                        t.num(f"{element.defense:.0f}") if not children else c.dash(),
                        t.num(str(element.experience)) if not children else c.dash(),
                        t.num(f"{roll.morale:.0f}" if children else f"{element.morale:.0f}"),
                        t.text(
                            str(battalion.order_for(element)),
                            size=t.SIZE_META,
                            color=t.TEXT_3,
                            no_wrap=True,
                        ),
                        c.row_menu(menu),
                    ],
                    height=t.TABLE_ROW_H + 4,
                    bgcolor=t.ROW_EXPANDED if expanded else None,
                    last=last and not expanded,
                    on_click=lambda e=element: toggle_expanded(e),
                    menu=menu,
                )
            )
            if expanded:
                rows.append(expanded_panel(element))
        return rows

    def add_group_menu() -> ft.Control:
        return c.create_menu(
            "Добавить группу",
            [
                c.MenuItem(entry.label, lambda key=key: add_element(key))
                for key, entry in sorted(
                    config.element_types.element_types.items(), key=lambda item: item[1].label
                )
            ],
            primary=False,
            height=t.BUTTON_SM_H,
        )

    # -- шапка отряда ---------------------------------------------------------
    def stats() -> ft.Control:
        summary = battalion.summary()
        return c.stat_strip(
            [
                ("Групп в бою", f"{summary['elements']} из {len(battalion.leaf_elements)}"),
                ("Л/с", str(battalion.personnel_current)),
                ("Техника", str(battalion.vehicles_current)),
                ("Мораль", f"{summary['morale']:.0f}"),
                ("Опыт", f"{summary['experience']:.1f}"),
                ("Организация", f"{summary['organisation']:.0f}"),
            ]
        )

    fields: list[ft.Control] = [
        c.labeled(
            "Масштаб отряда",
            c.select(
                str(battalion.scale),
                ECHELON_OPTIONS,
                lambda value: set_battalion("scale", Echelon(value)),
                width=140,
            ),
            width=140,
        ),
        c.labeled(
            "Приказ отряда",
            c.select(
                str(battalion.order),
                [(str(order), str(order)) for order in COMMAND_ORDERS],
                lambda value: set_battalion("order", Order(value)),
                width=160,
            ),
            width=160,
        ),
        c.labeled(
            "Связь, %",
            c.number_field(
                battalion.communications,
                lambda value: set_battalion("communications", value),
                minimum=0,
                maximum=100,
                width=100,
            ),
            width=100,
        ),
    ]
    if toggles.commander_influence:
        fields.append(
            c.labeled(
                "Командир, 0…100",
                c.number_field(
                    battalion.commander_influence,
                    lambda value: set_battalion("commander_influence", value),
                    minimum=0,
                    maximum=100,
                    width=120,
                ),
                width=120,
            )
        )
    fields.append(
        c.labeled(
            "Задача боя",
            c.text_field(
                battalion.task,
                lambda value: set_battalion("task", value),
                placeholder="не задана",
                width=260,
            )[0],
            width=260,
        )
    )

    name_field, _ = c.text_field(
        battalion.name,
        lambda value: set_battalion("name", value),
        expand=True,
    )

    header = c.card(
        [
            ft.Row(
                [
                    name_field,
                    c.create_menu(
                        "В бой",
                        [
                            c.MenuItem(
                                "Стороной A",
                                lambda: _use_in_battle(app, battalion, Side.A),
                                icon=ft.Icons.MILITARY_TECH,
                            ),
                            c.MenuItem(
                                "Стороной B", lambda: _use_in_battle(app, battalion, Side.B)
                            ),
                        ],
                        icon=ft.Icons.SHIELD_OUTLINED,
                        primary=False,
                    ),
                    c.more_menu(
                        unit_actions(
                            app, unit_path, battalion, on_changed=on_changed, with_battle=False
                        )
                    ),
                ],
                spacing=t.GAP_SM,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            c.flow(fields, spacing=12),
            c.divider(vertical_margin=4),
            stats_holder,
        ],
        spacing=t.GAP_IN,
    )

    count_holder.content = t.card_title(f"Боевой порядок · групп {len(battalion.elements)}")
    stats_holder.content = stats()
    elements_holder.controls = element_rows()

    elements_card = ft.Container(
        content=ft.Column(
            [
                ft.Container(
                    content=ft.Row(
                        [count_holder, c.spacer(), add_group_menu()],
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    height=t.CARD_HEADER_H,
                    padding=ft.Padding.symmetric(horizontal=t.PAD_CARD),
                    border=t.border_bottom(t.BORDER),
                ),
                table.head(),
                elements_holder,
            ],
            spacing=0,
            expand=True,
        ),
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
        expand=True,
    )

    # Пустое место под ошибку не должно сдвигать редактор ниже списка слева:
    # отступ у самой ошибки, а не промежуток колонки.
    return ft.Column(
        [
            error_holder,
            ft.Container(content=header, margin=ft.Margin.only(bottom=t.GAP)),
            elements_card,
        ],
        spacing=0,
        expand=True,
    )
