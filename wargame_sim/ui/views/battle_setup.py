"""Настройка боя: стороны, условия, наряд сил, сид и сравнение сторон.

Экран собирается один раз и дальше перерисовывает только изменившееся:
переход на самого себя увозил бы прокрутку в начало. Держатель есть у
каждого куска, который сам себя не перерисовывает, и это не перестраховка —
без них экран показывал не то, что в модели:

* сегментированный переключатель подсветку не двигает, поэтому щелчок по
  местности, времени суток, погоде и укреплениям оставлял её на прежнем
  значении;
* тумблер наряда сил помнит значение, с которым его собрали, поэтому щелчок
  по строке и щелчок по старшей группе состояние подгрупп не показывали;
* смена подразделения меняла отряд, но в наряде сил оставались группы
  прежнего — и щелчок по ним ничего не делал;
* счётчики «сколько в бою» и блок «Сценарий» в боковой колонке не менялись
  вообще никогда.

Стороны свёрстаны не двумя карточками рядом, а одной таблицей
«параметр — A — B». При минимальном окне на карточку стороны оставалось
273 px, то есть по 85 px на поле в строке из трёх; в таблице то же поле
получает 230 px, а сравнивать стороны стало можно взглядом по строке.

Блок «Что даёт перевес» считается по реальному конфигу — берёт те же
множители приказов и местности, которые потом применит движок, а не
пересказывает их словами.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence

import flet as ft

from core import formation, preview
from core.models import (
    COMMAND_ORDERS,
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
from ui.shell import battle_tabs, scenario_aside, screen
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

#: Подпись параметра в таблице сторон: слева от полей A и B.
PARAM_W = 116

#: Поле сида.
SEED_W = 140

#: Уровни укреплений: не набирать числом, а выбирать — их всего шесть.
FORTIFICATION_LEVELS: tuple[str, ...] = ("0", "1", "2", "3", "4", "5")

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

    sides_holder = ft.Container()
    conditions_holder = ft.Container()
    forces_holder = ft.Container()
    compare_holder = ft.Container(expand=True)
    aside_holder = ft.Container()
    seed_holder = ft.Container(width=SEED_W)
    fort_holders = {str(side): ft.Container() for side in Side}

    # -- перерисовка изменившегося -------------------------------------------
    def touch() -> None:
        """Сценарий изменился: бой начинается заново, сводка пересчитывается.

        Поля и списки показывают набранное сами, поэтому карточка сторон
        здесь не собирается: пересборка увела бы фокус из поля, в котором
        ГМ ещё печатает.
        """
        app.engine = None
        compare_holder.content = compare_card()
        aside_holder.content = scenario_aside(app)
        app.refresh(compare_holder, aside_holder)

    def forces_changed() -> None:
        forces_holder.content = forces_card()
        app.refresh(forces_holder)
        touch()

    def unit_changed() -> None:
        sides_holder.content = sides_card()
        forces_changed()

    # -- правки сценария -----------------------------------------------------
    def set_conditions(attribute: str, value: object) -> None:
        """Общее условие боя: местность, время суток, погода, предел ходов."""
        setattr(environment, attribute, value)
        conditions_holder.content = conditions_card()
        app.refresh(conditions_holder)
        touch()

    def set_intel(side: Side, level: IntelLevel) -> None:
        """Разведданные стороны; выбранное показывает сам список."""
        setattr(environment, f"intel_{side}", level)
        touch()

    def set_side(side: Side, attribute: str, value: object) -> None:
        setattr(scenario.battalion(side), attribute, value)
        touch()

    def set_scenario(attribute: str, value: object) -> None:
        """Название, заметки и сид: на сравнение сторон они не влияют.

        Бой заново здесь не начинается вслух — правку ловит отпечаток
        сценария в ``AppState.ensure_battle``, поэтому пересобирать сводку
        на каждой букве названия не нужно.
        """
        setattr(scenario, attribute, value)
        aside_holder.content = scenario_aside(app)
        app.refresh(aside_holder)

    def set_fortification(side: Side, level: int) -> None:
        key = str(side)
        setattr(environment, f"fortification_{key}", level)
        fort_holders[key].content = fortification_segment(side)
        app.refresh(fort_holders[key])
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
        unit_changed()

    def random_seed() -> None:
        scenario.master_seed = random.randint(0, MAX_SEED)
        seed_holder.content = seed_field()
        app.refresh(seed_holder)
        touch()

    def save() -> None:
        if not scenario.id:
            scenario.id = new_id("scn")
        path = app.save_scenario(scenario)
        app.notify(f"Сценарий сохранён: {path.name}")

    def idle_sides() -> list[str]:
        """Стороны, у которых в бою нет ни одной группы."""
        return [str(side) for side in Side if not scenario.battalion(side).engaged_elements]

    def start() -> None:
        idle = idle_sides()
        if idle:
            app.notify(idle_warning(idle))
            return
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

        def words(label: str, left: str, right: str):
            return c.table_row(
                COMPARE,
                [
                    t.text(label, size=t.SIZE_ROW, color=t.TEXT_3),
                    t.text(left, size=t.SIZE_ROW, align=ft.TextAlign.RIGHT, no_wrap=True),
                    t.text(right, size=t.SIZE_ROW, align=ft.TextAlign.RIGHT, no_wrap=True),
                ],
                height=t.TABLE_ROW_H - 2,
            )

        rows = [
            words("Состояние", str(sa["state"]), str(sb["state"])),
            words("Приказ", str(a.order), str(b.order)),
            line("Групп в бою", str(len(a.engaged_elements)), str(len(b.engaged_elements))),
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
                    edge_block(),
                    c.table_head(COMPARE),
                    ft.Column(rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True),
                ],
                spacing=0,
                expand=True,
            ),
            expand=True,
        )

    def edge_block() -> ft.Control:
        """Честный разбор перевеса: те же формулы, что применит движок.

        Отношения показаны числами, а не пересказаны в абзаце: раньше здесь
        лежали три предложения подряд, и найти в них два числа глазами было
        отдельной работой. Перевес отмечен насыщенностью цифры, а не цветом:
        цветом в приложении обозначаются только потери и подавление.
        """
        edge = preview.edge(scenario, config)
        leader = edge.leader
        return ft.Container(
            content=ft.Column(
                [
                    t.caption("Что даёт перевес"),
                    c.kv_line(
                        "Огонь A / стойкость B",
                        t.num(f"{edge.ratio_a:.2f}", weight=t.W500 if leader == "A" else t.W400),
                        height=t.TABLE_ROW_H - 4,
                    ),
                    c.kv_line(
                        "Огонь B / стойкость A",
                        t.num(f"{edge.ratio_b:.2f}", weight=t.W500 if leader == "B" else t.W400),
                        height=t.TABLE_ROW_H - 4,
                    ),
                    c.note(edge.verdict),
                ],
                spacing=4,
                tight=True,
            ),
            padding=ft.Padding.symmetric(vertical=t.GAP_IN, horizontal=t.PAD_CARD),
            border=t.border_bottom(t.BORDER_INNER),
        )

    # -- стороны одной таблицей ---------------------------------------------
    unit_options = [(battalion.id, battalion.name) for _, battalion in app.units()]

    def param_row(label: str, controls: dict[str, ft.Control]) -> ft.Control:
        """Строка «параметр — A — B»: подпись один раз, поля во всю ширину."""
        return ft.Row(
            [
                ft.Container(
                    content=t.text(label, size=t.SIZE_ROW, color=t.TEXT_3, no_wrap=True),
                    width=PARAM_W,
                ),
                *(
                    ft.Container(content=controls[str(side)], expand=True)
                    for side in Side
                ),
            ],
            spacing=t.GAP_SM,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )

    def by_side(builder: Callable[[Side], ft.Control]) -> dict[str, ft.Control]:
        return {str(side): builder(side) for side in Side}

    def unit_select(side: Side) -> ft.Control:
        """Список подразделений; пустая библиотека показывает то, что заряжено."""
        battalion = scenario.battalion(side)
        return c.select(
            battalion.id,
            unit_options or [(battalion.id, battalion.name)],
            lambda value, s=side: pick_unit(s, value),
            expand=True,
        )

    def fortification_segment(side: Side) -> ft.Control:
        return c.segmented(
            [(level, level) for level in FORTIFICATION_LEVELS],
            str(environment.fortification(side)),
            lambda value, s=side: set_fortification(s, int(value)),
        )

    def side_head(side: Side) -> ft.Control:
        """Шапка колонки стороны: буква и масштаб отряда.

        Численности здесь намеренно нет: она зависит от наряда сил, а
        карточка сторон на его правку не пересобирается — показывала бы
        прежнее число. Сколько людей идёт в бой, говорит карточка наряда
        сил, и говорит один раз.
        """
        return ft.Row(
            [
                t.text(str(side), size=t.SIZE_TITLE, weight=t.W600),
                ft.Text(
                    str(scenario.battalion(side).scale),
                    style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                ),
            ],
            spacing=8,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )

    def sides_card() -> ft.Control:
        rows: list[ft.Control] = [
            ft.Container(
                content=param_row("", by_side(side_head)),
                padding=ft.Padding.only(bottom=t.GAP_SM),
                border=t.border_bottom(t.BORDER_INNER),
            ),
            param_row("Подразделение", by_side(unit_select)),
            param_row(
                "Приказ",
                by_side(
                    lambda side: c.select(
                        str(scenario.battalion(side).order),
                        [(str(order), str(order)) for order in COMMAND_ORDERS],
                        lambda value, s=side: set_side(s, "order", Order(value)),
                        expand=True,
                    )
                ),
            ),
            param_row(
                "Задача боя",
                by_side(
                    lambda side: c.text_field(
                        scenario.battalion(side).task,
                        lambda value, s=side: set_side(s, "task", value),
                        placeholder="не задана",
                        expand=True,
                    )[0]
                ),
            ),
        ]
        if toggles.intel:
            rows.append(
                param_row(
                    "Разведданные",
                    by_side(
                        lambda side: c.select(
                            str(environment.intel(side)),
                            [(str(level), str(level)) for level in IntelLevel],
                            lambda value, s=side: set_intel(s, IntelLevel(value)),
                            expand=True,
                        )
                    ),
                )
            )
        for side in Side:
            fort_holders[str(side)].content = fortification_segment(side)
        rows.append(param_row("Укрепления", dict(fort_holders)))
        rows.append(
            param_row(
                "Связь",
                by_side(
                    lambda side: c.number_field(
                        scenario.battalion(side).communications,
                        lambda value, s=side: set_side(s, "communications", value),
                        minimum=0,
                        maximum=100,
                        expand=True,
                    )
                ),
            )
        )
        if toggles.commander_influence:
            rows.append(
                param_row(
                    "Командир",
                    by_side(
                        lambda side: c.number_field(
                            scenario.battalion(side).commander_influence,
                            lambda value, s=side: set_side(s, "commander_influence", value),
                            minimum=0,
                            maximum=100,
                            expand=True,
                        )
                    ),
                )
            )
        return c.card([t.card_title("Стороны"), *rows])

    # -- условия ------------------------------------------------------------
    def conditions_card() -> ft.Control:
        return c.card(
            [
                t.card_title("Условия боя"),
                c.flow(
                    [
                        c.labeled(
                            "Местность",
                            c.segmented(
                                [(str(item), str(item)) for item in Terrain],
                                str(environment.terrain),
                                lambda value: set_conditions("terrain", Terrain(value)),
                            ),
                            width=TERRAIN_W,
                        ),
                        c.labeled(
                            "Время суток",
                            c.segmented(
                                [(str(item), str(item)) for item in TimeOfDay],
                                str(environment.time_of_day),
                                lambda value: set_conditions("time_of_day", TimeOfDay(value)),
                            ),
                            width=TIME_W,
                        ),
                        c.labeled(
                            "Погода",
                            c.segmented(
                                [(str(item), str(item)) for item in Weather],
                                str(environment.weather),
                                lambda value: set_conditions("weather", Weather(value)),
                            ),
                            width=WEATHER_W,
                        ),
                        c.labeled(
                            "Предел ходов",
                            c.number_field(
                                environment.max_turns,
                                lambda value: set_conditions("max_turns", int(value)),
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
        forces_changed()

    def set_all_engaged(side: Side, engaged: bool) -> None:
        formation.set_all_engaged(scenario.battalion(side), engaged)
        forces_changed()

    def fold(side: Side, element_id: str) -> None:
        key = (str(side), element_id)
        if key in app.collapsed_groups:
            app.collapsed_groups.discard(key)
        else:
            app.collapsed_groups.add(key)
        forces_changed()

    def force_row(side: Side, node: ob.Node, battalion: Battalion) -> ft.Control:
        roll = battalion.rollup(node.element.id)
        engaged_here = roll.engaged > 0
        row = ft.Container(
            content=ft.Row(
                [
                    # Имя живёт в растягивающемся контейнере, как в колонке
                    # «Группа» на пульте: иначе длинное название не во что
                    # обрезать и строка вылезает за край карточки.
                    ft.Container(
                        content=ob.name_cell(
                            node,
                            muted=not engaged_here,
                            on_toggle=lambda e=node.element.id, s=side: fold(s, e),
                            counter=f"{roll.engaged} из {roll.leaves}",
                        ),
                        expand=True,
                    ),
                    ft.Text(
                        f"{roll.personnel_current} чел.",
                        style=t.mono(size=t.SIZE_META, color=t.TEXT_MUTED),
                    ),
                    c.toggle(
                        "",
                        engaged_here,
                        lambda value, e=node.element.id, s=side: set_engaged(s, e, value),
                    ),
                ],
                spacing=8,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            height=t.TABLE_ROW_H + 6,
        )
        # Строка наряда сил кликабельна целиком: раньше попасть надо было
        # ровно в тумблер справа. Щелчок по строке и щелчок по тумблеру
        # ставят одно и то же значение, поэтому промах по тумблеру внутри
        # строки ничего не ломает.
        return c.interactive(
            row,
            on_click=lambda e=node.element.id, s=side, was=engaged_here: set_engaged(s, e, not was),
            menu=[
                c.MenuItem(
                    "Отвести в резерв" if engaged_here else "Ввести в бой",
                    lambda e=node.element.id, s=side, was=engaged_here: set_engaged(s, e, not was),
                    icon=ft.Icons.PAUSE if engaged_here else ft.Icons.PLAY_ARROW,
                ),
                c.MenuItem(
                    "Править в конструкторе",
                    lambda b=battalion.id: app.go(ROUTES["unit"].format(id=b)),
                    icon=ft.Icons.TUNE,
                ),
            ],
        )

    def force_column(side: Side) -> ft.Control:
        battalion = scenario.battalion(side)
        key = str(side)
        rows = [
            force_row(side, node, battalion)
            for node in ob.nodes(battalion, key, app.collapsed_groups)
        ]
        engaged = battalion.engaged_elements
        header = ft.Row(
            [
                t.caption(f"Сторона {key} · {battalion.scale}"),
                c.spacer(),
                c.tertiary_button(
                    "Все",
                    lambda s=side: set_all_engaged(s, True),
                    height=t.BUTTON_XS_H,
                    tooltip="Ввести в бой весь отряд",
                ),
                c.tertiary_button(
                    "Никого",
                    lambda s=side: set_all_engaged(s, False),
                    height=t.BUTTON_XS_H,
                    tooltip="Отвести в резерв весь отряд",
                ),
            ],
            spacing=0,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )
        return ft.Column(
            [
                header,
                c.kv_line(
                    f"в бою {len(engaged)} из {len(battalion.leaf_elements)}",
                    ft.Text(
                        f"{battalion.personnel_current} чел.",
                        style=t.mono(size=t.SIZE_META, color=t.TEXT_3),
                    ),
                    height=t.TABLE_HEAD_H,
                ),
                *rows,
            ],
            spacing=0,
            tight=True,
            expand=True,
        )

    def forces_card() -> ft.Control:
        parts: list[ft.Control] = [
            t.card_title("Наряд сил"),
            c.note(
                "Выключенная группа остаётся в резерве: она не стреляет и по ней "
                "не стреляют. Выключение старшей группы уводит в резерв и все её "
                "подгруппы; ввести их в бой можно прямо на пульте, на любом ходу."
            ),
            ft.Row(
                [force_column(side) for side in Side],
                spacing=t.GAP,
                vertical_alignment=ft.CrossAxisAlignment.START,
            ),
        ]
        idle = idle_sides()
        if idle:
            parts.append(c.warn_banner(idle_warning(idle)))
        return c.card(parts)

    # -- сценарий и случайность ---------------------------------------------
    def seed_field() -> ft.Control:
        return c.number_field(
            scenario.master_seed,
            lambda value: set_scenario("master_seed", int(value)),
            minimum=0,
            maximum=MAX_SEED,
            integer=True,
            width=SEED_W,
        )

    seed_holder.content = seed_field()
    randomness = c.card(
        [
            t.card_title("Сценарий и случайность"),
            ft.Row(
                [
                    c.labeled(
                        "Название сценария",
                        c.text_field(
                            scenario.name,
                            lambda value: set_scenario("name", value),
                            expand=True,
                        )[0],
                        expand=True,
                    ),
                    c.labeled("Сид боя", seed_holder, width=SEED_W),
                    c.secondary_button("Случайный", random_seed, icon=ft.Icons.CASINO, height=32),
                ],
                spacing=t.GAP_SM,
                vertical_alignment=ft.CrossAxisAlignment.END,
            ),
            c.labeled(
                "Заметки",
                c.text_field(
                    scenario.notes,
                    lambda value: set_scenario("notes", value),
                    placeholder="необязательно",
                    expand=True,
                )[0],
                expand=True,
            ),
            c.note(
                "Один и тот же сид даёт один и тот же бой — результат можно повторить точно."
            ),
        ]
    )

    sides_holder.content = sides_card()
    conditions_holder.content = conditions_card()
    forces_holder.content = forces_card()
    compare_holder.content = compare_card()
    aside_holder.content = scenario_aside(app)

    app.bind("Ctrl+Enter", start)
    app.bind("Ctrl+S", save)

    # Карточки тянутся на всю ширину колонки: раньше «Условия боя» была
    # уже соседних — колонка брала ширину по содержимому.
    left = ft.Column(
        [
            sides_holder,
            conditions_holder,
            forces_holder,
            randomness,
        ],
        spacing=t.GAP,
        expand=True,
        scroll=ft.ScrollMode.AUTO,
        horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
    )

    return screen(
        app,
        active="battle",
        title=scenario.name,
        subtitle="Кто, где и с какой задачей вступает в бой",
        tabs=battle_tabs(app, "setup"),
        actions=[
            c.primary_button(
                "Начать бой",
                start,
                icon=ft.Icons.PLAY_ARROW,
                tooltip="Ctrl+Enter",
            ),
            c.more_menu(
                [
                    c.MenuItem("Сохранить сценарий  Ctrl+S", save, icon=ft.Icons.SAVE_OUTLINED),
                    c.MenuItem(
                        "Открыть сценарий…",
                        lambda: app.go(ROUTES["archive"]),
                        icon=ft.Icons.FOLDER_OPEN_OUTLINED,
                    ),
                    c.MenuItem(
                        "Прогнать много раз",
                        lambda: app.go(ROUTES["batch"]),
                        icon=ft.Icons.INSIGHTS_OUTLINED,
                    ),
                ]
            ),
        ],
        aside=aside_holder,
        body=c.columns(left, compare_holder, right_width=390),
    )


def idle_warning(idle: Sequence[str]) -> str:
    """Почему бой не начнётся: у стороны в бою нет ни одной группы.

    Без этой проверки «Начать бой» собирал бой, в котором одной стороне
    воевать нечем, — и он кончался на первом ходу разгромом, которого никто
    не задумывал.
    """
    who = "Обе стороны" if len(idle) > 1 else f"Сторона {idle[0]}"
    return (
        f"{who} целиком в резерве — воевать некем. Бой начнётся, когда в нём "
        "будет хотя бы одна группа с каждой стороны."
    )

