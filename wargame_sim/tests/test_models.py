"""Модели данных и агрегаты (§4)."""

from __future__ import annotations

import pytest

from core.models import Battalion, Element, Environment, Order, Side, VehicleGroup


def _element(**overrides) -> Element:
    data = {
        "id": "r1",
        "name": "1-я рота",
        "type": "стрелковая_рота",
        "personnel_full": 120,
        "personnel_current": 120,
        "attack": 42,
        "defense": 45,
        "experience": 2,
    }
    data.update(overrides)
    return Element(**data)


def test_losses_are_derived_not_stored() -> None:
    """Потери в процентах не хранятся — вычисляются (§4.1)."""
    assert "loss_ratio" not in Element.model_fields
    element = _element(personnel_current=90)
    assert element.loss_ratio == pytest.approx(0.25)
    assert element.personnel_losses == 30


def test_element_rejects_current_above_full() -> None:
    with pytest.raises(ValueError, match="больше штата"):
        _element(personnel_current=200)


@pytest.mark.parametrize(
    "field, value",
    [("morale", 101), ("ammo", -1), ("experience", 5), ("experience", 0), ("attack", 101)],
)
def test_fields_have_ranges(field: str, value: float) -> None:
    with pytest.raises(ValueError):
        _element(**{field: value})


def test_vehicle_group_validation() -> None:
    with pytest.raises(ValueError, match="больше штата"):
        VehicleGroup(vehicle_type="БТР", count_full=4, count_current=9)
    group = VehicleGroup(vehicle_type="БТР", count_full=4, count_current=3, condition=50)
    assert group.losses == 1
    assert group.loss_ratio == pytest.approx(0.25)


def test_vehicle_condition_is_weighted_by_count() -> None:
    element = _element(
        vehicles=[
            VehicleGroup(vehicle_type="БМП", count_full=6, count_current=6, condition=100),
            VehicleGroup(vehicle_type="БТР", count_full=2, count_current=2, condition=50),
        ]
    )
    assert element.vehicle_condition == pytest.approx(87.5)


def test_battalion_aggregates_are_read_only_properties() -> None:
    for name in ("personnel_current", "morale", "combat_power", "organisation", "supply_level"):
        assert name not in Battalion.model_fields


def test_battalion_weighted_aggregates() -> None:
    battalion = Battalion(
        id="a",
        name="бат",
        elements=[
            _element(id="r1", personnel_current=100, morale=80),
            _element(id="r2", personnel_current=50, morale=20),
        ],
    )
    assert battalion.personnel_current == 150
    assert battalion.morale == pytest.approx((100 * 80 + 50 * 20) / 150)
    assert 0 <= battalion.combat_power <= 100
    assert 0 <= battalion.organisation <= 100


def test_element_order_overrides_battalion_order() -> None:
    """Приказ задаётся на батальон, у элемента можно переопределить (§4.4)."""
    scout = _element(id="scout", order=Order.RECON)
    line = _element(id="line")
    battalion = Battalion(id="a", name="бат", elements=[scout, line], order=Order.ATTACK)
    assert battalion.order_for(scout) == Order.RECON
    assert battalion.order_for(line) == Order.ATTACK


def test_dead_elements_are_excluded_from_aggregates() -> None:
    dead = _element(id="dead", alive=False)
    alive = _element(id="alive")
    battalion = Battalion(id="a", name="бат", elements=[dead, alive])
    assert battalion.personnel_current == alive.personnel_current
    assert battalion.personnel_full == dead.personnel_full + alive.personnel_full


def test_environment_side_accessors() -> None:
    environment = Environment(fortification_A=2, fortification_B=4)
    assert environment.fortification("A") == 2
    assert environment.fortification(Side.B) == 4
    assert environment.intel("A") == environment.intel_A


def test_scenario_normalisation_sets_sides(scenario) -> None:
    scenario.battalion_a.side = Side.B
    normalised = scenario.normalised()
    assert normalised.battalion_a.side == Side.A
    assert normalised.battalion_b.side == Side.B
    assert scenario.battalion_a.side == Side.B  # исходник не тронут
