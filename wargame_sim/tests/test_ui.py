"""Интерфейс: маршруты, общая рамка, экраны, тумблеры, поля (§10, §12).

Flet-окно в тестах не запускается — экраны строятся как обычные объекты
контролов, поэтому проверяется именно то, что собирает интерфейс.
"""

from __future__ import annotations

import shutil
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
from ui.views import archive, config_editor, unit_editor, vehicles
from ui.widgets import journal
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
        ROUTES["vehicles"],
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
    """Все девять маршрутов из §10 строят экран."""
    routes = _routes(app)
    assert len(routes) == len(ROUTE_TABLE)
    for route in routes:
        view = resolve(app, route)
        assert isinstance(view, ft.View)
        assert view.controls


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
def test_vehicle_constructor_lists_the_library(app: AppState) -> None:
    view = vehicles.build(app)
    library = app.config.vehicles.vehicles
    assert _has(view, f"Машины · {len(library)}")
    for name in library:
        assert _has(view, name)


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
        app.store.raw_text("vehicles"), ("vehicles",), "Тягач", vehicles.NEW_VEHICLE
    )
    app.store.save_text("vehicles", text)
    app.reload_config()
    assert set(app.config.vehicles.vehicles) == before | {"Тягач"}

    app.store.save_text("vehicles", remove_entry(app.store.raw_text("vehicles"), ("vehicles", "Тягач")))
    app.reload_config()
    assert set(app.config.vehicles.vehicles) == before


def test_vehicle_in_use_is_not_deleted_silently(app: AppState) -> None:
    """Машину, которая стоит в подразделении, удалить нельзя — и сказано почему."""
    view = vehicles.build(app, "БТР")
    assert _has(view, "Где используется")
    texts = " ".join(_texts(view))
    assert "тип «стрелковая_рота»" in texts


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
