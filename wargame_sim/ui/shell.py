"""Общая рамка приложения: боковая навигация, верхняя полоса, контент.

Рамка одинакова на всех девяти экранах. Переход по разделам не перестраивает
её — подсвечивается активный пункт и перерисовывается только контент, поэтому
кнопки «назад» и «на главную» больше не нужны.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

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
    #: Подпункты второго уровня: (подпись, маршрут, ключ активности).
    children: list[tuple[str, str, str]] = field(default_factory=list)


#: Порядок пунктов из хендоффа. `swords` в Flet нет — берём ближайшую военную
#: иконку из того же набора Material Symbols.
NAV: tuple[NavItem, ...] = (
    NavItem("home", "Главная", ft.Icons.DASHBOARD_OUTLINED, ROUTES["home"]),
    NavItem("units", "Подразделения", ft.Icons.GROUPS_OUTLINED, ROUTES["units"]),
    NavItem("battle", "Бой", ft.Icons.SHIELD_OUTLINED, ROUTES["battle_setup"]),
    NavItem("batch", "Массовое моделирование", ft.Icons.INSIGHTS_OUTLINED, ROUTES["batch"]),
    NavItem("config", "Коэффициенты", ft.Icons.TUNE_OUTLINED, ROUTES["config"]),
    NavItem("archive", "Архив", ft.Icons.INVENTORY_2_OUTLINED, ROUTES["archive"]),
)


def nav_item(
    item: NavItem, active: bool, go: Callable[[str], None]
) -> ft.Control:
    """Пункт навигации: активный — тёмная плашка."""
    return ft.Container(
        content=ft.Row(
            [
                ft.Icon(item.icon, size=18, color=t.TEXT_ON_DARK if active else t.TEXT_2),
                ft.Text(
                    item.label,
                    style=t.sans(
                        size=t.SIZE_BODY,
                        weight=t.W500 if active else t.W400,
                        color=t.TEXT_ON_DARK if active else t.TEXT_2,
                    ),
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
        on_click=lambda *_: go(item.route),
    )


def nav_child(label: str, route: str, active: bool, go: Callable[[str], None]) -> ft.Control:
    """Подпункт второго уровня."""
    return ft.Container(
        content=ft.Text(
            label,
            style=t.sans(
                size=t.SIZE_ROW,
                weight=t.W500 if active else t.W400,
                color=t.TEXT if active else t.TEXT_2,
            ),
        ),
        height=t.NAV_SUB_H,
        padding=ft.Padding.only(left=30, right=8),
        bgcolor="#DDD7CC" if active else None,
        border_radius=t.R_FIELD,
        alignment=ft.Alignment.CENTER_LEFT,
        on_click=lambda *_: go(route),
    )


def children_for(section: str, app: AppState) -> list[tuple[str, str, str]]:
    """Подпункты активного раздела: фазы боя, открытый батальон, разделы конфига."""
    if section == "battle":
        battle_id = app.scenario.id
        return [
            ("Настройка", ROUTES["battle_setup"], "setup"),
            ("Прогон", ROUTES["battle"].format(id=battle_id), "run"),
            ("Итог", ROUTES["battle_result"].format(id=battle_id), "result"),
        ]
    if section == "units" and app.open_unit is not None:
        unit_id, name = app.open_unit
        return [(name, ROUTES["unit"].format(id=unit_id), unit_id)]
    if section == "config":
        from ui.views.config_editor import SECTION_LABELS

        return [
            (SECTION_LABELS.get(name, name), f"{ROUTES['config']}?section={name}", name)
            for name in app.store.sections()
        ]
    return []


def sidebar(
    app: AppState,
    active: str,
    active_child: str = "",
    *,
    aside: ft.Control | None = None,
) -> ft.Control:
    """Боковая навигация: бренд, пункты, блок сценария, тема."""
    items: list[ft.Control] = []
    for item in NAV:
        items.append(nav_item(item, item.key == active, app.go))
        if item.key == active:
            items.extend(
                nav_child(label, route, key == active_child, app.go)
                for label, route, key in children_for(item.key, app)
            )

    brand = ft.Column(
        [
            ft.Text("Симулятор боя", style=t.sans(size=t.SIZE_TITLE, weight=t.W600)),
            t.caption("Батальонный уровень"),
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
        on_click=lambda *_: app.toggle_theme(),
    )

    body: list[ft.Control] = [brand, ft.Column(items, spacing=2, tight=True)]
    if aside is not None:
        body.append(aside)
    body.append(c.spacer())
    body.append(theme_row)

    return ft.Container(
        content=ft.Column(body, spacing=22, tight=False, expand=True),
        width=t.SIDEBAR_W,
        bgcolor=t.SIDEBAR_BG,
        border=ft.Border.only(right=ft.BorderSide(1, t.BORDER)),
        padding=ft.Padding.symmetric(vertical=18, horizontal=12),
    )


def aside_block(title: str, controls: Sequence[ft.Control]) -> ft.Control:
    """Блок в боковой колонке под навигацией (сценарий, разделы, правки)."""
    return ft.Column(
        [t.caption(title), *controls],
        spacing=6,
        tight=True,
    )


def scenario_aside(app: AppState) -> ft.Control:
    """Блок «Сценарий»: что сейчас заряжено в бой."""
    scenario = app.scenario
    environment = scenario.environment
    return aside_block(
        "Сценарий",
        [
            ft.Text(scenario.name, style=t.sans(size=t.SIZE_BODY, weight=t.W500)),
            ft.Text(
                f"{environment.terrain} · {environment.time_of_day} · {environment.weather}",
                style=t.mono(size=t.SIZE_META, color=t.TEXT_3, height=1.5),
            ),
            ft.Text(
                f"сид {scenario.master_seed} · предел {environment.max_turns}",
                style=t.mono(size=t.SIZE_META, color=t.TEXT_3, height=1.5),
            ),
        ],
    )


def topbar(
    title: str,
    subtitle: str = "",
    *,
    actions: Sequence[ft.Control] = (),
    mono_subtitle: bool = False,
    leading_extra: Sequence[ft.Control] = (),
) -> ft.Control:
    """Верхняя полоса: заголовок экрана слева, действия справа."""
    heading: list[ft.Control] = [
        ft.Text(title, style=t.sans(size=t.SIZE_SCREEN, weight=t.W600), no_wrap=True)
    ]
    if subtitle:
        style = (
            t.mono(size=t.SIZE_META, color=t.TEXT_3)
            if mono_subtitle
            else t.sans(size=t.SIZE_META, color=t.TEXT_3)
        )
        heading.append(ft.Text(subtitle, style=style, no_wrap=True))

    return ft.Container(
        content=ft.Row(
            [
                ft.Column(heading, spacing=2, tight=True),
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
    scrollable: bool = False,
) -> ft.View:
    """Собрать экран в общей рамке.

    ``scrollable`` включает прокрутку контента: пульт боя обязан помещаться
    целиком, остальные экраны могут прокручиваться на узком окне.
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
            scroll=ft.ScrollMode.AUTO if scrollable else None,
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
