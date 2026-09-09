"""Фаза 7 — подавление (§6.2): ``suppression += k_подавление × Давление``."""

from __future__ import annotations

from core.config import AppConfig
from core.engine.formulas import clamp
from core.engine.state import BattleState, TurnData, element_key, other_side
from core.log import BattleLog

PHASE = "suppression"


def run(
    state: BattleState,
    turn_data: TurnData,
    side: str,
    config: AppConfig,
    log: BattleLog,
) -> None:
    enemy = other_side(side)
    suppression_cfg = config.cbt.suppression

    for target in state.elements(enemy):
        target_key = element_key(enemy, target)
        pressure = turn_data.pressure.get(target_key, 0.0)
        if pressure <= 0:
            continue
        gain = suppression_cfg.gain * pressure**suppression_cfg.gain_exponent
        before = target.suppression
        target.suppression = clamp(before + gain, suppression_cfg.min, suppression_cfg.max)
        applied = target.suppression - before
        turn_data.suppression_gain[target_key] = (
            turn_data.suppression_gain.get(target_key, 0.0) + applied
        )
        log.add(
            turn=state.turn,
            phase=PHASE,
            actor=f"{side}/*",
            target=target_key,
            event="suppressed",
            before={"suppression": before},
            after={"suppression": target.suppression},
            breakdown=[
                ("давление", pressure),
                ("k_подавление", suppression_cfg.gain),
                ("экспонента", suppression_cfg.gain_exponent),
                ("потолок", suppression_cfg.max),
            ],
            text=(
                f"«{target.name}» подавлена на {target.suppression:.0f}% "
                f"(+{applied:.0f})."
            ),
        )
