"""Список подразделений: создать, копировать, импорт/экспорт, удалить."""

from __future__ import annotations

import json
from pathlib import Path

import flet as ft

from core.models import Battalion, Side, new_id
from core.samples import make_battalion
from core.storage import StorageError, delete_file, load_battalion
from ui.state import ROUTES, AppState
from ui.widgets.common import (
    GAP,
    PAD,
    action_button,
    card,
    empty_hint,
    error_banner,
    link_button,
    page_title,
    text_button,
)

ROUTE = ROUTES["units"]


def build(app: AppState) -> ft.View:
    message = ft.Text("", size=12, opacity=0.75)
    import_path = ft.Ref[ft.TextField]()

    def refresh() -> None:
        app.go(ROUTE)

    def create() -> None:
        battalion = make_battalion(new_id("bat"), "Новый батальон", Side.A, app.config)
        app.save_unit(battalion)
        app.notify(f"Создан «{battalion.name}»")
        app.go(ROUTES["unit"].format(id=battalion.id))

    def create_empty() -> None:
        battalion = Battalion(id=new_id("bat"), name="Пустой батальон", side=Side.A, elements=[])
        app.save_unit(battalion)
        app.go(ROUTES["unit"].format(id=battalion.id))

    def duplicate(source: Battalion) -> None:
        copy = source.model_copy(deep=True)
        copy.id = new_id("bat")
        copy.name = f"{source.name} (копия)"
        app.save_unit(copy)
        app.notify(f"Скопирован «{source.name}»")
        refresh()

    def remove(path: Path, battalion: Battalion) -> None:
        delete_file(path)
        app.notify(f"Удалён «{battalion.name}»")
        refresh()

    def export(path: Path, battalion: Battalion) -> None:
        target = path.with_name(f"{path.stem}_export.json")
        target.write_text(
            json.dumps(battalion.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        message.value = f"Выгружено: {target}"
        message.update()

    def do_import() -> None:
        raw = (import_path.current.value or "").strip()
        if not raw:
            message.value = "Укажите путь к файлу подразделения."
            message.update()
            return
        try:
            battalion = load_battalion(Path(raw))
        except StorageError as error:
            message.value = str(error)
            message.update()
            return
        battalion.id = new_id("bat")
        app.save_unit(battalion)
        app.notify(f"Загружен «{battalion.name}»")
        refresh()

    units = app.units()
    if units:
        rows: list[ft.Control] = [
            ft.Container(
                content=ft.Row(
                    [
                        ft.Column(
                            [
                                ft.Text(battalion.name, size=14, weight=ft.FontWeight.W_600),
                                ft.Text(
                                    f"{len(battalion.elements)} элем. · "
                                    f"{battalion.personnel_current} чел. · "
                                    f"техники {battalion.vehicles_current} · "
                                    f"приказ {battalion.order}",
                                    size=12,
                                    opacity=0.7,
                                ),
                            ],
                            spacing=2,
                            expand=True,
                        ),
                        link_button(
                            "Открыть", ROUTES["unit"].format(id=battalion.id), app.go
                        ),
                        text_button("Копировать", lambda b=battalion: duplicate(b)),
                        text_button("Экспорт", lambda p=path, b=battalion: export(p, b)),
                        text_button("Удалить", lambda p=path, b=battalion: remove(p, b)),
                    ],
                    spacing=GAP,
                    wrap=True,
                ),
                padding=PAD,
                border_radius=10,
                border=ft.Border.all(1, ft.Colors.OUTLINE_VARIANT),
            )
            for path, battalion in units
        ]
        listing: ft.Control = ft.Column(rows, spacing=GAP, tight=True)
    else:
        listing = empty_hint("Подразделений пока нет — создайте первое.")

    controls: list[ft.Control] = [
        page_title("Подразделения", "Батальоны, из которых собираются бои."),
    ]
    if app.config_error:
        controls.append(error_banner(app.config_error))
    controls += [
        ft.Row(
            [
                action_button("Создать типовой", create, icon=ft.Icons.ADD),
                text_button("Создать пустой", create_empty),
                link_button(
                "На главную", ROUTES["home"], app.go, icon=ft.Icons.ARROW_BACK),
            ],
            spacing=GAP,
            wrap=True,
        ),
        listing,
        card(
            "Импорт",
            [
                ft.Row(
                    [
                        ft.TextField(
                            ref=import_path,
                            label="Путь к JSON-файлу подразделения",
                            dense=True,
                            expand=True,
                        ),
                        action_button("Загрузить", do_import, icon=ft.Icons.UPLOAD_FILE),
                    ],
                    spacing=GAP,
                ),
                message,
            ],
        ),
    ]

    return ft.View(
        route=ROUTE,
        controls=[ft.Column(controls, spacing=GAP, scroll=ft.ScrollMode.AUTO, expand=True)],
        padding=PAD,
    )
