"""Список подразделений: таблица отрядов любого масштаба и операции над ними."""

from __future__ import annotations

import json
from pathlib import Path

import flet as ft

from core.models import Battalion, Side, new_id
from core.samples import make_battalion, make_platoon
from core.storage import StorageError, delete_file, load_battalion
from ui import theme as t
from ui.shell import screen
from ui.state import ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["units"]

COLUMNS: tuple[c.Col, ...] = (
    c.Col("Отряд", expand=True),
    c.Col("Масштаб", 90),
    c.Col("Групп", 70, numeric=True),
    c.Col("Л/с", 90, numeric=True),
    c.Col("Техника", 90, numeric=True),
    c.Col("Мораль", 80, numeric=True),
    c.Col("Опыт", 70, numeric=True),
    c.Col("Приказ", 120, pad_left=16),
    c.Col("", 200),
)


def build(app: AppState) -> ft.View:
    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))
    import_path = {"value": ""}

    def refresh() -> None:
        app.go(ROUTE)

    def create_typical() -> None:
        battalion = make_battalion(new_id("bat"), "Новый батальон", Side.A, app.config)
        app.save_unit(battalion)
        app.notify(f"Создан «{battalion.name}»")
        app.go(ROUTES["unit"].format(id=battalion.id))

    def create_platoon() -> None:
        battalion = make_platoon(new_id("vzv"), "Новый взвод", Side.A, app.config)
        app.save_unit(battalion)
        app.notify(f"Создан «{battalion.name}»")
        app.go(ROUTES["unit"].format(id=battalion.id))

    def create_empty() -> None:
        battalion = Battalion(id=new_id("bat"), name="Пустой отряд", side=Side.A, elements=[])
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
        app.refresh(message)

    def do_import() -> None:
        raw = import_path["value"].strip()
        if not raw:
            message.value = "Укажите путь к файлу подразделения."
            app.refresh(message)
            return
        try:
            battalion = load_battalion(Path(raw))
        except StorageError as error:
            message.value = str(error)
            app.refresh(message)
            return
        battalion.id = new_id("bat")
        app.save_unit(battalion)
        app.notify(f"Загружен «{battalion.name}»")
        refresh()

    def add_template(type_name: str) -> None:
        """Шаблон группы добавляется в первый отряд списка."""
        units = app.units()
        if not units:
            message.value = "Сначала создайте отряд — шаблон некуда положить."
            app.refresh(message)
            return
        app.go(ROUTES["unit"].format(id=units[0][1].id))

    def row(path: Path, battalion: Battalion, *, last: bool) -> ft.Control:
        actions = ft.Row(
            [
                c.spacer(),
                c.secondary_button(
                    "Открыть",
                    lambda: app.go(ROUTES["unit"].format(id=battalion.id)),
                    height=t.BUTTON_SM_H,
                ),
                c.icon_button(
                    ft.Icons.CONTENT_COPY,
                    lambda: duplicate(battalion),
                    size=t.BUTTON_SM_H,
                    icon_size=16,
                    tooltip="Копировать",
                ),
                c.icon_button(
                    ft.Icons.DOWNLOAD_OUTLINED,
                    lambda: export(path, battalion),
                    size=t.BUTTON_SM_H,
                    icon_size=16,
                    tooltip="Экспорт JSON",
                ),
                c.icon_button(
                    ft.Icons.DELETE_OUTLINE,
                    lambda: remove(path, battalion),
                    size=t.BUTTON_SM_H,
                    icon_size=16,
                    color=t.LOSS,
                    tooltip="Удалить",
                ),
            ],
            spacing=6,
        )
        return c.table_row(
            COLUMNS,
            [
                t.text(battalion.name, size=t.SIZE_BODY, weight=t.W500),
                t.text(str(battalion.scale), size=t.SIZE_ROW, color=t.TEXT_3),
                t.num(str(len(battalion.elements))),
                t.num(str(battalion.personnel_current)),
                t.num(str(battalion.vehicles_current)),
                t.num(f"{battalion.morale:.0f}"),
                t.num(f"{battalion.experience:.1f}"),
                t.text(str(battalion.order), size=t.SIZE_ROW, color=t.TEXT_3),
                actions,
            ],
            height=t.TABLE_ROW_TALL_H,
            last=last,
        )

    units = app.units()
    if units:
        body: ft.Control = c.table(
            COLUMNS,
            [
                row(path, battalion, last=index == len(units) - 1)
                for index, (path, battalion) in enumerate(units)
            ],
        )
    else:
        body = ft.Column(
            [c.table_head(COLUMNS), c.empty_hint("Подразделений пока нет — создайте первое.")],
            spacing=0,
            expand=True,
        )

    templates = c.card(
        [
            t.card_title("Типовые шаблоны групп"),
            c.flow(
                [
                    c.chip(entry.label, lambda key=key: add_template(key))
                    for key, entry in sorted(app.config.element_types.element_types.items())
                ],
                spacing=t.GAP_SM,
            ),
        ],
        expand=True,
    )

    path_field, _ = c.text_field(
        "",
        lambda value: import_path.update(value=value),
        placeholder="Путь к JSON-файлу подразделения",
        expand=True,
    )

    import_card = c.card(
        [
            t.card_title("Импорт"),
            ft.Row(
                [path_field, c.primary_button("Загрузить", do_import)],
                spacing=t.GAP_SM,
            ),
            c.note(
                "Импортированный отряд появится в списке и станет доступен "
                "как сторона A или B."
            ),
            message,
        ],
        width=420,
    )

    return screen(
        app,
        active="units",
        title="Подразделения",
        subtitle="Отряды любого масштаба, из которых собираются бои",
        actions=[
            c.tertiary_button("Импорт JSON", do_import, icon=ft.Icons.UPLOAD_FILE),
            c.secondary_button("Пустой", create_empty),
            c.secondary_button("Взвод", create_platoon),
            c.primary_button("Батальон", create_typical, icon=ft.Icons.ADD),
        ],
        body=ft.Column(
            [
                c.framed_card("Отряды", body, expand=True),
                ft.Row(
                    [templates, import_card],
                    spacing=t.GAP,
                    vertical_alignment=ft.CrossAxisAlignment.START,
                ),
            ],
            spacing=t.GAP,
            expand=True,
        ),
    )
