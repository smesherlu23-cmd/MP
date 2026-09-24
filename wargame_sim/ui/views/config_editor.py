"""Коэффициенты: поля раздела, режим YAML, тумблеры, сброс к эталону (§5, §10).

Поля не свёрстаны по картинке, а построены по реальной схеме из
``core.config.schema`` и реальному содержимому YAML: новый коэффициент в
конфиге появляется здесь сам. Правка пишется точечно в текст файла, поэтому
комментарии в конфиге остаются на месте.

Разделы — списком на самом экране, по группам, а не пятнадцатью подпунктами
навигации вперемешку с английскими ключами. Поле — строкой формы: слева
русское название и пояснение из комментария конфига, справа значение.
Раньше над полем стоял голый ключ вроде ``PRESSURE_EXPONENT``.
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
    field_notes,
    patch_scalar,
)
from ui import theme as t
from ui.shell import screen
from ui.state import CONFIG_FIELDS, CONFIG_YAML, ROUTES, AppState
from ui.widgets import common as c
from ui.widgets import dialogs as dlg

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
    "toggles": "Что учитывать",
    "vehicles": "Техника",
    "weapons": "Вооружение",
    "gear": "Обмундирование",
    "troops": "Солдаты",
}

#: Разделы по группам — так они стоят в списке слева. Библиотеки правятся
#: карточками в «Мат.части»; здесь они для правки текстом целиком.
SECTION_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Условия", ("terrain", "weather", "time_of_day")),
    ("Бой", ("orders", "element_types", "experience", "morale", "combat", "supply", "fatigue")),
    ("Учёт", ("toggles",)),
    ("Библиотеки", ("vehicles", "weapons", "gear", "troops")),
)

#: Ширина списка разделов.
SECTIONS_W = 210

#: Ширина строки формы: две в ряд на штатной ширине, одна — в узком окне.
FORM_ROW_W = 470

#: Ширина поля значения в строке формы.
VALUE_W = 132


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
    "scale_turns": "Длительность задачи по масштабу отряда",
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

#: Русские названия ключей. Пояснение к полю берётся из комментария в
#: самом конфиге (:func:`core.config.introspect.field_notes`); название —
#: отсюда. Чего здесь нет, показывается ключом: новый коэффициент виден
#: сразу, даже если подписать его ещё не успели.
FIELD_LABELS: dict[str, str] = {
    "detection": "Обнаружение",
    "fatigue": "Усталость",
    "speed": "Скорость отхода",
    "cover": "Укрытие",
    "accuracy": "Точность",
    "vehicles": "Техника",
    "attack": "Огонь",
    "defense": "Устойчивость",
    "visibility": "Заметность",
    "detection_speed": "Скорость обнаружения",
    "ammo_use": "Расход боезапаса",
    "fuel_use": "Расход топлива",
    "fatigue_gain": "Прирост усталости",
    "morale_resistance": "Стойкость морали",
    "initiative": "Инициатива",
    "disengage": "Выход из контакта",
    "kind": "Вид задачи",
    "turns": "Ходов",
    "damage_ratio": "Нанести потерь, доля",
    "personnel_ratio": "Сохранить л/с, доля",
    "intel_level": "Уровень разведданных",
    "staff_attack": "Доля огня штата",
    "staff_defense": "Доля защищённости штата",
    "label": "Название",
    "combat": "Боевой",
    "hq": "Штаб",
    "supply_source": "Источник снабжения",
    "recon": "Разведка",
    "target_priority": "Приоритет цели",
    "vulnerability": "Уязвимость",
    "anti_tank": "Противотанковые",
    "stealth": "Скрытность",
    "personnel_full": "Штат, чел.",
    "echelon": "Ступень",
    "vehicle_type": "Техника",
    "vehicle_count": "Машин",
    "suppression_recovery": "Снятие подавления",
    "commander_resistance": "Стойкость командира",
    "recovery_per_turn": "Восстановление за ход",
    "min": "Минимум",
    "max": "Максимум",
    "k1_casualties": "Вес потерь",
    "k2_suppression": "Вес подавления",
    "k3_vehicle_losses": "Вес потерь техники",
    "k4_no_hq": "Вес потери штаба",
    "k7_side_success": "Вес успеха стороны",
    "retreat": "Порог отступления",
    "panic": "Порог паники",
    "strength_reference": "Человек в единице силы",
    "lethality": "Летальность",
    "pressure_exponent": "Экспонента давления",
    "cap_per_turn": "Потолок доли потерь за ход",
    "defense_epsilon": "ε в знаменателе давления",
    "first_strike_bonus": "Бонус первого удара",
    "condition_share": "Доля урона в состояние",
    "condition_loss_per_hit": "Потеря состояния за попадание",
    "disabled_below_condition": "Выведена из строя ниже",
    "crew_loss_share": "Потери экипажа, доля",
    "breakdown_per_turn": "Поломки за ход",
    "abandoned_on_panic": "Брошено при панике, доля",
    "base": "Основание",
    "recon_element_bonus": "Прибавка за разведэлемент",
    "recon_bonus_cap": "Потолок прибавки разведки",
    "intel_gain_per_turn": "Прирост разведданных за ход",
    "intel_levels": "Уровни разведданных",
    "target_share": "Доля доступных целей",
    "cohesion_weight": "Вес слаженности",
    "ambush_bonus": "Бонус засады",
    "readiness_weight": "Вес готовности",
    "priority_exponent": "Экспонента приоритета",
    "min_weight": "Минимальный вес цели",
    "hq_focus_bonus": "Бонус огня по штабу",
    "supply_focus_bonus": "Бонус огня по тылу",
    "gain": "Прирост",
    "gain_exponent": "Экспонента прироста",
    "recovery": "Восстановление",
    "loss_per_casualty_share": "Потеря за долю потерь",
    "loss_per_suppression": "Потеря за подавление",
    "order_change_cost": "Цена смены приказа",
    "split_cost": "Цена деления",
    "merge_cost": "Цена сведения",
    "commit_cost": "Цена ввода резерва",
    "cohesion": "Слаженность",
    "commander": "Командир",
    "readiness": "Готовность",
    "vehicle_condition": "Состояние техники",
    "fortification": "Укрепления",
    "fortification_cover": "Укрытие укреплений",
    "collapse": "Обвал обороны",
    "noise_experience": "Разброс огня по опыту",
    "noise_cohesion": "Разброс огня по слаженности",
    "noise_suppression": "Разброс огня по подавлению",
    "armour": "Броня",
    "rout_personnel_ratio": "Порог разгрома, доля л/с",
    "element_dead_personnel_ratio": "Порог небоеспособности, доля л/с",
    "panic_pursuit_losses": "Потери при бегстве, доля",
    "disengage_threshold": "Порог выхода из боя",
    "default_max_turns": "Предел ходов по умолчанию",
    "max_cover": "Потолок укрытия",
    "external_supply_share": "Подвоз без своего тыла, доля",
    "source_efficiency_curve": "Эффективность тыла",
    "base_per_turn": "Расход за ход",
    "intensity_weight": "Вес интенсивности огня",
    "resupply_per_turn": "Подвоз за ход",
    "resupply_without_source": "Подвоз без тыла",
    "infantry_uses_fuel": "Пехота тратит топливо",
    "loss_per_turn": "Износ за ход",
    "gain_per_turn": "Прирост за ход",
    "gain_in_contact": "Прирост в контакте",
    "gain_per_casualty_share": "Прирост за долю потерь",
    "recovery_experience_weight": "Вес опыта в отдыхе",
    "state_curve": "Кривая состояния",
    "fuel": "Топливо",
    "equipment": "Снаряжение",
    "commander_influence": "Влияние командира",
    "intel": "Разведданные",
}

VIEW_OPTIONS: tuple[tuple[str, str], ...] = (
    (CONFIG_FIELDS, "поля"),
    (CONFIG_YAML, "YAML"),
)

#: Сколько отличий от эталона перечислять поимённо.
SHOWN_DIFFERENCES = 6


def field_label(key: str, note: str) -> str:
    """Название поля: русское, если известно; иначе начало пояснения; иначе ключ."""
    if key in FIELD_LABELS:
        return FIELD_LABELS[key]
    head = note.strip(" -—").split(":")[0].split(";")[0].strip(" -—")
    return head[:1].upper() + head[1:] if head else key


def section_groups(sections: list[str]) -> list[tuple[str, list[str]]]:
    """Разделы по группам; неизвестные новые — в «Прочее», чтобы не потерялись."""
    placed = {name for _, names in SECTION_GROUPS for name in names}
    groups = [
        (title, [name for name in names if name in sections]) for title, names in SECTION_GROUPS
    ]
    rest = [name for name in sections if name not in placed]
    if rest:
        groups.append(("Прочее", rest))
    return [(title, names) for title, names in groups if names]


def group_title(group: GroupSpec, section: str = "") -> str:
    """Название группы: человеческое, если оно известно, иначе ключ YAML.

    Корень раздела («combat» в combat.yaml) назван «Общее»: иначе заголовок
    повторял ключ дважды — «combat combat».
    """
    if not group.path:
        return "Значения раздела"
    if group.path == (section,):
        return GROUP_LABELS.get(group.dotted, "Общее")
    return GROUP_LABELS.get(group.dotted, group.key)


def build(app: AppState, section: str = "combat") -> ft.View:
    store = app.store
    sections = store.sections()
    if section not in sections:
        section = sections[0]

    app.config_section = section

    error_holder = ft.Container()
    body_holder = ft.Container(expand=True)
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
        error_holder.content = (
            None
            if error is None
            else ft.Container(
                content=c.error_banner(str(error)), margin=ft.Margin.only(bottom=t.GAP)
            )
        )
        app.refresh(error_holder)

    def say(text: str) -> None:
        app.notify(text)

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

    def ask_reset_section() -> None:
        dlg.confirm(
            app,
            f"Сбросить раздел «{SECTION_LABELS.get(section, section)}»?",
            "Все правки коэффициентов этого раздела заменятся эталоном из "
            "config/defaults. Вернуть их будет нечем.",
            confirm_label="Сбросить",
            danger=True,
            on_confirm=reset_section,
        )

    def ask_reset_all() -> None:
        dlg.confirm(
            app,
            "Сбросить все коэффициенты?",
            "Каждый раздел конфигурации заменится эталоном из config/defaults — "
            "вся калибровка, которую вы подбирали, пропадёт. Отменить нельзя.",
            confirm_label="Сбросить всё",
            danger=True,
            on_confirm=reset_all,
        )

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
        render_changed()

    def set_view(value: str) -> None:
        app.config_view = value
        view_switch.content = c.segmented(VIEW_OPTIONS, value, set_view)
        render_body()
        app.refresh(view_switch)
        app.go(f"{ROUTE}?section={section}")

    # -- тумблеры -----------------------------------------------------------
    def set_toggle(name: str, value: bool) -> None:
        """Переключить тумблер из раздела «Что учитывать»."""
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
        render_body()
        render_changed()

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
        changed_holder.content = ft.Text(
            text, style=t.sans(size=t.SIZE_META, color=t.TEXT_3), expand=True
        )
        app.refresh(changed_holder)

    # -- тело карточки «Параметры» -----------------------------------------
    def value_control(spec: FieldSpec) -> ft.Control:
        """Само значение: число, текст, тумблер или ссылка на режим YAML."""
        if spec.kind == KIND_BOOL:
            if section == "toggles":
                return c.toggle(
                    "", bool(spec.value), lambda value, s=spec: set_toggle(s.key, value)
                )
            return c.toggle("", bool(spec.value), lambda value, s=spec: set_value(s, value))
        if not spec.editable:
            hint = (
                f"кривая, точек {len(spec.value)}"
                if spec.kind == KIND_CURVE
                else ", ".join(str(item) for item in spec.value)
            )
            return ft.Container(
                content=ft.Text(
                    hint,
                    style=t.mono(size=t.SIZE_ROW, color=t.TEXT_PLACEHOLDER),
                    no_wrap=True,
                    overflow=ft.TextOverflow.ELLIPSIS,
                ),
                width=VALUE_W,
                height=t.FIELD_H,
                bgcolor=t.SURFACE_ALT,
                border=ft.Border.all(1, t.BORDER),
                border_radius=t.R_FIELD,
                padding=ft.Padding.only(left=10, right=6),
                alignment=ft.Alignment.CENTER_LEFT,
                tooltip="правится в режиме YAML — там видно целиком",
            )
        if spec.kind == KIND_TEXT:
            control, _ = c.text_field(
                str(spec.value), lambda value, s=spec: set_value(s, value), width=VALUE_W
            )
            return control
        return c.number_field(
            float(spec.value),
            lambda value, s=spec: set_value(s, value),
            minimum=spec.minimum,
            maximum=spec.maximum,
            integer=spec.kind == KIND_INT,
            width=VALUE_W,
        )

    def field_row(spec: FieldSpec, notes: dict) -> ft.Control:
        """Строка формы: название и пояснение слева, значение справа."""
        note = notes.get(spec.path, "")
        label = field_label(spec.key, note)
        if spec.key in TOGGLE_LABELS and section == "toggles":
            label = TOGGLE_LABELS[spec.key]
        # Ключ по-русски («звено», «взвод») и есть название — второй строкой
        # он повторял бы сам себя.
        meta: list[ft.Control] = (
            []
            if label == spec.key
            else [
                ft.Text(
                    spec.key, style=t.mono(size=t.SIZE_LABEL, color=t.TEXT_MUTED), no_wrap=True
                )
            ]
        )
        if note and note != label and note != spec.key:
            meta.append(
                ft.Text(
                    note,
                    style=t.sans(size=t.SIZE_LABEL, color=t.TEXT_MUTED),
                    no_wrap=True,
                    overflow=ft.TextOverflow.ELLIPSIS,
                    tooltip=note,
                    expand=True,
                )
            )
        return ft.Container(
            content=ft.Row(
                [
                    ft.Column(
                        [
                            t.text(label, size=t.SIZE_ROW, weight=t.W500, no_wrap=True),
                            ft.Row(
                                meta, spacing=6, vertical_alignment=ft.CrossAxisAlignment.CENTER
                            ),
                        ],
                        spacing=2,
                        tight=True,
                        expand=True,
                    ),
                    value_control(spec),
                ],
                spacing=t.GAP_SM,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            width=FORM_ROW_W,
            padding=ft.Padding.symmetric(vertical=4),
        )

    def group_block(group: GroupSpec, notes: dict) -> ft.Control:
        head = ft.Row(
            [
                ft.Text(
                    group_title(group, section), style=t.sans(size=t.SIZE_BODY, weight=t.W600)
                ),
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
            [
                head,
                c.flow([field_row(spec, notes) for spec in group.fields], spacing=t.GAP),
            ],
            spacing=t.GAP_SM,
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
        notes = field_notes(store.raw_text(section))
        blocks: list[ft.Control] = [group_block(group, notes) for group in groups]
        blocks.append(
            c.note(
                "Правка применяется без перезапуска: следующий ход считается по новым "
                "значениям. Эталон лежит в config/defaults и не перезаписывается — "
                "«Сбросить раздел» в меню «Ещё действия» возвращает именно его."
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

    # -- список разделов ------------------------------------------------------
    def section_list() -> ft.Control:
        rows: list[ft.Control] = []
        for title, names in section_groups(sections):
            rows.append(
                ft.Container(
                    content=t.caption(title),
                    padding=ft.Padding.only(left=t.PAD_ROW_X, top=12, bottom=4),
                )
            )
            for name in names:
                active = name == section
                row = ft.Container(
                    content=ft.Text(
                        SECTION_LABELS.get(name, name),
                        style=t.sans(
                            size=t.SIZE_ROW,
                            weight=t.W500 if active else t.W400,
                            color=t.TEXT if active else t.TEXT_2,
                        ),
                        no_wrap=True,
                    ),
                    height=t.NAV_SUB_H,
                    padding=ft.Padding.symmetric(horizontal=t.PAD_ROW_X),
                    alignment=ft.Alignment.CENTER_LEFT,
                    bgcolor=t.ROW_EXPANDED if active else None,
                )
                rows.append(
                    c.interactive(
                        row, on_click=lambda n=name: app.go(f"{ROUTE}?section={n}")
                    )
                    if not active
                    else row
                )
        return ft.Container(
            content=ft.Column(rows, spacing=0, scroll=ft.ScrollMode.AUTO, expand=True),
            width=SECTIONS_W,
            bgcolor=t.CARD_BG,
            border=ft.Border.all(1, t.BORDER),
            border_radius=t.R_CARD,
            clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
            padding=ft.Padding.only(bottom=t.GAP_SM),
        )

    # -- сборка -------------------------------------------------------------
    view_switch = ft.Container(content=c.segmented(VIEW_OPTIONS, app.config_view, set_view))

    render_body()
    render_changed()

    parameters = c.framed_card(
        SECTION_LABELS.get(section, section),
        body_holder,
        trailing=[view_switch],
        footer=ft.Container(
            content=ft.Row([changed_holder]),
            padding=ft.Padding.symmetric(vertical=t.GAP_SM, horizontal=t.PAD_CARD),
            border=t.border_top(t.BORDER_INNER),
        ),
        expand=True,
    )

    yaml_mode = app.config_view == CONFIG_YAML
    actions: list[ft.Control] = []
    if yaml_mode:
        # «Применить» есть только там, где его есть что применять: в полях
        # правка пишется сразу, и серая кнопка там была кнопкой без действия.
        actions.append(
            c.primary_button(
                "Применить",
                apply_yaml,
                icon=ft.Icons.CHECK,
                tooltip="Проверить и записать текст раздела",
            )
        )
    actions.append(
        c.more_menu(
            [
                c.MenuItem("Сбросить раздел…", ask_reset_section, icon=ft.Icons.RESTORE),
                c.MENU_DIVIDER,
                c.MenuItem(
                    "Сбросить всё…", ask_reset_all, icon=ft.Icons.RESTORE, danger=True
                ),
            ]
        )
    )

    return screen(
        app,
        active="config",
        title="Коэффициенты",
        subtitle=f"config/{section}.yaml · schema_version {version()}",
        mono_subtitle=True,
        actions=actions,
        body=ft.Column(
            [
                error_holder,
                ft.Row(
                    [section_list(), ft.Container(content=parameters, expand=True)],
                    spacing=t.GAP,
                    vertical_alignment=ft.CrossAxisAlignment.START,
                    expand=True,
                ),
            ],
            spacing=0,
            expand=True,
        ),
    )


def _defaults(store, section: str) -> dict:
    """Эталонное содержимое раздела из ``config/defaults``."""
    import yaml

    path = store.default_path_for(section)
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
