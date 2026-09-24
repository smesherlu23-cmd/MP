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
from ui.shell import NAV, screen
from ui.state import ROUTES, AppState
from ui.views import (
    archive,
    batch,
    battle_result,
    battle_run,
    battle_setup,
    config_editor,
    home,
    materiel,
    troops,
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
    (re.compile(r"^/materiel/(?P<library>[^/]+)$"), materiel.build),
    (re.compile(r"^/troops$"), troops.build),
    (re.compile(r"^/battle/setup$"), lambda app: battle_setup.build(app)),
    (re.compile(r"^/battle/(?P<battle_id>[^/]+)/result$"), battle_result.build),
    (re.compile(r"^/battle/(?P<battle_id>[^/]+)$"), battle_run.build),
    (re.compile(r"^/batch$"), lambda app: batch.build(app)),
    (re.compile(r"^/config$"), config_editor.build),
    (re.compile(r"^/archive$"), lambda app: archive.build(app)),
)


#: Ctrl+1…8 — разделы навигации по порядку, как в браузере или мессенджере.
SECTION_KEYS: tuple[str, ...] = tuple(str(index + 1) for index in range(len(NAV)))


def key_name(event: ft.KeyboardEvent) -> str:
    """Сочетание в виде «Ctrl+Shift+Enter».

    Cmd приравнен к Ctrl: на macOS модификатор действий — он.
    """
    parts: list[str] = []
    if event.ctrl or event.meta:
        parts.append("Ctrl")
    if event.alt:
        parts.append("Alt")
    if event.shift:
        parts.append("Shift")
    parts.append(event.key)
    return "+".join(parts)


def resolve(app: AppState, route: str) -> ft.View:
    """Построить экран по маршруту; неизвестный маршрут — понятная заглушка."""
    # Горячие клавиши принадлежат экрану: старые снимаются вместе с ним,
    # иначе Ctrl+F с библиотеки продолжал бы работать в бою.
    app.shortcuts.clear()
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


def current_width(page: ft.Page) -> int:
    """Ширина, под которую раскладываются таблицы.

    Сначала ширина самой страницы: у окна её может не быть (в браузере
    ``page.window.width`` пуст), и тогда таблица считала бы колонки под
    штатные 1600 px при настоящих 1280 — и колонка названия схлопывалась.
    """
    return int(page.width or page.window.width or t.WINDOW_W)


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
    page.fonts = dict(t.FONT_FILES)
    page.window.width = t.WINDOW_W
    page.window.height = t.WINDOW_H
    page.window.min_width = t.WINDOW_MIN_W
    page.window.min_height = t.WINDOW_MIN_H
    app.window_width = current_width(page)

    def notify(message: str) -> None:
        page.show_dialog(ft.SnackBar(content=ft.Text(message)))

    def open_dialog(dialog: ft.Control) -> None:
        page.show_dialog(dialog)

    def close_dialog() -> None:
        page.pop_dialog()

    # Один-единственный View на всё приложение: при замене стека Flutter
    # анимирует навигацию, а рамка у нас одинаковая на всех экранах —
    # анимировать нечего. Меняем содержимое, а не сам View.
    #
    # `FilePicker` — сервис, а не контрол: он живёт в `services` вида и
    # переживает смену содержимого, поэтому окно выбора папки открывается
    # с любого экрана.
    picker = ft.FilePicker()
    root = ft.View(
        route=ROUTES["home"],
        padding=0,
        spacing=0,
        bgcolor=t.CONTENT_BG,
        services=[picker],
    )

    def ask_directory(title: str, initial: str, on_pick: Callable[[str], None]) -> None:
        """Системное окно выбора папки. Методы пикера — корутины."""

        async def work() -> None:
            chosen = await picker.get_directory_path(
                dialog_title=title, initial_directory=initial
            )
            if chosen:
                on_pick(chosen)
            else:
                notify("Выгрузка отменена.")

        page.run_task(work)

    def ask_file(
        title: str,
        initial: str,
        extensions: tuple[str, ...],
        on_pick: Callable[[str], None],
    ) -> None:
        async def work() -> None:
            files = await picker.pick_files(
                dialog_title=title,
                initial_directory=initial,
                allowed_extensions=list(extensions) or None,
                file_type=ft.FilePickerFileType.CUSTOM
                if extensions
                else ft.FilePickerFileType.ANY,
            )
            if files and files[0].path:
                on_pick(files[0].path)

        page.run_task(work)

    def paint(dark: bool) -> None:
        """Переключить палитру и всё, что красит не наша вёрстка.

        Темы Flutter задаются обе сразу: ``theme_mode`` только выбирает,
        какую из них взять, и без второй половины выпадающее меню в тёмной
        теме осталось бы белым.
        """
        t.apply(dark)
        theme = t.flet_theme()
        page.theme = theme
        page.dark_theme = theme
        page.theme_mode = t.theme_mode()
        page.bgcolor = t.CONTENT_BG
        root.bgcolor = t.CONTENT_BG

    def render() -> None:
        view = resolve(app, page.route or ROUTES["home"])
        root.controls = view.controls
        root.bgcolor = view.bgcolor
        if not page.views or page.views[0] is not root:
            page.views.clear()
            page.views.append(root)
        page.update()

    def resized(*_: object) -> None:
        """Окно изменили — таблицы пересобирают набор колонок под ширину."""
        width = current_width(page)
        if width == app.window_width:
            return
        app.window_width = width
        render()

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
        paint(dark)
        render()

    def on_key(event: ft.KeyboardEvent) -> None:
        """Горячие клавиши окна.

        Все сочетания — с модификатором либо Escape: обработчик один на всё
        окно и не знает, стоит ли курсор в текстовом поле, а `Пробел` без
        модификатора попадал бы сюда прямо во время набора.
        """
        keys = key_name(event)
        if keys == "Escape":
            close_dialog()
            return
        if app.press(keys):
            return
        if keys.startswith("Ctrl+") and event.key in SECTION_KEYS:
            navigate(NAV[SECTION_KEYS.index(event.key)].route)

    app.notifier = notify
    app.dialog_opener = open_dialog
    app.dialog_closer = close_dialog
    app.directory_asker = ask_directory
    app.file_asker = ask_file
    app.navigator = navigate
    app.theme_switcher = switch_theme
    page.on_keyboard_event = on_key
    page.on_resize = resized
    page.on_route_change = lambda *_: render()
    page.on_view_pop = lambda *_: back()
    paint(app.dark_theme)  # запомненная с прошлого запуска тема
    render()


def run() -> None:
    """Запустить приложение. Шрифты лежат в assets и грузятся с диска.

    В собранном ``flet build`` исполняемом файле каталог ассетов кладёт
    сама сборка, и путь рядом с исходниками не существует — тогда
    остаётся значение по умолчанию, иначе шрифты не найдутся.
    """
    from pathlib import Path

    assets = Path(__file__).resolve().parents[1] / "assets"
    if assets.is_dir():
        ft.run(main, assets_dir=str(assets))
    else:
        ft.run(main)


if __name__ == "__main__":
    run()
