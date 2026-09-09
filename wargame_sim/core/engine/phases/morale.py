"""Фаза 10 — мораль (§6.2).

Отрицательная часть изменения делится на устойчивость (приказ × опыт),
положительная — начисляется как есть.
"""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, TurnData, element_key, other_side
from core.log import BattleLog

PHASE = "morale"


def _side_success(state: BattleState, turn_data: TurnData) -> dict[str, float]:
    """Успех стороны в ходу: своя доля потерь против доли потерь противника."""
    shares: dict[str, float] = {}
    for side in SIDES:
        own = [
            turn_data.loss_share.get(element_key(side, element), 0.0)
            for element in state.elements(side)
        ]
        shares[side] = sum(own) / len(own) if own else 0.0
    return {side: clamp(shares[other_side(side)] - shares[side], -1.0, 1.0) for side in SIDES}


def run(state: BattleState, turn_data: TurnData, config: AppConfig, log: BattleLog) -> None:
    weights = config.mor.weights
    morale_cfg = config.mor
    element_types = config.element_types.element_types
    success = _side_success(state, turn_data)
    turn_data.side_success = success

    for side in SIDES:
        has_hq = state.hq_alive(side, element_types)
        battalion = state.battalion(side)
        for element in state.elements(side):
            key = element_key(side, element)
            order = config.order(state.order_of(side, element))
            experience = config.experience_level(element.experience)

            loss_share = turn_data.loss_share.get(key, 0.0)
            suppression_gain = turn_data.suppression_gain.get(key, 0.0)
            vehicle_loss_share = turn_data.vehicle_loss_share.get(key, 0.0)

            negative = (
                weights.k1_casualties * loss_share
                + weights.k2_suppression * suppression_gain
                + weights.k3_vehicle_losses * vehicle_loss_share
                + (0.0 if has_hq else weights.k4_no_hq)
            )
            resistance = order.morale_resistance * experience.morale_resistance
            negative /= resistance if resistance > 0 else 1.0

            commander_term = (
                weights.k5_commander * battalion.commander_influence
                if config.tog.commander_influence
                else 0.0
            )
            positive = (
                commander_term
                + weights.k6_experience * experience.morale_bonus
                + weights.k7_side_success * max(success[side], 0.0)
            )

            delta = positive - negative
            before = element.morale
            element.morale = clamp(before + delta, morale_cfg.min, morale_cfg.max)
            if element.morale == before:
                continue

            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=key,
                event="morale_changed",
                before={"morale": before},
                after={"morale": element.morale},
                breakdown=[
                    ("k1·потери", -weights.k1_casualties * loss_share),
                    ("k2·подавление", -weights.k2_suppression * suppression_gain),
                    ("k3·потери техники", -weights.k3_vehicle_losses * vehicle_loss_share),
                    ("k4·вне связи со штабом", 0.0 if has_hq else -weights.k4_no_hq),
                    ("устойчивость", resistance),
                    ("k5·командир", commander_term),
                    ("k6·опыт", weights.k6_experience * experience.morale_bonus),
                    ("k7·успех стороны", weights.k7_side_success * max(success[side], 0.0)),
                    ("итого", delta),
                ],
                text=(
                    f"{element.name}: мораль {before:.0f}→{element.morale:.0f} "
                    f"({delta:+.1f})."
                ),
            )
