"""Фаза 1 — восстановление: спад подавления, отдых, подвоз снабжения (§6.1)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import SIDES, BattleState, element_key
from core.log import BattleLog

PHASE = "recovery"


def _has_supply_source(state: BattleState, side: str, config: AppConfig) -> bool:
    """Есть ли тыл в штате отряда — живой или уже выбитый."""
    for element in state.side(side).battalion.elements:
        entry = config.element_types.element_types.get(element.type)
        if entry is not None and entry.supply_source:
            return True
    return False


def _supply_efficiency(state: BattleState, side: str, config: AppConfig) -> float:
    """Эффективность подвоза: считается по живым тыловым элементам.

    Если тыла нет **по штату** — а у взвода и отделения его и не бывает, —
    подвоз идёт от старшей части долей ``external_supply_share``. Это не то
    же, что выбитый тыл: там подвоз обрывается совсем, и это событие боя.
    """
    best = 0.0
    for element in state.elements(side):
        entry = config.element_types.element_types.get(element.type)
        if entry is None or not entry.supply_source:
            continue
        health = 100.0 * element.personnel_ratio * (1.0 - element.suppression / 100.0)
        best = max(best, config.sup.source_efficiency_curve(health))
    if best == 0.0 and not _has_supply_source(state, side, config):
        return config.sup.external_supply_share
    return best


def run(state: BattleState, config: AppConfig, log: BattleLog) -> None:
    turn = state.turn
    # На первом ходу восстанавливать нечего: бой ещё не начинался, а
    # контакт не размечен — иначе все получают бесплатный тик подвоза,
    # отдыха и готовности ещё до первого выстрела.
    if turn <= 1:
        return
    suppression_cfg = config.cbt.suppression
    fatigue_cfg = config.fat
    ammo_cfg = config.sup.ammo
    fuel_cfg = config.sup.fuel
    equipment_cfg = config.sup.equipment
    vehicles_cfg = config.cbt.vehicles
    cohesion_cfg = config.cbt.cohesion
    readiness_cfg = config.cbt.readiness
    morale_cfg = config.mor

    for side in SIDES:
        side_state = state.side(side)
        efficiency = _supply_efficiency(state, side, config)
        for element in state.elements(side):
            key = element_key(side, element)
            in_contact = side_state.contact_flag(element.id)
            experience = config.experience_level(element.experience)
            before = {
                "suppression": element.suppression,
                "fatigue": element.fatigue,
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
                "morale": element.morale,
                "cohesion": element.cohesion,
                "readiness": element.readiness,
            }
            factors: list[tuple[str, float]] = []

            # Спад подавления: k_восстановление × (1 + k_опыт)
            decay = suppression_cfg.recovery * (1.0 + experience.suppression_recovery)
            element.suppression = clamp(
                element.suppression - decay, suppression_cfg.min, suppression_cfg.max
            )
            factors.append(("спад подавления", decay))

            # Отдых: работает, когда элемент не был в контакте в прошлом ходу
            if config.tog.fatigue and not in_contact:
                rest = fatigue_cfg.recovery_per_turn * (
                    1.0 + fatigue_cfg.recovery_experience_weight * experience.combat
                )
                element.fatigue = clamp(
                    element.fatigue - rest, fatigue_cfg.min, fatigue_cfg.max
                )
                factors.append(("отдых", rest))

            # Небоевой износ: чем ниже надёжность машины, тем быстрее
            # она теряет состояние сама по себе — без единого попадания.
            if config.tog.vehicle_condition and element.vehicles_current:
                worn = 0.0
                for group in element.vehicles:
                    if not group.count_current:
                        continue
                    entry = config.vehicle(group.vehicle_type)
                    drop = vehicles_cfg.breakdown_per_turn * (
                        1.0 - entry.reliability / 100.0
                    )
                    group.condition = clamp(group.condition - drop, 0.0, 100.0)
                    worn = max(worn, drop)
                if worn:
                    factors.append(("износ техники", worn))

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

            # Готовность и слаженность собираются только вне контакта:
            # под огнём подразделение не перестраивается и не приводит
            # себя в порядок — оно просто держится.
            if config.tog.readiness and not in_contact:
                before_readiness = element.readiness
                element.readiness = clamp(
                    element.readiness + readiness_cfg.recovery_per_turn,
                    readiness_cfg.min,
                    readiness_cfg.max,
                )
                if element.readiness != before_readiness:
                    factors.append(("готовность", readiness_cfg.recovery_per_turn))

            # Слаженность собирается только вне контакта: под огнём
            # подразделение не перестраивается.
            if not in_contact:
                before_cohesion = element.cohesion
                element.cohesion = clamp(
                    element.cohesion + cohesion_cfg.recovery_per_turn,
                    cohesion_cfg.min,
                    cohesion_cfg.max,
                )
                if element.cohesion != before_cohesion:
                    factors.append(("слаженность", cohesion_cfg.recovery_per_turn))

            # Мораль приходит в себя только вне контакта — под огнём не
            # рассыпаются, но и не рассветают. То же условие, что у отдыха.
            if not in_contact:
                element.morale = clamp(
                    element.morale + morale_cfg.recovery_per_turn,
                    morale_cfg.min,
                    morale_cfg.max,
                )
                factors.append(("восстановление морали", morale_cfg.recovery_per_turn))

            after = {
                "suppression": element.suppression,
                "fatigue": element.fatigue,
                "ammo": element.ammo,
                "fuel": element.fuel,
                "equipment": element.equipment,
                "morale": element.morale,
                "cohesion": element.cohesion,
                "readiness": element.readiness,
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
