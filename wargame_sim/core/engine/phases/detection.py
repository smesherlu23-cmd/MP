"""Фаза 2 — обнаружение: уровень контакта по каждому элементу (§6.2)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.rng import RngStreams
from core.engine.state import SIDES, BattleState, TurnData, element_key, other_side
from core.log import BattleLog
from core.models import ContactLevel, IntelLevel

PHASE = "detection"


def _intel_factor(state: BattleState, side: str, config: AppConfig) -> tuple[float, str]:
    """k_разведданные — по накопленному уровню разведданных стороны."""
    if not config.tog.intel:
        return 1.0, "выключено"
    level = str(state.side(side).intel_level)
    return config.cbt.detection.intel.get(level, 1.0), level


def _observer_quality(state: BattleState, side: str, config: AppConfig) -> tuple[float, float]:
    """Лучшее качество наблюдения стороны и прибавка за разведэлементы."""
    best = 0.0
    recon_bonus = 0.0
    detection_cfg = config.cbt.detection
    for element in state.elements(side):
        entry = config.element_type(element.type)
        experience = config.experience_level(element.experience)
        order = config.order(state.order_of(side, element))
        quality = (
            entry.detection
            * experience.detection
            * order.detection_speed
            * (1.0 - element.suppression / 100.0)
        )
        best = max(best, quality)
        if entry.recon:
            recon_bonus += detection_cfg.recon_element_bonus
    recon_bonus = min(recon_bonus, detection_cfg.recon_bonus_cap)
    return best, recon_bonus


def _level_for(value: float, config: AppConfig) -> ContactLevel:
    thresholds = config.cbt.detection.contact_thresholds
    if value >= thresholds.полный:
        return ContactLevel.FULL
    if value >= thresholds.частичный:
        return ContactLevel.PARTIAL
    return ContactLevel.NONE


def _advance_intel(state: BattleState, side: str, config: AppConfig) -> None:
    """Разведданные растут, пока сторона держит контакт (§6.3, «разведка»)."""
    levels = config.cbt.detection.intel_levels
    side_state = state.side(side)
    if any(level != ContactLevel.NONE for level in side_state.contact.values()):
        side_state.intel_progress = min(
            side_state.intel_progress + config.cbt.detection.intel_gain_per_turn,
            float(len(levels) - 1),
        )
    index = int(side_state.intel_progress)
    side_state.intel_level = IntelLevel(levels[min(index, len(levels) - 1)])


def run(
    state: BattleState,
    turn_data: TurnData,
    config: AppConfig,
    rng: RngStreams,
    log: BattleLog,
) -> None:
    """Определить уровень контакта каждой стороны с элементами противника."""
    turn = state.turn
    detection_cfg = config.cbt.detection
    terrain = config.terrain_entry(str(state.environment.terrain))
    weather = config.weather_entry(str(state.environment.weather))
    time_of_day = config.time_entry(str(state.environment.time_of_day))

    for side in SIDES:
        enemy = other_side(side)
        side_state = state.side(side)
        side_state.contact = {}
        intel_factor, intel_label = _intel_factor(state, side, config)
        observer, recon_bonus = _observer_quality(state, side, config)

        for element in state.elements(enemy):
            entry = config.element_type(element.type)
            order = config.order(state.order_of(enemy, element))
            stealth = entry.stealth * order.visibility
            value = (
                detection_cfg.base
                * terrain.detection
                * weather.detection
                * time_of_day.detection
                * intel_factor
                * stealth
                * observer
                * (1.0 + recon_bonus)
            )
            level = _level_for(value, config)
            side_state.contact[element.id] = level
            log.add(
                turn=turn,
                phase=PHASE,
                actor=f"{side}/*",
                target=element_key(enemy, element),
                event="contact",
                before={"contact": "—"},
                after={"contact": str(level), "value": value},
                breakdown=[
                    (f"местность:{state.environment.terrain}", terrain.detection),
                    (f"погода:{state.environment.weather}", weather.detection),
                    (f"время:{state.environment.time_of_day}", time_of_day.detection),
                    (f"разведданные:{intel_label}", intel_factor),
                    (f"скрытность:{element.type}", stealth),
                    ("наблюдатель", observer),
                    ("разведэлементы", 1.0 + recon_bonus),
                ],
                text=(
                    f"{element.name} ({enemy}) — контакт «{level}» "
                    f"(значение {value:.2f})."
                ),
            )

    # Кто из своих под наблюдением противника — нужно для усталости и отдыха.
    for side in SIDES:
        enemy_contact = state.side(other_side(side)).contact
        for element in state.side(side).battalion.elements:
            visible = enemy_contact.get(element.id, ContactLevel.NONE) != ContactLevel.NONE
            sees_enemy = any(
                level != ContactLevel.NONE for level in state.side(side).contact.values()
            )
            flag = bool(element.alive and (visible or sees_enemy))
            state.side(side).in_contact[element.id] = flag
            turn_data.in_contact[element_key(side, element)] = flag
        side_state = state.side(side)
        if any(side_state.in_contact.values()) and side_state.first_contact_turn is None:
            side_state.first_contact_turn = turn

    for side in SIDES:
        _advance_intel(state, side, config)
