"""Фаза 4 — выбор целей: распределение огня по элементам противника (§6.2).

Вес цели = приоритет типа × уязвимость × (1 − укрытие) × случайность,
уровень контакта задаёт, какая доля элементов противника вообще доступна.
"""

from __future__ import annotations

import math

from core.config import AppConfig
from core.engine.formulas import contact_target_share, cover, vehicle_visibility
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


def _under_observation(state: BattleState, side: str) -> bool:
    """Видит ли противник хоть кого-то из наших — значит, есть куда стрелять."""
    return any(state.side(side).in_contact.values())


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
    share = contact_target_share(_best_contact(state, side), config)

    if not visible or share <= 0:
        # Наблюдение потеряно. Но если противник видит нас, мы
        # отстреливаемся в его сторону — плохо, зато не даром. Без этого
        # подавленная сторона переставала стрелять совсем, и победитель
        # переставал платить ровно тогда, когда исход уже решён.
        if not _under_observation(state, side):
            return
        visible = list(state.elements(enemy))
        share = config.cbt.detection.return_fire.target_share
        turn_data.blind_fire.add(side)
        if not visible or share <= 0:
            return

    available = max(1, math.ceil(share * len(state.elements(enemy))))

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
            # Техника притягивает огонь тем сильнее, чем она заметнее:
            # танковая рота видна лучше, чем пеший взвод.
            seen = vehicle_visibility(target, config)
            noticeability = config.cbt.curves.visibility(seen) if seen else 1.0
            weight = (
                entry.target_priority**targeting_cfg.priority_exponent
                * entry.vulnerability
                * (1.0 - enemy_cover)
                * noticeability
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
                ("заметность техники", noticeability),
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
