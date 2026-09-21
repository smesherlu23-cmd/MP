"""Цикл боя и порядок фаз (§6.1).

Ход — строгая последовательность фаз. Фазы 4–7 (выбор целей, воздействие,
потери, подавление) выполняются по сторонам в порядке инициативы, поэтому
бонус первого удара действительно означает удар первым.
"""

from __future__ import annotations

from core import formation
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
from core.engine.state import (
    SIDES,
    BattleState,
    SideState,
    TurnData,
    element_key,
    other_side,
)
from core.log import BattleLog
from core.models import (
    BattalionState,
    BattleResult,
    ContactLevel,
    Element,
    ElementReport,
    EndReason,
    Order,
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
            # Резерв в учёт не попадает: он войдёт, когда его введут в бой.
            for element in battalion.engaged_elements:
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

    # -- управление боем ----------------------------------------------------
    def commit(self, side: str, element_id: str) -> bool:
        """Ввести резервный элемент в бой прямо по ходу.

        С этого момента он стреляет, по нему стреляют и он входит во все
        агрегаты батальона; его численность регистрируется в реестре, чтобы
        «потеряно + в строю» по-прежнему сходилось с исходным (§4.2).
        """
        battalion = self.state.battalion(side)
        element = battalion.element(element_id)
        if element is None or element.engaged:
            return False

        element.engaged = True
        side_state = self.state.side(side)
        side_state.initial_personnel[element.id] = element.personnel_current
        side_state.initial_vehicles[element.id] = element.vehicles_current
        side_state.personnel_lost.setdefault(element.id, 0)
        side_state.vehicles_lost.setdefault(element.id, 0)
        side_state.in_contact[element.id] = False
        self._spend_readiness([element], self.config.cbt.readiness.commit_cost)

        self.log.add(
            turn=self.state.turn,
            phase="command",
            actor=element_key(side, element),
            event="reserve_committed",
            before={"engaged": False},
            after={
                "engaged": True,
                "personnel": element.personnel_current,
                "vehicles": element.vehicles_current,
            },
            text=(
                f"«{element.name}» введён в бой из резерва: "
                f"{element.personnel_current} чел."
            ),
        )
        return True

    def withdraw(self, side: str, element_id: str) -> bool:
        """Вывести элемент из боя в резерв — до первого выстрела по нему."""
        battalion = self.state.battalion(side)
        element = battalion.element(element_id)
        if element is None or not element.engaged or self.state.turn > 0:
            return False
        element.engaged = False
        side_state = self.state.side(side)
        for registry in (
            side_state.initial_personnel,
            side_state.initial_vehicles,
            side_state.personnel_lost,
            side_state.vehicles_lost,
            side_state.in_contact,
        ):
            registry.pop(element.id, None)
        return True

    def set_order(self, side: str, element_id: str, order: Order | None) -> bool:
        """Сменить приказ отдельного элемента по ходу боя."""
        battalion = self.state.battalion(side)
        element = battalion.element(element_id)
        if element is None:
            return False

        before = str(battalion.order_for(element))
        element.order = order
        after = str(battalion.order_for(element))
        if before == after:
            return False
        self._spend_readiness([element], self.config.cbt.readiness.order_change_cost)

        self.log.add(
            turn=self.state.turn,
            phase="command",
            actor=element_key(side, element),
            event="order_changed",
            before={"order": before},
            after={"order": after},
            text=f"«{element.name}»: приказ {before} → {after}.",
        )
        return True

    # -- цена команды -------------------------------------------------------
    def _spend_readiness(self, elements: list[Element], cost: float) -> None:
        """Снять готовность с групп, которых коснулась команда.

        Перестроение посреди боя не бесплатно: подразделение перестаёт быть
        готовым действовать сразу. Готовность входит в K_сост и в бросок
        инициативы, поэтому дробить силы под огнём — решение с ценой.
        """
        if not self.config.tog.readiness or cost <= 0:
            return
        limits = self.config.cbt.readiness
        for element in elements:
            element.readiness = max(limits.min, min(limits.max, element.readiness - cost))

    # -- перестроение -------------------------------------------------------
    def split(
        self,
        side: str,
        element_id: str,
        parts: int = 2,
        *,
        shares: list[float] | None = None,
        names: list[str] | None = None,
    ) -> list[Element]:
        """Разделить группу на подгруппы прямо по ходу боя.

        Подгруппы получают свою долю людей, машин **и своей доли уже
        понесённых потерь**, поэтому «потеряно + в строю» по каждой стороне
        сходится с исходным и после деления (§4.2).
        """
        battalion = self.state.battalion(side)
        parent = battalion.element(element_id)
        if parent is None:
            raise formation.FormationError(f"группы «{element_id}» в отряде нет")
        children = formation.split(
            battalion, element_id, parts, shares=shares, names=names
        )
        self._rehome_registry(side, parent, children)
        self._spend_readiness(children, self.config.cbt.readiness.split_cost)
        self.log.add(
            turn=self.state.turn,
            phase="command",
            actor=element_key(side, parent),
            event="group_split",
            before={"parts": 1, "personnel": parent.personnel_current},
            after={
                "parts": len(children),
                "personnel": [child.personnel_current for child in children],
            },
            text=(
                f"«{parent.name}» разделена на {len(children)}: "
                + ", ".join(
                    f"{child.name} — {child.personnel_current} чел." for child in children
                )
                + "."
            ),
        )
        return children

    def detach_vehicles(self, side: str, element_id: str) -> list[Element]:
        """Отделить технику группы в самостоятельный отряд."""
        battalion = self.state.battalion(side)
        parent = battalion.element(element_id)
        if parent is None:
            raise formation.FormationError(f"группы «{element_id}» в отряде нет")
        children = formation.detach_vehicles(battalion, element_id, self.config)
        self._rehome_registry(side, parent, children)
        self._spend_readiness(children, self.config.cbt.readiness.split_cost)
        foot, crew = children
        self.log.add(
            turn=self.state.turn,
            phase="command",
            actor=element_key(side, parent),
            event="vehicles_detached",
            before={"personnel": parent.personnel_current, "vehicles": parent.vehicles_current},
            after={
                "пехота": foot.personnel_current,
                "экипажи": crew.personnel_current,
                "техника": crew.vehicles_current,
            },
            text=(
                f"Техника «{parent.name}» выделена отдельно: "
                f"{crew.vehicles_current} ед. и {crew.personnel_current} чел. экипажей; "
                f"пехота ({foot.personnel_current} чел.) осталась спешенной."
            ),
        )
        return children

    def merge(self, side: str, element_id: str) -> Element:
        """Свести подгруппы обратно в группу вместе с их учётом потерь."""
        battalion = self.state.battalion(side)
        parent = battalion.element(element_id)
        if parent is None:
            raise formation.FormationError(f"группы «{element_id}» в отряде нет")
        leaves = battalion.leaves_of(element_id)
        names = [leaf.name for leaf in leaves]
        merged = formation.merge(battalion, element_id)
        self._collect_registry(side, merged, leaves)
        self._spend_readiness([merged], self.config.cbt.readiness.merge_cost)
        self.log.add(
            turn=self.state.turn,
            phase="command",
            actor=element_key(side, merged),
            event="group_merged",
            before={"parts": len(leaves)},
            after={"parts": 1, "personnel": merged.personnel_current},
            text=(
                f"Сведены в «{merged.name}» ({merged.personnel_current} чел.): "
                + ", ".join(names)
                + "."
            ),
        )
        return merged

    # -- реестр при перестроении -------------------------------------------
    def _rehome_registry(self, side: str, parent: Element, children: list[Element]) -> None:
        """Раздать учёт старшей группы её подгруппам.

        Потери раскладываются по тем же долям, что и люди, а «на начало» у
        подгруппы получается «потеряно + в строю» — ровно то равенство, на
        котором держится проверка баланса.
        """
        side_state = self.state.side(side)
        enemy_state = self.state.enemy(side)
        engaged = parent.id in side_state.initial_personnel
        contact = enemy_state.contact.pop(parent.id, ContactLevel.NONE)
        in_contact = side_state.in_contact.pop(parent.id, False)

        personnel_lost = side_state.personnel_lost.pop(parent.id, 0)
        vehicles_lost = side_state.vehicles_lost.pop(parent.id, 0)
        side_state.initial_personnel.pop(parent.id, None)
        side_state.initial_vehicles.pop(parent.id, None)
        if not engaged:
            return

        weights = [float(child.personnel_current) for child in children]
        vehicle_weights = [float(child.vehicles_current) for child in children]
        lost_personnel = formation.apportion(personnel_lost, weights)
        lost_vehicles = formation.apportion(vehicles_lost, vehicle_weights)
        for index, child in enumerate(children):
            side_state.personnel_lost[child.id] = lost_personnel[index]
            side_state.vehicles_lost[child.id] = lost_vehicles[index]
            side_state.initial_personnel[child.id] = (
                child.personnel_current + lost_personnel[index]
            )
            side_state.initial_vehicles[child.id] = child.vehicles_current + lost_vehicles[index]
            side_state.in_contact[child.id] = in_contact
            enemy_state.contact[child.id] = contact

    def _collect_registry(self, side: str, parent: Element, leaves: list[Element]) -> None:
        """Собрать учёт подгрупп обратно в сведённую группу."""
        side_state = self.state.side(side)
        enemy_state = self.state.enemy(side)
        levels = list(ContactLevel)
        personnel_lost = vehicles_lost = 0
        initial_personnel = initial_vehicles = 0
        in_contact = False
        best = ContactLevel.NONE
        engaged = False
        for leaf in leaves:
            if leaf.id in side_state.initial_personnel:
                engaged = True
            personnel_lost += side_state.personnel_lost.pop(leaf.id, 0)
            vehicles_lost += side_state.vehicles_lost.pop(leaf.id, 0)
            initial_personnel += side_state.initial_personnel.pop(leaf.id, 0)
            initial_vehicles += side_state.initial_vehicles.pop(leaf.id, 0)
            in_contact = in_contact or side_state.in_contact.pop(leaf.id, False)
            level = enemy_state.contact.pop(leaf.id, ContactLevel.NONE)
            if levels.index(level) > levels.index(best):
                best = level
        if not engaged:
            return
        side_state.personnel_lost[parent.id] = personnel_lost
        side_state.vehicles_lost[parent.id] = vehicles_lost
        side_state.initial_personnel[parent.id] = initial_personnel
        side_state.initial_vehicles[parent.id] = initial_vehicles
        side_state.in_contact[parent.id] = in_contact
        enemy_state.contact[parent.id] = best

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
        tasks = {side: self.state.side(side).task_completed for side in SIDES}
        # Выполненная задача снимает «поражение по выходу из боя». Засада и
        # отход тем и заканчиваются, что сторона уходит: считать это
        # поражением — значит объявлять проигравшим того, кто сделал ровно
        # то, что ему приказали. Разгром и паника задачей не отменяются.
        defeated = {
            side: states[side] in DEFEATED_STATES
            or (withdrawn[side] and not tasks[side])
            for side in SIDES
        }

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
        if reason == EndReason.TASK:
            # Победу по задаче одерживает победитель, а не проигравший:
            # «1-й взвод задача» в строке про победу 2-го взвода читалось
            # как будто задачу выполнил проигравший.
            return (
                f"Бой окончен на ходу {self.state.turn}: победа стороны {winner} "
                f"({battalion.name}) — задача выполнена, {loser.name} её сорвать "
                f"не смог."
            )
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
        # По листьям: старшая группа — это её подгруппы, а не ещё одна единица.
        leaves = battalion.leaf_elements
        end_personnel = sum(element.personnel_current for element in leaves)
        end_vehicles = sum(element.vehicles_current for element in leaves)
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
            for element in leaves
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
