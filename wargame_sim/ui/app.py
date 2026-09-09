"""Роутер и стек View: навигация с рабочей кнопкой «назад» (§10)."""

from __future__ import annotations

import inspect
import re
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

import flet as ft

from core.config import ConfigError
from ui.state import ROUTES, AppState
from ui.views import (
    archive,
    batch,
    battle_result,
    battle_run,
    battle_setup,
    config_editor,
    home,
    unit_editor,
    units,
)
from ui.widgets.common import PAD, error_banner, link_button, page_title

TITLE = "Симулятор боя"

#: Шаблон маршрута → построитель экрана. Порядок важен: сначала точные пути.
Builder = Callable[..., ft.View]
ROUTE_TABLE: tuple[tuple[re.Pattern[str], Builder], ...] = (
    (re.compile(r"^/$"), lambda app: home.build(app)),
    (re.compile(r"^/units$"), lambda app: units.build(app)),
    (re.compile(r"^/units/(?P<unit_id>[^/]+)$"), unit_editor.build),
    (re.compile(r"^/battle/setup$"), lambda app: battle_setup.build(app)),
    (re.compile(r"^/battle/(?P<battle_id>[^/]+)/result$"), battle_result.build),
    (re.compile(r"^/battle/(?P<battle_id>[^/]+)$"), battle_run.build),
    (re.compile(r"^/batch$"), lambda app: batch.build(app)),
    (re.compile(r"^/config$"), config_editor.build),
    (re.compile(r"^/archive$"), lambda app: archive.build(app)),
)


def resolve(app: AppState, route: str) -> ft.View:
    """Построить экран по маршруту; неизвестный маршрут — понятная заглушка."""
    parsed = urlparse(route or "/")
    path = parsed.path or "/"
    query = {key: values[0] for key, values in parse_qs(parsed.query).items()}

    for pattern, builder in ROUTE_TABLE:
        match = pattern.match(path)
        if match is None:
            continue
        accepted = set(inspect.signature(builder).parameters)
        arguments = {
            name: value
            for name, value in {**match.groupdict(), **query}.items()
            if name in accepted
        }
        try:
            return builder(app, **arguments)
        except ConfigError as error:
            return _error_view(app, path, str(error))

    return _not_found(app, path)


def _not_found(app: AppState, path: str) -> ft.View:
    return ft.View(
        route=path,
        controls=[
            page_title("Экран не найден", f"Маршрут «{path}» неизвестен."),
            link_button(
                "На главную", ROUTES["home"], app.go),
        ],
        padding=PAD,
    )


def _error_view(app: AppState, path: str, message: str) -> ft.View:
    return ft.View(
        route=path,
        controls=[
            page_title("Ошибка конфигурации"),
            error_banner(message),
            link_button("Открыть редактор коэффициентов", ROUTES["config"], app.go),
            link_button(
                "На главную", ROUTES["home"], app.go),
        ],
        padding=PAD,
    )


def main(page: ft.Page) -> None:
    """Точка входа Flet-приложения.

    Активным считается первый View в ``page.views``, а ``push_route`` на уже
    текущий маршрут события не порождает — поэтому экран рисуется явно, а
    история переходов ведётся отдельно, чтобы кнопка «назад» работала и в
    десктопном окне, и в браузере.
    """
    app = AppState(page)
    history: list[str] = []

    page.title = TITLE
    page.theme_mode = ft.ThemeMode.SYSTEM
    page.padding = 0

    def notify(message: str) -> None:
        page.show_dialog(ft.SnackBar(content=ft.Text(message)))

    def toggle_theme() -> None:
        page.theme_mode = (
            ft.ThemeMode.DARK if page.theme_mode != ft.ThemeMode.DARK else ft.ThemeMode.LIGHT
        )
        page.update()

    def back() -> None:
        if not history:
            return
        target = history.pop()
        navigate(target, remember=False)

    def appbar() -> ft.AppBar:
        return ft.AppBar(
            title=ft.Text(TITLE),
            leading=ft.IconButton(
                icon=ft.Icons.ARROW_BACK,
                tooltip="Назад",
                disabled=not history,
                on_click=lambda *_: back(),
            ),
            actions=[
                ft.IconButton(
                    icon=ft.Icons.BRIGHTNESS_6,
                    tooltip="Светлая или тёмная тема",
                    on_click=lambda *_: toggle_theme(),
                ),
                ft.IconButton(
                    icon=ft.Icons.HOME_OUTLINED,
                    tooltip="На главную",
                    on_click=lambda *_: navigate(ROUTES["home"]),
                ),
            ],
        )

    def render() -> None:
        view = resolve(app, page.route)
        view.appbar = appbar()
        page.views.clear()
        page.views.append(view)
        page.update()

    def navigate(route: str, *, remember: bool = True) -> None:
        current = page.route or ROUTES["home"]
        if route == current:
            render()  # повторный переход на тот же маршрут — просто перерисовка
            return
        if remember:
            history.append(current)
        page.run_task(page.push_route, route)

    app.notifier = notify
    app.navigator = navigate
    page.on_route_change = lambda *_: render()
    page.on_view_pop = lambda *_: back()
    render()


def run() -> None:
    ft.run(main)


if __name__ == "__main__":
    run()
