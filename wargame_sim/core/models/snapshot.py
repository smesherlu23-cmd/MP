"""Снимок боя: то, из чего бой поднимается ровно там, где его бросили (§11).

Раньше бой жил только в памяти: закрыли окно на пятнадцатом ходу — и ни
журнала, ни потерь, ни перестроений. За столом это самая дорогая потеря,
какая в инструменте ГМ возможна.

Снимок делается **на границе хода**, и это не деталь реализации, а условие
воспроизводимости. `RngStreams` заводит поток на ключ
``(сид, ход, фаза, элемент)`` и переиспользует его в пределах хода;
законченный ход к своим потокам больше не возвращается, поэтому поднятый
бой продолжается теми же бросками, что и непрерывный.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.log import LogEntry
from core.models.battalion import Battalion
from core.models.element import SCHEMA_VERSION
from core.models.enums import ContactLevel, EndReason, IntelLevel, Winner
from core.models.scenario import Scenario


class SideSnapshot(BaseModel):
    """Учёт одной стороны — всё, что копится за бой."""

    model_config = ConfigDict(extra="forbid")

    battalion: Battalion
    initial_personnel: dict[str, int] = Field(default_factory=dict)
    initial_vehicles: dict[str, int] = Field(default_factory=dict)
    personnel_lost: dict[str, int] = Field(default_factory=dict)
    vehicles_lost: dict[str, int] = Field(default_factory=dict)
    contact: dict[str, ContactLevel] = Field(default_factory=dict)
    in_contact: dict[str, bool] = Field(default_factory=dict)
    intel_progress: float = 0.0
    intel_level: IntelLevel = IntelLevel.NONE
    turns_held: int = 0
    disengage: float = 0.0
    inflicted_personnel: int = 0
    task_completed: bool = False
    first_contact_turn: int | None = None
    panicked_elements: int = 0
    destroyed_elements: int = 0


class BattleSnapshot(BaseModel):
    """Бой целиком: сценарий, сид, состояние сторон и журнал."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SCHEMA_VERSION
    id: str
    scenario: Scenario
    master_seed: int
    turn: int
    finished: bool = False
    winner: Winner | None = None
    end_reason: EndReason | None = None
    sides: dict[str, SideSnapshot]
    log: list[LogEntry] = Field(default_factory=list)

    @property
    def title(self) -> str:
        return self.scenario.name

    @property
    def summary(self) -> str:
        """Короткая строка для списка сохранённых боёв."""
        sides = " → ".join(
            f"{side.battalion.name} {side.battalion.personnel_current} чел."
            for side in self.sides.values()
        )
        return f"ход {self.turn} · {sides}"
