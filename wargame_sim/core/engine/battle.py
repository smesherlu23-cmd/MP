"""Цикл боя и порядок фаз (§6.1).

Ход — строгая последовательность фаз. Фазы 4–7 (выбор целей, воздействие,
потери, подавление) выполняются по сторонам в порядке инициативы, поэтому
бонус первого удара действительно означает удар первым.
"""

from __future__ import annotations

from core.config import AppConfig, load_config
from core.engine import checks
from core.engine.phases import (
    casualties,
    damage,
    detection,
    fatigue,
    initiative,
    morale,
    recovery,
    supply,
    suppression,
    targeting,
)
from core.engine.rng import RngStreams
from core.engine.state import SIDES, BattleState, SideState, TurnData, other_side
from core.log import BattleLog
from core.models import (
    BattalionState,
    BattleResult,
    ElementReport,
    EndReason,
    Scenario,
    SideReport,
    Winner,
    new_id,
)

#: Порядок фаз хода — ровно как в §6.1.
PHASE_ORDER = (
    "recovery",
    "detection",
    "initiative",
    "targeting",
    "damage",
    "casualties",
    "suppression",
    "supply",
    "fatigue",
    "morale",
    "checks",
)

#: Состояния, немедленно выводящие сторону из боя. Отступление в список
#: не входит: оно засчитывается только после выхода из контакта.
DEFEATED_STATES = (
    BattalionState.ROUTED,
    BattalionState.PANIC,
)

_STATE_TO_REASON = {
    BattalionState.ROUTED: EndReason.ROUT,
    BattalionState.PANIC: EndReason.PANIC,
    BattalionState.RETREATING: EndReason.RETREAT,
}


class BattleEngine:
    """Пошаговый движок боя.

    Одна и та же пара (сценарий, конфиг) с одним сидом всегда даёт один и тот
    же результат и один и тот же журнал (§7).
    """

    def __init__(
        self,
        scenario: Scenario,
        config: AppConfig | None = None,
        *,
        seed: int | None = None,
        verbose: bool = True,
    ) -> None:
        self.scenario = scenario.normalised()
        self.config = config or load_config()
        self.master_seed = int(self.scenario.master_seed if seed is None else seed)
        self.log = BattleLog(verbose=verbose)
        self.rng = RngStreams(self.master_seed)
        self.state = self._build_state()
        self.winner: Winner | None = None
        self.end_reason: EndReason | None = None
        self.turn_data = TurnData(turn=0)

    # -- инициализация ------------------------------------------------------
    def _build_state(self) -> BattleState:
        sides: dict[str, SideState] = {}
        for name in SIDES:
            battalion = self.scenario.battalion(name).copy_deep()
            battalion.state = BattalionState.FIGHTING
            side_state = SideState(battalion=battalion)
            for element in battalion.elements:
                side_state.initial_personnel[element.id] = element.personnel_current
                side_state.initial_vehicles[element.id] = element.vehicles_current
                side_state.personnel_lost[element.id] = 0
                side_state.vehicles_lost[element.id] = 0
                side_state.in_contact[element.id] = False
            side_state.intel_progress = float(
                self.config.cbt.detection.intel_levels.index(
                    str(self.scenario.environment.intel(name))
                )
            )
            side_state.intel_level = self.scenario.environment.intel(name)
            sides[name] = side_state
        return BattleState(environment=self.scenario.environment, sides=sides)

    # -- ход ----------------------------------------------------------------
    @property
    def finished(self) -> bool:
        return self.state.finished

    @property
    def turn(self) -> int:
        return self.state.turn

    def step(self) -> None:
        """Один полный ход."""
        if self.state.finished:
            return
        self.state.turn += 1
        turn = self.state.turn
        self.turn_data = TurnData(turn=turn)
        config = self.config
        log = self.log

        self.log.add(
            turn=turn,
            phase="turn",
            event="turn_started",
            before={},
            after={
                "A_personnel": self.state.battalion("A").personnel_current,
                "B_personnel": self.state.battalion("B").personnel_current,
            },
            text=f"Ход {turn}.",
        )

        recovery.run(self.state, config, log)
        detection.run(self.state, self.turn_data, config, self.rng, log)
        initiative.run(self.state, self.turn_data, config, self.rng, log)

        first = self.turn_data.first_side
        for side in (first, other_side(first)):
            if not self.state.is_active(side):
                continue
            targeting.run(self.state, self.turn_data, side, config, self.rng, log)
            damage.run(self.state, self.turn_data, side, config, self.rng, log)
            casualties.run(self.state, self.turn_data, side, config, self.rng, log)
            suppression.run(self.state, self.turn_data, side, config, log)

        supply.run(self.state, self.turn_data, config, log)
        fatigue.run(self.state, self.turn_data, config, log)
        morale.run(self.state, self.turn_data, config, log)
        checks.run(self.state, self.turn_data, config, self.rng, log)

        self._evaluate_end()

    def run(self, max_turns: int | None = None) -> BattleResult:
        """Прогнать бой до конца и вернуть результат."""
        limit = max_turns or self.state.environment.max_turns
        while not self.state.finished and self.state.turn < limit:
            self.step()
        if not self.state.finished:
            self._finish(Winner.DRAW, EndReason.TURN_LIMIT)
        return self.result()

    def run_turns(self, count: int) -> None:
        """Прогнать не более ``count`` ходов (кнопка «5 ходов» в UI)."""
        limit = self.state.environment.max_turns
        for _ in range(count):
            if self.state.finished or self.state.turn >= limit:
                break
            self.step()
        if not self.state.finished and self.state.turn >= limit:
            self._finish(Winner.DRAW, EndReason.TURN_LIMIT)

    # -- условия остановки --------------------------------------------------
    def _evaluate_end(self) -> None:
        states = {side: self.state.battalion(side).state for side in SIDES}
        withdrawn = {
            side: checks.has_withdrawn(self.state, side, self.config) for side in SIDES
        }
        defeated = {
            side: states[side] in DEFEATED_STATES or withdrawn[side] for side in SIDES
        }
        tasks = {side: self.state.side(side).task_completed for side in SIDES}

        def reason_for(side: str) -> EndReason:
            if withdrawn[side]:
                return EndReason.RETREAT
            return _STATE_TO_REASON.get(states[side], EndReason.ROUT)

        if defeated["A"] and defeated["B"]:
            self._finish(Winner.DRAW, reason_for("A"))
        elif defeated["A"]:
            self._finish(Winner.B, reason_for("A"))
        elif defeated["B"]:
            self._finish(Winner.A, reason_for("B"))
        elif tasks["A"] and tasks["B"]:
            self._finish(Winner.DRAW, EndReason.TASK)
        elif tasks["A"]:
            self._finish(Winner.A, EndReason.TASK)
        elif tasks["B"]:
            self._finish(Winner.B, EndReason.TASK)
        elif self.state.turn >= self.state.environment.max_turns:
            self._finish(Winner.DRAW, EndReason.TURN_LIMIT)

    def _finish(self, winner: Winner, reason: EndReason) -> None:
        if self.state.finished:
            return
        self.state.finished = True
        self.winner = winner
        self.end_reason = reason
        self.log.add(
            turn=self.state.turn,
            phase="turn",
            event="battle_finished",
            before={},
            after={"winner": str(winner), "reason": str(reason)},
            text=self._outcome_text(winner, reason),
        )

    def _outcome_text(self, winner: Winner, reason: EndReason) -> str:
        if winner == Winner.DRAW:
            return f"Бой окончен на ходу {self.state.turn}: ничья ({reason})."
        battalion = self.state.battalion(str(winner))
        loser = self.state.battalion(other_side(str(winner)))
        return (
            f"Бой окончен на ходу {self.state.turn}: победа стороны {winner} "
            f"({battalion.name}) — {loser.name} {reason}."
        )

    # -- отчёт --------------------------------------------------------------
    def _side_report(self, side: str) -> SideReport:
        side_state = self.state.side(side)
        battalion = side_state.battalion
        start_personnel = sum(side_state.initial_personnel.values())
        start_vehicles = sum(side_state.initial_vehicles.values())
        end_personnel = sum(element.personnel_current for element in battalion.elements)
        end_vehicles = sum(element.vehicles_current for element in battalion.elements)
        lost_personnel = side_state.total_personnel_lost()
        lost_vehicles = side_state.total_vehicles_lost()

        elements = [
            ElementReport(
                id=element.id,
                name=element.name,
                type=element.type,
                alive=element.alive,
                personnel_start=side_state.initial_personnel.get(element.id, 0),
                personnel_end=element.personnel_current,
                personnel_lost=side_state.personnel_lost.get(element.id, 0),
                vehicles_start=side_state.initial_vehicles.get(element.id, 0),
                vehicles_end=element.vehicles_current,
                vehicles_lost=side_state.vehicles_lost.get(element.id, 0),
                vehicle_condition=round(element.vehicle_condition, 2),
                morale=round(element.morale, 2),
                suppression=round(element.suppression, 2),
                fatigue=round(element.fatigue, 2),
                ammo=round(element.ammo, 2),
                fuel=round(element.fuel, 2),
                equipment=round(element.equipment, 2),
                order=str(battalion.order_for(element)),
            )
            for element in battalion.elements
        ]

        return SideReport(
            id=battalion.id,
            name=battalion.name,
            side=side,
            state=str(battalion.state),
            task=battalion.task,
            task_completed=side_state.task_completed,
            personnel_start=start_personnel,
            personnel_end=end_personnel,
            personnel_lost=lost_personnel,
            personnel_loss_ratio=round(
                lost_personnel / start_personnel if start_personnel else 0.0, 4
            ),
            vehicles_start=start_vehicles,
            vehicles_end=end_vehicles,
            vehicles_lost=lost_vehicles,
            morale=round(battalion.morale, 2),
            combat_power=round(battalion.combat_power, 2),
            organisation=round(battalion.organisation, 2),
            supply=round(battalion.supply_level, 2),
            ammo=round(battalion.ammo, 2),
            fuel=round(battalion.fuel, 2),
            equipment=round(battalion.equipment, 2),
            fatigue=round(battalion.fatigue, 2),
            suppression=round(battalion.suppression, 2),
            elements=elements,
        )

    def result(self) -> BattleResult:
        """Собрать результат боя вместе с журналом."""
        winner = self.winner or Winner.DRAW
        reason = self.end_reason or EndReason.TURN_LIMIT
        return BattleResult(
            id=new_id("btl"),
            scenario_id=self.scenario.id,
            scenario_name=self.scenario.name,
            master_seed=self.master_seed,
            turns=self.state.turn,
            max_turns=self.state.environment.max_turns,
            winner=winner,
            end_reason=reason,
            summary_text=self._outcome_text(winner, reason),
            side_a=self._side_report("A"),
            side_b=self._side_report("B"),
            log=list(self.log.entries),
            log_hash=self.log.digest(),
        )


def run_battle(
    scenario: Scenario,
    config: AppConfig | None = None,
    *,
    seed: int | None = None,
    verbose: bool = True,
) -> BattleResult:
    """Прогнать сценарий целиком — основная точка входа для cli и UI."""
    engine = BattleEngine(scenario, config, seed=seed, verbose=verbose)
    return engine.run()
