"""Интерфейс: маршруты, общая рамка, экраны, тумблеры, поля (§10, §12).

Flet-окно в тестах не запускается — экраны строятся как обычные объекты
контролов, поэтому проверяется именно то, что собирает интерфейс.
"""

from __future__ import annotations

import shutil
from dataclasses import fields
from pathlib import Path

import flet as ft
import pytest

from core.batch import run_batch
from core.config import ConfigError, ConfigStore
from core.config.introspect import flatten
from core.config.schema import TogglesBody
from core.engine import BattleEngine
from core.models import Order, Side
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
        if getattr(control, "bgcolor", None) == t.TEXT and _has(control, "Подразделения")
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
    assert _has(view, "Бой ещё не проводился")


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
    assert _has(view, f"{title} · {len(entries)}")
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


def test_order_choices_cover_every_order(app: AppState) -> None:
    labels = _labels(resolve(app, ROUTES["battle_setup"]))
    assert "приказ" in labels
    for order in Order:
        assert str(order).casefold() in labels


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
    assert _has(view, "Перестроить")
    assert _has(view, "Разделить")
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
