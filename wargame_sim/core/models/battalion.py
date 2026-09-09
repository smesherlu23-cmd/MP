"""Батальон и его агрегаты (§4.2)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.models.element import SCHEMA_VERSION, Element
from core.models.enums import BattalionState, Order, Side


class Battalion(BaseModel):
    """Сторона боя: набор элементов плюс общебатальонные параметры."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: int = SCHEMA_VERSION
    id: str
    name: str
    side: Side = Side.A
    elements: list[Element] = Field(default_factory=list)
    commander_influence: float = Field(default=50.0, ge=0, le=100)
    communications: float = Field(default=80.0, ge=0, le=100)
    order: Order = Order.ATTACK
    task: str = ""
    state: BattalionState = BattalionState.FIGHTING

    @field_validator("elements")
    @classmethod
    def _unique_ids(cls, elements: list[Element]) -> list[Element]:
        ids = [element.id for element in elements]
        duplicates = {name for name in ids if ids.count(name) > 1}
        if duplicates:
            raise ValueError(f"повторяющиеся id элементов: {', '.join(sorted(duplicates))}")
        return elements

    # -- доступ -------------------------------------------------------------
    def element(self, element_id: str) -> Element | None:
        for element in self.elements:
            if element.id == element_id:
                return element
        return None

    @property
    def alive_elements(self) -> list[Element]:
        return [element for element in self.elements if element.alive]

    def order_for(self, element: Element) -> Order:
        """Приказ элемента; если не задан — приказ батальона (§4.4)."""
        return element.order or self.order

    # -- агрегаты (только для чтения, считаются на лету) --------------------
    @property
    def personnel_full(self) -> int:
        return sum(element.personnel_full for element in self.elements)

    @property
    def personnel_current(self) -> int:
        return sum(element.personnel_current for element in self.alive_elements)

    @property
    def personnel_ratio(self) -> float:
        if self.personnel_full == 0:
            return 0.0
        return self.personnel_current / self.personnel_full

    @property
    def vehicles_full(self) -> int:
        return sum(element.vehicles_full for element in self.elements)

    @property
    def vehicles_current(self) -> int:
        return sum(element.vehicles_current for element in self.alive_elements)

    @property
    def loss_ratio(self) -> float:
        return 1.0 - self.personnel_ratio

    def _weighted(self, attribute: str) -> float:
        """Средневзвешенное по текущей численности живых элементов."""
        alive = self.alive_elements
        total = sum(element.personnel_current for element in alive)
        if total == 0:
            values = [getattr(element, attribute) for element in alive]
            return sum(values) / len(values) if values else 0.0
        return (
            sum(getattr(element, attribute) * element.personnel_current for element in alive)
            / total
        )

    @property
    def morale(self) -> float:
        return self._weighted("morale")

    @property
    def experience(self) -> float:
        return self._weighted("experience")

    @property
    def ammo(self) -> float:
        return self._weighted("ammo")

    @property
    def fuel(self) -> float:
        return self._weighted("fuel")

    @property
    def equipment(self) -> float:
        return self._weighted("equipment")

    @property
    def fatigue(self) -> float:
        return self._weighted("fatigue")

    @property
    def suppression(self) -> float:
        return self._weighted("suppression")

    @property
    def cohesion(self) -> float:
        return self._weighted("cohesion")

    @property
    def readiness(self) -> float:
        return self._weighted("readiness")

    @property
    def combat_power(self) -> float:
        """Остаточная боеспособность, 0..100.

        Доля исходной огневой мощи, которую батальон ещё может выдать:
        численность × мораль × (1 − подавление) × боезапас.
        """
        if not self.elements:
            return 0.0
        potential = sum(element.attack * element.personnel_full for element in self.elements)
        if potential == 0:
            return 0.0
        actual = sum(
            element.attack
            * element.personnel_current
            * (element.morale / 100.0)
            * (1.0 - element.suppression / 100.0)
            * (element.ammo / 100.0)
            for element in self.alive_elements
        )
        return 100.0 * actual / potential

    @property
    def organisation(self) -> float:
        """Организация, 0..100: связь × слаженность × доля живых элементов."""
        if not self.elements:
            return 0.0
        alive_share = len(self.alive_elements) / len(self.elements)
        return alive_share * self.cohesion * (self.communications / 100.0)

    @property
    def supply_level(self) -> float:
        """Снабжение, 0..100 — среднее по боезапасу, топливу и снаряжению."""
        return (self.ammo + self.fuel + self.equipment) / 3.0

    def summary(self) -> dict[str, float | int | str]:
        """Сводка для интерфейса и отчёта."""
        return {
            "id": self.id,
            "name": self.name,
            "side": str(self.side),
            "state": str(self.state),
            "elements": len(self.elements),
            "elements_alive": len(self.alive_elements),
            "personnel_full": self.personnel_full,
            "personnel_current": self.personnel_current,
            "personnel_ratio": round(self.personnel_ratio, 4),
            "vehicles_full": self.vehicles_full,
            "vehicles_current": self.vehicles_current,
            "morale": round(self.morale, 2),
            "experience": round(self.experience, 2),
            "cohesion": round(self.cohesion, 2),
            "suppression": round(self.suppression, 2),
            "fatigue": round(self.fatigue, 2),
            "ammo": round(self.ammo, 2),
            "fuel": round(self.fuel, 2),
            "equipment": round(self.equipment, 2),
            "supply": round(self.supply_level, 2),
            "combat_power": round(self.combat_power, 2),
            "organisation": round(self.organisation, 2),
        }

    def copy_deep(self) -> Battalion:
        return self.model_copy(deep=True)
