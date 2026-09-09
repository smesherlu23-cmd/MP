"""Фаза 4 — выбор целей: распределение огня по элементам противника (§6.2).

Вес цели = приоритет типа × уязвимость × (1 − укрытие) × случайность,
уровень контакта задаёт, какая доля элементов противника вообще доступна.
"""

from __future__ import annotations

import math

from core.config import AppConfig
from core.engine.formulas import contact_target_share, cover
from core.engine.rng import RngStreams
from core.engine.state import BattleState, TurnData, element_key, other_side
from core.log import BattleLog
from core.models import ContactLevel

PHASE = "targeting"


def _best_contact(state: BattleState, side: str) -> ContactLevel:
    levels = list(state.side(side).contact.values())
    if ContactLevel.FULL in levels:
        return ContactLevel.FULL
    if ContactLevel.PARTIAL in levels:
        return ContactLevel.PARTIAL
    return ContactLevel.NONE


def run(
    state: BattleState,
    turn_data: TurnData,
    side: str,
    config: AppConfig,
    rng: RngStreams,
    log: BattleLog,
) -> None:
    """Построить матрицу целеуказания для стороны ``side``."""
    enemy = other_side(side)
    targeting_cfg = config.cbt.targeting
    contact_map = state.side(side).contact
    enemy_battalion = state.battalion(enemy)
    enemy_cover = cover(enemy_battalion, state.environment, config)

    visible = [
        element
        for element in state.elements(enemy)
        if contact_map.get(element.id, ContactLevel.NONE) != ContactLevel.NONE
    ]
    if not visible:
        return

    share = contact_target_share(_best_contact(state, side), config)
    available = max(1, math.ceil(share * len(state.elements(enemy)))) if share > 0 else 0
    if available == 0:
        return

    for attacker in state.elements(side):
        attacker_key = element_key(side, attacker)
        weights: list[tuple[float, str]] = []
        details: dict[str, list[tuple[str, float]]] = {}
        for target in visible:
            entry = config.element_type(target.type)
            level = contact_map.get(target.id, ContactLevel.NONE)
            noise = rng.uniform(
                state.turn,
                PHASE,
                f"{attacker_key}->{enemy}/{target.id}",
                targeting_cfg.noise.min,
                targeting_cfg.noise.max,
            )
            weight = (
                entry.target_priority**targeting_cfg.priority_exponent
                * entry.vulnerability
                * (1.0 - enemy_cover)
                * noise
            )
            focus = 1.0
            if level == ContactLevel.FULL and entry.hq:
                focus *= 1.0 + targeting_cfg.hq_focus_bonus
            if level == ContactLevel.FULL and entry.supply_source:
                focus *= 1.0 + targeting_cfg.supply_focus_bonus
            weight *= focus
            weight = max(weight, targeting_cfg.min_weight)
            weights.append((weight, target.id))
            details[target.id] = [
                ("приоритет", entry.target_priority),
                ("уязвимость", entry.vulnerability),
                ("укрытие", 1.0 - enemy_cover),
                ("фокус", focus),
                ("случайность", noise),
            ]

        weights.sort(key=lambda item: (-item[0], item[1]))
        chosen = weights[:available]
        total = sum(weight for weight, _ in chosen)
        if total <= 0:
            continue

        allocation = {target_id: weight / total for weight, target_id in chosen}
        turn_data.allocation[attacker_key] = allocation

        for target_id, part in allocation.items():
            target = enemy_battalion.element(target_id)
            if target is None:
                continue
            log.add(
                turn=state.turn,
                phase=PHASE,
                actor=attacker_key,
                target=element_key(enemy, target),
                event="fire_allocated",
                before={},
                after={"share": part},
                breakdown=details[target_id],
                text=(
                    f"{attacker.name} направляет {part * 100:.0f}% огня "
                    f"по «{target.name}»."
                ),
            )
