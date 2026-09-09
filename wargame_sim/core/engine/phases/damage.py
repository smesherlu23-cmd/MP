"""Фаза 5 — воздействие: огневая мощь, устойчивость и давление (§6.2)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import contact_accuracy, firepower, resilience
from core.engine.rng import RngStreams
from core.engine.state import BattleState, TurnData, element_key, other_side
from core.log import BattleLog
from core.models import ContactLevel

PHASE = "damage"


def run(
    state: BattleState,
    turn_data: TurnData,
    side: str,
    config: AppConfig,
    rng: RngStreams,
    log: BattleLog,
) -> None:
    """Посчитать давление, создаваемое стороной ``side`` на каждую цель."""
    enemy = other_side(side)
    battalion = state.battalion(side)
    enemy_battalion = state.battalion(enemy)
    casualties_cfg = config.cbt.casualties
    contact_map = state.side(side).contact

    first_strike = (
        casualties_cfg.first_strike_bonus if turn_data.first_side == side else 1.0
    )

    # --- огневая мощь атакующих ------------------------------------------
    for attacker in state.elements(side):
        attacker_key = element_key(side, attacker)
        if attacker_key not in turn_data.allocation:
            continue
        noise = rng.uniform(
            state.turn,
            PHASE,
            attacker_key,
            casualties_cfg.noise.min,
            casualties_cfg.noise.max,
        )
        value, factors = firepower(
            attacker,
            battalion,
            state.environment,
            config,
            order_name=state.order_of(side, attacker),
            noise=noise,
            accuracy=1.0,
            first_strike=first_strike,
        )
        turn_data.fire[attacker_key] = value
        turn_data.breakdown[attacker_key] = factors.pairs()
        # Интенсивность огня — база для расхода боезапаса (§6.1, фаза 8).
        turn_data.fire_intensity[attacker_key] = (
            value / attacker.attack if attacker.attack > 0 else 0.0
        )
        log.add(
            turn=state.turn,
            phase=PHASE,
            actor=attacker_key,
            event="firepower",
            before={},
            after={"firepower": value},
            breakdown=factors.pairs(),
            text=f"{attacker.name}: огневая мощь {value:.1f}.",
        )

    # --- устойчивость целей ----------------------------------------------
    for target in state.elements(enemy):
        target_key = element_key(enemy, target)
        if target_key in turn_data.defence:
            continue
        value, factors = resilience(
            target,
            enemy_battalion,
            state.environment,
            config,
            order_name=state.order_of(enemy, target),
        )
        turn_data.defence[target_key] = value
        log.add(
            turn=state.turn,
            phase=PHASE,
            actor=target_key,
            event="resilience",
            before={},
            after={"resilience": value},
            breakdown=factors.pairs(),
            text=f"{target.name}: устойчивость {value:.1f}.",
        )

    # --- давление на каждую цель -----------------------------------------
    for target in state.elements(enemy):
        target_key = element_key(enemy, target)
        level = contact_map.get(target.id, ContactLevel.NONE)
        accuracy = contact_accuracy(level, config)
        incoming = 0.0
        anti_tank = 0.0
        contributions: list[tuple[str, float]] = []
        for attacker in state.elements(side):
            attacker_key = element_key(side, attacker)
            allocation = turn_data.allocation.get(attacker_key, {})
            part = allocation.get(target.id, 0.0)
            if part <= 0:
                continue
            portion = turn_data.fire.get(attacker_key, 0.0) * part * accuracy
            incoming += portion
            anti_tank += portion * config.element_type(attacker.type).anti_tank
            contributions.append((f"огонь:{attacker.name}", portion))
        if incoming <= 0:
            continue

        defence = turn_data.defence.get(target_key, 0.0)
        pressure = incoming / (defence + casualties_cfg.defense_epsilon)
        vehicle_pressure = 0.0
        if target.vehicles_current > 0:
            vehicle_defence = defence + config.cbt.vehicles.defense_epsilon
            vehicle_pressure = anti_tank / vehicle_defence

        turn_data.pressure[target_key] = turn_data.pressure.get(target_key, 0.0) + pressure
        turn_data.vehicle_pressure[target_key] = (
            turn_data.vehicle_pressure.get(target_key, 0.0) + vehicle_pressure
        )

        log.add(
            turn=state.turn,
            phase=PHASE,
            actor=f"{side}/*",
            target=target_key,
            event="pressure",
            before={},
            after={"pressure": pressure, "vehicle_pressure": vehicle_pressure},
            breakdown=[
                *contributions,
                (f"контакт:{level}", accuracy),
                ("устойчивость цели", defence),
                ("ε", casualties_cfg.defense_epsilon),
            ],
            text=(
                f"Давление на «{target.name}»: {pressure:.2f} "
                f"(огонь {incoming:.1f} против устойчивости {defence:.1f})."
            ),
        )
