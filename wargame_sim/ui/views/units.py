"""Отряды: список слева, редактор выбранного справа.

Раньше это были два экрана: таблица отрядов с четырьмя кнопками на каждой
строке и отдельный конструктор, откуда к следующему отряду вела только
навигация назад. Под таблицей стояли ещё две карточки — шаблоны групп,
которые непонятно куда добавляли группу, и импорт с полем для пути.

Теперь выбор отряда перерисовывает только правую половину, а всё, что
делают с отрядом целиком, живёт в «⋯» на его строке.
"""

from __future__ import annotations

from pathlib import Path

import flet as ft

from core.models import Battalion, Side, new_id
from core.samples import make_battalion, make_company, make_platoon
from core.storage import StorageError, load_battalion
from ui import theme as t
from ui.shell import screen
from ui.state import ROUTES, AppState
from ui.views import unit_editor as editor
from ui.widgets import common as c

ROUTE = ROUTES["units"]


def build(app: AppState, unit_id: str | None = None) -> ft.View:
    state = {"selected": unit_id or (app.open_unit[0] if app.open_unit else None), "query": ""}
    list_holder = ft.Column(spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
    count_holder = ft.Text(style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED))
    editor_holder = ft.Container(expand=True)
    available = t.content_width(app.window_width, right=editor.LIST_W)

    # -- выбор и перерисовка ------------------------------------------------
    def units() -> list[tuple[Path, Battalion]]:
        return app.units()

    def current(found: list[tuple[Path, Battalion]]) -> tuple[Path, Battalion] | None:
        for path, battalion in found:
            if battalion.id == state["selected"]:
                return path, battalion
        return found[0] if found else None

    def render() -> None:
        found = units()
        picked = current(found)
        state["selected"] = picked[1].id if picked else None
        render_list(found)
        render_editor(picked)
        app.refresh(list_holder, count_holder, editor_holder)

    def changed(selected: str | None) -> None:
        """Отряд сохранён, скопирован или удалён — список показывает новое."""
        if selected is not None:
            state["selected"] = selected
            found = units()
            render_list(found)
            if selected != (editor_holder.data or None):
                render_editor(current(found))
                app.refresh(editor_holder)
            app.refresh(list_holder, count_holder)
            return
        state["selected"] = None
        render()

    def select(battalion_id: str) -> None:
        if battalion_id == state["selected"]:
            return
        state["selected"] = battalion_id
        app.expanded_element = None
        found = units()
        render_list(found)
        render_editor(current(found))
        app.refresh(list_holder, editor_holder)

    def render_list(found: list[tuple[Path, Battalion]]) -> None:
        shown = [
            (path, battalion)
            for path, battalion in found
            if c.matches(state["query"], battalion.name, str(battalion.scale), str(battalion.order))
        ]
        count_holder.value = (
            f"{len(shown)} из {len(found)}" if state["query"] else str(len(found))
        )
        if not found:
            list_holder.controls = [
                c.empty_state(
                    "Отрядов пока нет",
                    "Создайте взвод, роту или батальон — или загрузите отряд из файла.",
                    icon=ft.Icons.GROUPS_OUTLINED,
                )
            ]
            return
        if not shown:
            list_holder.controls = [
                c.empty_state("Ничего не нашлось", f"По запросу «{state['query']}» отрядов нет.")
            ]
            return
        list_holder.controls = [
            c.list_row(
                battalion.name,
                f"{battalion.scale} · {battalion.personnel_current} чел."
                f" · групп {len(battalion.elements)}",
                selected=battalion.id == state["selected"],
                on_click=lambda b=battalion.id: select(b),
                menu=editor.unit_actions(app, path, battalion, on_changed=changed),
                last=index == len(shown) - 1,
            )
            for index, (path, battalion) in enumerate(shown)
        ]

    def render_editor(picked: tuple[Path, Battalion] | None) -> None:
        if picked is None:
            editor_holder.data = None
            editor_holder.content = c.card(
                [
                    c.empty_state(
                        "Выберите отряд слева",
                        "Здесь откроется его боевой порядок: группы, численность, "
                        "приказы и техника.",
                        icon=ft.Icons.ACCOUNT_TREE_OUTLINED,
                    )
                ],
                expand=True,
            )
            return
        path, battalion = picked
        editor_holder.data = battalion.id
        editor_holder.content = editor.editor_pane(
            app, path, battalion, on_changed=changed, available=available
        )

    def search(query: str) -> None:
        state["query"] = query
        render_list(units())
        app.refresh(list_holder, count_holder)

    # -- создание и импорт ----------------------------------------------------
    def created(battalion: Battalion) -> None:
        app.save_unit(battalion)
        app.notify(f"Создан «{battalion.name}»")
        state["selected"] = battalion.id
        app.expanded_element = None
        render()

    def create_platoon() -> None:
        created(make_platoon(new_id("vzv"), "Новый взвод", Side.A, app.config))

    def create_company() -> None:
        created(make_company(new_id("rota"), "Новая рота", Side.A, app.config))

    def create_battalion() -> None:
        created(make_battalion(new_id("bat"), "Новый батальон", Side.A, app.config))

    def create_empty() -> None:
        created(Battalion(id=new_id("bat"), name="Пустой отряд", side=Side.A, elements=[]))

    def pick_import() -> None:
        """Выбрать файл отряда системным окном."""
        app.ask_file("Выберите файл подразделения", load_from, extensions=("json",))

    def load_from(source: Path | str) -> None:
        try:
            battalion = load_battalion(Path(source))
        except StorageError as error:
            app.notify(str(error))
            return
        battalion.id = new_id("bat")
        app.save_unit(battalion)
        app.notify(f"Загружен «{battalion.name}»")
        state["selected"] = battalion.id
        render()

    # Взвод — первым: бои чаще всего идут взводами и отделениями.
    app.bind("Ctrl+N", create_platoon)
    search_box, focus_search = c.search_box("", search, placeholder="Найти отряд", width=None)
    app.bind("Ctrl+F", focus_search)

    found = units()
    picked = current(found)
    state["selected"] = picked[1].id if picked else None
    render_list(found)
    render_editor(picked)

    warnings: list[ft.Control] = []
    broken = app.broken_units()
    if broken:
        details = "; ".join(f"{path.name} — {reason}" for path, reason in broken[:3])
        warnings.append(
            c.warn_banner(f"Не читается файлов: {len(broken)}. В списке их нет. {details}")
        )

    list_panel = ft.Container(
        content=ft.Column(
            [
                ft.Container(
                    content=ft.Row(
                        [t.card_title("Отряды"), c.spacer(), count_holder],
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    height=t.CARD_HEADER_H,
                    padding=ft.Padding.symmetric(horizontal=t.PAD_CARD),
                ),
                ft.Container(
                    content=search_box,
                    padding=ft.Padding.only(left=t.GAP_SM, right=t.GAP_SM, bottom=t.GAP_SM),
                    border=t.border_bottom(t.BORDER),
                ),
                list_holder,
            ],
            spacing=0,
            expand=True,
            horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
        ),
        width=editor.LIST_W,
        bgcolor=t.CARD_BG,
        border=ft.Border.all(1, t.BORDER),
        border_radius=t.R_CARD,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
    )

    return screen(
        app,
        active="units",
        title="Отряды",
        subtitle="Силы любого масштаба, из которых собираются бои",
        actions=[
            c.create_menu(
                "Создать",
                [
                    c.MenuItem("Взвод  Ctrl+N", create_platoon, icon=ft.Icons.GROUPS_OUTLINED),
                    c.MenuItem("Рота", create_company, icon=ft.Icons.GROUPS_OUTLINED),
                    c.MenuItem("Батальон", create_battalion, icon=ft.Icons.GROUPS_OUTLINED),
                    c.MENU_DIVIDER,
                    c.MenuItem("Пустой отряд", create_empty, icon=ft.Icons.ADD),
                ],
            ),
            c.more_menu(
                [c.MenuItem("Загрузить из файла…", pick_import, icon=ft.Icons.UPLOAD_FILE)]
            ),
        ],
        body=ft.Column(
            [
                *warnings,
                ft.Row(
                    [list_panel, editor_holder],
                    spacing=t.GAP,
                    vertical_alignment=ft.CrossAxisAlignment.START,
                    expand=True,
                ),
            ],
            spacing=t.GAP,
            expand=True,
        ),
    )
