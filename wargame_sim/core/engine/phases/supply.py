"""Фаза 8 — расход боезапаса и топлива (§6.1, §5 supply.yaml)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, TurnData, element_key
from core.log import BattleLog

PHASE = "supply"


def run(state: BattleState, turn_data: TurnData, config: AppConfig, log: BattleLog) -> None:
    ammo_cfg = config.sup.ammo
    fuel_cfg = config.sup.fuel
    equipment_cfg = config.sup.equipment

    for side in SIDES:
        for element in state.elements(side):
            key = element_key(side, element)
            order = config.order(state.order_of(side, element))
            intensity = turn_data.fire_intensity.get(key, 0.0)
            loss_share = turn_data.loss_share.get(key, 0.0)

            before = {
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
            }
            factors: list[tuple[str, float]] = [
                (f"приказ:{order_name(state, side, element)}", order.ammo_use),
                ("интенсивность огня", intensity),
            ]

            ammo_spent = (
                ammo_cfg.base_per_turn
                * order.ammo_use
                * (1.0 + ammo_cfg.intensity_weight * intensity)
            )
            element.ammo = clamp(element.ammo - ammo_spent, ammo_cfg.min, ammo_cfg.max)
            factors.append(("расход боезапаса", ammo_spent))

            if config.tog.fuel and (element.has_vehicles or fuel_cfg.infantry_uses_fuel):
                fuel_spent = (
                    fuel_cfg.base_per_turn
                    * order.fuel_use
                    * (1.0 + fuel_cfg.intensity_weight * intensity)
                )
                element.fuel = clamp(element.fuel - fuel_spent, fuel_cfg.min, fuel_cfg.max)
                factors.append(("расход топлива", fuel_spent))

            if config.tog.equipment:
                kit_lost = (
                    equipment_cfg.loss_per_turn
                    + equipment_cfg.loss_per_casualty_share * loss_share
                )
                element.equipment = clamp(
                    element.equipment - kit_lost, equipment_cfg.min, equipment_cfg.max
                )
                factors.append(("износ снаряжения", kit_lost))

            after = {
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
            }
            if before == after:
                continue
            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=key,
                event="supply_spent",
                before=before,
                after=after,
                breakdown=factors,
                text=(
                    f"{element.name}: боезапас {before['ammo']:.0f}→{after['ammo']:.0f}%, "
                    f"топливо {before['fuel']:.0f}→{after['fuel']:.0f}%."
                ),
            )


def order_name(state: BattleState, side: str, element) -> str:
    return state.order_of(side, element)
