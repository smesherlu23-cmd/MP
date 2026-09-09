"""Элемент подразделения и группа техники (§4.1)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.models.enums import Order

SCHEMA_VERSION = 1


class VehicleGroup(BaseModel):
    """Однородная группа техники внутри элемента."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    vehicle_type: str
    count_full: int = Field(ge=0)
    count_current: int = Field(ge=0)
    condition: float = Field(default=100.0, ge=0, le=100)

    @model_validator(mode="after")
    def _current_not_above_full(self) -> VehicleGroup:
        if self.count_current > self.count_full:
            raise ValueError(
                f"техники в строю ({self.count_current}) больше штата ({self.count_full})"
            )
        return self

    @property
    def losses(self) -> int:
        return self.count_full - self.count_current

    @property
    def loss_ratio(self) -> float:
        if self.count_full == 0:
            return 0.0
        return 1.0 - self.count_current / self.count_full


class Element(BaseModel):
    """Строевая единица батальона: рота, батарея, взвод, штаб, тыл."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    id: str
    name: str
    type: str
    personnel_full: int = Field(ge=0)
    personnel_current: int = Field(ge=0)
    vehicles: list[VehicleGroup] = Field(default_factory=list)

    attack: float = Field(ge=0, le=100)
    defense: float = Field(ge=0, le=100)
    experience: int = Field(ge=1, le=4)
    morale: float = Field(default=75.0, ge=0, le=100)
    cohesion: float = Field(default=80.0, ge=0, le=100)
    readiness: float = Field(default=80.0, ge=0, le=100)
    ammo: float = Field(default=100.0, ge=0, le=100)
    fuel: float = Field(default=100.0, ge=0, le=100)
    equipment: float = Field(default=100.0, ge=0, le=100)
    fatigue: float = Field(default=0.0, ge=0, le=100)
    suppression: float = Field(default=0.0, ge=0, le=100)
    order: Order | None = None
    alive: bool = True

    @model_validator(mode="after")
    def _current_not_above_full(self) -> Element:
        if self.personnel_current > self.personnel_full:
            raise ValueError(
                f"элемент «{self.name}»: в строю ({self.personnel_current}) "
                f"больше штата ({self.personnel_full})"
            )
        return self

    # -- производные величины (в модели не хранятся, §4.1) ------------------
    @property
    def personnel_losses(self) -> int:
        return self.personnel_full - self.personnel_current

    @property
    def personnel_ratio(self) -> float:
        if self.personnel_full == 0:
            return 0.0
        return self.personnel_current / self.personnel_full

    @property
    def loss_ratio(self) -> float:
        return 1.0 - self.personnel_ratio

    @property
    def vehicles_full(self) -> int:
        return sum(group.count_full for group in self.vehicles)

    @property
    def vehicles_current(self) -> int:
        return sum(group.count_current for group in self.vehicles)

    @property
    def has_vehicles(self) -> bool:
        return self.vehicles_full > 0

    @property
    def vehicle_condition(self) -> float:
        """Средневзвешенное состояние техники по числу машин в строю."""
        total = self.vehicles_current
        if total == 0:
            return 0.0
        return sum(g.count_current * g.condition for g in self.vehicles) / total

    def copy_deep(self) -> Element:
        return self.model_copy(deep=True)
