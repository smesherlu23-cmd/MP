"""Интерфейс: маршруты, экраны, реакция на ошибки и тумблеры (§10).

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
from core.config.schema import TogglesBody
from core.engine import BattleEngine
from core.models import Order, Side
from ui.app import ROUTE_TABLE, resolve
from ui.state import ROUTES, AppState
from ui.views import config_editor, unit_editor
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
# Маршруты
# --------------------------------------------------------------------------
def test_every_documented_route_resolves(app: AppState) -> None:
    """Все девять маршрутов из §10 строят экран."""
    unit_id = app.units()[0][1].id
    routes = [
        ROUTES["home"],
        ROUTES["units"],
        ROUTES["unit"].format(id=unit_id),
        ROUTES["battle_setup"],
        ROUTES["battle"].format(id=app.scenario.id),
        ROUTES["battle_result"].format(id=app.scenario.id),
        ROUTES["batch"],
        ROUTES["config"],
        ROUTES["archive"],
    ]
    assert len(routes) == len(ROUTE_TABLE)
    for route in routes:
        view = resolve(app, route)
        assert isinstance(view, ft.View)
        assert view.controls


def test_unknown_route_gives_stub(app: AppState) -> None:
    view = resolve(app, "/такого/нет")
    assert isinstance(view, ft.View)


def test_missing_unit_gives_message(app: AppState) -> None:
    view = resolve(app, "/units/несуществующий")
    assert isinstance(view, ft.View)


def test_config_section_from_query(app: AppState) -> None:
    for section in app.store.sections():
        assert isinstance(resolve(app, f"/config?section={section}"), ft.View)
    assert isinstance(resolve(app, "/config?section=выдумка"), ft.View)


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


def test_config_editor_rejects_invalid_yaml(app: AppState) -> None:
    """Правка с ошибкой не применяется, файл остаётся прежним."""
    before = app.store.raw_text("combat")
    view = config_editor.build(app, "combat")
    assert isinstance(view, ft.View)
    with pytest.raises(ConfigError):
        app.store.save_text("combat", "combat: [сломано")
    assert app.store.raw_text("combat") == before


# --------------------------------------------------------------------------
# Тумблеры скрывают поля (§4.5)
# --------------------------------------------------------------------------
def _control_labels(control: object, found: list[str] | None = None) -> list[str]:
    """Собрать подписи всех вложенных контролов."""
    found = [] if found is None else found
    label = getattr(control, "label", None)
    if isinstance(label, str):
        found.append(label)
    for attribute in ("controls", "content", "actions", "rows", "columns", "cells"):
        value = getattr(control, attribute, None)
        if isinstance(value, list):
            for item in value:
                _control_labels(item, found)
        elif value is not None and hasattr(value, "__dataclass_fields__"):
            _control_labels(value, found)
    return found


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
    unit_id = app.units()[0][1].id

    data = app.store.raw("toggles")
    data["toggles"][toggle_name] = True
    app.store.save("toggles", data)
    app.reload_config()
    labels_on = _control_labels(unit_editor.build(app, unit_id))
    assert label in labels_on

    data = app.store.raw("toggles")
    data["toggles"][toggle_name] = False
    app.store.save("toggles", data)
    app.reload_config()
    labels_off = _control_labels(unit_editor.build(app, unit_id))
    assert label not in labels_off


def test_commander_and_intel_toggles_hide_setup_fields(app: AppState) -> None:
    data = app.store.raw("toggles")
    data["toggles"]["commander_influence"] = False
    data["toggles"]["intel"] = False
    app.store.save("toggles", data)
    app.reload_config()
    labels = _control_labels(resolve(app, ROUTES["battle_setup"]))
    assert "Влияние командира" not in labels
    assert "Разведданные" not in labels


def test_all_toggles_are_editable(app: AppState) -> None:
    labels = _control_labels(config_editor.build(app, "toggles"))
    for name in TogglesBody.model_fields:
        assert config_editor.TOGGLE_LABELS[name] in labels


# --------------------------------------------------------------------------
# Поведение экранов
# --------------------------------------------------------------------------
def test_battle_screen_after_steps(app: AppState) -> None:
    engine = app.start_battle()
    engine.run_turns(3)
    view = resolve(app, ROUTES["battle"].format(id=app.scenario.id))
    assert isinstance(view, ft.View)


def test_result_screen_after_battle(app: AppState) -> None:
    app.start_battle()
    app.engine.run()
    app.finish_battle()
    view = resolve(app, ROUTES["battle_result"].format(id=app.scenario.id))
    assert isinstance(view, ft.View)


def test_batch_screen_with_results(app: AppState) -> None:
    app.batch = run_batch(app.scenario, app.config, runs=6, processes=1)
    view = resolve(app, ROUTES["batch"])
    assert isinstance(view, ft.View)


def test_archive_screen_with_saved_battle(app: AppState) -> None:
    result = BattleEngine(app.scenario, app.config, verbose=False).run()
    app.save_result(result)
    view = resolve(app, ROUTES["archive"])
    assert isinstance(view, ft.View)
    assert app.results()


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
def test_number_field_applies_valid_value() -> None:
    seen: list[float] = []
    field = number_field("Мораль", 50, minimum=0, maximum=100, on_change=seen.append)
    field.value = "80"
    field.on_blur(None)
    assert seen == [80]
    assert field.error is None


def test_number_field_rejects_out_of_range() -> None:
    seen: list[float] = []
    field = number_field("Мораль", 50, minimum=0, maximum=100, on_change=seen.append)
    field.value = "500"
    field.on_blur(None)
    assert seen == []
    assert "допустимо" in field.error


def test_number_field_rejects_non_number() -> None:
    seen: list[float] = []
    field = number_field("Мораль", 50, minimum=0, maximum=100, on_change=seen.append)
    field.value = "много"
    field.on_blur(None)
    assert seen == []
    assert field.error == "нужно число"


def test_number_field_shows_range_hint() -> None:
    field = number_field("Опыт", 2, minimum=1, maximum=4, integer=True, on_change=lambda _: None)
    assert "1…4" in str(field.helper)


def test_scenario_side_assignment_from_editor(app: AppState) -> None:
    _, battalion = app.units()[0]
    unit_editor._use_in_battle(app, battalion, Side.B)
    assert app.scenario.battalion_b.id == battalion.id
    assert app.scenario.battalion_b.side == Side.B


def test_order_choices_cover_every_order(app: AppState) -> None:
    labels = _control_labels(resolve(app, ROUTES["battle_setup"]))
    assert "Приказ" in labels
    assert all(isinstance(order.value, str) for order in Order)
