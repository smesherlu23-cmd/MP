"""Фаза 3 — инициатива: кто наносит удар первым (§6.2)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.rng import RngStreams
from core.engine.state import SIDES, BattleState, TurnData
from core.log import BattleLog
from core.models import ContactLevel, Order

PHASE = "initiative"


def _side_value(
    state: BattleState, side: str, config: AppConfig, rng: RngStreams
) -> tuple[float, list[tuple[str, float]]]:
    initiative_cfg = config.cbt.initiative
    battalion = state.battalion(side)
    elements = state.elements(side)
    factors: list[tuple[str, float]] = []

    if not elements:
        return 0.0, [("нет боеспособных элементов", 0.0)]

    experience_bonus = max(
        config.experience_level(element.experience).initiative for element in elements
    )
    factors.append(("опыт", experience_bonus))

    cohesion = battalion.cohesion * battalion.communications / 100.0
    cohesion_term = initiative_cfg.cohesion_weight * cohesion / 100.0
    factors.append(("связь", cohesion_term))

    order_term = max(
        config.order(state.order_of(side, element)).initiative for element in elements
    )
    factors.append(("приказ", order_term))

    if config.tog.intel:
        intel_term = initiative_cfg.intel.get(str(state.side(side).intel_level), 0.0)
    else:
        intel_term = 0.0
    factors.append(("разведданные", intel_term))

    readiness_term = 0.0
    if config.tog.readiness:
        readiness_term = initiative_cfg.readiness_weight * battalion.readiness / 100.0
    factors.append(("готовность", readiness_term))

    roll = rng.uniform(
        state.turn, PHASE, side, initiative_cfg.roll.min, initiative_cfg.roll.max
    )
    factors.append(("бросок", roll))

    ambush_term = 0.0
    first_contact = state.side(side).first_contact_turn
    in_first_contact_turn = first_contact is not None and first_contact == state.turn
    has_ambush = any(
        state.order_of(side, element) == str(Order.AMBUSH) for element in elements
    )
    sees_enemy = any(
        level != ContactLevel.NONE for level in state.side(side).contact.values()
    )
    if has_ambush and sees_enemy and in_first_contact_turn:
        ambush_term = initiative_cfg.ambush_bonus
    factors.append(("засада", ambush_term))

    total = (
        experience_bonus
        + cohesion_term
        + order_term
        + intel_term
        + readiness_term
        + roll
        + ambush_term
    )
    return total, factors


def run(
    state: BattleState, turn_data: TurnData, config: AppConfig, rng: RngStreams, log: BattleLog
) -> None:
    values: dict[str, float] = {}
    breakdowns: dict[str, list[tuple[str, float]]] = {}
    for side in SIDES:
        values[side], breakdowns[side] = _side_value(state, side, config, rng)

    if values["A"] == values["B"]:
        # Ничью разрешает бросок, а не порядок сторон — иначе появился бы
        # систематический перевес у A (§12, тест на 50% ± 5%).
        first = "A" if rng.random(state.turn, PHASE, "tie") < 0.5 else "B"
    else:
        first = "A" if values["A"] > values["B"] else "B"

    turn_data.first_side = first
    turn_data.initiative_values = values

    log.add(
        turn=state.turn,
        phase=PHASE,
        actor=f"{first}/*",
        event="initiative",
        before={"A": values["A"], "B": values["B"]},
        after={"first": first},
        breakdown=[(f"{side}:{name}", value) for side in SIDES for name, value in breakdowns[side]],
        text=(
            f"Инициатива у стороны {first} "
            f"(A {values['A']:.2f} против B {values['B']:.2f}); "
            f"бонус первого удара ×{config.cbt.casualties.first_strike_bonus:g}."
        ),
    )
