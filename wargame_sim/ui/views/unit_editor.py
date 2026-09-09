"""Конструктор подразделения: дерево элементов, правка всех полей, сводка."""

from __future__ import annotations

import flet as ft

from core.models import Battalion, Element, Order, Side, VehicleGroup, new_id
from core.samples import make_element
from ui.state import ROUTES, AppState
from ui.widgets.battalion import battalion_summary
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    choice,
    empty_hint,
    error_banner,
    link_button,
    number_field,
    page_title,
    text_button,
    text_input,
)

ROUTE = ROUTES["unit"]

#: Поля элемента: подпись, атрибут, диапазон, целое ли, пояснение.
ELEMENT_FIELDS: tuple[tuple[str, str, float, float, bool, str], ...] = (
    ("Штатная численность", "personnel_full", 0, 100000, True, "человек по штату"),
    ("В строю", "personnel_current", 0, 100000, True, "не больше штата"),
    ("Огневая мощь", "attack", 0, 100, False, "базовая, 0…100"),
    ("Устойчивость", "defense", 0, 100, False, "базовая, 0…100"),
    ("Опыт", "experience", 1, 4, True, "1 — новобранцы, 4 — ветераны"),
    ("Мораль", "morale", 0, 100, False, ""),
    ("Слаженность", "cohesion", 0, 100, False, "связь внутри элемента, %"),
    ("Готовность", "readiness", 0, 100, False, ""),
    ("Боезапас", "ammo", 0, 100, False, "%"),
    ("Топливо", "fuel", 0, 100, False, "%"),
    ("Снаряжение", "equipment", 0, 100, False, "%"),
    ("Усталость", "fatigue", 0, 100, False, "%"),
)

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
        return ft.View(
            route=ROUTE.format(id=unit_id),
            controls=[
                page_title("Подразделение не найдено"),
                error_banner(f"Подразделение «{unit_id}» отсутствует в data/units."),
                link_button(
                "К списку", ROUTES["units"], app.go, icon=ft.Icons.ARROW_BACK),
            ],
            padding=PAD,
        )

    _, battalion = found
    config = app.config
    toggles = config.tog
    summary_holder = ft.Container(content=battalion_summary(battalion), expand=True)
    elements_holder = ft.Column(spacing=GAP, tight=True)
    error_holder = ft.Container()

    def save_and_refresh() -> None:
        """Сохранить правку и сразу отразить её в сводке батальона (§10)."""
        app.save_unit(battalion)
        summary_holder.content = battalion_summary(battalion)
        elements_holder.controls = element_tiles()
        app.refresh(summary_holder, elements_holder)

    def show_error(message: str) -> None:
        error_holder.content = error_banner(message)
        app.refresh(error_holder)

    def clear_error() -> None:
        error_holder.content = None
        app.refresh(error_holder)

    def set_element_field(element: Element, attribute: str, value: float) -> None:
        previous = getattr(element, attribute)
        try:
            setattr(element, attribute, value)
        except ValueError as error:
            show_error(str(error).splitlines()[0])
            setattr(element, attribute, previous)
            return
        clear_error()
        save_and_refresh()

    def set_battalion_field(attribute: str, value) -> None:
        setattr(battalion, attribute, value)
        save_and_refresh()

    def add_element(type_name: str) -> None:
        entry = config.element_type(type_name)
        element = make_element(
            type_name,
            entry.label,
            new_id(type_name),
            config,
        )
        battalion.elements = [*battalion.elements, element]
        save_and_refresh()

    def remove_element(element: Element) -> None:
        battalion.elements = [item for item in battalion.elements if item.id != element.id]
        save_and_refresh()

    def add_vehicles(element: Element) -> None:
        element.vehicles = [
            *element.vehicles,
            VehicleGroup(vehicle_type="Техника", count_full=4, count_current=4),
        ]
        save_and_refresh()

    def set_vehicle_field(group: VehicleGroup, attribute: str, value: float) -> None:
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

    def element_fields(element: Element) -> list[ft.Control]:
        fields: list[ft.Control] = []
        for label, attribute, minimum, maximum, integer, hint in ELEMENT_FIELDS:
            toggle_name = OPTIONAL_FIELDS.get(attribute)
            if toggle_name and not getattr(toggles, toggle_name):
                continue
            fields.append(
                number_field(
                    label,
                    float(getattr(element, attribute)),
                    minimum=minimum,
                    maximum=maximum,
                    integer=integer,
                    hint=hint,
                    on_change=lambda value, e=element, a=attribute: set_element_field(e, a, value),
                )
            )
        return fields

    def vehicle_controls(element: Element) -> list[ft.Control]:
        controls: list[ft.Control] = []
        for group in element.vehicles:
            row = [
                text_input(
                    "Тип техники",
                    group.vehicle_type,
                    lambda value, g=group: set_vehicle_field(g, "vehicle_type", value),
                    width=160,
                ),
                number_field(
                    "По штату",
                    group.count_full,
                    minimum=0,
                    maximum=10000,
                    integer=True,
                    on_change=lambda value, g=group: set_vehicle_field(g, "count_full", value),
                    width=110,
                ),
                number_field(
                    "В строю",
                    group.count_current,
                    minimum=0,
                    maximum=10000,
                    integer=True,
                    on_change=lambda value, g=group: set_vehicle_field(g, "count_current", value),
                    width=110,
                ),
            ]
            if toggles.vehicle_condition:
                row.append(
                    number_field(
                        "Состояние",
                        group.condition,
                        minimum=0,
                        maximum=100,
                        hint="%",
                        on_change=lambda value, g=group: set_vehicle_field(g, "condition", value),
                        width=120,
                    )
                )
            row.append(
                ft.IconButton(
                    icon=ft.Icons.DELETE_OUTLINE,
                    tooltip="Убрать группу техники",
                    on_click=lambda *_, e=element, g=group: remove_vehicles(e, g),
                )
            )
            controls.append(ft.Row(row, spacing=GAP, wrap=True))
        controls.append(
            text_button("Добавить технику", lambda e=element: add_vehicles(e), icon=ft.Icons.ADD)
        )
        return controls

    def element_tiles() -> list[ft.Control]:
        if not battalion.elements:
            return [empty_hint("В батальоне нет элементов — добавьте из шаблонов ниже.")]
        tiles: list[ft.Control] = []
        for element in battalion.elements:
            tiles.append(
                ft.ExpansionTile(
                    title=ft.Text(
                        f"{element.name} — {element.personnel_current}"
                        f"/{element.personnel_full} чел.",
                        size=14,
                        weight=ft.FontWeight.W_500,
                    ),
                    subtitle=ft.Text(
                        f"{element.type} · приказ {battalion.order_for(element)} · "
                        f"мораль {element.morale:.0f}",
                        size=12,
                    ),
                    controls=[
                        ft.Container(
                            content=ft.Column(
                                [
                                    ft.Row(
                                        [
                                            text_input(
                                                "Название",
                                                element.name,
                                                lambda value, e=element: set_element_field(
                                                    e, "name", value
                                                ),
                                                width=240,
                                            ),
                                            choice(
                                                "Тип",
                                                [
                                                    (key, entry.label)
                                                    for key, entry in sorted(
                                                        config.element_types.element_types.items()
                                                    )
                                                ],
                                                element.type,
                                                lambda value, e=element: set_element_field(
                                                    e, "type", value
                                                ),
                                            ),
                                            choice(
                                                "Приказ элемента",
                                                [
                                                    ("", "как у батальона"),
                                                    *[
                                                        (str(order), str(order))
                                                        for order in Order
                                                    ],
                                                ],
                                                str(element.order or ""),
                                                lambda value, e=element: set_element_field(
                                                    e, "order", Order(value) if value else None
                                                ),
                                            ),
                                        ],
                                        spacing=GAP,
                                        wrap=True,
                                    ),
                                    ft.Row(element_fields(element), spacing=GAP, wrap=True),
                                    ft.Divider(height=1),
                                    *vehicle_controls(element),
                                    ft.Row(
                                        [
                                            text_button(
                                                "Удалить элемент",
                                                lambda e=element: remove_element(e),
                                                icon=ft.Icons.DELETE_OUTLINE,
                                            )
                                        ]
                                    ),
                                ],
                                spacing=GAP,
                                tight=True,
                            ),
                            padding=PAD,
                        )
                    ],
                )
            )
        return tiles

    elements_holder.controls = element_tiles()

    battalion_controls = ft.Row(
        [
            text_input(
                "Название",
                battalion.name,
                lambda value: set_battalion_field("name", value),
                width=260,
            ),
            choice(
                "Сторона",
                [(str(side), str(side)) for side in Side],
                str(battalion.side),
                lambda value: set_battalion_field("side", Side(value)),
                width=120,
            ),
            choice(
                "Приказ батальона",
                [(str(order), str(order)) for order in Order],
                str(battalion.order),
                lambda value: set_battalion_field("order", Order(value)),
            ),
            number_field(
                "Связь",
                battalion.communications,
                minimum=0,
                maximum=100,
                hint="общая связь, %",
                on_change=lambda value: set_battalion_field("communications", value),
            ),
        ],
        spacing=GAP,
        wrap=True,
    )
    if toggles.commander_influence:
        battalion_controls.controls.append(
            number_field(
                "Влияние командира",
                battalion.commander_influence,
                minimum=0,
                maximum=100,
                on_change=lambda value: set_battalion_field("commander_influence", value),
            )
        )

    templates = ft.Row(
        [
            text_button(
                entry.label,
                lambda key=key: add_element(key),
                icon=ft.Icons.ADD_CIRCLE_OUTLINE,
            )
            for key, entry in sorted(config.element_types.element_types.items())
        ],
        spacing=GAP,
        wrap=True,
    )

    left = ft.Column(
        [
            card("Батальон", [battalion_controls,
                              text_input(
                                  "Задача боя",
                                  battalion.task,
                                  lambda value: set_battalion_field("task", value),
                              )]),
            card("Добавить элемент из шаблона", [templates]),
            card("Элементы", [elements_holder]),
        ],
        spacing=GAP,
        expand=3,
        scroll=ft.ScrollMode.AUTO,
    )
    right = ft.Column([summary_holder], spacing=GAP, expand=2, scroll=ft.ScrollMode.AUTO)

    return ft.View(
        route=ROUTE.format(id=unit_id),
        controls=[
            ft.Column(
                [
                    page_title(
                        f"Конструктор: {battalion.name}",
                        "Правки сохраняются сразу и тут же видны в сводке.",
                    ),
                    ft.Row(
                        [
                            link_button(
                "К списку", ROUTES["units"], app.go, icon=ft.Icons.ARROW_BACK),
                            link_button("На главную", ROUTES["home"], app.go),
                            action_button(
                                "В бой стороной A",
                                lambda: _use_in_battle(app, battalion, Side.A),
                                icon=ft.Icons.MILITARY_TECH,
                            ),
                            action_button(
                                "В бой стороной B",
                                lambda: _use_in_battle(app, battalion, Side.B),
                                icon=ft.Icons.MILITARY_TECH,
                            ),
                        ],
                        spacing=GAP,
                        wrap=True,
                    ),
                    error_holder,
                    ft.Row(
                        [left, right],
                        spacing=GAP,
                        vertical_alignment=ft.CrossAxisAlignment.START,
                        expand=True,
                    ),
                ],
                spacing=GAP,
                expand=True,
            )
        ],
        padding=PAD,
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
