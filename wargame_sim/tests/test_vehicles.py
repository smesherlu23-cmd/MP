"""Техника как отдельная сущность: карточка машины влияет на расчёт (§4.1)."""

from __future__ import annotations

import pytest

from core.config import AppConfig, ConfigError, ConfigStore
from core.engine import BattleEngine
from core.engine.formulas import (
    anti_tank_share,
    vehicle_armour,
    vehicle_fuel_use,
    vehicle_visibility,
)
from core.models import BattalionState, Side, VehicleGroup
from core.samples import make_battalion


def _element(config: AppConfig, type_name: str):
    battalion = make_battalion("bat_t", "Тест", Side.A, config)
    element = next(e for e in battalion.elements if e.type == type_name)
    return battalion, element


def test_unknown_vehicle_gives_clear_error(config: AppConfig) -> None:
    """Опечатка в типе машины — понятное сообщение, а не падение (§5)."""
    with pytest.raises(ConfigError, match="не описана"):
        config.vehicle("Звездолёт")


def test_vehicle_roster_comes_from_config(config: AppConfig) -> None:
    """Штатная техника типа элемента описана в конфиге, а не в коде."""
    entry = config.element_type("бронегруппа").defaults
    assert entry.vehicle_type == "БМП"
    assert entry.vehicle_count > 0
    _, element = _element(config, "бронегруппа")
    assert element.vehicles[0].vehicle_type == "БМП"


def test_anti_tank_takes_the_better_of_infantry_and_vehicles(config: AppConfig) -> None:
    """Рота на БТР остаётся слабой против танков, на танках — нет."""
    _, element = _element(config, "бронегруппа")
    infantry_share, source = anti_tank_share(element, config)
    assert source == "пехота"

    element.vehicles[0].vehicle_type = "Танк"
    tank_share, source = anti_tank_share(element, config)
    assert source == "техника"
    assert tank_share > infantry_share


def test_armour_switches_to_side_when_formation_breaks(config: AppConfig) -> None:
    """По отступающему и паникующему бьют в борт."""
    battalion, element = _element(config, "бронегруппа")
    front, facing = vehicle_armour(element, battalion, config)
    assert facing == "лоб"

    battalion.state = BattalionState.PANIC
    side, facing = vehicle_armour(element, battalion, config)
    assert facing == "борт"
    assert side < front


def test_armour_curve_makes_tanks_harder_to_kill(config: AppConfig) -> None:
    curve = config.cbt.curves.armour
    assert curve(config.vehicle("Танк").armour_front) > curve(
        config.vehicle("БТР").armour_front
    )


def test_element_without_vehicles_is_neutral(config: AppConfig) -> None:
    _, element = _element(config, "штаб")
    assert element.vehicles_current == 0
    assert vehicle_armour(element, make_battalion("b", "B", Side.A, config), config) == (
        0.0,
        "нет техники",
    )
    assert vehicle_visibility(element, config) == 0.0
    assert vehicle_fuel_use(element, config) == 1.0


def test_crew_loss_follows_the_card(config: AppConfig) -> None:
    """С танком гибнет танковый экипаж, с грузовиком — водитель со старшим."""
    assert config.vehicle("Танк").crew > config.vehicle("Грузовик").crew


def test_reliability_wears_vehicles_without_a_single_hit(config: AppConfig) -> None:
    """Небоевой износ: ненадёжная машина теряет состояние сама по себе."""
    from core.engine.phases import recovery
    from core.engine.state import BattleState, SideState
    from core.log import BattleLog
    from core.models import Environment

    battalion = make_battalion("bat_w", "Износ", Side.A, config)
    element = next(e for e in battalion.elements if e.vehicles)
    element.vehicles = [
        VehicleGroup(vehicle_type="Танк", count_full=4, count_current=4, condition=100.0)
    ]
    state = BattleState(
        environment=Environment(),
        sides={
            "A": SideState(battalion=battalion),
            "B": SideState(battalion=make_battalion("bat_x", "B", Side.B, config)),
        },
        # На первом ходу фаза восстановления не работает: бой ещё не
        # начинался, и бесплатного тика подвоза и отдыха быть не должно.
        turn=2,
    )
    recovery.run(state, config, BattleLog())
    assert element.vehicles[0].condition < 100.0


def test_swapping_vehicles_changes_the_battle(config_copy: ConfigStore, scenario) -> None:
    """Перевооружение бронегруппы на танки меняет исход, а не только цифры."""
    base = config_copy.get()
    before = BattleEngine(scenario, base, verbose=False).run()

    upgraded = scenario.model_copy(deep=True)
    for element in upgraded.battalion_a.elements:
        for group in element.vehicles:
            if group.vehicle_type == "БМП":
                group.vehicle_type = "Танк"
    after = BattleEngine(upgraded, base, verbose=False).run()

    assert (before.side_b.personnel_lost, before.turns) != (
        after.side_b.personnel_lost,
        after.turns,
    )
