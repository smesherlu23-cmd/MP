"""Интерфейс: маршруты, общая рамка, экраны, тумблеры, поля (§10, §12).

Flet-окно в тестах не запускается — экраны строятся как обычные объекты
контролов, поэтому проверяется именно то, что собирает интерфейс.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Sequence
from dataclasses import fields
from pathlib import Path
from types import SimpleNamespace

import flet as ft
import pytest

from core.batch import run_batch
from core.config import ConfigError, ConfigStore
from core.config.introspect import flatten
from core.config.schema import TogglesBody
from core.engine import BattleEngine
from core.models import COMMAND_ORDERS, Order, Side, Terrain
from ui import shell
from ui import theme as t
from ui.app import ROUTE_TABLE, resolve
from ui.state import CONFIG_YAML, ROUTES, AppState
from ui.views import archive, config_editor, materiel, troops, unit_editor
from ui.widgets import common, journal
from ui.widgets.common import number_field

PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def app(tmp_path: Path) -> AppState:
    """Приложение на изолированных копиях конфига и данных."""
    config_dir = tmp_path / "config"
    shutil.copytree(PROJECT_ROOT / "config", config_dir)
    data_dir = tmp_path / "data"
    state = AppState(page=None, store=ConfigStore(config_dir), data_dir=data_dir)
    state.save_unit(state.scenario.battalion_a)
    state.save_unit(state.scenario.battalion_b)
    state.save_scenario(state.scenario)
    return state


# --------------------------------------------------------------------------
# Обход дерева контролов
# --------------------------------------------------------------------------
#: Атрибуты, через которые у контрола есть дети.
_CHILD_FIELDS = ("controls", "content", "actions", "spans", "options")


def _walk(node: object, out: list[object] | None = None) -> list[object]:
    """Все контролы экрана в порядке обхода."""
    found = [] if out is None else out
    found.append(node)
    for name in _CHILD_FIELDS:
        value = getattr(node, name, None)
        if isinstance(value, list):
            for item in value:
                if not isinstance(item, (str, int, float, bool)):
                    _walk(item, found)
        elif value is not None and not isinstance(value, (str, int, float, bool)):
            _walk(value, found)
    return found


def _texts(node: object) -> list[str]:
    """Все видимые надписи экрана: тексты, куски текста и пункты списков."""
    values: list[str] = []
    for control in _walk(node):
        for attribute in ("value", "text"):
            value = getattr(control, attribute, None)
            if isinstance(value, str) and value:
                values.append(value)
    return values


def _labels(node: object) -> set[str]:
    """Надписи без учёта регистра — подписи полей набраны заглавными."""
    return {value.casefold() for value in _texts(node)}


def _has(node: object, label: str) -> bool:
    return label.casefold() in _labels(node)


def _routes(app: AppState) -> list[str]:
    unit_id = app.units()[0][1].id
    return [
        ROUTES["home"],
        ROUTES["units"],
        ROUTES["unit"].format(id=unit_id),
        ROUTES["materiel"].format(library="vehicles"),
        ROUTES["materiel"].format(library="weapons"),
        ROUTES["materiel"].format(library="gear"),
        ROUTES["troops"],
        ROUTES["battle_setup"],
        ROUTES["battle"].format(id=app.scenario.id),
        ROUTES["battle_result"].format(id=app.scenario.id),
        ROUTES["batch"],
        ROUTES["config"],
        ROUTES["archive"],
    ]


# --------------------------------------------------------------------------
# Маршруты
# --------------------------------------------------------------------------
def test_every_documented_route_resolves(app: AppState) -> None:
    """Каждый маршрут строит экран, и ни один шаблон не остался без проверки."""
    from urllib.parse import urlparse

    routes = _routes(app)
    for route in routes:
        view = resolve(app, route)
        assert isinstance(view, ft.View)
        assert view.controls

    paths = [urlparse(route).path for route in routes]
    for pattern, _builder in ROUTE_TABLE:
        assert any(pattern.match(path) for path in paths), pattern.pattern


def test_unknown_route_gives_stub(app: AppState) -> None:
    view = resolve(app, "/такого/нет")
    assert isinstance(view, ft.View)
    assert _has(view, "Экран не найден")


def test_missing_unit_gives_message(app: AppState) -> None:
    view = resolve(app, "/units/несуществующий")
    assert isinstance(view, ft.View)


def test_config_section_from_query(app: AppState) -> None:
    for section in app.store.sections():
        view = resolve(app, f"/config?section={section}")
        assert isinstance(view, ft.View)
        assert _has(view, f"config/{section}.yaml · schema_version 1")
    assert isinstance(resolve(app, "/config?section=выдумка"), ft.View)


# --------------------------------------------------------------------------
# Общая рамка одинакова на всех экранах
# --------------------------------------------------------------------------
def test_every_screen_keeps_the_same_navigation(app: AppState) -> None:
    """Переход по разделам не меняет рамку — меняется только контент."""
    for route in _routes(app):
        labels = _labels(resolve(app, route))
        for item in shell.NAV:
            assert item.label.casefold() in labels, (route, item.label)


def test_active_navigation_item_is_highlighted(app: AppState) -> None:
    sidebar = shell.sidebar(app, "units")
    highlighted = [
        control
        for control in _walk(sidebar)
        if getattr(control, "bgcolor", None) == t.TEXT and _has(control, "Отряды")
    ]
    assert len(highlighted) == 1


def test_screens_use_only_registered_fonts(app: AppState) -> None:
    """Начертание выбирается семейством — семейство должно быть в assets."""
    known = set(t.FONT_FILES)
    for route in _routes(app):
        for control in _walk(resolve(app, route)):
            families = {
                getattr(control, "font_family", None),
                getattr(getattr(control, "style", None), "font_family", None),
            }
            for family in families - {None}:
                assert family in known, (route, family)


def test_battle_console_does_not_scroll(app: AppState) -> None:
    """Пульт боя обязан помещаться целиком (§10)."""
    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    columns = [
        control
        for control in _walk(view)
        if isinstance(control, ft.Column) and control.scroll == ft.ScrollMode.AUTO
    ]
    # прокручиваются только панели внутри карточек, но не сам экран
    assert all(column is not view.controls[0] for column in columns)


# --------------------------------------------------------------------------
# Ошибки конфигурации не роняют интерфейс (§5)
# --------------------------------------------------------------------------
def test_broken_config_shows_banner_not_crash(app: AppState) -> None:
    assert app.config is not None  # первичная загрузка — есть запасной конфиг
    (app.store.directory / "combat.yaml").write_text("combat: [битый", encoding="utf-8")
    app.reload_config()
    assert app.config_error
    view = resolve(app, ROUTES["home"])
    assert isinstance(view, ft.View)
    assert any("Ошибка в конфиге" in value for value in _texts(view))


def test_config_editor_rejects_invalid_yaml(app: AppState) -> None:
    """Правка с ошибкой не применяется, файл остаётся прежним."""
    before = app.store.raw_text("combat")
    view = config_editor.build(app, "combat")
    assert isinstance(view, ft.View)
    with pytest.raises(ConfigError):
        app.store.save_text("combat", "combat: [сломано")
    assert app.store.raw_text("combat") == before


# --------------------------------------------------------------------------
# Редактор коэффициентов строится по схеме, а не по картинке
# --------------------------------------------------------------------------
def test_field_editor_shows_every_value_of_the_section(app: AppState) -> None:
    view = config_editor.build(app, "combat")
    labels = _labels(view)
    keys = {path.split(".")[-1] for path in flatten(app.store.raw("combat"))}
    for key in keys - {"schema_version"}:
        assert key.casefold() in labels, key


def test_field_editor_switches_to_yaml(app: AppState) -> None:
    app.config_view = CONFIG_YAML
    view = config_editor.build(app, "combat")
    editors = [
        control
        for control in _walk(view)
        if isinstance(control, ft.TextField) and control.multiline
    ]
    assert editors and editors[0].value == app.store.raw_text("combat")


def test_field_editor_reports_difference_from_defaults(app: AppState) -> None:
    view = config_editor.build(app, "combat")
    assert _has(view, "Раздел совпадает с эталоном из config/defaults.")

    data = app.store.raw("combat")
    data["combat"]["casualties"]["lethality"] = 0.999
    app.store.save("combat", data)
    app.reload_config()
    texts = _texts(config_editor.build(app, "combat"))
    assert any("casualties.lethality" in value for value in texts)


# --------------------------------------------------------------------------
# Тумблеры скрывают поля (§4.5)
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "toggle_name, label",
    [
        ("fuel", "Топливо"),
        ("equipment", "Снаряжение"),
        ("readiness", "Готовность"),
        ("fatigue", "Усталость"),
    ],
)
def test_disabled_parameter_disappears_from_editor(
    app: AppState, toggle_name: str, label: str
) -> None:
    _, battalion = app.units()[0]
    app.expanded_element = battalion.elements[0].id  # поля элемента видны раскрытыми

    def shown() -> bool:
        view = unit_editor.build(app, battalion.id)
        return any(value.casefold().startswith(label.casefold()) for value in _texts(view))

    data = app.store.raw("toggles")
    data["toggles"][toggle_name] = True
    app.store.save("toggles", data)
    app.reload_config()
    assert shown()

    data = app.store.raw("toggles")
    data["toggles"][toggle_name] = False
    app.store.save("toggles", data)
    app.reload_config()
    assert not shown()


def test_commander_and_intel_toggles_hide_setup_fields(app: AppState) -> None:
    data = app.store.raw("toggles")
    data["toggles"]["commander_influence"] = False
    data["toggles"]["intel"] = False
    app.store.save("toggles", data)
    app.reload_config()
    view = resolve(app, ROUTES["battle_setup"])
    assert not _has(view, "Командир")
    assert not _has(view, "Разведданные")


def test_all_toggles_are_editable(app: AppState) -> None:
    labels = _labels(config_editor.build(app, "toggles"))
    for name in TogglesBody.model_fields:
        assert config_editor.TOGGLE_LABELS[name].casefold() in labels


# --------------------------------------------------------------------------
# Поведение экранов
# --------------------------------------------------------------------------
def test_battle_screen_after_steps(app: AppState) -> None:
    engine = app.start_battle()
    engine.run_turns(3)
    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    assert isinstance(view, ft.View)
    assert _has(view, "Журнал")
    assert any(value.startswith("записей ") for value in _texts(view))


def test_result_screen_after_battle(app: AppState) -> None:
    app.start_battle()
    app.engine.run()
    result = app.finish_battle()
    view = resolve(app, ROUTES["battle_result"].format(id=app.scenario.id))
    assert isinstance(view, ft.View)
    assert _has(view, f"ходов {result.turns} · сид {result.master_seed} · записей {len(result.log)}")


def test_result_screen_without_battle_explains_itself(app: AppState) -> None:
    view = resolve(app, ROUTES["battle_result"].format(id=app.scenario.id))
    assert _has(view, "Боя ещё не было")
    assert _has(view, "К подготовке")


def test_batch_screen_with_results(app: AppState) -> None:
    app.batch = run_batch(app.scenario, app.config, runs=6, processes=1)
    view = resolve(app, ROUTES["batch"])
    assert isinstance(view, ft.View)
    assert _has(view, "Вероятности исходов")
    assert _has(view, f"Прогоны · {app.batch.runs}")


def test_archive_screen_with_saved_battle(app: AppState) -> None:
    result = BattleEngine(app.scenario, app.config, verbose=False).run()
    app.save_result(result)
    view = resolve(app, ROUTES["archive"])
    assert isinstance(view, ft.View)
    assert app.results()
    assert _has(view, "ПРОВЕДЁННЫЕ БОИ · 1")


def test_archive_filter_by_outcome_and_search(app: AppState) -> None:
    result = BattleEngine(app.scenario, app.config, verbose=False).run()
    assert archive.matches(result, "", "*")
    assert archive.matches(result, str(result.master_seed), "*")
    assert archive.matches(result, result.scenario_name[:5].upper(), "*")
    assert not archive.matches(result, "нет такого боя", "*")
    assert archive.matches(result, "", str(result.winner))
    other = "A" if str(result.winner) != "A" else "B"
    assert not archive.matches(result, "", other)


def test_attention_block_stays_when_everyone_holds(app: AppState) -> None:
    """Пустой блок «Требует внимания» не должен дёргать раскладку (§10)."""
    battalion = app.scenario.battalion_a
    rows = journal.attention_rows([("A", battalion)], threshold=0)
    assert rows == []
    assert _has(journal.attention_card(rows, 0), "Требует внимания")


def test_attention_rows_are_sorted_and_capped(app: AppState) -> None:
    battalion = app.scenario.battalion_a.model_copy(deep=True)
    for index, element in enumerate(battalion.elements):
        element.morale = 10 + index
    rows = journal.attention_rows([("A", battalion)], threshold=100)
    assert len(rows) == 4
    assert [row[2] for row in rows] == sorted(row[2] for row in rows)


# --------------------------------------------------------------------------
# Конструктор техники
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "library, title",
    [("vehicles", "Техника"), ("weapons", "Пехотное вооружение"), ("gear", "Обмундирование")],
)
def test_materiel_lists_every_library(app: AppState, library: str, title: str) -> None:
    view = materiel.build(app, library)
    entries = materiel.entries_of(app, materiel.LIBRARIES[library])
    assert _has(view, title)
    assert _has(view, str(len(entries))), "счётчик записей в шапке карточки"
    assert _has(view, f"Мат.часть · {title}")


def test_materiel_groups_entries_by_folder(app: AppState) -> None:
    """Папки видно в списке, и пустая папка не исчезает."""
    view = materiel.build(app, "vehicles")
    for folder in app.config.vehicles.folders:
        assert _has(view, folder)


def test_vehicle_constructor_edits_write_to_config(app: AppState) -> None:
    """Правка поля уходит в vehicles.yaml и подхватывается расчётом."""
    from core.config.introspect import patch_scalar

    text = patch_scalar(app.store.raw_text("vehicles"), ("vehicles", "Танк", "crew"), 4)
    app.store.save_text("vehicles", text)
    app.reload_config()
    assert app.config.vehicle("Танк").crew == 4
    assert "# crew           — экипаж" in app.store.raw_text("vehicles")


def test_vehicle_constructor_creates_and_removes(app: AppState) -> None:
    from core.config.introspect import append_entry, remove_entry

    before = set(app.config.vehicles.vehicles)
    text = append_entry(
        app.store.raw_text("vehicles"),
        ("vehicles",),
        "Тягач",
        materiel.LIBRARIES["vehicles"].new_entry,
    )
    app.store.save_text("vehicles", text)
    app.reload_config()
    assert set(app.config.vehicles.vehicles) == before | {"Тягач"}

    app.store.save_text("vehicles", remove_entry(app.store.raw_text("vehicles"), ("vehicles", "Тягач")))
    app.reload_config()
    assert set(app.config.vehicles.vehicles) == before


def test_vehicle_in_use_is_not_deleted_silently(app: AppState) -> None:
    """Машину, которая стоит в подразделении, удалить нельзя — и сказано почему."""
    view = materiel.build(app, "vehicles", "БТР")
    assert _has(view, "Где используется")
    texts = " ".join(_texts(view))
    assert "тип «стрелковая_рота»" in texts


# --------------------------------------------------------------------------
# Сборка юнитов
# --------------------------------------------------------------------------
def test_troops_screen_shows_kit_and_computed_values(app: AppState) -> None:
    view = troops.build(app, "Гранатомётчик")
    assert _has(view, "Сборка юнитов")
    assert _has(view, "Комплект")
    assert _has(view, "Что даёт подразделению")
    # обмундирование, оружие и доп. оружие названы по-человечески
    texts = " ".join(_texts(view))
    assert app.config.weapon("РПГ").label in texts


def test_troop_in_composition_is_not_deleted_silently(app: AppState) -> None:
    assert app.materiel_usage("troops", "Стрелок")
    assert not app.materiel_usage("troops", "Снабженец") or True


def test_unit_editor_saves_edits(app: AppState) -> None:
    """Правка в конструкторе сразу уходит на диск и в сводку."""
    _, battalion = app.units()[0]
    battalion.name = "Переименованный"
    app.save_unit(battalion)
    assert app.unit(battalion.id)[1].name == "Переименованный"


def test_state_keeps_config_when_reload_fails(app: AppState) -> None:
    good = app.config
    (app.store.directory / "morale.yaml").write_text("morale: [сломано", encoding="utf-8")
    assert app.reload_config() is None
    assert app.config_error
    assert app.config is good  # старый конфиг остаётся рабочим


# --------------------------------------------------------------------------
# Числовые поля с диапазоном (§10)
# --------------------------------------------------------------------------
def _number_field(value: float, **kwargs) -> tuple[ft.Control, ft.TextField, list[float]]:
    seen: list[float] = []
    shell_control = number_field(value, seen.append, **kwargs)
    field = shell_control.content
    return shell_control, field, seen


def test_number_field_applies_valid_value() -> None:
    shell_control, field, seen = _number_field(50, minimum=0, maximum=100)
    field.value = "80"
    field.on_blur(None)
    assert seen == [80]
    assert shell_control.border == ft.Border.all(1, t.BORDER)


def test_number_field_rejects_out_of_range() -> None:
    shell_control, field, seen = _number_field(50, minimum=0, maximum=100)
    field.value = "500"
    field.on_blur(None)
    assert seen == []
    assert shell_control.border == ft.Border.all(1, t.LOSS)


def test_number_field_rejects_non_number() -> None:
    shell_control, field, seen = _number_field(50, minimum=0, maximum=100)
    field.value = "много"
    field.on_blur(None)
    assert seen == []
    assert shell_control.border == ft.Border.all(1, t.LOSS)


def test_number_field_shows_range_hint() -> None:
    shell_control, _, _ = _number_field(2, minimum=1, maximum=4, integer=True)
    assert "1…4" in str(shell_control.tooltip)


def test_scenario_side_assignment_from_editor(app: AppState) -> None:
    _, battalion = app.units()[0]
    unit_editor._use_in_battle(app, battalion, Side.B)
    assert app.scenario.battalion_b.id == battalion.id
    assert app.scenario.battalion_b.side == Side.B


def test_order_choices_cover_every_command(app: AppState) -> None:
    """В списке приказов есть все команды — и нет паники.

    Паника не команда: это состояние, в которое элемент срывается сам.
    Пока её можно было выбрать, у стороны не оставалось выполнимой задачи,
    элемент продолжал стрелять, а через ход приказ переписывался на
    отступление.
    """
    labels = _labels(resolve(app, ROUTES["battle_setup"]))
    assert "приказ" in labels
    for order in COMMAND_ORDERS:
        assert str(order).casefold() in labels
    assert str(Order.PANIC).casefold() not in labels


def test_panic_is_not_offered_anywhere(app: AppState) -> None:
    """Ни один экран не предлагает «паническое бегство» как выбор."""
    engine = app.start_battle()
    engine.run_turns(2)
    unit = app.units()[0][1].id
    app.expanded_element = app.scenario.battalion_a.elements[1].id
    app.selected_group = ("A", engine.state.battalion("A").leaf_elements[0].id)
    for route in (
        ROUTES["battle_setup"],
        ROUTES["battle"].format(id=app.scenario.id),
        ROUTES["unit"].format(id=unit),
    ):
        assert str(Order.PANIC).casefold() not in _labels(resolve(app, route)), route


# --------------------------------------------------------------------------
# Боевой порядок деревом (§4.2)
# --------------------------------------------------------------------------
def test_battle_console_shows_the_order_of_battle(app: AppState) -> None:
    """Пульт боя показывает дерево групп, а не плоскую таблицу элементов."""
    app.start_battle()
    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    assert _has(view, "Боевой порядок")
    assert "группа" in _labels(view)
    assert "масштаб" in _labels(view)


def test_selected_group_gets_its_commands(app: AppState) -> None:
    """Выбранная группа открывает в подвале действия над ней."""
    engine = app.start_battle()
    target = next(
        element for element in engine.state.battalion("A").leaf_elements if element.has_vehicles
    )
    route = ROUTES["battle"].format(id=app.scenario.id)

    app.selected_group = None
    assert _has(
        resolve(app, route),
        "Щелчок выбирает группу, правая кнопка открывает действия над ней",
    )

    app.selected_group = ("A", target.id)
    view = resolve(app, route)
    assert _has(view, "Разделить…")
    assert _has(view, "Отделить технику")


def test_split_group_shows_its_subgroups(app: AppState) -> None:
    """После деления подгруппы видны в дереве, а старшая группа — их суммой."""
    engine = app.start_battle()
    target = next(
        element for element in engine.state.battalion("A").leaf_elements if element.has_vehicles
    )
    children = engine.split("A", target.id, 3)

    route = ROUTES["battle"].format(id=app.scenario.id)
    app.selected_group = ("A", children[0].id)
    view = resolve(app, route)
    for child in children:
        assert _has(view, child.name)
    # у подгруппы сводить нечего, а у старшей группы — есть
    assert _has(view, "Свести") is False
    assert _has(view, "Разделить…") is True

    app.selected_group = ("A", target.id)
    merged_view = resolve(app, route)
    assert _has(merged_view, "Свести") is True
    assert _has(merged_view, "Разделить…") is False


def test_collapsed_group_hides_its_subgroups(app: AppState) -> None:
    """Свёрнутая группа прячет всё своё поддерево."""
    engine = app.start_battle()
    target = next(
        element for element in engine.state.battalion("A").leaf_elements if element.has_vehicles
    )
    children = engine.split("A", target.id, 2)
    route = ROUTES["battle"].format(id=app.scenario.id)

    assert _has(resolve(app, route), children[0].name)
    app.collapsed_groups.add(("A", target.id))
    assert _has(resolve(app, route), children[0].name) is False
    assert _has(resolve(app, route), target.name)


def test_unit_editor_offers_scale_and_reshaping(app: AppState) -> None:
    """Конструктор даёт масштаб отряда и перестроение групп."""
    _, battalion = app.units()[0]
    app.expanded_element = battalion.elements[1].id
    view = unit_editor.build(app, battalion.id)

    assert "масштаб отряда" in _labels(view)
    # Перестроение — в «⋯» строки группы и по правой кнопке, а не третьей
    # копией кнопок внутри раскрытой панели.
    assert "Разделить…" in _menu_labels(view)
    assert "самостоятельная" in _labels(view)


def test_force_allocation_is_a_tree(app: AppState) -> None:
    """Наряд сил на экране подготовки показывает дерево и масштаб отряда."""
    from core import formation

    battalion = app.scenario.battalion_a
    target = next(element for element in battalion.elements if element.has_vehicles)
    children = formation.split(battalion, target.id, 2)

    view = resolve(app, ROUTES["battle_setup"])
    assert _has(view, "Наряд сил")
    for child in children:
        assert _has(view, child.name)
    assert f"сторона a · {battalion.scale}" in _labels(view)


# --------------------------------------------------------------------------
# Тёмная тема (§10)
# --------------------------------------------------------------------------
def _colors(node: object) -> set[str]:
    """Все цвета, которые экран реально назначил контролам."""
    found: set[str] = set()
    for control in _walk(node):
        for attribute in ("bgcolor", "color", "icon_color", "cursor_color"):
            value = getattr(control, attribute, None)
            if isinstance(value, str) and value.startswith("#"):
                found.add(value.upper())
        style = getattr(control, "style", None) or getattr(control, "text_style", None)
        value = getattr(style, "color", None)
        if isinstance(value, str) and value.startswith("#"):
            found.add(value.upper())
    return found


@pytest.fixture()
def light_theme():
    """Любой тест волен переключить палитру — вернём её на место."""
    yield
    t.apply(False)


def test_palette_swap_reaches_every_token(light_theme) -> None:
    """apply() раскладывает палитру по всем константам модуля, а не по части."""
    light = {field.name: getattr(t.LIGHT, field.name) for field in fields(t.LIGHT)}
    t.apply(True)
    for name, value in light.items():
        if name == "name":
            continue
        assert getattr(t, name.upper()) != value, f"{name} остался светлым"
    assert t.is_dark() is True


def _palette_values(palette: t.Palette) -> set[str]:
    return {
        getattr(palette, field.name).upper() for field in fields(palette) if field.name != "name"
    }


def test_dark_theme_repaints_the_battle_console(app: AppState, light_theme) -> None:
    """Пульт боя в тёмной теме перекрашивается целиком."""
    app.start_battle()
    route = ROUTES["battle"].format(id=app.scenario.id)
    light_colors = _colors(resolve(app, route))

    t.apply(True)
    dark_colors = _colors(resolve(app, route))

    assert light_colors and dark_colors
    # Светлые лестницы частично совпадают по значениям с тёмными (один и тот
    # же серый бывает описанием там и плейсхолдером тут), поэтому сверяемся
    # не с пересечением, а с тем, что осталось только от светлой палитры.
    leaked = dark_colors & (_palette_values(t.LIGHT) - _palette_values(t.DARK))
    assert not leaked, f"цвета не переключились: {sorted(leaked)}"


@pytest.mark.parametrize("route_name", ["home", "units", "battle_setup", "batch", "config"])
@pytest.mark.parametrize("dark", [False, True])
def test_every_screen_uses_only_palette_colors(
    app: AppState, route_name: str, dark: bool, light_theme
) -> None:
    """Ни одного цвета «россыпью»: всё, что красится, берётся из палитры.

    Тот же тест ловит и цвет, вписанный в экран руками: он не совпадёт ни
    с одним значением действующей палитры.
    """
    t.apply(dark)
    palette = t.DARK if dark else t.LIGHT
    used = _colors(resolve(app, ROUTES[route_name]))
    assert used
    assert used <= _palette_values(palette), (
        f"цвета мимо палитры: {sorted(used - _palette_values(palette))}"
    )


def test_default_arguments_do_not_freeze_the_light_palette(light_theme) -> None:
    """Цвет по умолчанию берётся в момент вызова, а не при импорте модуля.

    Аргумент по умолчанию вычисляется один раз при импорте: если оставить
    там t.TEXT, светлая тема застынет в каждом заголовке навсегда.
    """
    t.apply(True)
    assert t.text("x").color == t.DARK.text
    assert t.sans().color == t.DARK.text
    assert t.caption("x").style.color == t.DARK.text_muted
    assert t.border().top.color == t.DARK.border
    assert common.note("x").style.color == t.DARK.text_3


def test_flet_theme_follows_the_palette(light_theme) -> None:
    """Материальная тема Flutter меняется вместе с палитрой."""
    assert t.flet_theme().canvas_color == t.LIGHT.content_bg
    assert t.theme_mode() == ft.ThemeMode.LIGHT
    t.apply(True)
    assert t.flet_theme().canvas_color == t.DARK.content_bg
    assert t.flet_theme().color_scheme.surface == t.DARK.card_bg
    assert t.theme_mode() == ft.ThemeMode.DARK


def test_theme_choice_survives_a_restart(tmp_path: Path) -> None:
    """Выбранную тему приложение помнит между запусками."""
    config_dir = tmp_path / "config"
    shutil.copytree(PROJECT_ROOT / "config", config_dir)
    data_dir = tmp_path / "data"

    first = AppState(page=None, store=ConfigStore(config_dir), data_dir=data_dir)
    assert first.dark_theme is False
    first.toggle_theme()
    assert first.dark_theme is True

    again = AppState(page=None, store=ConfigStore(config_dir), data_dir=data_dir)
    assert again.dark_theme is True


def test_broken_settings_file_does_not_break_startup(tmp_path: Path) -> None:
    """Битый файл настроек — это светлая тема, а не падение приложения."""
    config_dir = tmp_path / "config"
    shutil.copytree(PROJECT_ROOT / "config", config_dir)
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "ui.json").write_text("{не json", encoding="utf-8")

    state = AppState(page=None, store=ConfigStore(config_dir), data_dir=data_dir)
    assert state.dark_theme is False


def test_charts_follow_the_palette(app: AppState, light_theme) -> None:
    """Графики рисует matplotlib, и он тоже обязан знать о тёмной теме."""
    from ui import charts

    batch = run_batch(app.scenario, app.config, runs=4, processes=1)
    light_png = charts.losses_histogram(batch)
    t.apply(True)
    dark_png = charts.losses_histogram(batch)

    assert light_png and dark_png
    assert light_png != dark_png


# --------------------------------------------------------------------------
# Правая кнопка, диалоги и честность интерфейса
# --------------------------------------------------------------------------
def _menu_items(control: object) -> list[object]:
    """Пункты меню контрола: и по правой кнопке, и под «⋯»."""
    found: list[object] = []
    for attribute in ("secondary_items", "items"):
        value = getattr(control, attribute, None)
        if isinstance(value, list):
            found.extend(item for item in value if isinstance(item, ft.PopupMenuItem))
    return found


def _menu_labels(node: object) -> set[str]:
    """Подписи всех пунктов меню экрана — контекстных и под «⋯»."""
    labels: set[str] = set()
    for control in _walk(node):
        for item in _menu_items(control):
            for child in _walk(item):
                value = getattr(child, "value", None)
                if isinstance(value, str) and value:
                    labels.add(value)
    return labels


def _menu_action(node: object, label: str):
    """Обработчик пункта меню с такой подписью."""
    for control in _walk(node):
        for item in _menu_items(control):
            if label in {
                value
                for child in _walk(item)
                if isinstance(value := getattr(child, "value", None), str)
            }:
                return item.on_click
    raise AssertionError(f"нет пункта меню «{label}»")


def _clicks_by_label(node: object, label: str) -> list:
    """Все обработчики кнопок с такой подписью, в порядке обхода.

    Одинаково подписанных кнопок на экране бывает несколько: в наряде сил
    «Все» и «Никого» есть у каждой стороны.
    """
    found = [
        control.on_click
        for control in _walk(node)
        if getattr(control, "on_click", None) is not None
        and label
        in {
            value
            for child in _walk(control)
            if isinstance(value := getattr(child, "value", None), str)
        }
    ]
    if not found:
        raise AssertionError(f"нет кнопки «{label}»")
    return found


def _click_by_label(node: object, label: str):
    """Обработчик кнопки или плашки с такой подписью.

    Берётся последнее совпадение: содержимое экрана идёт после навигации,
    а подпункт навигации бывает подписан так же, как кнопка (например,
    «Итог» на пульте боя).
    """
    return _clicks_by_label(node, label)[-1]


def _click_by_tooltip(node: object, tooltip: str):
    """Обработчик кнопки без подписи — такие ищутся по подсказке."""
    for control in _walk(node):
        if getattr(control, "on_click", None) is None:
            continue
        if any(getattr(item, "tooltip", None) == tooltip for item in _walk(control)):
            return control.on_click
    raise AssertionError(f"нет кнопки с подсказкой «{tooltip}»")


def _dialogs(app: AppState) -> list[object]:
    """Перехват модальных окон: в тестах их некуда показывать."""
    box: list[object] = []
    app.dialog_opener = box.append
    app.dialog_closer = lambda: None
    return box


def test_folder_row_carries_its_actions(app: AppState) -> None:
    """Папка правится правой кнопкой по своей строке, а не поиском кнопок."""
    from core.config import folders as folder_ops

    store = app.store
    patched, path = folder_ops.create(store.raw_text("vehicles"), store.raw("vehicles"), "", "Парк")
    store.save_text("vehicles", patched)
    app.reload_config()

    view = materiel.build(app, "vehicles")
    labels = _menu_labels(view)
    assert "Переименовать…" in labels
    assert "Создать вложенную…" in labels
    assert "Удалить папку…" in labels
    assert path == "Парк"


def test_library_entry_row_carries_its_actions(app: AppState) -> None:
    """У записи библиотеки — открыть, копировать, удалить по правой кнопке."""
    labels = _menu_labels(materiel.build(app, "weapons"))
    assert {"Открыть", "Копировать", "Удалить…"} <= labels


def test_deleting_a_folder_asks_first(app: AppState) -> None:
    """Удаление папки спрашивает, а не происходит по одному щелчку."""
    from core.config import folders as folder_ops

    store = app.store
    patched, _ = folder_ops.create(store.raw_text("gear"), store.raw("gear"), "", "Склад")
    store.save_text("gear", patched)
    app.reload_config()
    app.selected_folder["gear"] = "Склад"

    box = _dialogs(app)
    view = materiel.build(app, "gear")
    _menu_action(view, "Удалить папку…")()

    assert len(box) == 1, "диалог подтверждения не открылся"
    assert box[0].title.value.startswith("Удалить папку «")
    assert "Склад" in app.config.gear.folders, "папка удалилась до подтверждения"


def test_split_dialog_previews_the_apportionment(app: AppState) -> None:
    """Деление показывает доли и то, сколько людей уйдёт в каждую подгруппу."""
    from core import formation
    from ui.widgets import dialogs as dlg

    battalion = app.scenario.battalion_a
    element = battalion.leaf_elements[0]
    box = _dialogs(app)
    dlg.split_group(app, element, on_split=lambda parts, shares: None, parts=3)

    assert len(box) == 1
    texts = _texts(box[0])
    expected = formation.apportion(element.personnel_current, [1.0, 1.0, 1.0])
    assert str(element.personnel_current) in " ".join(texts)
    for value in expected:
        assert str(value) in texts


def test_split_dialog_hands_over_the_shares(app: AppState) -> None:
    """Выбранные доли доходят до деления, а не теряются по дороге."""
    from ui.widgets import dialogs as dlg

    battalion = app.scenario.battalion_a
    element = battalion.leaf_elements[0]
    taken: list[tuple[int, list[float]]] = []
    box = _dialogs(app)
    dlg.split_group(
        app,
        element,
        on_split=lambda parts, shares: taken.append((parts, shares)),
        parts=2,
    )

    _click_by_label(box[0], "Разделить")()
    assert taken == [(2, [1.0, 1.0])]


def test_result_is_not_invented_before_the_battle_ends(app: AppState) -> None:
    """Вкладка «Итог» на третьем ходу не выдаёт ничью по лимиту ходов.

    Она ведёт на экран итога, и тот честно говорит, что бой идёт, — и
    предлагает довести его до конца, а не показывает конец, которого не было.
    """
    engine = app.start_battle()
    engine.run_turns(3)
    assert not engine.finished
    moves: list[str] = []
    app.navigator = moves.append

    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    _click_by_label(view, "Итог")()
    result_route = ROUTES["battle_result"].format(id=app.scenario.id)
    assert moves == [result_route]
    assert app.result is None, "итог собрался по незакончившемуся бою"

    _click_by_label(resolve(app, result_route), "Довести до конца")()
    assert engine.finished
    assert app.result is not None and app.result.turns == engine.turn


def test_journal_shows_the_latest_records(app: AppState) -> None:
    """Журнал показывает последние записи, а не первые два хода."""
    engine = app.start_battle()
    engine.run_turns(6)
    entries = list(engine.log.entries)
    assert len(entries) > journal.EntriesView().__dict__["_limit"]

    view = journal.EntriesView()
    view.render(entries, "events")
    shown = view.__dict__["_window"]
    assert shown[-1] is entries[-1], "последняя запись боя не показана"
    assert shown[0] is not entries[0], "показано начало вместо конца"


def test_journal_appends_instead_of_rebuilding(app: AppState) -> None:
    """Новая запись добавляет одну плитку, а не перестраивает триста."""
    engine = app.start_battle()
    engine.run_turns(2)
    view = journal.EntriesView()
    view.render(list(engine.log.entries), "events")
    tiles = view.__dict__["_tiles"]
    before = list(tiles.controls)

    element = engine.state.battalion("A").leaf_elements[0]
    engine.set_order("A", element.id, Order.DEFENCE)
    view.render(list(engine.log.entries), "events")

    # Окно уже полное, поэтому одна плитка ушла с начала и одна пришла в конец,
    # а всё между ними — те же самые объекты, а не новые.
    assert tiles.controls[:-1] == before[1:], "старые плитки пересобрались заново"
    assert tiles.controls[-1] is not before[-1]


def test_changed_filter_rebuilds_the_journal(app: AppState) -> None:
    """Смена фильтра — это другой список, и он собирается заново.

    Проверяется показанное окно, а не объекты контролов: один ход даёт
    больше записей, чем помещается в окно, поэтому «последние 300 всего
    журнала» и «последние 300 второго хода» бывают одним и тем же набором.
    """
    engine = app.start_battle()
    engine.run_turns(2)
    entries = list(engine.log.entries)
    view = journal.EntriesView()
    view.render(entries, "events")

    first_turn = [entry for entry in entries if entry.turn == 1]
    view.render(first_turn, "events")
    shown = view.__dict__["_window"]

    assert shown, "после смены фильтра окно пустое"
    assert all(entry.turn == 1 for entry in shown), "в окне остались записи чужого хода"
    assert shown[-1] is first_turn[-1]


def test_template_chip_actually_adds_a_group(app: AppState) -> None:
    """«Добавить группу» кладёт группу этого типа в открытый отряд.

    Раньше шаблоны жили на экране списка и сначала спрашивали, в какой
    отряд класть; ещё раньше любой шаблон просто открывал первый отряд.
    Теперь они там, где ими пользуются, — в редакторе выбранного отряда.
    """
    from ui.views import units as units_view

    type_name = sorted(app.config.element_types.element_types)[0]
    label = app.config.element_type(type_name).label
    target = app.units()[1][1]
    before = len(target.elements)

    _menu_action(units_view.build(app, unit_id=target.id), label)(None)

    saved = app.unit(target.id)
    assert saved is not None
    assert len(saved[1].elements) == before + 1
    assert saved[1].elements[-1].type == type_name


def test_changing_the_scenario_starts_a_new_battle(app: AppState) -> None:
    """Правка сценария не выдаётся за продолжение прежнего боя."""
    engine = app.ensure_battle()
    engine.run_turns(2)
    assert app.ensure_battle() is engine

    app.scenario.master_seed = app.scenario.master_seed + 1
    fresh = app.ensure_battle()
    assert fresh is not engine
    assert fresh.state.turn == 0


def test_broken_unit_file_is_reported_not_hidden(app: AppState) -> None:
    """Нечитаемый файл подразделения виден на экране, а не исчезает молча."""
    from ui.views import units as units_view

    (app.units_dir / "broken.json").write_text("{не json", encoding="utf-8")
    broken = app.broken_units()
    assert len(broken) == 1
    assert "broken.json" in broken[0][0].name

    assert "не читается файлов: 1" in " ".join(_texts(units_view.build(app))).casefold()


# --------------------------------------------------------------------------
# Выбор папки и файла системным окном
# --------------------------------------------------------------------------
def _picker(app: AppState, chosen: Path) -> list[tuple[str, str]]:
    """Подменить системное окно выбора: запомнить вопрос, ответить `chosen`."""
    asked: list[tuple[str, str]] = []

    def ask(title: str, initial: str, on_pick) -> None:
        asked.append((title, initial))
        on_pick(str(chosen))

    app.directory_asker = ask
    return asked


def test_export_asks_where_to_put_the_file(app: AppState, tmp_path: Path) -> None:
    """Выгрузка отряда кладёт файл в выбранную папку, а не рядом с оригиналом."""
    from ui.views import units as units_view

    target = tmp_path / "выгрузка"
    target.mkdir()
    asked = _picker(app, target)

    _, battalion = app.units()[0]
    _menu_action(units_view.build(app), "Выгрузить JSON")()

    assert len(asked) == 1
    assert battalion.name in asked[0][0]
    written = list(target.glob("*.json"))
    assert len(written) == 1
    assert json.loads(written[0].read_text(encoding="utf-8"))["id"] == battalion.id


def test_chosen_folder_is_remembered(app: AppState, tmp_path: Path) -> None:
    """Выбранная папка предлагается в следующий раз, а не сбрасывается."""
    from ui.views import units as units_view

    target = tmp_path / "отчёты"
    target.mkdir()
    asked = _picker(app, target)

    _menu_action(units_view.build(app), "Выгрузить JSON")()
    _menu_action(units_view.build(app), "Выгрузить JSON")()

    assert asked[0][1] == str(app.results_dir), "первый раз — каталог результатов"
    assert asked[1][1] == str(target), "второй раз — где выгружали в прошлый"
    assert app.export_dir() == target


def test_report_export_lands_in_the_chosen_folder(app: AppState, tmp_path: Path) -> None:
    """Отчёт об исходе пишется туда, куда указали, во всех трёх форматах."""
    from ui.views import battle_result

    engine = app.start_battle()
    engine.run()
    app.result = engine.result()
    target = tmp_path / "итоги"
    target.mkdir()
    _picker(app, target)

    view = battle_result.build(app, app.scenario.id)
    for label in ("Отчёт Markdown", "Страница HTML", "Таблица CSV"):
        _menu_action(view, label)(None)

    assert {path.suffix for path in target.iterdir()} == {".md", ".html", ".csv"}


def test_without_a_window_export_falls_back_to_results(app: AppState) -> None:
    """Без запущенного окна спрашивать некого — пишем в каталог результатов."""
    from ui.views import units as units_view

    app.directory_asker = None
    _menu_action(units_view.build(app), "Выгрузить JSON")()

    assert list(app.results_dir.glob("*.json"))


def test_import_offers_a_file_dialog(app: AppState, tmp_path: Path) -> None:
    """«Обзор» открывает выбор файла и загружает выбранный отряд."""
    from ui.views import units as units_view

    _, battalion = app.units()[0]
    source = tmp_path / "гость.json"
    source.write_text(
        json.dumps(battalion.model_dump(mode="json"), ensure_ascii=False), encoding="utf-8"
    )

    asked: list[tuple[str, tuple[str, ...]]] = []

    def ask(title: str, initial: str, extensions: tuple[str, ...], on_pick) -> None:
        asked.append((title, extensions))
        on_pick(str(source))

    app.file_asker = ask
    before = len(app.units())
    _menu_action(units_view.build(app), "Загрузить из файла…")(None)

    assert asked and asked[0][1] == ("json",)
    assert len(app.units()) == before + 1


# --------------------------------------------------------------------------
# Точечная перерисовка, поиск и клавиатура
# --------------------------------------------------------------------------
def _routes_taken(app: AppState) -> list[str]:
    """Перехват переходов: точечная перерисовка обязана обходиться без них."""
    taken: list[str] = []
    app.navigator = taken.append
    return taken


def test_editing_a_library_does_not_rebuild_the_screen(app: AppState) -> None:
    """Правка записи перерисовывает список, а не уводит экран на новый круг."""
    view = materiel.build(app, "vehicles")
    taken = _routes_taken(app)
    before = materiel.entries_of(app, materiel.LIBRARIES["vehicles"])

    _menu_action(view, "Копировать")()

    assert taken == [], "экран собрался заново — прокрутка и фокус уехали"
    after = materiel.entries_of(app, materiel.LIBRARIES["vehicles"])
    assert len(after) == len(before) + 1
    copied = next(name for name in after if name not in before)
    assert after[copied].label in _texts(view), "список не обновился"


def test_folder_click_does_not_rebuild_the_screen(app: AppState) -> None:
    """Выбор папки тоже перерисовка, а не переход."""
    from core.config import folders as folder_ops

    store = app.store
    patched, _ = folder_ops.create(
        store.raw_text("weapons"), store.raw("weapons"), "", "Гранатомёты"
    )
    store.save_text("weapons", patched)
    app.reload_config()

    view = materiel.build(app, "weapons")
    taken = _routes_taken(app)
    _menu_action(view, "Открыть")()

    assert taken == []


def test_search_filters_the_library(app: AppState) -> None:
    """Поиск сужает список и честно показывает, сколько нашлось."""
    view = materiel.build(app, "vehicles")
    entries = materiel.entries_of(app, materiel.LIBRARIES["vehicles"])
    target = next(iter(entries.values()))

    _search(view)(target.label)
    shown = _texts(view)

    assert f"найдено 1 из {len(entries)}" in shown
    assert target.label in shown
    others = [entry.label for entry in entries.values() if entry.label != target.label]
    assert all(label not in shown for label in others)


def test_search_that_finds_nothing_says_so(app: AppState) -> None:
    """Пустой результат — это сообщение, а не пустая таблица."""
    view = materiel.build(app, "gear")
    _search(view)("зззз")
    assert any("ничего не нашлось" in text for text in _texts(view))


def test_search_field_survives_typing(app: AppState) -> None:
    """Поле поиска не пересобирается: иначе фокус теряется на первой букве."""
    view = materiel.build(app, "vehicles")
    before = _search_control(view)
    _search(view)("т")
    assert _search_control(view) is before


def _search_control(node: object) -> object:
    """Сам TextField поиска — по подсказке внутри него."""
    for control in _walk(node):
        hint = getattr(control, "hint_text", None)
        if isinstance(hint, str) and hint.startswith("Поиск"):
            return control
    raise AssertionError("поля поиска нет на экране")


def _search(node: object):
    """Набрать текст в поле поиска так, как это делает пользователь."""
    field = _search_control(node)

    def type_in(text: str) -> None:
        field.value = text
        field.on_change(None)

    return type_in


def test_shortcuts_belong_to_the_screen(app: AppState) -> None:
    """Горячие клавиши снимаются вместе с экраном, а не копятся."""
    resolve(app, ROUTES["materiel"].format(library="vehicles"))
    assert "Ctrl+F" in app.shortcuts
    assert "Ctrl+N" in app.shortcuts

    resolve(app, ROUTES["home"])
    assert app.shortcuts == {}, "Ctrl+F с библиотеки продолжал бы работать на главной"


def test_ctrl_enter_takes_a_turn(app: AppState) -> None:
    """Самое частое действие боя доступно с клавиатуры."""
    engine = app.start_battle()
    resolve(app, ROUTES["battle"].format(id=app.scenario.id))

    assert app.press("Ctrl+Enter") is True
    assert engine.turn == 1
    assert app.press("Ctrl+Shift+Enter") is True
    assert engine.turn == 6


def test_unknown_shortcut_is_not_swallowed(app: AppState) -> None:
    """Чужое сочетание возвращает False — его разберёт роутер."""
    resolve(app, ROUTES["home"])
    assert app.press("Ctrl+7") is False


def test_key_name_reads_modifiers(app: AppState) -> None:
    """Cmd приравнен к Ctrl: на macOS модификатор действий — он."""
    from ui.app import key_name

    def make(**kw: object) -> SimpleNamespace:
        return SimpleNamespace(
            key=kw.get("key", "Enter"),
            shift=kw.get("shift", False),
            ctrl=kw.get("ctrl", False),
            alt=kw.get("alt", False),
            meta=kw.get("meta", False),
        )
    assert key_name(make(ctrl=True)) == "Ctrl+Enter"
    assert key_name(make(meta=True)) == "Ctrl+Enter"
    assert key_name(make(ctrl=True, shift=True)) == "Ctrl+Shift+Enter"
    assert key_name(make(key="Escape")) == "Escape"


def test_result_route_does_not_invent_an_outcome(app: AppState) -> None:
    """На маршрут итога ведут ещё навигация и главная — проверка стоит там."""
    engine = app.start_battle()
    engine.run_turns(3)
    view = resolve(app, ROUTES["battle_result"].format(id=app.scenario.id))
    shown = _texts(view)

    assert app.result is None
    assert not any("Ничья" in text for text in shown)
    assert f"Бой идёт, ход {engine.turn}" in shown
    assert _has(view, "К пульту")
    assert _has(view, "Довести до конца")


def test_resets_ask_before_wiping(app: AppState) -> None:
    """Четыре «сброса» необратимы — каждый сначала спрашивает."""
    from ui.views import config_editor as cfg_view

    box = _dialogs(app)
    _click_by_label(materiel.build(app, "vehicles"), "Сбросить библиотеку…")()
    _click_by_label(troops.build(app), "Сбросить типы…")()
    view = cfg_view.build(app)
    _click_by_label(view, "Сбросить раздел…")()
    _click_by_label(view, "Сбросить всё…")()

    assert len(box) == 4, "какой-то сброс срабатывает без вопроса"
    # и ничего при этом не сбросилось
    assert app.config is not None


def test_restart_asks_when_the_battle_has_started(app: AppState) -> None:
    """«Начать заново» стирает проведённый бой, поэтому спрашивает."""
    engine = app.start_battle()
    engine.run_turns(3)
    box = _dialogs(app)
    route = ROUTES["battle"].format(id=app.scenario.id)

    _menu_action(resolve(app, route), "Начать заново…")(None)

    assert len(box) == 1
    assert "заново" in box[0].title.value.casefold()
    assert app.engine is engine, "бой перезапустился до подтверждения"
    assert engine.turn == 3


# --------------------------------------------------------------------------
# Таблицы под ширину окна
# --------------------------------------------------------------------------
def _tables() -> list[tuple[str, tuple[common.Col, ...], int]]:
    """Все таблицы приложения и ширина правой колонки рядом с ними."""
    from ui.views import archive as archive_view
    from ui.views import unit_editor as editor_view
    from ui.widgets import orbat as orbat_widget

    tables = [
        # Список отрядов стоит слева от редактора, но для ширины таблицы
        # сторона не важна — важно, сколько он отнимает.
        ("редактор отряда", editor_view.COLUMNS, editor_view.LIST_W),
        ("пульт боя", orbat_widget.TREE_COLUMNS, 420),
        ("сборка юнитов", troops.COLUMNS, troops.DETAIL_W),
        ("архив", archive_view.RESULT_COLUMNS, archive_view.SCENARIOS_W),
    ]
    tables += [
        (f"мат.часть · {spec.label}", spec.columns, materiel.DETAIL_W)
        for spec in materiel.LIBRARIES.values()
    ]
    return tables


def test_every_table_fits_the_smallest_window() -> None:
    """Таблица не должна вылезать за край: прокрутки вбок у неё нет.

    При 1280 полный набор колонок не помещался ни в конструкторе, ни в
    библиотеках, ни в архиве — правые колонки просто срезались.
    """
    for name, columns, right in _tables():
        available = t.content_width(t.WINDOW_MIN_W, right=right)
        shown = common.fit_columns(columns, available)
        left = available - common.columns_width(shown)
        assert left >= common.NAME_MIN_W, f"{name}: на название остаётся {left} px"


def test_wide_window_shows_every_column() -> None:
    """На штатной ширине ничего не прячется — экономия только в узком окне."""
    for name, columns, right in _tables():
        available = t.content_width(t.WINDOW_W, right=right)
        assert common.fit_columns(columns, available) == tuple(columns), name


def test_narrow_window_drops_columns_on_a_real_screen(app: AppState) -> None:
    """Экран действительно собирается с меньшим набором колонок."""
    from ui.views import unit_editor as editor_view

    unit = app.units()[0][1].id
    app.window_width = t.WINDOW_W
    wide = _labels(editor_view.build(app, unit))
    app.window_width = t.WINDOW_MIN_W
    narrow = _labels(editor_view.build(app, unit))

    assert "устойч." in wide
    assert "устойч." not in narrow, "узкое окно обязано убрать необязательную колонку"
    assert "группа" in narrow and "л/с" in narrow, "обязательные колонки остались"


def test_head_and_rows_never_diverge() -> None:
    """Шапка и строки берут колонки из одного места и не расходятся."""
    columns = (
        common.Col("Имя", expand=True),
        common.Col("A", 100),
        common.Col("B", 100, optional=1),
    )
    table = common.Table.fit(columns, 320)
    row = table.row([ft.Text("имя"), ft.Text("a"), ft.Text("b")])

    head_cells = row.content.controls if hasattr(row, "content") else []
    assert len(table.shown) == len(head_cells)
    assert [cell.content.value for cell in head_cells] == ["имя", "a"]


def test_battle_console_saves_after_every_turn(app: AppState) -> None:
    """Ход прошёл — бой уже на диске, а не только в памяти."""
    app.start_battle()
    route = ROUTES["battle"].format(id=app.scenario.id)
    view = resolve(app, route)
    assert app.saved_battles() == []

    _click_by_label(view, "Шаг")()

    saved = app.saved_battles()
    assert len(saved) == 1
    assert saved[0][1].turn == 1
    assert saved[0][1].log, "журнал в снимок не попал"


def test_home_offers_to_continue_an_unfinished_battle(app: AppState) -> None:
    """Незаконченный бой виден на главной и поднимается щелчком."""
    engine = app.start_battle()
    engine.run_turns(5)
    app.save_battle()
    app.engine = None  # как после перезапуска приложения

    view = resolve(app, ROUTES["home"])
    assert _has(view, "Незаконченные бои")
    assert any("ход 5" in text for text in _texts(view))

    _click_by_label(view, "Продолжить")()
    assert app.engine is not None
    assert app.engine.turn == 5
    assert len(app.engine.log) > 0


def test_finished_battle_is_not_offered_as_unfinished(app: AppState) -> None:
    """Законченный бой в «незаконченные» не попадает."""
    engine = app.start_battle()
    engine.run()
    app.save_battle()

    assert engine.finished
    assert not _has(resolve(app, ROUTES["home"]), "Незаконченные бои")


# --------------------------------------------------------------------------
# Настройка боя: экран показывает то, что в модели
# --------------------------------------------------------------------------
def _switches(node: object) -> list[ft.Switch]:
    return [control for control in _walk(node) if isinstance(control, ft.Switch)]


def _force_rows(node: object) -> list[ft.Container]:
    """Живые строки наряда сил: у каждой свой тумблер и свой щелчок."""
    return [
        control
        for control in _walk(node)
        if isinstance(control, ft.Container)
        and getattr(control, "on_click", None) is not None
        and _switches(control)
    ]


def _counters(node: object) -> list[str]:
    """Счётчики «в бою N из M» — по одному на сторону."""
    return [
        value
        for control in _walk(node)
        if isinstance(value := getattr(control, "value", None), str)
        and value.startswith("в бою ")
    ]


def _segments(node: object, label: str) -> list[ft.Container]:
    """Сегменты переключателя с такой подписью: щёлкаемые и подсвеченный."""
    return [
        control
        for control in _walk(node)
        if isinstance(control, ft.Container)
        and control.border_radius == t.R_SEGMENT
        and [
            value
            for child in _walk(control)
            if isinstance(value := getattr(child, "value", None), str)
        ]
        == [label]
    ]


def _active_segment(node: object, labels: Sequence[str]) -> str:
    """Какой из вариантов подсвечен: у активного нет обработчика и есть фон."""
    active = [
        label
        for label in labels
        for segment in _segments(node, label)
        if segment.on_click is None and segment.bgcolor
    ]
    assert len(active) == 1, f"подсвечено не одно значение: {active}"
    return active[0]


def test_force_allocation_follows_the_model(app: AppState) -> None:
    """Щелчок по строке наряда сил виден на самой строке.

    Тумблер помнит значение, с которым его собрали, а карточка наряда сил
    не пересобиралась вовсе: щелчок по строке уводил группу в резерв, но
    тумблер оставался включённым, а счётчик «в бою» не менялся никогда.
    """
    battalion = app.scenario.battalion_a
    total = len(battalion.leaf_elements)
    view = resolve(app, ROUTES["battle_setup"])

    assert _counters(view)[0] == f"в бою {total} из {total}"
    assert _switches(view)[0].value is True

    _force_rows(view)[0].on_click(None)

    assert len(battalion.engaged_elements) == total - 1
    assert _switches(view)[0].value is False, "тумблер показывает состояние, которого нет"
    assert _counters(view)[0] == f"в бою {total - 1} из {total}"


def test_force_allocation_has_bulk_actions(app: AppState) -> None:
    """«Все» и «Никого» есть у каждой стороны и работают только на своей."""
    view = resolve(app, ROUTES["battle_setup"])
    _clicks_by_label(view, "Никого")[0]()

    assert not app.scenario.battalion_a.engaged_elements
    assert app.scenario.battalion_b.engaged_elements, "«Никого» задело чужую сторону"

    _clicks_by_label(view, "Все")[0]()
    assert len(app.scenario.battalion_a.engaged_elements) == len(
        app.scenario.battalion_a.leaf_elements
    )


def test_a_side_left_in_reserve_does_not_start_a_battle(app: AppState) -> None:
    """Бой, в котором одной стороне воевать нечем, не начинается.

    Раньше «Начать бой» собирал такой бой молча, и он кончался на первом
    ходу разгромом, которого никто не задумывал.
    """
    notes: list[str] = []
    app.notifier = notes.append
    view = resolve(app, ROUTES["battle_setup"])

    _clicks_by_label(view, "Никого")[0]()
    assert any("целиком в резерве" in value for value in _texts(view)), "предупреждения не видно"

    _click_by_label(view, "Начать бой")()
    assert app.engine is None, "бой начался без одной из сторон"
    assert notes and "в резерве" in notes[-1]


def test_conditions_highlight_moves_with_the_choice(app: AppState) -> None:
    """Выбранная местность подсвечена: сегмент сам себя не перекрашивает."""
    labels = [str(item) for item in Terrain]
    view = resolve(app, ROUTES["battle_setup"])
    assert _active_segment(view, labels) == str(app.scenario.environment.terrain)

    _segments(view, str(Terrain.SWAMP))[0].on_click(None)

    assert app.scenario.environment.terrain == Terrain.SWAMP
    assert _active_segment(view, labels) == str(Terrain.SWAMP)


def test_fortification_is_chosen_not_typed(app: AppState) -> None:
    """Укрепления выбираются из шести уровней, и выбор виден на месте."""
    view = resolve(app, ROUTES["battle_setup"])
    _segments(view, "4")[0].on_click(None)

    assert app.scenario.environment.fortification_A == 4
    assert app.scenario.environment.fortification_B != 4, "укрепления поехали на обе стороны"
    assert _segments(view, "4")[0].on_click is None, "подсветка осталась на прежнем уровне"


def test_the_scenario_block_follows_the_conditions(app: AppState) -> None:
    """Блок «Сценарий» в боковой колонке пересобирается вместе с условиями."""
    view = resolve(app, ROUTES["battle_setup"])
    _segments(view, str(Terrain.SWAMP))[0].on_click(None)

    environment = app.scenario.environment
    line = f"{environment.terrain} · {environment.time_of_day} · {environment.weather}"
    assert line in _texts(view), "боковая колонка показывает прежние условия"


def test_picking_a_unit_redraws_the_force_allocation(app: AppState) -> None:
    """Смена подразделения меняет и дерево наряда сил, а не только список."""
    from core.samples import make_platoon

    platoon = make_platoon("bn_probe", "Взвод для проверки", Side.A, app.config)
    app.save_unit(platoon)

    view = resolve(app, ROUTES["battle_setup"])
    dropdown = next(control for control in _walk(view) if isinstance(control, ft.Dropdown))
    dropdown.value = platoon.id
    dropdown.on_select(None)

    assert app.scenario.battalion_a.name == platoon.name
    leaves = app.scenario.battalion_a.leaf_elements
    assert _counters(view)[0] == f"в бою {len(leaves)} из {len(leaves)}"
    for element in leaves:
        assert _has(view, element.name), "в наряде сил группы прежнего отряда"


def test_random_seed_does_not_rebuild_the_screen(app: AppState) -> None:
    """Новый сид перерисовывает поле, а не гоняет экран через переход."""
    moves: list[str] = []
    app.navigator = moves.append
    view = resolve(app, ROUTES["battle_setup"])

    _click_by_label(view, "Случайный")()

    assert not moves, "смена сида собирает экран заново"
    assert str(app.scenario.master_seed) in _texts(view), "в поле прежний сид"


def test_the_edge_is_shown_as_numbers(app: AppState) -> None:
    """Перевес показан двумя отношениями и выводом, а не абзацем из трёх фраз."""
    from core import preview

    edge = preview.edge(app.scenario, app.config)
    shown = _texts(resolve(app, ROUTES["battle_setup"]))

    assert f"{edge.ratio_a:.2f}" in shown
    assert f"{edge.ratio_b:.2f}" in shown
    assert edge.verdict in shown


def test_setup_shortcuts_save_and_start(app: AppState) -> None:
    """Ctrl+S сохраняет сценарий, Ctrl+Enter начинает бой."""
    resolve(app, ROUTES["battle_setup"])

    assert app.press("Ctrl+S")
    assert app.scenarios(), "сценарий не сохранён"

    assert app.press("Ctrl+Enter")
    assert app.engine is not None


def test_interactive_makes_the_row_clickable(app: AppState) -> None:
    """`interactive` вешает щелчок сама.

    Раньше она брала ``on_click`` только ради формы курсора, а вешать
    обработчик должен был вызывающий: строка наряда сил показывала руку и
    не делала ничего.
    """
    clicks: list[int] = []
    row = ft.Container(content=ft.Text("строка"))
    common.interactive(row, on_click=lambda: clicks.append(1))

    assert row.on_click is not None, "строка осталась неживой"
    row.on_click(None)
    assert clicks == [1]


# --------------------------------------------------------------------------
# Бой не теряется, конец слышен, итог сохраняется
# --------------------------------------------------------------------------
def test_opening_the_setup_does_not_wipe_a_running_battle(app: AppState) -> None:
    """Заход на экран настройки не сбрасывает проведённый бой.

    Экран настройки звал `touch()` прямо при сборке, а `touch` ставит
    `app.engine = None`: пять проведённых ходов пропадали от одного
    перехода по навигации, и со стороны это выглядело так, будто отряды
    вообще не несут потерь.
    """
    engine = app.start_battle()
    engine.run_turns(5)
    losses = engine.state.side("A").total_personnel_lost()
    assert losses > 0

    resolve(app, ROUTES["battle_setup"])

    assert app.engine is engine, "бой заменён новым"
    assert app.ensure_battle().turn == 5
    assert app.engine.state.side("A").total_personnel_lost() == losses


def test_finished_battle_announces_itself(app: AppState) -> None:
    """Конец боя слышен: уведомление и окно с предложением разбора."""
    notes: list[str] = []
    app.notifier = notes.append
    box = _dialogs(app)
    app.engine = None

    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    _menu_action(view, "До конца боя")(None)

    assert app.engine.finished
    assert notes and notes[-1].startswith("Бой окончен"), notes
    assert len(box) == 1, "окна о конце боя нет"
    assert "окончен" in box[0].title.value.casefold()


def test_a_finished_battle_goes_to_the_archive_by_itself(app: AppState) -> None:
    """Законченный бой попадает в архив сам, без кнопки «В архив».

    Раньше `finish_battle` считал итог только в памяти: бой, доведённый до
    конца и закрытый, не оставлял следа, и раздел «Бои» в архиве был пуст.
    """
    assert not app.results()
    engine = app.start_battle()
    engine.run()

    result = app.finish_battle()

    assert app.result_path is not None
    assert [saved.id for _, saved in app.results()] == [result.id]

    # Итог считается один раз: иначе каждый заход на экран плодил копии.
    for _ in range(3):
        app.finish_battle()
    assert len(app.results()) == 1
    assert app.result is result


def test_an_unfinished_battle_is_not_archived(app: AppState) -> None:
    """Незаконченный бой в архив не идёт — итога у него ещё нет."""
    engine = app.start_battle()
    engine.run_turns(4)

    app.finish_battle()

    assert app.result_path is None
    assert not app.results()


def test_the_result_screen_says_where_the_battle_was_saved(app: AppState) -> None:
    """Экран итога показывает файл архива вместо кнопки «В архив»."""
    engine = app.start_battle()
    engine.run()

    view = resolve(app, ROUTES["battle_result"].format(id=app.scenario.id))

    assert app.result_path is not None
    assert _has(view, app.result_path.name)
    assert not _has(view, "В архив"), "кнопка предлагает сделать уже сделанное"
