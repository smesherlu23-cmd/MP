"""Настройка боя: стороны, условия, сид и сравнение сторон.

Блок «Что даёт перевес» считается по реальному конфигу — берёт те же
множители приказов и местности, которые потом применит движок, а не
пересказывает их словами.
"""

from __future__ import annotations

import random

import flet as ft

from core import formation, preview
from core.models import (
    MAX_SEED,
    Battalion,
    IntelLevel,
    Order,
    Side,
    Terrain,
    TimeOfDay,
    Weather,
    new_id,
)
from ui import theme as t
from ui.shell import scenario_aside, screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import orbat as ob

ROUTE = ROUTES["battle_setup"]

#: Ширины групп в карточке условий. В строке с переносом ширина ребёнка
#: обязана быть задана: иначе Flet рисует серый прямоугольник вместо
#: содержимого. Значения с запасом под самые длинные названия из конфига.
TERRAIN_W = 340
TIME_W = 190
WEATHER_W = 240
LIMIT_W = 120

COMPARE: tuple[c.Col, ...] = (
    c.Col("Показатель", expand=True),
    c.Col("A", 80, numeric=True),
    c.Col("B", 80, numeric=True),
)


def build(app: AppState) -> ft.View:
    scenario = app.scenario
    environment = scenario.environment
    config = app.config
    toggles = config.tog

    compare_holder = ft.Container()
    edge_holder = ft.Container(expand=True)
    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))

    def touch() -> None:
        app.engine = None
        compare_holder.content = compare_card()
        edge_holder.content = edge_note()
        app.refresh(compare_holder, edge_holder)

    def set_environment(attribute: str, value: object) -> None:
        setattr(environment, attribute, value)
        touch()

    def set_side(side: Side, attribute: str, value: object) -> None:
        setattr(scenario.battalion(side), attribute, value)
        touch()

    def pick_unit(side: Side, unit_id: str) -> None:
        found = app.unit(unit_id)
        if found is None:
            return
        battalion = found[1].model_copy(deep=True)
        battalion.side = side
        if side == Side.A:
            scenario.battalion_a = battalion
        else:
            scenario.battalion_b = battalion
        touch()

    def random_seed() -> None:
        scenario.master_seed = random.randint(0, MAX_SEED)
        app.notify(f"Новый сид: {scenario.master_seed}")
        app.go(ROUTE)

    def save() -> None:
        if not scenario.id:
            scenario.id = new_id("scn")
        path = app.save_scenario(scenario)
        message.value = f"Сценарий сохранён: {path.name}"
        app.refresh(message)

    def start() -> None:
        app.start_battle()
        app.go(ROUTES["battle"].format(id=scenario.id))

    # -- сравнение сторон ---------------------------------------------------
    def compare_card() -> ft.Control:
        a, b = scenario.battalion_a, scenario.battalion_b
        sa, sb = a.summary(), b.summary()

        def line(label: str, left: str, right: str, *, weight: ft.FontWeight = t.W400):
            return c.table_row(
                COMPARE,
                [
                    t.text(label, size=t.SIZE_ROW, color=t.TEXT_3),
                    t.num(left, weight=weight),
                    t.num(right, weight=weight),
                ],
                height=t.TABLE_ROW_H - 2,
            )

        rows = [
            c.table_row(
                COMPARE,
                [
                    t.text("Состояние", size=t.SIZE_ROW, color=t.TEXT_3),
                    t.text(str(sa["state"]), size=t.SIZE_ROW, align=ft.TextAlign.RIGHT),
                    t.text(str(sb["state"]), size=t.SIZE_ROW, align=ft.TextAlign.RIGHT),
                ],
                height=t.TABLE_ROW_H - 2,
            ),
            c.table_row(
                COMPARE,
                [
                    t.text("Приказ", size=t.SIZE_ROW, color=t.TEXT_3),
                    t.text(str(a.order), size=t.SIZE_ROW, align=ft.TextAlign.RIGHT),
                    t.text(str(b.order), size=t.SIZE_ROW, align=ft.TextAlign.RIGHT),
                ],
                height=t.TABLE_ROW_H - 2,
            ),
            line(
                "Групп в бою",
                str(len(a.engaged_elements)),
                str(len(b.engaged_elements)),
            ),
            line("Личный состав", str(a.personnel_current), str(b.personnel_current)),
            line("Техника", str(a.vehicles_current), str(b.vehicles_current)),
            line("Мораль", f"{sa['morale']:.0f}", f"{sb['morale']:.0f}"),
            line("Опыт (средний)", f"{sa['experience']:.1f}", f"{sb['experience']:.1f}"),
            line("Слаженность", f"{sa['cohesion']:.0f}", f"{sb['cohesion']:.0f}"),
            line("Связь", f"{a.communications:.0f}", f"{b.communications:.0f}"),
            line(
                "Влияние командира",
                f"{a.commander_influence:.0f}",
                f"{b.commander_influence:.0f}",
            ),
            line("Боезапас", f"{sa['ammo']:.0f}", f"{sb['ammo']:.0f}"),
            line("Снабжение", f"{sa['supply']:.0f}", f"{sb['supply']:.0f}"),
        ]
        rows.append(
            ft.Container(
                content=ft.Column(
                    [
                        line(
                            "Боеспособность",
                            f"{sa['combat_power']:.0f}",
                            f"{sb['combat_power']:.0f}",
                            weight=t.W500,
                        ),
                        line(
                            "Организация",
                            f"{sa['organisation']:.0f}",
                            f"{sb['organisation']:.0f}",
                            weight=t.W500,
                        ),
                    ],
                    spacing=0,
                    tight=True,
                ),
                padding=ft.Padding.only(top=6),
                border=t.border_top(t.BORDER_INNER),
            )
        )

        return c.framed_card(
            "Сравнение сторон",
            ft.Column(
                [
                    c.table_head(COMPARE),
                    ft.Column(rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True),
                ],
                spacing=0,
                expand=True,
            ),
            footer=c.card_footer([edge_holder], height=None),
            expand=True,
        )

    def edge_note() -> ft.Control:
        """Честный разбор перевеса: те же формулы, что применит движок."""
        edge = preview.edge(scenario, config)
        return ft.Column(
            [t.caption("Что даёт перевес"), c.note(edge.text)],
            spacing=4,
            tight=True,
            expand=True,
        )

    # -- карточка стороны ---------------------------------------------------
    unit_options = [(battalion.id, battalion.name) for _, battalion in app.units()]

    def side_card(side: Side) -> ft.Control:
        battalion = scenario.battalion(side)
        key = "A" if side == Side.A else "B"
        fields: list[ft.Control] = [
            c.labeled(
                "Подразделение",
                c.select(
                    battalion.id,
                    unit_options or [(battalion.id, battalion.name)],
                    lambda value, s=side: pick_unit(s, value),
                    expand=True,
                ),
                expand=True,
            ),
            ft.Row(
                [
                    c.labeled(
                        "Приказ",
                        c.select(
                            str(battalion.order),
                            [(str(order), str(order)) for order in Order],
                            lambda value, s=side: set_side(s, "order", Order(value)),
                            expand=True,
                        ),
                        expand=True,
                    ),
                    c.labeled(
                        "Разведданные",
                        c.select(
                            str(environment.intel(key)),
                            [(str(level), str(level)) for level in IntelLevel],
                            lambda value, s=side: set_environment(
                                "intel_A" if s == Side.A else "intel_B", IntelLevel(value)
                            ),
                            expand=True,
                        ),
                        expand=True,
                    )
                    if toggles.intel
                    else ft.Container(expand=True),
                ],
                spacing=t.GAP_SM,
            ),
            c.labeled(
                "Задача боя",
                c.text_field(
                    battalion.task,
                    lambda value, s=side: set_side(s, "task", value),
                    placeholder="не задана",
                    expand=True,
                )[0],
                expand=True,
            ),
            ft.Row(
                [
                    c.labeled(
                        "Укрепления 0…5",
                        c.number_field(
                            environment.fortification(key),
                            lambda value, s=side: set_environment(
                                "fortification_A" if s == Side.A else "fortification_B", int(value)
                            ),
                            minimum=0,
                            maximum=5,
                            integer=True,
                            expand=True,
                        ),
                        expand=True,
                    ),
                    c.labeled(
                        "Связь",
                        c.number_field(
                            battalion.communications,
                            lambda value, s=side: set_side(s, "communications", value),
                            minimum=0,
                            maximum=100,
                            expand=True,
                        ),
                        expand=True,
                    ),
                    c.labeled(
                        "Командир",
                        c.number_field(
                            battalion.commander_influence,
                            lambda value, s=side: set_side(s, "commander_influence", value),
                            minimum=0,
                            maximum=100,
                            expand=True,
                        ),
                        expand=True,
                    )
                    if toggles.commander_influence
                    else ft.Container(expand=True),
                ],
                spacing=t.GAP_SM,
            ),
        ]

        header = ft.Row(
            [
                t.card_title(f"Сторона {key}"),
                c.spacer(),
                ft.Text(
                    f"{battalion.personnel_current} чел. · {battalion.vehicles_current} техн.",
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                ),
            ],
            spacing=8,
        )
        return c.card([header, *fields], expand=True)

    # -- условия ------------------------------------------------------------
    conditions = c.card(
        [
            t.card_title("Условия боя"),
            c.flow(
                [
                    c.labeled(
                        "Местность",
                        c.segmented(
                            [(str(item), str(item)) for item in Terrain],
                            str(environment.terrain),
                            lambda value: set_environment("terrain", Terrain(value)),
                        ),
                        width=TERRAIN_W,
                    ),
                    c.labeled(
                        "Время суток",
                        c.segmented(
                            [(str(item), str(item)) for item in TimeOfDay],
                            str(environment.time_of_day),
                            lambda value: set_environment("time_of_day", TimeOfDay(value)),
                        ),
                        width=TIME_W,
                    ),
                    c.labeled(
                        "Погода",
                        c.segmented(
                            [(str(item), str(item)) for item in Weather],
                            str(environment.weather),
                            lambda value: set_environment("weather", Weather(value)),
                        ),
                        width=WEATHER_W,
                    ),
                    c.labeled(
                        "Предел ходов",
                        c.number_field(
                            environment.max_turns,
                            lambda value: set_environment("max_turns", int(value)),
                            minimum=1,
                            maximum=500,
                            integer=True,
                            width=LIMIT_W,
                        ),
                        width=LIMIT_W,
                    ),
                ],
                spacing=20,
            ),
        ]
    )

    # -- наряд сил ----------------------------------------------------------
    def set_engaged(side: Side, element_id: str, engaged: bool) -> None:
        """Ввести группу в бой или отвести — вместе со всеми подгруппами."""
        battalion = scenario.battalion(side)
        if battalion.element(element_id) is None:
            return
        formation.set_engaged(battalion, element_id, engaged)
        touch()

    def force_column(side: Side) -> ft.Control:
        battalion = scenario.battalion(side)
        key = "A" if side == Side.A else "B"
        rows: list[ft.Control] = []
        for element in battalion.ordered_elements:
            roll = battalion.rollup(element.id)
            engaged_here = roll.engaged > 0
            rows.append(
                ft.Container(
                    content=ft.Row(
                        [
                            ft.Container(width=battalion.depth_of(element) * ob.INDENT),
                            ft.Text(
                                element.name,
                                style=t.sans(
                                    size=t.SIZE_ROW,
                                    weight=t.W500 if roll.leaves > 1 else t.W400,
                                    color=t.TEXT if engaged_here else t.TEXT_PLACEHOLDER,
                                ),
                                expand=True,
                                no_wrap=True,
                            ),
                            ft.Text(
                                f"{element.echelon} · {roll.personnel_current} чел.",
                                style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED),
                            ),
                            c.toggle(
                                "",
                                engaged_here,
                                lambda value, e=element.id, s=side: set_engaged(s, e, value),
                            ),
                        ],
                        spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    height=t.TABLE_ROW_H + 6,
                )
            )
            # Строка наряда сил кликабельна целиком: раньше попасть надо
            # было ровно в тумблер справа.
            rows[-1] = c.interactive(
                rows[-1],
                on_click=(
                    lambda e=element.id, s=side, was=engaged_here: set_engaged(s, e, not was)
                ),
                menu=[
                    c.MenuItem(
                        "Отвести в резерв" if engaged_here else "Ввести в бой",
                        lambda e=element.id, s=side, was=engaged_here: set_engaged(s, e, not was),
                        icon=ft.Icons.PAUSE if engaged_here else ft.Icons.PLAY_ARROW,
                    ),
                    c.MenuItem(
                        "Править в конструкторе",
                        lambda b=battalion.id: app.go(ROUTES["unit"].format(id=b)),
                        icon=ft.Icons.TUNE,
                    ),
                ],
            )
        engaged = battalion.engaged_elements
        return ft.Column(
            [
                ft.Row(
                    [
                        t.caption(f"Сторона {key} · {battalion.scale}"),
                        c.spacer(),
                        ft.Text(
                            f"{len(engaged)} из {len(battalion.leaf_elements)} · "
                            f"{battalion.personnel_current} чел.",
                            style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                        ),
                    ],
                    spacing=8,
                ),
                *rows,
            ],
            spacing=0,
            tight=True,
            expand=True,
        )

    forces = c.card(
        [
            t.card_title("Наряд сил"),
            c.note(
                "Выключенная группа остаётся в резерве: она не стреляет и по ней "
                "не стреляют. Выключение старшей группы уводит в резерв и все её "
                "подгруппы; ввести их в бой можно прямо на пульте, на любом ходу."
            ),
            ft.Row(
                [force_column(Side.A), force_column(Side.B)],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.START,
            ),
        ]
    )

    randomness = c.card(
        [
            t.card_title("Сценарий и случайность"),
            ft.Row(
                [
                    c.labeled(
                        "Название сценария",
                        c.text_field(
                            scenario.name,
                            lambda value: setattr(scenario, "name", value),
                            expand=True,
                        )[0],
                        expand=True,
                    ),
                    c.labeled(
                        "Сид боя",
                        c.number_field(
                            scenario.master_seed,
                            lambda value: setattr(scenario, "master_seed", int(value)),
                            minimum=0,
                            maximum=MAX_SEED,
                            integer=True,
                            width=140,
                        ),
                        width=140,
                    ),
                    c.secondary_button("Случайный", random_seed, icon=ft.Icons.CASINO, height=32),
                ],
                spacing=t.GAP_SM,
                vertical_alignment=ft.CrossAxisAlignment.END,
            ),
            c.labeled(
                "Заметки",
                c.text_field(
                    scenario.notes,
                    lambda value: setattr(scenario, "notes", value),
                    placeholder="необязательно",
                    expand=True,
                )[0],
                expand=True,
            ),
            c.note(
                "Один и тот же сид даёт один и тот же бой — результат можно повторить точно."
            ),
            message,
        ]
    )

    touch()

    left = ft.Column(
        [
            ft.Row(
                [side_card(Side.A), side_card(Side.B)],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.START,
            ),
            conditions,
            forces,
            randomness,
            c.spacer(),
        ],
        spacing=t.GAP,
        expand=True,
        scroll=ft.ScrollMode.AUTO,
    )

    return screen(
        app,
        active="battle",
        active_child="setup",
        title="Настройка боя",
        subtitle="Кто, где и с какой задачей вступает в бой",
        actions=[
            c.tertiary_button("Сохранить сценарий", save, icon=ft.Icons.SAVE_OUTLINED),
            c.secondary_button("Массовое моделирование", lambda: app.go(ROUTES["batch"])),
            c.primary_button("Начать бой", start, icon=ft.Icons.PLAY_ARROW),
        ],
        aside=scenario_aside(app),
        body=c.columns(left, compare_holder, right_width=390),
    )


def side_name(battalion: Battalion) -> str:
    return battalion.name
