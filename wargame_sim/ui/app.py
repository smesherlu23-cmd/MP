"""Роутер приложения.

Рамка (боковая навигация и верхняя полоса) живёт в :mod:`ui.shell` и
одинакова на всех экранах, поэтому переход перерисовывает только контент.
Кнопок «назад» и «на главную» нет — их роль взяла на себя навигация слева.
"""

from __future__ import annotations

import inspect
import re
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

import flet as ft

from core.config import ConfigError
from ui import theme as t
from ui.shell import screen
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
from ui.widgets import common as c

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
            return _error_view(app, str(error))

    return _not_found(app, path)


def _not_found(app: AppState, path: str) -> ft.View:
    return screen(
        app,
        active="home",
        title="Экран не найден",
        subtitle=f"Маршрут «{path}» неизвестен",
        body=c.empty_hint("Выберите раздел в навигации слева."),
    )


def _error_view(app: AppState, message: str) -> ft.View:
    return screen(
        app,
        active="config",
        title="Ошибка конфигурации",
        body=ft.Column(
            [
                c.error_banner(message),
                c.secondary_button(
                    "Открыть редактор коэффициентов",
                    lambda: app.go(ROUTES["config"]),
                ),
            ],
            spacing=t.GAP,
            tight=True,
        ),
    )


def main(page: ft.Page) -> None:
    """Точка входа Flet-приложения.

    Активным считается первый View в ``page.views``, а ``push_route`` на уже
    текущий маршрут события не порождает — поэтому экран рисуется явно, а
    история переходов ведётся отдельно.
    """
    app = AppState(page)
    history: list[str] = []

    page.title = TITLE
    page.padding = 0
    page.spacing = 0
    page.bgcolor = t.CONTENT_BG
    page.fonts = dict(t.FONT_FILES)
    page.theme_mode = ft.ThemeMode.LIGHT
    page.theme = ft.Theme(font_family=t.SANS)
    page.window.width = 1600
    page.window.height = 1000
    page.window.min_width = 1280
    page.window.min_height = 800

    def notify(message: str) -> None:
        page.show_dialog(ft.SnackBar(content=ft.Text(message)))

    def render() -> None:
        view = resolve(app, page.route or ROUTES["home"])
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

    def back() -> None:
        if history:
            navigate(history.pop(), remember=False)

    def switch_theme(dark: bool) -> None:
        page.theme_mode = ft.ThemeMode.DARK if dark else ft.ThemeMode.LIGHT
        render()

    app.notifier = notify
    app.navigator = navigate
    app.theme_switcher = switch_theme
    page.on_route_change = lambda *_: render()
    page.on_view_pop = lambda *_: back()
    render()


def run() -> None:
    """Запустить приложение. Шрифты лежат в assets и грузятся с диска."""
    from pathlib import Path

    assets = Path(__file__).resolve().parents[1] / "assets"
    ft.run(main, assets_dir=str(assets))


if __name__ == "__main__":
    run()
