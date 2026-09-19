"""Коэффициенты: поля раздела, режим YAML, тумблеры, сброс к эталону (§5, §10).

Поля не свёрстаны по картинке, а построены по реальной схеме из
``core.config.schema`` и реальному содержимому YAML: новый коэффициент в
конфиге появляется здесь сам. Правка пишется точечно в текст файла, поэтому
комментарии в конфиге остаются на месте.
"""

from __future__ import annotations

import flet as ft

from core.config import ConfigError
from core.config.introspect import (
    KIND_BOOL,
    KIND_CURVE,
    KIND_INT,
    KIND_TEXT,
    VERSION_KEY,
    FieldSpec,
    GroupSpec,
    PatchError,
    describe,
    differences,
    patch_scalar,
)
from core.config.schema import TogglesBody
from ui import theme as t
from ui.shell import aside_block, screen
from ui.state import CONFIG_FIELDS, CONFIG_YAML, ROUTES, AppState
from ui.widgets import common as c

ROUTE = ROUTES["config"]

#: Человекочитаемые названия разделов конфигурации.
SECTION_LABELS: dict[str, str] = {
    "terrain": "Местность",
    "weather": "Погода",
    "time_of_day": "Время суток",
    "orders": "Приказы",
    "element_types": "Типы элементов",
    "experience": "Опыт",
    "morale": "Мораль",
    "combat": "Ядро расчёта",
    "supply": "Снабжение",
    "fatigue": "Усталость",
    "toggles": "Тумблеры",
}

#: Названия групп, у которых ключ YAML сам по себе ничего не говорит.
#: Всё, чего здесь нет (местность, приказы, типы элементов), уже названо
#: по-русски в самом конфиге и берётся оттуда.
GROUP_LABELS: dict[str, str] = {
    "combat.casualties": "Потери в личном составе",
    "combat.casualties.noise": "Случайность огня",
    "combat.vehicles": "Потери техники",
    "combat.detection": "Обнаружение",
    "combat.detection.intel": "Разведданные",
    "combat.detection.contact_thresholds": "Пороги контакта",
    "combat.detection.target_share": "Доля доступных целей",
    "combat.detection.accuracy": "Точность по контакту",
    "combat.initiative": "Инициатива",
    "combat.initiative.intel": "Разведданные",
    "combat.initiative.roll": "Бросок инициативы",
    "combat.targeting": "Целеуказание",
    "combat.targeting.noise": "Случайность выбора цели",
    "combat.suppression": "Подавление",
    "combat.curves": "Кривые",
    "combat.checks": "Проверки конца хода",
    "morale.weights": "Веса морали",
    "morale.thresholds": "Пороги морали",
    "supply.ammo": "Боезапас",
    "supply.fuel": "Топливо",
    "supply.equipment": "Снаряжение",
    "toggles": "Учитывать в расчёте",
}

#: Подписи тумблеров опциональных параметров (§4.5).
TOGGLE_LABELS: dict[str, str] = {
    "fuel": "Топливо",
    "equipment": "Снаряжение",
    "vehicle_condition": "Состояние техники",
    "readiness": "Готовность",
    "commander_influence": "Влияние командира",
    "intel": "Разведданные",
    "fatigue": "Усталость",
}

VIEW_OPTIONS: tuple[tuple[str, str], ...] = (
    (CONFIG_FIELDS, "поля"),
    (CONFIG_YAML, "YAML"),
)

#: Ширина поля в сетке параметров — четыре колонки в левой карточке.
GRID_FIELD_W = 214

#: Сколько отличий от эталона перечислять поимённо.
SHOWN_DIFFERENCES = 6


def group_title(group: GroupSpec) -> str:
    """Название группы: человеческое, если оно известно, иначе ключ YAML."""
    if not group.path:
        return "Значения раздела"
    return GROUP_LABELS.get(group.dotted, group.key)


def build(app: AppState, section: str = "combat") -> ft.View:
    store = app.store
    sections = store.sections()
    if section not in sections:
        section = sections[0]

    app.config_section = section

    message = ft.Text(style=t.sans(size=t.SIZE_ROW, color=t.TEXT_3))
    error_holder = ft.Container()
    body_holder = ft.Container(expand=True)
    toggles_holder = ft.Column(spacing=2, tight=True)
    changed_holder = ft.Container()
    editor = ft.TextField(
        value="",
        multiline=True,
        min_lines=24,
        max_lines=80,
        border=ft.InputBorder.NONE,
        content_padding=ft.Padding.all(0),
        text_style=t.mono(size=t.SIZE_ROW, height=1.55),
        cursor_color=t.TEXT,
        dense=True,
    )

    # -- чтение раздела -----------------------------------------------------
    def raw() -> dict:
        return store.raw(section)

    def version() -> int:
        return int(raw().get(VERSION_KEY, 1))

    def show_error(error: ConfigError | None) -> None:
        error_holder.content = None if error is None else c.error_banner(str(error))
        app.refresh(error_holder)

    def say(text: str) -> None:
        message.value = text
        app.refresh(message)

    # -- запись -------------------------------------------------------------
    def write(text: str) -> bool:
        """Проверить и записать раздел. При ошибке файл остаётся прежним."""
        try:
            store.save_text(section, text)
        except ConfigError as error:
            show_error(error)
            say("Изменения не применены — файл остался прежним.")
            return False
        app.reload_config()
        show_error(None)
        return True

    def set_value(spec: FieldSpec, value: object) -> None:
        try:
            patched = patch_scalar(store.raw_text(section), spec.path, value)
        except (ConfigError, PatchError) as error:
            show_error(error if isinstance(error, ConfigError) else None)
            say(f"Не нашёл «{spec.dotted}» в тексте файла — поправьте в режиме YAML.")
            return
        if write(patched):
            say(f"{spec.dotted} = {value}. Следующий ход считается по новому значению.")
            render_changed()

    # -- действия верхней полосы -------------------------------------------
    def apply_yaml() -> None:
        if app.config_view != CONFIG_YAML:
            return
        if write(editor.value or ""):
            say("Применено. Новые коэффициенты действуют со следующего расчёта.")
            render_changed()

    def reset_section() -> None:
        try:
            store.reset_section(section)
        except ConfigError as error:
            show_error(error)
            return
        app.reload_config()
        show_error(None)
        say("Раздел сброшен к эталонным значениям из config/defaults.")
        render_body()
        render_changed()

    def reset_all() -> None:
        store.reset_all()
        app.reload_config()
        show_error(None)
        say("Все разделы сброшены к значениям по умолчанию.")
        render_body()
        render_toggles()
        render_changed()

    def set_view(value: str) -> None:
        app.config_view = value
        view_switch.content = c.segmented(VIEW_OPTIONS, value, set_view)
        render_body()
        app.refresh(view_switch)
        app.go(f"{ROUTE}?section={section}")

    # -- тумблеры -----------------------------------------------------------
    def set_toggle(name: str, value: bool) -> None:
        try:
            patched = patch_scalar(store.raw_text("toggles"), ("toggles", name), value)
            store.save_text("toggles", patched)
        except (ConfigError, PatchError) as error:
            show_error(error if isinstance(error, ConfigError) else None)
            say("Тумблер не переключился — проверьте config/toggles.yaml.")
            return
        app.reload_config()
        show_error(None)
        label = TOGGLE_LABELS.get(name, name)
        say(f"«{label}» " + ("учитывается в расчёте." if value else "выключен: модификатор 1.0."))
        render_toggles()
        if section == "toggles":
            render_body()

    def render_toggles() -> None:
        current = app.config.tog
        toggles_holder.controls = [
            c.toggle(
                TOGGLE_LABELS.get(name, name),
                bool(getattr(current, name)),
                lambda value, key=name: set_toggle(key, value),
            )
            for name in TogglesBody.model_fields
        ]
        app.refresh(toggles_holder)

    # -- «изменено в этом разделе» -----------------------------------------
    def render_changed() -> None:
        try:
            current = raw()
            reference = _defaults(store, section)
        except ConfigError as error:
            show_error(error)
            return
        paths = [
            path.removeprefix(f"{section}.")
            for path in differences(current, reference)
            if path != VERSION_KEY
        ]
        if paths:
            listed = ", ".join(paths[:SHOWN_DIFFERENCES])
            tail = " и другие" if len(paths) > SHOWN_DIFFERENCES else ""
            text = f"{len(paths)} знач. отличается от эталона: {listed}{tail}."
        else:
            text = "Раздел совпадает с эталоном из config/defaults."
        changed_holder.content = ft.Column(
            [t.caption("Изменено в этом разделе"), c.note(text)],
            spacing=4,
            tight=True,
        )
        app.refresh(changed_holder)

    # -- тело карточки «Параметры» -----------------------------------------
    def field_control(spec: FieldSpec) -> ft.Control:
        if spec.kind == KIND_BOOL:
            return c.labeled(
                spec.key,
                c.toggle("", bool(spec.value), lambda value, s=spec: set_value(s, value)),
                width=GRID_FIELD_W,
            )
        if not spec.editable:
            hint = (
                f"кривая, точек {len(spec.value)}"
                if spec.kind == KIND_CURVE
                else ", ".join(str(item) for item in spec.value)
            )
            return c.labeled(
                spec.key,
                ft.Container(
                    content=ft.Text(
                        hint,
                        style=t.mono(size=t.SIZE_ROW, color=t.TEXT_PLACEHOLDER),
                        no_wrap=True,
                    ),
                    height=t.FIELD_H,
                    bgcolor=t.SURFACE_ALT,
                    border=ft.Border.all(1, t.BORDER),
                    border_radius=t.R_FIELD,
                    padding=ft.Padding.only(left=10, right=6),
                    alignment=ft.Alignment.CENTER_LEFT,
                    tooltip="правится в режиме YAML — там видно целиком",
                ),
                width=GRID_FIELD_W,
            )
        if spec.kind == KIND_TEXT:
            control, _ = c.text_field(
                str(spec.value),
                lambda value, s=spec: set_value(s, value),
                width=GRID_FIELD_W,
            )
            return c.labeled(spec.key, control, width=GRID_FIELD_W)
        return c.labeled(
            spec.key,
            c.number_field(
                float(spec.value),
                lambda value, s=spec: set_value(s, value),
                minimum=spec.minimum,
                maximum=spec.maximum,
                integer=spec.kind == KIND_INT,
                width=GRID_FIELD_W,
            ),
            width=GRID_FIELD_W,
        )

    def group_block(group: GroupSpec) -> ft.Control:
        head = ft.Row(
            [
                ft.Text(group_title(group), style=t.sans(size=t.SIZE_BODY, weight=t.W600)),
                ft.Text(
                    group.dotted or section,
                    style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_PLACEHOLDER),
                ),
                ft.Container(height=1, bgcolor=t.BORDER_INNER, expand=True),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )
        return ft.Column(
            [head, c.flow([field_control(spec) for spec in group.fields])],
            spacing=t.GAP_IN,
            tight=True,
        )

    def fields_body() -> ft.Control:
        try:
            groups = describe(section, raw())
        except ConfigError as error:
            show_error(error)
            return c.empty_hint("Раздел не читается — исправьте файл в режиме YAML.")
        if not groups:
            return c.empty_hint("В этом разделе нет отдельных значений.")
        blocks: list[ft.Control] = [group_block(group) for group in groups]
        blocks.append(
            c.note(
                "Правка применяется без перезапуска: следующий ход считается по новым "
                "значениям. Эталонные значения лежат в config/defaults и не "
                "перезаписываются — «Сбросить раздел» возвращает именно их."
            )
        )
        return ft.Container(
            content=ft.Column(blocks, spacing=t.PAD_CARD, scroll=ft.ScrollMode.AUTO, expand=True),
            padding=t.PAD_CARD,
            expand=True,
        )

    def yaml_body() -> ft.Control:
        try:
            editor.value = store.raw_text(section)
            show_error(None)
        except ConfigError as error:
            show_error(error)
        return ft.Container(
            content=ft.Column([editor], scroll=ft.ScrollMode.AUTO, expand=True),
            margin=t.PAD_CARD,
            padding=ft.Padding.symmetric(vertical=t.GAP_IN, horizontal=t.GAP_IN),
            bgcolor=t.SURFACE_ALT,
            border=ft.Border.all(1, t.BORDER),
            border_radius=t.R_FIELD,
            expand=True,
        )

    def render_body() -> None:
        body_holder.content = (
            yaml_body() if app.config_view == CONFIG_YAML else fields_body()
        )
        app.refresh(body_holder)

    # -- сборка -------------------------------------------------------------
    view_switch = ft.Container(content=c.segmented(VIEW_OPTIONS, app.config_view, set_view))

    render_body()
    render_toggles()
    render_changed()

    parameters = c.framed_card(
        "Параметры",
        body_holder,
        trailing=[view_switch],
        expand=True,
    )

    toggles_card = c.framed_card(
        "Опциональные параметры",
        ft.Container(
            content=ft.Column(
                [
                    c.note(
                        "Выключенный параметр не участвует в формулах"
                        " и скрывается в интерфейсе."
                    ),
                    toggles_holder,
                    c.spacer(),
                ],
                spacing=t.GAP_IN,
                expand=True,
            ),
            padding=t.PAD_CARD,
            expand=True,
        ),
        footer=ft.Container(
            content=changed_holder,
            padding=ft.Padding.symmetric(vertical=t.GAP_IN, horizontal=t.PAD_CARD),
            border=t.border_top(t.BORDER_INNER),
        ),
        expand=True,
    )

    left = ft.Column([message, error_holder, parameters], spacing=t.GAP_SM, expand=True)

    return screen(
        app,
        active="config",
        active_child=section,
        title=SECTION_LABELS.get(section, section),
        subtitle=f"config/{section}.yaml · schema_version {version()}",
        mono_subtitle=True,
        aside=aside_block(
            "Разделы",
            [
                c.note(
                    "Разделы перечислены в навигации. Эталон — config/defaults.",
                    size=t.SIZE_META,
                )
            ],
        ),
        actions=[
            c.tertiary_button("Сбросить всё", reset_all),
            c.secondary_button("Сбросить раздел", reset_section, icon=ft.Icons.RESTORE),
            c.primary_button(
                "Применить",
                apply_yaml,
                icon=ft.Icons.CHECK,
                disabled=app.config_view != CONFIG_YAML,
                tooltip="Правки в полях применяются сразу"
                if app.config_view != CONFIG_YAML
                else "Проверить и записать текст раздела",
            ),
        ],
        body=c.columns(left, toggles_card, right_width=340),
    )


def _defaults(store, section: str) -> dict:
    """Эталонное содержимое раздела из ``config/defaults``."""
    import yaml

    path = store.default_path_for(section)
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
