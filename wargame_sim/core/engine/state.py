"""Состояние боя: постоянные учётные данные и эфемерные данные хода."""

from __future__ import annotations

from dataclasses import dataclass, field

from core.models import (
    Battalion,
    BattalionState,
    ContactLevel,
    Element,
    Environment,
    IntelLevel,
    Order,
)

SIDES = ("A", "B")


def other_side(side: str) -> str:
    return "B" if side == "A" else "A"


@dataclass
class SideState:
    """Учёт по одной стороне за весь бой."""

    battalion: Battalion
    #: Численность и техника на начало боя — база для проверки баланса (§12).
    initial_personnel: dict[str, int] = field(default_factory=dict)
    initial_vehicles: dict[str, int] = field(default_factory=dict)
    personnel_lost: dict[str, int] = field(default_factory=dict)
    vehicles_lost: dict[str, int] = field(default_factory=dict)
    #: Уровень контакта с каждым элементом противника (что видит эта сторона).
    contact: dict[str, ContactLevel] = field(default_factory=dict)
    #: Находился ли собственный элемент в контакте в прошедшем ходу.
    in_contact: dict[str, bool] = field(default_factory=dict)
    #: Накопленный уровень разведданных, 0..len(intel_levels)-1.
    intel_progress: float = 0.0
    intel_level: IntelLevel = IntelLevel.NONE
    #: Сколько ходов сторона удержалась под огнём (для «оборона»/«закрепление»).
    turns_held: int = 0
    #: Накопленный выход из контакта (для «отступление»/«засада»).
    disengage: float = 0.0
    #: Нанесённые противнику потери в л/с за весь бой.
    inflicted_personnel: int = 0
    task_completed: bool = False
    first_contact_turn: int | None = None
    #: Сколько элементов сорвалось в панику и сколько выбито огнём —
    #: по их соотношению различаются «паника» и «разгром» как исход боя.
    panicked_elements: int = 0
    destroyed_elements: int = 0

    def contact_flag(self, element_id: str) -> bool:
        """Был ли элемент в огневом контакте в прошедшем ходу."""
        return self.in_contact.get(element_id, False)

    def start_totals(self) -> tuple[int, int]:
        return sum(self.initial_personnel.values()), sum(self.initial_vehicles.values())

    def total_personnel_lost(self) -> int:
        return sum(self.personnel_lost.values())

    def total_vehicles_lost(self) -> int:
        return sum(self.vehicles_lost.values())

    @property
    def side(self) -> str:
        return str(self.battalion.side)


@dataclass
class TurnData:
    """Эфемерные величины одного хода."""

    turn: int
    first_side: str = "A"
    initiative_values: dict[str, float] = field(default_factory=dict)
    fire: dict[str, float] = field(default_factory=dict)
    defence: dict[str, float] = field(default_factory=dict)
    allocation: dict[str, dict[str, float]] = field(default_factory=dict)
    pressure: dict[str, float] = field(default_factory=dict)
    vehicle_pressure: dict[str, float] = field(default_factory=dict)
    casualties: dict[str, int] = field(default_factory=dict)
    vehicle_losses: dict[str, int] = field(default_factory=dict)
    suppression_gain: dict[str, float] = field(default_factory=dict)
    loss_share: dict[str, float] = field(default_factory=dict)
    vehicle_loss_share: dict[str, float] = field(default_factory=dict)
    fire_intensity: dict[str, float] = field(default_factory=dict)
    in_contact: dict[str, bool] = field(default_factory=dict)
    side_success: dict[str, float] = field(default_factory=dict)
    breakdown: dict[str, list[tuple[str, float]]] = field(default_factory=dict)


@dataclass
class BattleState:
    """Всё изменяемое состояние боя."""

    environment: Environment
    sides: dict[str, SideState]
    turn: int = 0
    finished: bool = False

    def side(self, name: str) -> SideState:
        return self.sides[name]

    def battalion(self, name: str) -> Battalion:
        return self.sides[name].battalion

    def enemy(self, name: str) -> SideState:
        return self.sides[other_side(name)]

    def elements(self, name: str) -> list[Element]:
        return self.sides[name].battalion.alive_elements

    def order_of(self, side: str, element: Element) -> str:
        return str(self.sides[side].battalion.order_for(element))

    def is_active(self, name: str) -> bool:
        """Сторона ещё участвует в бою."""
        state = self.sides[name].battalion.state
        return state in (BattalionState.FIGHTING, BattalionState.RETREATING)

    def hq_alive(self, name: str, element_types) -> bool:
        for element in self.sides[name].battalion.alive_elements:
            entry = element_types.get(element.type)
            if entry is not None and entry.hq:
                return True
        return False


def element_key(side: str, element: Element) -> str:
    """Человекочитаемый идентификатор элемента в журнале: ``A/rota_1``."""
    return f"{side}/{element.id}"


def panic_order() -> Order:
    return Order.PANIC
