"""Фаза 1 — восстановление: спад подавления, отдых, подвоз снабжения (§6.1)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, element_key
from core.log import BattleLog

PHASE = "recovery"


def _supply_efficiency(state: BattleState, side: str, config: AppConfig) -> float:
    """Эффективность подвоза: считается по живым тыловым элементам."""
    best = 0.0
    for element in state.elements(side):
        entry = config.element_types.element_types.get(element.type)
        if entry is None or not entry.supply_source:
            continue
        health = 100.0 * element.personnel_ratio * (1.0 - element.suppression / 100.0)
        best = max(best, config.sup.source_efficiency_curve(health))
    return best


def run(state: BattleState, config: AppConfig, log: BattleLog) -> None:
    turn = state.turn
    suppression_cfg = config.cbt.suppression
    fatigue_cfg = config.fat
    ammo_cfg = config.sup.ammo
    fuel_cfg = config.sup.fuel
    equipment_cfg = config.sup.equipment
    morale_cfg = config.mor

    for side in SIDES:
        side_state = state.side(side)
        efficiency = _supply_efficiency(state, side, config)
        for element in state.elements(side):
            key = element_key(side, element)
            experience = config.experience_level(element.experience)
            before = {
                "suppression": element.suppression,
                "fatigue": element.fatigue,
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
                "morale": element.morale,
            }
            factors: list[tuple[str, float]] = []

            # Спад подавления: k_восстановление × (1 + k_опыт)
            decay = suppression_cfg.recovery * (1.0 + experience.suppression_recovery)
            element.suppression = clamp(
                element.suppression - decay, suppression_cfg.min, suppression_cfg.max
            )
            factors.append(("спад подавления", decay))

            # Отдых: работает, когда элемент не был в контакте в прошлом ходу
            if config.tog.fatigue and not side_state.contact_flag(element.id):
                rest = fatigue_cfg.recovery_per_turn * (
                    1.0 + fatigue_cfg.recovery_experience_weight * experience.combat
                )
                element.fatigue = clamp(
                    element.fatigue - rest, fatigue_cfg.min, fatigue_cfg.max
                )
                factors.append(("отдых", rest))

            # Подвоз снабжения от живого тылового элемента
            if efficiency > 0:
                ammo_gain = ammo_cfg.resupply_per_turn * efficiency
                element.ammo = clamp(element.ammo + ammo_gain, ammo_cfg.min, ammo_cfg.max)
                factors.append(("подвоз боезапаса", ammo_gain))
                if config.tog.fuel:
                    fuel_gain = fuel_cfg.resupply_per_turn * efficiency
                    element.fuel = clamp(element.fuel + fuel_gain, fuel_cfg.min, fuel_cfg.max)
                    factors.append(("подвоз топлива", fuel_gain))
                if config.tog.equipment:
                    kit_gain = equipment_cfg.resupply_per_turn * efficiency
                    element.equipment = clamp(
                        element.equipment + kit_gain, equipment_cfg.min, equipment_cfg.max
                    )
                    factors.append(("пополнение снаряжения", kit_gain))
            else:
                factors.append(("подвоз боезапаса", 0.0))

            # Естественное восстановление морали
            element.morale = clamp(
                element.morale + morale_cfg.recovery_per_turn, morale_cfg.min, morale_cfg.max
            )
            factors.append(("восстановление морали", morale_cfg.recovery_per_turn))

            after = {
                "suppression": element.suppression,
                "fatigue": element.fatigue,
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
                "morale": element.morale,
            }
            if before != after:
                log.add(
                    turn=turn,
                    phase=PHASE,
                    actor=key,
                    event="recovered",
                    before=before,
                    after=after,
                    breakdown=factors,
                    text=(
                        f"{element.name}: подавление {before['suppression']:.0f}→"
                        f"{after['suppression']:.0f}, боезапас {before['ammo']:.0f}→"
                        f"{after['ammo']:.0f}."
                    ),
                )
