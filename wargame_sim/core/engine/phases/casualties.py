"""Фаза 6 — потери в личном составе и технике (§6.2).

Потери в процентах нигде не хранятся: ведётся учёт «потеряно» и «в строю»,
их сумма всегда равна исходной численности (§12).
"""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp, cover
from core.engine.rng import RngStreams
from core.engine.state import BattleState, TurnData, element_key, other_side
from core.log import BattleLog
from core.models import Element

PHASE = "casualties"


def apply_personnel_loss(
    state: BattleState, side: str, element: Element, amount: int
) -> int:
    """Списать л/с, не уходя в минус, и записать в учёт стороны."""
    amount = max(0, min(amount, element.personnel_current))
    if amount == 0:
        return 0
    element.personnel_current -= amount
    side_state = state.side(side)
    side_state.personnel_lost[element.id] = side_state.personnel_lost.get(element.id, 0) + amount
    return amount


def apply_vehicle_loss(
    state: BattleState, side: str, element: Element, destroyed: int
) -> dict[str, int]:
    """Списать технику пропорционально наличию в группах.

    Возвращает, сколько машин каждого типа выбито: по этому потом
    считается экипаж — он у каждой машины свой (§4.1).
    """
    if destroyed <= 0 or element.vehicles_current == 0:
        return {}
    remaining = min(destroyed, element.vehicles_current)
    total = element.vehicles_current
    written_off: dict[str, int] = {}

    def take_from(group, amount: int) -> int:
        amount = min(amount, group.count_current)
        if amount <= 0:
            return 0
        group.count_current -= amount
        written_off[group.vehicle_type] = written_off.get(group.vehicle_type, 0) + amount
        return amount

    for group in element.vehicles:
        if remaining <= 0:
            break
        quota = min(round(destroyed * group.count_current / total), remaining)
        remaining -= take_from(group, quota)
    # Остаток раздаём по группам, где ещё есть машины.
    for group in element.vehicles:
        if remaining <= 0:
            break
        remaining -= take_from(group, remaining)

    side_state = state.side(side)
    side_state.vehicles_lost[element.id] = side_state.vehicles_lost.get(
        element.id, 0
    ) + sum(written_off.values())
    return written_off


def damage_vehicle_condition(element: Element, hits: int, loss_per_hit: float) -> float:
    """Часть попаданий уходит не в уничтожение, а в снижение состояния."""
    if hits <= 0 or element.vehicles_current == 0:
        return 0.0
    total = element.vehicles_current
    applied = 0.0
    for group in element.vehicles:
        if group.count_current == 0:
            continue
        share = group.count_current / total
        drop = loss_per_hit * hits * share
        new_condition = clamp(group.condition - drop, 0.0, 100.0)
        applied += group.condition - new_condition
        group.condition = new_condition
    return applied


def run(
    state: BattleState,
    turn_data: TurnData,
    side: str,
    config: AppConfig,
    rng: RngStreams,
    log: BattleLog,
) -> None:
    """Превратить давление, созданное стороной ``side``, в потери противника."""
    enemy = other_side(side)
    enemy_battalion = state.battalion(enemy)
    casualties_cfg = config.cbt.casualties
    vehicles_cfg = config.cbt.vehicles
    enemy_cover = cover(enemy_battalion, state.environment, config)

    for target in list(state.elements(enemy)):
        target_key = element_key(enemy, target)
        pressure = turn_data.pressure.get(target_key, 0.0)
        if pressure <= 0:
            continue

        before = {
            "personnel": target.personnel_current,
            "vehicles": target.vehicles_current,
            "condition": round(target.vehicle_condition, 2),
        }

        # --- личный состав ------------------------------------------------
        # Кривая обвала: пока устойчивость держит давление, потери идут по
        # обычной кривой; когда давление её пробивает, множитель растёт —
        # фронт либо стоит, либо сыпется, промежуточного состояния мало.
        collapse = config.cbt.curves.collapse(pressure)
        share = clamp(
            casualties_cfg.lethality * pressure**casualties_cfg.pressure_exponent * collapse,
            0.0,
            casualties_cfg.cap_per_turn,
        )
        # Потери бросаются, а не вычисляются: матожидание то же, но разброс
        # зависит от размера цели — у взвода он втрое шире, чем у роты.
        chance = clamp(share * (1.0 - enemy_cover), 0.0, 1.0)
        losses = rng.binomial(
            target.personnel_current, chance, state.turn, PHASE, target_key
        )
        losses = apply_personnel_loss(state, enemy, target, losses)

        # --- техника ------------------------------------------------------
        vehicle_pressure = turn_data.vehicle_pressure.get(target_key, 0.0)
        destroyed = 0
        damaged_hits = 0
        vehicle_share = 0.0
        if vehicle_pressure > 0 and target.vehicles_current > 0:
            vehicle_share = clamp(
                vehicles_cfg.lethality * vehicle_pressure**vehicles_cfg.pressure_exponent,
                0.0,
                vehicles_cfg.cap_per_turn,
            )
            vehicle_chance = clamp(vehicle_share * (1.0 - enemy_cover), 0.0, 1.0)
            hits = rng.binomial(
                target.vehicles_current, vehicle_chance, state.turn, f"{PHASE}:veh", target_key
            )
            damaged_hits = rng.binomial(
                hits, vehicles_cfg.condition_share, state.turn, f"{PHASE}:cond", target_key
            )
            destroyed = hits - damaged_hits
            lost_by_type = apply_vehicle_loss(state, enemy, target, destroyed)
            destroyed = sum(lost_by_type.values())
            damage_vehicle_condition(target, damaged_hits, vehicles_cfg.condition_loss_per_hit)
            # Экипаж берётся из карточки машины: с танком гибнет танковый
            # экипаж, с грузовиком — водитель со старшим.
            crew_aboard = sum(
                count * config.vehicle(name).crew for name, count in lost_by_type.items()
            )
            crew = rng.round_stochastic(
                crew_aboard * vehicles_cfg.crew_loss_share,
                state.turn,
                f"{PHASE}:crew",
                target_key,
            )
            crew_lost = apply_personnel_loss(state, enemy, target, crew)
            losses += crew_lost

        state.side(side).inflicted_personnel += losses

        start_personnel = before["personnel"]
        turn_data.casualties[target_key] = turn_data.casualties.get(target_key, 0) + losses
        turn_data.loss_share[target_key] = (
            losses / start_personnel if start_personnel else 0.0
        )
        start_vehicles = before["vehicles"]
        turn_data.vehicle_losses[target_key] = (
            turn_data.vehicle_losses.get(target_key, 0) + destroyed
        )
        turn_data.vehicle_loss_share[target_key] = (
            destroyed / start_vehicles if start_vehicles else 0.0
        )

        after = {
            "personnel": target.personnel_current,
            "vehicles": target.vehicles_current,
            "condition": round(target.vehicle_condition, 2),
        }
        if before == after:
            continue

        log.add(
            turn=state.turn,
            phase=PHASE,
            actor=f"{side}/*",
            target=target_key,
            event="losses_inflicted",
            before=before,
            after=after,
            breakdown=[
                ("давление", pressure),
                ("летальность", casualties_cfg.lethality),
                ("экспонента", casualties_cfg.pressure_exponent),
                ("обвал обороны", collapse),
                ("доля потерь", share),
                ("укрытие", 1.0 - enemy_cover),
                ("потолок за ход", casualties_cfg.cap_per_turn),
                ("давление по технике", vehicle_pressure),
                ("доля потерь техники", vehicle_share),
                ("повреждено машин", float(damaged_hits)),
            ],
            text=(
                f"«{target.name}» потеряла {losses} чел."
                + (f" и {destroyed} ед. техники." if destroyed else ".")
                + (f" Повреждено машин: {damaged_hits}." if damaged_hits else "")
            ),
        )
