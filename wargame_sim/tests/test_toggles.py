"""Опциональные параметры: отключение не ломает расчёт (§4.5, §14.6)."""

from __future__ import annotations

import itertools

import pytest

from core.config.schema import TogglesBody
from core.engine import BattleEngine
from core.engine.formulas import state_coefficient
from core.models import Battalion, Element
from tests.conftest import scenario_with

TOGGLE_NAMES = list(TogglesBody.model_fields)


def _element() -> tuple[Element, Battalion]:
    element = Element(
        id="r1",
        name="1-я рота",
        type="стрелковая_рота",
        personnel_full=120,
        personnel_current=90,
        attack=42,
        defense=45,
        experience=2,
        morale=60,
        fatigue=40,
        equipment=70,
        readiness=65,
        fuel=50,
    )
    return element, Battalion(id="a", name="бат", elements=[element])


def test_all_seven_optional_parameters_are_present() -> None:
    assert set(TOGGLE_NAMES) == {
        "fuel",
        "equipment",
        "vehicle_condition",
        "readiness",
        "commander_influence",
        "intel",
        "fatigue",
    }


@pytest.mark.parametrize("name", TOGGLE_NAMES)
def test_disabled_parameter_is_neutral(config, name: str) -> None:
    """Выключенный параметр не входит в произведение (модификатор 1.0)."""
    element, battalion = _element()
    setattr(config.tog, name, True)
    _, factors_on = state_coefficient(element, battalion, config)
    setattr(config.tog, name, False)
    _, factors_off = state_coefficient(element, battalion, config)
    setattr(config.tog, name, True)

    labels_on = {label for label, _ in factors_on.items}
    labels_off = {label for label, _ in factors_off.items}
    assert labels_off <= labels_on


@pytest.mark.parametrize("name", TOGGLE_NAMES)
def test_battle_runs_with_parameter_disabled(config, name: str) -> None:
    setattr(config.tog, name, False)
    try:
        result = BattleEngine(scenario_with(config), config, verbose=False).run()
    finally:
        setattr(config.tog, name, True)
    assert result.turns <= result.max_turns
    assert result.side_a.personnel_lost + result.side_a.personnel_end == result.side_a.personnel_start


def test_battle_runs_with_everything_disabled(config) -> None:
    for name in TOGGLE_NAMES:
        setattr(config.tog, name, False)
    try:
        result = BattleEngine(scenario_with(config), config, verbose=False).run()
    finally:
        for name in TOGGLE_NAMES:
            setattr(config.tog, name, True)
    assert result.turns <= result.max_turns
    assert result.winner is not None


@pytest.mark.parametrize("combo", list(itertools.combinations(TOGGLE_NAMES, 2)))
def test_pairs_of_disabled_parameters(config, combo: tuple[str, str]) -> None:
    for name in combo:
        setattr(config.tog, name, False)
    try:
        result = BattleEngine(scenario_with(config), config, verbose=False).run()
    finally:
        for name in combo:
            setattr(config.tog, name, True)
    assert 0 < result.turns <= result.max_turns
