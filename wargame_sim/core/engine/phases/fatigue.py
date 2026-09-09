"""Фаза 9 — усталость (§5 fatigue.yaml)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, TurnData, element_key
from core.log import BattleLog

PHASE = "fatigue"


def run(state: BattleState, turn_data: TurnData, config: AppConfig, log: BattleLog) -> None:
    if not config.tog.fatigue:
        return

    fatigue_cfg = config.fat
    terrain = config.terrain_entry(str(state.environment.terrain))
    weather = config.weather_entry(str(state.environment.weather))

    for side in SIDES:
        for element in state.elements(side):
            key = element_key(side, element)
            order = config.order(state.order_of(side, element))
            in_contact = turn_data.in_contact.get(key, False)
            loss_share = turn_data.loss_share.get(key, 0.0)

            gain = fatigue_cfg.gain_per_turn
            if in_contact:
                gain += fatigue_cfg.gain_in_contact
            gain += fatigue_cfg.gain_per_casualty_share * loss_share
            gain *= order.fatigue_gain * terrain.fatigue * weather.fatigue

            before = element.fatigue
            element.fatigue = clamp(before + gain, fatigue_cfg.min, fatigue_cfg.max)
            if element.fatigue == before:
                continue
            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=key,
                event="fatigue_gained",
                before={"fatigue": before},
                after={"fatigue": element.fatigue},
                breakdown=[
                    ("базовый прирост", fatigue_cfg.gain_per_turn),
                    ("контакт", fatigue_cfg.gain_in_contact if in_contact else 0.0),
                    ("от потерь", fatigue_cfg.gain_per_casualty_share * loss_share),
                    (f"приказ:{state.order_of(side, element)}", order.fatigue_gain),
                    (f"местность:{state.environment.terrain}", terrain.fatigue),
                    (f"погода:{state.environment.weather}", weather.fatigue),
                ],
                text=f"{element.name}: усталость {before:.0f}→{element.fatigue:.0f}%.",
            )
