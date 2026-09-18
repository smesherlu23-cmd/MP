"""Конструктор подразделения: элементы строками, сводка справа.

Одновременно раскрыт один элемент. Правки сохраняются сразу и тут же
пересчитывают сводку — это единственный способ понять, что даёт правка.
"""

from __future__ import annotations

import flet as ft

from core.models import Battalion, Element, Order, Side, VehicleGroup, new_id
from core.samples import make_element
from ui import theme as t
from ui.shell import aside_block, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c
from ui.widgets.battalion import summary_card, type_label

ROUTE = ROUTES["unit"]

COLUMNS: tuple[c.Col, ...] = (
    c.Col("Элемент", expand=True),
    c.Col("Тип", 150),
    c.Col("Л/с", 90, numeric=True),
    c.Col("Огн.", 70, numeric=True),
    c.Col("Устойч.", 80, numeric=True),
    c.Col("Опыт", 60, numeric=True),
    c.Col("Мораль", 70, numeric=True),
    c.Col("Приказ", 110, pad_left=14),
    c.Col("", 28),
)

#: Поля элемента в раскрытой панели: подпись, атрибут, диапазон, целое ли.
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

#: Ширина поля «задача боя»: в строке с переносом у ребёнка обязана быть
#: своя ширина, иначе Flet рисует серый прямоугольник вместо содержимого.
TASK_FIELD_W = 300

#: Поля, скрываемые при выключенном тумблере (§4.5).
OPTIONAL_FIELDS = {
    "fuel": "fuel",
    "equipment": "equipment",
    "readiness": "readiness",
    "fatigue": "fatigue",
}


def build(app: AppState, unit_id: str) -> ft.View:
    found = app.unit(unit_id)
    if found is None:
        return screen(
            app,
            active="units",
            title="Подразделение не найдено",
            subtitle=f"«{unit_id}» отсутствует в data/units",
            body=c.empty_hint("Выберите батальон в списке подразделений."),
        )

    _, battalion = found
    app.open_unit = (battalion.id, battalion.name)
    config = app.config
    toggles = config.tog

    summary_holder = ft.Container()
    elements_holder = ft.Column(spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
    error_holder = ft.Container()

    def save_and_refresh() -> None:
        app.save_unit(battalion)
        summary_holder.content = summary_card(battalion, config, side=str(battalion.side))
        elements_holder.controls = element_rows()
        app.refresh(summary_holder, elements_holder)

    def show_error(message: str) -> None:
        error_holder.content = c.error_banner(message)
        app.refresh(error_holder)

    def clear_error() -> None:
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
        save_and_refresh()

    def set_battalion(attribute: str, value: object) -> None:
        setattr(battalion, attribute, value)
        save_and_refresh()

    def toggle_expanded(element: Element) -> None:
        app.expanded_element = None if app.expanded_element == element.id else element.id
        elements_holder.controls = element_rows()
        app.refresh(elements_holder)

    def add_element(type_name: str) -> None:
        entry = config.element_type(type_name)
        element = make_element(type_name, entry.label, new_id(type_name), config)
        battalion.elements = [*battalion.elements, element]
        app.expanded_element = element.id
        save_and_refresh()

    def remove_element(element: Element) -> None:
        battalion.elements = [item for item in battalion.elements if item.id != element.id]
        if app.expanded_element == element.id:
            app.expanded_element = None
        save_and_refresh()

    def add_vehicles(element: Element) -> None:
        element.vehicles = [
            *element.vehicles,
            VehicleGroup(vehicle_type="Техника", count_full=4, count_current=4),
        ]
        save_and_refresh()

    def set_vehicle(group: VehicleGroup, attribute: str, value: object) -> None:
        previous = getattr(group, attribute)
        try:
            setattr(group, attribute, value)
        except ValueError as error:
            show_error(str(error).splitlines()[0])
            setattr(group, attribute, previous)
            return
        clear_error()
        save_and_refresh()

    def remove_vehicles(element: Element, group: VehicleGroup) -> None:
        element.vehicles = [item for item in element.vehicles if item is not group]
        save_and_refresh()

    # -- раскрытая панель элемента -----------------------------------------
    def expanded_panel(element: Element) -> ft.Control:
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
                        width=146,
                    ),
                    width=146,
                )
            )

        vehicles: list[ft.Control] = []
        for group in element.vehicles:
            row: list[ft.Control] = [
                ft.Container(content=t.caption("Техника"), width=80),
                c.text_field(
                    group.vehicle_type,
                    lambda value, g=group: set_vehicle(g, "vehicle_type", value),
                    width=130,
                    nested=True,
                )[0],
                ft.Text(
                    f"по штату {group.count_full} · в строю {group.count_current}"
                    f" · состояние {group.condition:.0f}",
                    style=t.mono(size=t.SIZE_ROW, color=t.TEXT_3),
                    expand=True,
                ),
                c.number_field(
                    group.count_full,
                    lambda value, g=group: set_vehicle(g, "count_full", int(value)),
                    minimum=0,
                    maximum=10000,
                    integer=True,
                    width=90,
                    nested=True,
                ),
                c.number_field(
                    group.count_current,
                    lambda value, g=group: set_vehicle(g, "count_current", int(value)),
                    minimum=0,
                    maximum=10000,
                    integer=True,
                    width=90,
                    nested=True,
                ),
            ]
            if toggles.vehicle_condition:
                row.append(
                    c.number_field(
                        group.condition,
                        lambda value, g=group: set_vehicle(g, "condition", value),
                        minimum=0,
                        maximum=100,
                        width=90,
                        nested=True,
                    )
                )
            row.append(
                c.icon_button(
                    ft.Icons.DELETE_OUTLINE,
                    lambda e=element, g=group: remove_vehicles(e, g),
                    size=t.BUTTON_XS_H,
                    icon_size=15,
                    color=t.LOSS,
                    tooltip="Убрать группу техники",
                )
            )
            vehicles.append(
                ft.Row(
                    row,
                    spacing=t.GAP_SM,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                )
            )

        controls_row = ft.Row(
            [
                c.secondary_button(
                    "Добавить технику",
                    lambda e=element: add_vehicles(e),
                    icon=ft.Icons.ADD,
                    height=t.BUTTON_SM_H,
                ),
                c.spacer(),
                c.tertiary_button(
                    "Удалить элемент",
                    lambda e=element: remove_element(e),
                    icon=ft.Icons.DELETE_OUTLINE,
                    color=t.LOSS,
                    height=t.BUTTON_SM_H,
                ),
            ],
            spacing=t.GAP_SM,
        )

        head = ft.Row(
            [
                c.text_field(
                    element.name,
                    lambda value, e=element: set_element(e, "name", value),
                    width=230,
                    nested=True,
                )[0],
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
                c.select(
                    str(element.order or ""),
                    [("", "как у батальона"), *[(str(o), str(o)) for o in Order]],
                    lambda value, e=element: set_element(
                        e, "order", Order(value) if value else None
                    ),
                    width=180,
                    nested=True,
                ),
            ],
            spacing=t.GAP_SM,
            wrap=True,
            run_spacing=t.GAP_SM,
        )

        return ft.Container(
            content=ft.Column(
                [
                    head,
                    c.flow(fields, spacing=t.GAP_IN),
                    ft.Container(
                        content=ft.Column(vehicles, spacing=6, tight=True),
                        padding=ft.Padding.only(top=10),
                        border=t.border_top(t.BORDER_INNER),
                    )
                    if vehicles
                    else ft.Container(height=0),
                    controls_row,
                ],
                spacing=t.GAP_IN,
                tight=True,
            ),
            bgcolor=t.SURFACE_ALT,
            padding=ft.Padding.symmetric(vertical=14, horizontal=16),
            border=t.border_bottom(t.BORDER),
        )

    def element_rows() -> list[ft.Control]:
        if not battalion.elements:
            return [c.empty_hint("В батальоне нет элементов — добавьте из шаблонов.")]
        rows: list[ft.Control] = []
        for index, element in enumerate(battalion.elements):
            expanded = app.expanded_element == element.id
            last = index == len(battalion.elements) - 1
            rows.append(
                c.table_row(
                    COLUMNS,
                    [
                        t.text(
                            element.name,
                            size=t.SIZE_ROW,
                            weight=t.W600 if expanded else t.W400,
                        ),
                        t.text(type_label(element, config), size=t.SIZE_META, color=t.TEXT_3),
                        c.fraction(element.personnel_current, element.personnel_full),
                        t.num(f"{element.attack:.0f}"),
                        t.num(f"{element.defense:.0f}"),
                        t.num(str(element.experience)),
                        t.num(f"{element.morale:.0f}"),
                        t.text(str(battalion.order_for(element)), size=t.SIZE_META, color=t.TEXT_3),
                        ft.Icon(
                            ft.Icons.EXPAND_LESS if expanded else ft.Icons.EXPAND_MORE,
                            size=16,
                            color=t.TEXT_2 if expanded else t.TEXT_MUTED,
                        ),
                    ],
                    height=t.TABLE_ROW_H + 2,
                    bgcolor=t.ROW_EXPANDED if expanded else None,
                    last=last and not expanded,
                    on_click=lambda e=element: toggle_expanded(e),
                )
            )
            if expanded:
                rows.append(expanded_panel(element))
        return rows

    # -- карточка батальона -------------------------------------------------
    battalion_fields: list[ft.Control] = [
        c.labeled(
            "Название",
            c.text_field(
                battalion.name,
                lambda value: set_battalion("name", value),
                width=250,
            )[0],
            width=250,
        ),
        c.labeled(
            "Сторона",
            c.select(
                str(battalion.side),
                [(str(side), str(side)) for side in Side],
                lambda value: set_battalion("side", Side(value)),
                width=100,
            ),
            width=100,
        ),
        c.labeled(
            "Приказ батальона",
            c.select(
                str(battalion.order),
                [(str(order), str(order)) for order in Order],
                lambda value: set_battalion("order", Order(value)),
                width=170,
            ),
            width=170,
        ),
        c.labeled(
            "Связь, %",
            c.number_field(
                battalion.communications,
                lambda value: set_battalion("communications", value),
                minimum=0,
                maximum=100,
                width=110,
            ),
            width=110,
        ),
    ]
    if toggles.commander_influence:
        battalion_fields.append(
            c.labeled(
                "Командир, 0…100",
                c.number_field(
                    battalion.commander_influence,
                    lambda value: set_battalion("commander_influence", value),
                    minimum=0,
                    maximum=100,
                    width=150,
                ),
                width=150,
            )
        )
    battalion_fields.append(
        c.labeled(
            "Задача боя",
            c.text_field(
                battalion.task,
                lambda value: set_battalion("task", value),
                placeholder="не задана",
                width=TASK_FIELD_W,
            )[0],
            width=TASK_FIELD_W,
        )
    )

    templates_menu = c.secondary_button(
        "Добавить из шаблона",
        lambda: toggle_templates(),
        icon=ft.Icons.ADD,
        height=t.BUTTON_SM_H,
    )
    templates_row = ft.Container(visible=False)

    def toggle_templates() -> None:
        templates_row.visible = not templates_row.visible
        app.refresh(templates_row)

    templates_row.content = ft.Container(
        content=c.flow(
            [
                c.chip(entry.label, lambda key=key: add_element(key))
                for key, entry in sorted(config.element_types.element_types.items())
            ],
            spacing=t.GAP_SM,
        ),
        padding=ft.Padding.symmetric(vertical=10, horizontal=t.PAD_CARD),
        bgcolor=t.SURFACE_ALT,
        border=t.border_bottom(t.BORDER),
    )

    save_and_refresh()

    elements_card = c.framed_card(
        f"Элементы · {len(battalion.elements)}",
        ft.Column(
            [templates_row, c.table_head(COLUMNS), elements_holder],
            spacing=0,
            expand=True,
        ),
        trailing=[templates_menu],
        expand=True,
    )

    left = ft.Column(
        [
            error_holder,
            c.card([t.card_title("Батальон"), c.flow(battalion_fields, spacing=12)]),
            elements_card,
        ],
        spacing=t.GAP,
        expand=True,
    )

    right = c.card(
        [
            summary_holder,
            c.divider(),
            ft.Row(
                [
                    c.secondary_button("Копировать", lambda: None, height=32, expand=True),
                    c.secondary_button("Экспорт", lambda: None, height=32, expand=True),
                ],
                spacing=t.GAP_SM,
            ),
        ],
        expand=True,
    )

    return screen(
        app,
        active="units",
        active_child=battalion.id,
        title=battalion.name,
        subtitle=(
            f"{len(battalion.elements)} элементов · {battalion.personnel_current} чел."
            f" · техники {battalion.vehicles_current}"
        ),
        mono_subtitle=True,
        actions=[
            c.secondary_button("В бой стороной B", lambda: _use_in_battle(app, battalion, Side.B)),
            c.primary_button(
                "В бой стороной A",
                lambda: _use_in_battle(app, battalion, Side.A),
                icon=ft.Icons.MILITARY_TECH,
            ),
        ],
        aside=aside_block(
            "Правки",
            [c.note("Сохраняются сразу и тут же видны в сводке справа.", size=t.SIZE_META)],
        ),
        body=c.columns(left, right, right_width=330),
    )


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
