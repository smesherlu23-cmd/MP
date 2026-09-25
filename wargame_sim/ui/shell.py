"""Общая рамка приложения: боковая навигация, верхняя полоса, контент.

Рамка одинакова на всех девяти экранах. Переход по разделам не перестраивает
её — подсвечивается активный пункт и перерисовывается только контент, поэтому
кнопки «назад» и «на главную» больше не нужны.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import flet as ft

from ui import theme as t
from ui.state import ROUTES, AppState
from ui.widgets import common as c


@dataclass
class NavItem:
    """Пункт основной навигации."""

    key: str
    label: str
    icon: str
    route: str
    #: Группа пунктов; у группы своя подпись (пустая — без подписи).
    group: str = ""


#: Навигация сгруппирована по тому, что ГМ делает: бой — силы — разбор —
#: настройка. Раньше это был плоский список из восьми пунктов, где рядом
#: стояли «Подразделения», «Мат.часть» и «Сборка юнитов» — три имени для
#: библиотек одного рода, — а «Массовое моделирование» не влезало в строку.
#: Подпунктов у навигации больше нет: стадии боя, библиотеки и разделы
#: коэффициентов переключаются на самом экране, поэтому рамка не прыгает.
NAV: tuple[NavItem, ...] = (
    NavItem("home", "Обзор", ft.Icons.DASHBOARD_OUTLINED, ROUTES["home"]),
    NavItem("battle", "Бой", ft.Icons.SHIELD_OUTLINED, ROUTES["battle_setup"]),
    NavItem("units", "Отряды", ft.Icons.GROUPS_OUTLINED, ROUTES["units"], group="Силы"),
    NavItem(
        "materiel",
        "Мат.часть",
        ft.Icons.INVENTORY_OUTLINED,
        ROUTES["materiel"].format(library="vehicles"),
        group="Силы",
    ),
    NavItem("batch", "Прогоны", ft.Icons.INSIGHTS_OUTLINED, ROUTES["batch"], group="Разбор"),
    NavItem("archive", "Архив", ft.Icons.INVENTORY_2_OUTLINED, ROUTES["archive"], group="Разбор"),
    NavItem(
        "config", "Коэффициенты", ft.Icons.TUNE_OUTLINED, ROUTES["config"], group="Настройка"
    ),
)

#: Стадии боя — вкладками в шапке, а не подпунктами навигации.
BATTLE_STAGES: tuple[tuple[str, str], ...] = (
    ("setup", "Подготовка"),
    ("run", "Пульт"),
    ("result", "Итог"),
)


def nav_route(item: NavItem, app: AppState) -> str:
    """Куда ведёт пункт: «Бой» открывает ту стадию, на которой бой сейчас."""
    if item.key == "battle":
        return app.battle_route()
    return item.route


def nav_item(
    item: NavItem, active: bool, go: Callable[[str], None], route: str | None = None
) -> ft.Control:
    """Пункт навигации: активный — тёмная плашка."""
    target = route or item.route
    return ft.Container(
        content=ft.Row(
            [
                ft.Icon(item.icon, size=18, color=t.TEXT_INVERSE if active else t.TEXT_2),
                ft.Text(
                    item.label,
                    style=t.sans(
                        size=t.SIZE_BODY,
                        weight=t.W500 if active else t.W400,
                        color=t.TEXT_INVERSE if active else t.TEXT_2,
                    ),
                    no_wrap=True,
                    expand=True,
                ),
            ],
            spacing=10,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.NAV_ITEM_H,
        padding=ft.Padding.symmetric(horizontal=8),
        bgcolor=t.TEXT if active else None,
        border_radius=t.R_BUTTON,
        on_click=lambda *_: go(target),
    )


def battle_tabs(app: AppState, active: str) -> ft.Control:
    """Подготовка → Пульт → Итог: три стадии одного боя в шапке экрана."""
    battle_id = app.scenario.id
    routes = {
        "setup": ROUTES["battle_setup"],
        "run": ROUTES["battle"].format(id=battle_id),
        "result": ROUTES["battle_result"].format(id=battle_id),
    }
    return c.segmented(
        list(BATTLE_STAGES),
        active,
        lambda key: app.go(routes[key]),
    )


def status_block(app: AppState) -> ft.Control:
    """Что сейчас заряжено в бой — видно с любого экрана, щелчок ведёт туда.

    Заменил пять разных «справочных» блоков под навигацией: на одном экране
    там лежала подсказка про сохранение правок, на другом — про эталон
    конфигурации, на третьем — список типов с численностью. Всё это было
    текстом, который прочитали один раз. Состояние боя нужно всегда.
    """
    scenario = app.scenario
    environment = scenario.environment
    engine = app.engine
    if engine is not None and engine.finished:
        state = f"окончен · ход {engine.turn}"
    elif engine is not None and engine.turn > 0:
        state = f"идёт · ход {engine.turn}"
    else:
        state = "не начат"
    block = ft.Container(
        content=ft.Column(
            [
                t.caption("Текущий бой"),
                t.text(scenario.name, size=t.SIZE_ROW, weight=t.W500, no_wrap=True),
                ft.Text(
                    f"{scenario.battalion_a.name} → {scenario.battalion_b.name}",
                    style=t.sans(size=t.SIZE_META, color=t.TEXT_3),
                    no_wrap=True,
                    overflow=ft.TextOverflow.ELLIPSIS,
                ),
                ft.Text(
                    f"{environment.terrain} · {environment.time_of_day} · {environment.weather}",
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_3),
                    no_wrap=True,
                    overflow=ft.TextOverflow.ELLIPSIS,
                ),
                ft.Text(
                    state,
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_3),
                    no_wrap=True,
                ),
            ],
            spacing=3,
            tight=True,
        ),
        padding=ft.Padding.symmetric(vertical=10, horizontal=10),
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_BUTTON,
        bgcolor=t.CONTENT_BG,
        width=t.SIDEBAR_W - 24,
        tooltip="Открыть бой",
    )
    return c.interactive(block, on_click=lambda: app.go(app.battle_route()))


#: Прежнее имя: экран подготовки держит этот блок в своём держателе и
#: перерисовывает при правке условий.
scenario_aside = status_block


def sidebar(
    app: AppState,
    active: str,
    active_child: str = "",
    *,
    aside: ft.Control | None = None,
) -> ft.Control:
    """Боковая навигация: бренд, пункты по группам, текущий бой, тема."""
    del active_child  # подпунктов больше нет; параметр остаётся для вызовов
    groups: list[ft.Control] = []
    current: list[ft.Control] = []
    caption = None
    for item in NAV:
        if item.group != caption and current:
            groups.append(ft.Column(current, spacing=2, tight=True))
            current = []
        if item.group != caption and item.group:
            current.append(
                ft.Container(
                    content=t.caption(item.group),
                    padding=ft.Padding.only(left=8, bottom=4),
                )
            )
        caption = item.group
        current.append(nav_item(item, item.key == active, app.go, nav_route(item, app)))
    if current:
        groups.append(ft.Column(current, spacing=2, tight=True))

    brand = ft.Column(
        [
            ft.Text("Симулятор боя", style=t.sans(size=t.SIZE_TITLE, weight=t.W600)),
            t.caption("От отделения до полка"),
        ],
        spacing=2,
        tight=True,
    )

    theme_row = ft.Container(
        content=ft.Row(
            [
                ft.Icon(
                    ft.Icons.DARK_MODE_OUTLINED if app.dark_theme else ft.Icons.LIGHT_MODE_OUTLINED,
                    size=18,
                    color=t.TEXT_2,
                ),
                ft.Text(
                    "Тёмная тема" if app.dark_theme else "Светлая тема",
                    style=t.sans(size=t.SIZE_ROW, color=t.TEXT_2),
                ),
            ],
            spacing=10,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=32,
        padding=ft.Padding.symmetric(horizontal=8),
        border_radius=t.R_BUTTON,
        tooltip="Переключить тему",
        on_click=lambda *_: app.toggle_theme(),
    )

    body: list[ft.Control] = [
        brand,
        ft.Column(groups, spacing=16, tight=True),
        c.spacer(),
        aside if aside is not None else status_block(app),
        theme_row,
    ]
    return ft.Container(
        content=ft.Column(body, spacing=18, tight=False, expand=True),
        width=t.SIDEBAR_W,
        bgcolor=t.SIDEBAR_BG,
        border=ft.Border.only(right=ft.BorderSide(1, t.BORDER)),
        padding=ft.Padding.symmetric(vertical=18, horizontal=12),
    )


def topbar(
    title: str,
    subtitle: str = "",
    *,
    actions: Sequence[ft.Control] = (),
    mono_subtitle: bool = False,
    leading_extra: Sequence[ft.Control] = (),
    tabs: ft.Control | None = None,
) -> ft.Control:
    """Верхняя полоса: заголовок экрана слева, действия справа."""
    heading: list[ft.Control] = [
        ft.Text(
            title,
            style=t.sans(size=t.SIZE_SCREEN, weight=t.W600),
            no_wrap=True,
            overflow=ft.TextOverflow.ELLIPSIS,
            tooltip=title,
        )
    ]
    if subtitle:
        style = (
            t.mono(size=t.SIZE_META, color=t.TEXT_3)
            if mono_subtitle
            else t.sans(size=t.SIZE_META, color=t.TEXT_3)
        )
        heading.append(
            ft.Text(
                subtitle,
                style=style,
                no_wrap=True,
                overflow=ft.TextOverflow.ELLIPSIS,
                tooltip=subtitle,
            )
        )

    return ft.Container(
        content=ft.Row(
            [
                ft.Column(heading, spacing=2, tight=True),
                *([tabs] if tabs is not None else []),
                *leading_extra,
                c.spacer(),
                *actions,
            ],
            spacing=12,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        height=t.TOPBAR_H,
        bgcolor=t.SURFACE_ALT,
        border=t.border_bottom(t.BORDER),
        padding=ft.Padding.symmetric(horizontal=t.PAD_CONTENT_X),
    )


def screen(
    app: AppState,
    *,
    active: str,
    title: str,
    subtitle: str = "",
    body: ft.Control,
    actions: Sequence[ft.Control] = (),
    active_child: str = "",
    aside: ft.Control | None = None,
    mono_subtitle: bool = False,
    leading_extra: Sequence[ft.Control] = (),
    tabs: ft.Control | None = None,
) -> ft.View:
    """Собрать экран в общей рамке.

    Прокрутки на уровне экрана нет намеренно: прокручивается содержимое
    карточек — списки, журнал, поля раздела. Параметр `scrollable` здесь
    был, но его не передавал ни один экран, и докстрока описывала
    поведение, которого не существовало.
    """
    content_children: list[ft.Control] = []
    if app.config_error:
        content_children.append(c.error_banner(app.config_error))
    content_children.append(body)

    content = ft.Container(
        content=ft.Column(
            content_children,
            spacing=t.GAP,
            expand=True,
        ),
        bgcolor=t.CONTENT_BG,
        padding=ft.Padding.only(
            top=t.PAD_CONTENT_Y,
            left=t.PAD_CONTENT_X,
            right=t.PAD_CONTENT_X,
            bottom=t.PAD_CONTENT_Y,
        ),
        expand=True,
    )

    return ft.View(
        route=app.page.route if app.page is not None else "/",
        controls=[
            ft.Row(
                [
                    sidebar(app, active, active_child, aside=aside),
                    ft.Column(
                        [
                            topbar(
                                title,
                                subtitle,
                                actions=actions,
                                mono_subtitle=mono_subtitle,
                                leading_extra=leading_extra,
                                tabs=tabs,
                            ),
                            content,
                        ],
                        spacing=0,
                        expand=True,
                    ),
                ],
                spacing=0,
                expand=True,
            )
        ],
        padding=0,
        bgcolor=t.CONTENT_BG,
        spacing=0,
    )
