"""Фаза 10 — мораль (§6.2).

Давление на мораль делится на устойчивость: приказ × опыт × командир.
Положительных слагаемых «просто так» нет — единственный плюс даёт успех
своей стороны в ходу, и его надо заработать. Иначе рота под огнём набирает
мораль каждый ход: командир и опыт начисляли по +2.4, а потери за ход
снимали 0.7, и мораль ползла вверх у тех, кого расстреливают.
"""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, TurnData, element_key, other_side
from core.log import BattleLog
from core.models import Element

PHASE = "morale"


def _side_success(state: BattleState, turn_data: TurnData) -> dict[str, float]:
    """Успех стороны в ходу: своя доля потерь против доли потерь противника.

    Доля считается **по людям**, а не по элементам. Раньше это было
    среднее долей потерь по элементам, и миномётная батарея в 40 человек
    весила столько же, сколько стрелковая рота в 600: на 20 боях в 15%
    сторон·ходов знак получался противоположным взвешенному, то есть
    премию за ход получал тот, кто в этом ходу потерял больше людей.
    """
    shares: dict[str, float] = {}
    for side in SIDES:
        elements = state.elements(side)
        lost = sum(turn_data.casualties.get(element_key(side, item), 0) for item in elements)
        alive = sum(item.personnel_current for item in elements)
        start = alive + lost
        shares[side] = lost / start if start else 0.0
    return {side: clamp(shares[other_side(side)] - shares[side], -1.0, 1.0) for side in SIDES}


def _wear_cohesion(
    state: BattleState,
    element: Element,
    key: str,
    loss_share: float,
    suppression_gain: float,
    config: AppConfig,
    log: BattleLog,
) -> None:
    """Потери и подавление рвут слаженность.

    Считается здесь же, где давление на мораль: входные величины те же, а
    заводить ради этого отдельную фазу — менять §6.1 без нужды. Собирается
    слаженность обратно в фазе восстановления и только вне контакта.
    """
    cohesion_cfg = config.cbt.cohesion
    drop = (
        cohesion_cfg.loss_per_casualty_share * loss_share
        + cohesion_cfg.loss_per_suppression * suppression_gain
    )
    if drop <= 0:
        return
    before = element.cohesion
    element.cohesion = clamp(before - drop, cohesion_cfg.min, cohesion_cfg.max)
    if element.cohesion == before:
        return
    log.add(
        turn=state.turn,
        phase=PHASE,
        actor=key,
        event="cohesion_lost",
        before={"cohesion": before},
        after={"cohesion": element.cohesion},
        breakdown=[
            ("от потерь", -cohesion_cfg.loss_per_casualty_share * loss_share),
            ("от подавления", -cohesion_cfg.loss_per_suppression * suppression_gain),
        ],
        text=(
            f"{element.name}: слаженность {before:.0f}→{element.cohesion:.0f} "
            f"({-drop:+.1f})."
        ),
    )


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

            pressure = (
                weights.k1_casualties * loss_share
                + weights.k2_suppression * suppression_gain
                + weights.k3_vehicle_losses * vehicle_loss_share
                + (0.0 if has_hq else weights.k4_no_hq)
            )
            commander_hold = (
                morale_cfg.commander_resistance(battalion.commander_influence)
                if config.tog.commander_influence
                else 1.0
            )
            resistance = (
                order.morale_resistance * experience.morale_resistance * commander_hold
            )
            negative = pressure / resistance if resistance > 0 else pressure

            positive = weights.k7_side_success * max(success[side], 0.0)
            delta = positive - negative

            _wear_cohesion(state, element, key, loss_share, suppression_gain, config, log)
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
                    ("давление на мораль", -pressure),
                    ("устойчивость:приказ", order.morale_resistance),
                    ("устойчивость:опыт", experience.morale_resistance),
                    ("устойчивость:командир", commander_hold),
                    ("k7·успех стороны", positive),
                    ("итого", delta),
                ],
                text=(
                    f"{element.name}: мораль {before:.0f}→{element.morale:.0f} "
                    f"({delta:+.1f})."
                ),
            )
