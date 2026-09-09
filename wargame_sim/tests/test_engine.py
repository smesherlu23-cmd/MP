"""Движок боя: детерминизм, баланс потерь, завершаемость (§6, §7, §12)."""

from __future__ import annotations

import pytest

from core.engine import PHASE_ORDER, BattleEngine, run_battle
from core.engine.state import SIDES
from core.models import Environment, Order, Terrain, TimeOfDay, Weather
from tests.conftest import scenario_with


# --------------------------------------------------------------------------
# Воспроизводимость (§7)
# --------------------------------------------------------------------------
def test_same_seed_gives_identical_log(scenario, config) -> None:
    """50 прогонов одного сценария с одним сидом → одинаковый хеш журнала."""
    hashes = {BattleEngine(scenario, config).run().log_hash for _ in range(50)}
    assert len(hashes) == 1


def test_same_seed_gives_identical_numbers(scenario, config) -> None:
    first = BattleEngine(scenario, config).run()
    second = BattleEngine(scenario, config).run()
    assert first.model_dump(exclude={"id"}) == second.model_dump(exclude={"id"})


def test_different_seed_changes_result(scenario, config) -> None:
    hashes = {BattleEngine(scenario, config, seed=seed).run().log_hash for seed in range(8)}
    assert len(hashes) > 1


def test_seed_is_stored_in_result_for_replay(scenario, config) -> None:
    result = BattleEngine(scenario, config, seed=1234).run()
    assert result.master_seed == 1234
    replay = BattleEngine(scenario, config, seed=result.master_seed).run()
    assert replay.log_hash == result.log_hash


# --------------------------------------------------------------------------
# Баланс и границы (§12)
# --------------------------------------------------------------------------
def test_losses_plus_remainder_equal_initial_every_turn(scenario, config) -> None:
    """Потери + остаток == исходная численность на каждом ходу."""
    engine = BattleEngine(scenario, config)
    while not engine.finished:
        engine.step()
        for side in SIDES:
            side_state = engine.state.side(side)
            for element in side_state.battalion.elements:
                start = side_state.initial_personnel[element.id]
                lost = side_state.personnel_lost[element.id]
                assert lost + element.personnel_current == start
                start_vehicles = side_state.initial_vehicles[element.id]
                lost_vehicles = side_state.vehicles_lost[element.id]
                assert lost_vehicles + element.vehicles_current == start_vehicles


def test_nothing_goes_negative(scenario, config) -> None:
    engine = BattleEngine(scenario, config)
    while not engine.finished:
        engine.step()
        for side in SIDES:
            for element in engine.state.side(side).battalion.elements:
                assert element.personnel_current >= 0
                assert element.personnel_current <= element.personnel_full
                assert 0 <= element.morale <= 100
                assert 0 <= element.suppression <= 100
                assert 0 <= element.fatigue <= 100
                assert 0 <= element.ammo <= 100
                assert 0 <= element.fuel <= 100
                assert 0 <= element.equipment <= 100
                for group in element.vehicles:
                    assert 0 <= group.count_current <= group.count_full
                    assert 0 <= group.condition <= 100


def test_report_balance(scenario, config) -> None:
    result = run_battle(scenario, config)
    for report in (result.side_a, result.side_b):
        assert report.personnel_lost + report.personnel_end == report.personnel_start
        assert report.vehicles_lost + report.vehicles_end == report.vehicles_start
        assert 0 <= report.personnel_loss_ratio <= 1


# --------------------------------------------------------------------------
# Завершаемость (§12)
# --------------------------------------------------------------------------
@pytest.mark.parametrize("seed", range(12))
def test_battle_always_ends_within_max_turns(config, seed: int) -> None:
    scenario = scenario_with(config, seed=seed)
    result = BattleEngine(scenario, config, verbose=False).run()
    assert 0 < result.turns <= result.max_turns
    assert result.end_reason is not None


def test_short_turn_limit_is_respected(config) -> None:
    scenario = scenario_with(config, environment=Environment(max_turns=3))
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= 3


def test_phase_order_matches_spec() -> None:
    assert PHASE_ORDER == (
        "recovery",
        "detection",
        "initiative",
        "targeting",
        "damage",
        "casualties",
        "suppression",
        "supply",
        "fatigue",
        "morale",
        "checks",
    )


def test_step_by_step_matches_full_run(scenario, config) -> None:
    """Кнопка «шаг» и кнопка «до конца» дают один и тот же бой."""
    stepwise = BattleEngine(scenario, config)
    while not stepwise.finished:
        stepwise.step()
    whole = BattleEngine(scenario, config).run()
    assert stepwise.result().log_hash == whole.log_hash


def test_run_turns_stops_at_requested_count(scenario, config) -> None:
    engine = BattleEngine(scenario, config)
    engine.run_turns(5)
    assert engine.turn == 5 or engine.finished


# --------------------------------------------------------------------------
# Каждый приказ, местность, погода и время суток участвуют в тесте (§12)
# --------------------------------------------------------------------------
@pytest.mark.parametrize("order", list(Order))
def test_every_order_runs(config, order: Order) -> None:
    scenario = scenario_with(config, order_a=order, order_b=Order.DEFENCE)
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= result.max_turns
    assert result.side_a.personnel_lost + result.side_a.personnel_end == result.side_a.personnel_start


@pytest.mark.parametrize("terrain", list(Terrain))
def test_every_terrain_runs(config, terrain: Terrain) -> None:
    scenario = scenario_with(config, environment=Environment(terrain=terrain))
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= result.max_turns


@pytest.mark.parametrize("weather", list(Weather))
def test_every_weather_runs(config, weather: Weather) -> None:
    scenario = scenario_with(config, environment=Environment(weather=weather))
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= result.max_turns


@pytest.mark.parametrize("time_of_day", list(TimeOfDay))
def test_every_time_of_day_runs(config, time_of_day: TimeOfDay) -> None:
    scenario = scenario_with(config, environment=Environment(time_of_day=time_of_day))
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= result.max_turns


@pytest.mark.parametrize("fortification", range(6))
def test_every_fortification_level_runs(config, fortification: int) -> None:
    scenario = scenario_with(
        config, environment=Environment(fortification_B=fortification)
    )
    result = BattleEngine(scenario, config, verbose=False).run()
    assert result.turns <= result.max_turns
