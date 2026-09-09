"""Проверки конца хода: отступление, паника, разгром, выполнение задачи (§6.3)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.phases.casualties import apply_personnel_loss, apply_vehicle_loss
from core.engine.rng import RngStreams
from core.engine.state import SIDES, BattleState, TurnData, element_key
from core.log import BattleLog
from core.models import BattalionState, ContactLevel, IntelLevel, Order

PHASE = "checks"


def _set_order(state: BattleState, side: str, element, order: Order) -> None:
    element.order = order


def has_withdrawn(state: BattleState, side: str, config: AppConfig) -> bool:
    """Сторона отступила и действительно вышла из контакта.

    Приказ «отступление» сам по себе боя не заканчивает: пока противник
    держит контакт, отход продолжается под огнём.
    """
    side_state = state.side(side)
    return (
        side_state.battalion.state == BattalionState.RETREATING
        and side_state.disengage >= config.cbt.checks.disengage_threshold
    )


def check_morale_states(
    state: BattleState, turn_data: TurnData, config: AppConfig, rng: RngStreams, log: BattleLog
) -> None:
    """Порог отступления и порог паники — по каждому элементу."""
    thresholds = config.mor.thresholds
    vehicles_cfg = config.cbt.vehicles
    checks_cfg = config.cbt.checks

    for side in SIDES:
        for element in list(state.elements(side)):
            key = element_key(side, element)
            if element.morale < thresholds.panic:
                before = {
                    "morale": element.morale,
                    "personnel": element.personnel_current,
                    "vehicles": element.vehicles_current,
                    "order": str(state.battalion(side).order_for(element)),
                    "alive": element.alive,
                }
                pursuit_raw = element.personnel_current * checks_cfg.panic_pursuit_losses
                pursuit = rng.round_stochastic(pursuit_raw, state.turn, PHASE, key)
                lost = apply_personnel_loss(state, side, element, pursuit)
                abandoned = rng.round_stochastic(
                    element.vehicles_current * vehicles_cfg.abandoned_on_panic,
                    state.turn,
                    f"{PHASE}:veh",
                    key,
                )
                abandoned = apply_vehicle_loss(state, side, element, abandoned)
                _set_order(state, side, element, Order.PANIC)
                element.alive = False
                state.side(side).panicked_elements += 1
                turn_data.casualties[key] = turn_data.casualties.get(key, 0) + lost
                log.add(
                    turn=state.turn,
                    phase=PHASE,
                    actor=key,
                    event="panic",
                    before=before,
                    after={
                        "morale": element.morale,
                        "personnel": element.personnel_current,
                        "vehicles": element.vehicles_current,
                        "order": str(Order.PANIC),
                        "alive": element.alive,
                    },
                    breakdown=[
                        ("порог паники", thresholds.panic),
                        ("мораль", element.morale),
                        ("потери от преследования", float(lost)),
                        ("брошено техники", float(abandoned)),
                    ],
                    text=(
                        f"«{element.name}» ударилась в паническое бегство: "
                        f"{lost} чел. потеряно при преследовании, "
                        f"брошено {abandoned} ед. техники; элемент выбыл из расчёта."
                    ),
                )
                continue

            current_order = state.battalion(side).order_for(element)
            if element.morale < thresholds.retreat and current_order != Order.RETREAT:
                before_order = str(current_order)
                _set_order(state, side, element, Order.RETREAT)
                log.add(
                    turn=state.turn,
                    phase=PHASE,
                    actor=key,
                    event="retreat_order",
                    before={"order": before_order, "morale": element.morale},
                    after={"order": str(Order.RETREAT), "morale": element.morale},
                    breakdown=[
                        ("порог отступления", thresholds.retreat),
                        ("мораль", element.morale),
                    ],
                    text=f"«{element.name}» переходит к отступлению: мораль {element.morale:.0f}.",
                )


def check_elements_alive(state: BattleState, config: AppConfig, log: BattleLog) -> None:
    """Элемент небоеспособен, если численность упала ниже порога."""
    threshold = config.cbt.checks.element_dead_personnel_ratio
    for side in SIDES:
        for element in list(state.elements(side)):
            if element.personnel_full == 0:
                continue
            if element.personnel_ratio < threshold:
                element.alive = False
                state.side(side).destroyed_elements += 1
                log.add(
                    turn=state.turn,
                    phase=PHASE,
                    actor=element_key(side, element),
                    event="element_destroyed",
                    before={"alive": True, "personnel": element.personnel_current},
                    after={"alive": False, "personnel": element.personnel_current},
                    breakdown=[
                        ("порог небоеспособности", threshold),
                        ("доля л/с", element.personnel_ratio),
                    ],
                    text=(
                        f"«{element.name}» небоеспособна: осталось "
                        f"{element.personnel_current} чел. "
                        f"({element.personnel_ratio * 100:.0f}% штата)."
                    ),
                )


def update_disengage(state: BattleState, config: AppConfig) -> None:
    """Накопление выхода из контакта — по приказам и подвижности местности."""
    terrain = config.terrain_entry(str(state.environment.terrain))
    for side in SIDES:
        elements = state.elements(side)
        if not elements:
            continue
        pull = sum(
            config.order(state.order_of(side, element)).disengage for element in elements
        ) / len(elements)
        state.side(side).disengage += pull * terrain.speed


def check_task(state: BattleState, config: AppConfig, log: BattleLog) -> None:
    """Выполнение боевой задачи по приказу батальона (§6.3)."""
    checks_cfg = config.cbt.checks
    for side in SIDES:
        side_state = state.side(side)
        if side_state.task_completed:
            continue
        battalion = state.battalion(side)
        task = config.order(str(battalion.order)).task
        enemy_state = state.enemy(side)
        enemy_battalion = enemy_state.battalion
        done = False
        detail: list[tuple[str, float]] = []

        if task.kind == "enemy_routed":
            done = enemy_battalion.state in (
                BattalionState.ROUTED,
                BattalionState.PANIC,
            ) or has_withdrawn(state, str(enemy_state.battalion.side), config)
            detail = [("состояние противника", 1.0 if done else 0.0)]
        elif task.kind == "hold_turns":
            done = side_state.turns_held >= task.turns
            detail = [("выстоял ходов", float(side_state.turns_held)), ("нужно", float(task.turns))]
        elif task.kind == "ambush":
            start_personnel = sum(enemy_state.initial_personnel.values())
            inflicted = (
                side_state.inflicted_personnel / start_personnel if start_personnel else 0.0
            )
            own_start = sum(side_state.initial_personnel.values())
            kept = battalion.personnel_current / own_start if own_start else 0.0
            done = (
                inflicted >= task.damage_ratio
                and kept >= task.personnel_ratio
                and side_state.disengage >= checks_cfg.disengage_threshold
            )
            detail = [
                ("нанесено потерь", inflicted),
                ("нужно", task.damage_ratio),
                ("сохранено л/с", kept),
                ("выход из контакта", side_state.disengage),
            ]
        elif task.kind == "recon":
            target_level = task.intel_level or str(IntelLevel.FULL)
            levels = config.cbt.detection.intel_levels
            try:
                needed = levels.index(target_level)
            except ValueError:
                needed = len(levels) - 1
            done = side_state.intel_progress >= needed
            detail = [("разведданные", side_state.intel_progress), ("нужно", float(needed))]
        elif task.kind == "disengage":
            own_start = sum(side_state.initial_personnel.values())
            kept = battalion.personnel_current / own_start if own_start else 0.0
            done = (
                side_state.disengage >= checks_cfg.disengage_threshold
                and kept >= task.personnel_ratio
            )
            detail = [
                ("выход из контакта", side_state.disengage),
                ("сохранено л/с", kept),
                ("нужно", task.personnel_ratio),
            ]

        if done:
            side_state.task_completed = True
            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=f"{side}/*",
                event="task_completed",
                before={"task_completed": False},
                after={"task_completed": True},
                breakdown=detail,
                text=f"Сторона {side} выполнила задачу ({battalion.order}).",
            )


def check_battalions(state: BattleState, config: AppConfig, log: BattleLog) -> None:
    """Разгром, отступление и паника на уровне батальона."""
    checks_cfg = config.cbt.checks
    element_types = config.element_types.element_types

    for side in SIDES:
        side_state = state.side(side)
        battalion = side_state.battalion
        if battalion.state in (BattalionState.ROUTED, BattalionState.TASK_DONE):
            continue

        start_personnel = sum(side_state.initial_personnel.values())
        ratio = battalion.personnel_current / start_personnel if start_personnel else 0.0
        combat_elements = [
            element
            for element in battalion.alive_elements
            if element_types.get(element.type) is not None
            and element_types[element.type].combat
        ]

        if ratio < checks_cfg.rout_personnel_ratio or not combat_elements:
            # Если элементов сорвалось в панику больше, чем выбито огнём,
            # это паника, а не разгром (§9 — способы завершения).
            battalion.state = (
                BattalionState.PANIC
                if side_state.panicked_elements > side_state.destroyed_elements
                else BattalionState.ROUTED
            )
            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=f"{side}/*",
                event="battalion_routed",
                before={"state": "в бою", "personnel_ratio": ratio},
                after={"state": str(battalion.state)},
                breakdown=[
                    ("доля л/с", ratio),
                    ("порог разгрома", checks_cfg.rout_personnel_ratio),
                    ("боевых элементов", float(len(combat_elements))),
                ],
                text=(
                    f"Батальон {battalion.name}: {battalion.state}. Осталось "
                    f"{ratio * 100:.0f}% л/с, боеспособных элементов "
                    f"{len(combat_elements)} (в панике {side_state.panicked_elements}, "
                    f"выбито {side_state.destroyed_elements})."
                ),
            )
            continue

        alive = battalion.alive_elements
        if alive and all(
            state.order_of(side, element) == str(Order.PANIC) for element in alive
        ):
            battalion.state = BattalionState.PANIC
        elif alive and all(
            state.order_of(side, element)
            in (str(Order.RETREAT), str(Order.PANIC))
            for element in alive
        ):
            battalion.state = BattalionState.RETREATING
        elif side_state.task_completed:
            battalion.state = BattalionState.TASK_DONE
        else:
            battalion.state = BattalionState.FIGHTING


def update_hold_counters(state: BattleState, config: AppConfig) -> None:
    """Счётчик «выстоял N ходов» для обороны и закрепления."""
    for side in SIDES:
        side_state = state.side(side)
        under_fire = any(
            level != ContactLevel.NONE for level in state.enemy(side).contact.values()
        )
        if under_fire and side_state.battalion.state == BattalionState.FIGHTING:
            side_state.turns_held += 1


def run(
    state: BattleState, turn_data: TurnData, config: AppConfig, rng: RngStreams, log: BattleLog
) -> None:
    """Фаза 11 — проверки конца хода в порядке из §6.3."""
    check_morale_states(state, turn_data, config, rng, log)
    check_elements_alive(state, config, log)
    update_disengage(state, config)
    update_hold_counters(state, config)
    check_battalions(state, config, log)
    check_task(state, config, log)
    # Выполнение задачи может изменить состояние батальона.
    check_battalions(state, config, log)
