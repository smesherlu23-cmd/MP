"""Отряд стороны и его агрегаты (§4.2).

Отряд — это дерево групп любого масштаба: от отделения до полка. Дерутся
**листья** дерева; группа с подгруппами сама огня не ведёт, а показывает их
сумму. Поэтому движку по-прежнему видна плоская линейка (``alive_elements``),
а ГМ — структура.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.models.element import SCHEMA_VERSION, Element
from core.models.enums import BattalionState, Echelon, Order, Side


@dataclass(frozen=True)
class Rollup:
    """Сумма поддерева — чем группа выглядит в дереве.

    Считается по листьям, поэтому у группы с подгруппами показывается то,
    что осталось от её подгрупп, а не устаревшие собственные числа.
    """

    leaves: int
    engaged: int
    alive: int
    personnel_full: int
    personnel_current: int
    vehicles_full: int
    vehicles_current: int
    morale: float
    ammo: float
    suppression: float
    fatigue: float

    @property
    def personnel_losses(self) -> int:
        return self.personnel_full - self.personnel_current

    @property
    def personnel_ratio(self) -> float:
        if self.personnel_full == 0:
            return 0.0
        return self.personnel_current / self.personnel_full

    @property
    def in_reserve(self) -> bool:
        """Вся группа в резерве — ни один лист в бой не введён."""
        return self.engaged == 0 and self.leaves > 0


class Battalion(BaseModel):
    """Сторона боя: дерево групп плюс общие параметры отряда."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: int = SCHEMA_VERSION
    id: str
    name: str
    side: Side = Side.A
    #: Масштаб отряда целиком — этим словом интерфейс и называет сторону.
    #: В расчёте не участвует: считаются группы, а не подпись над ними.
    scale: Echelon = Echelon.BATTALION
    elements: list[Element] = Field(default_factory=list)
    commander_influence: float = Field(default=50.0, ge=0, le=100)
    communications: float = Field(default=80.0, ge=0, le=100)
    order: Order = Order.ATTACK
    task: str = ""
    state: BattalionState = BattalionState.FIGHTING
    #: Боевая мощь на начало боя — база для «остаточной боеспособности».
    #: До боя её нет, и тогда отряд по определению цел на 100%; движок
    #: ставит её один раз, когда собирает состояние боя.
    start_power: float | None = None

    @field_validator("elements")
    @classmethod
    def _unique_ids(cls, elements: list[Element]) -> list[Element]:
        ids = [element.id for element in elements]
        duplicates = {name for name in ids if ids.count(name) > 1}
        if duplicates:
            raise ValueError(f"повторяющиеся id элементов: {', '.join(sorted(duplicates))}")
        return elements

    @model_validator(mode="after")
    def _tree_is_sound(self) -> Battalion:
        """Родитель существует, и подчинение не замкнуто в кольцо."""
        known = {element.id for element in self.elements}
        for element in self.elements:
            if element.parent is not None and element.parent not in known:
                raise ValueError(
                    f"группа «{element.name}»: старшей группы "
                    f"«{element.parent}» в отряде нет"
                )
        by_id = {element.id: element for element in self.elements}
        for element in self.elements:
            seen = {element.id}
            current = element.parent
            while current is not None:
                if current in seen:
                    raise ValueError(f"группа «{element.name}» подчинена сама себе")
                seen.add(current)
                current = by_id[current].parent
        return self

    # -- дерево -------------------------------------------------------------
    def children_of(self, element_id: str) -> list[Element]:
        """Прямые подгруппы, в порядке объявления."""
        return [element for element in self.elements if element.parent == element_id]

    def is_leaf(self, element: Element) -> bool:
        """Лист дерева — тот, кто реально ведёт бой."""
        return not any(item.parent == element.id for item in self.elements)

    def parent_of(self, element: Element) -> Element | None:
        return self.element(element.parent) if element.parent else None

    def ancestors(self, element: Element) -> list[Element]:
        """Цепочка старших групп, от ближайшей к корню."""
        chain: list[Element] = []
        current = self.parent_of(element)
        while current is not None:
            chain.append(current)
            current = self.parent_of(current)
        return chain

    def depth_of(self, element: Element) -> int:
        return len(self.ancestors(element))

    def subtree(self, element_id: str) -> list[Element]:
        """Группа и всё, что ей подчинено, в глубину."""
        root = self.element(element_id)
        if root is None:
            return []
        found = [root]
        for child in self.children_of(element_id):
            found.extend(self.subtree(child.id))
        return found

    def leaves_of(self, element_id: str) -> list[Element]:
        """Листья поддерева — те, кто за эту группу дерётся."""
        return [item for item in self.subtree(element_id) if self.is_leaf(item)]

    @property
    def roots(self) -> list[Element]:
        return [element for element in self.elements if element.parent is None]

    @property
    def ordered_elements(self) -> list[Element]:
        """Дерево, развёрнутое в линейку для показа: родитель, потом дети."""
        ordered: list[Element] = []
        for root in self.roots:
            ordered.extend(self.subtree(root.id))
        # Осиротевших быть не должно, но если данные битые — не теряем их.
        seen = {element.id for element in ordered}
        ordered.extend(element for element in self.elements if element.id not in seen)
        return ordered

    @property
    def leaf_elements(self) -> list[Element]:
        """Все листья отряда — резерв и те, кто в бою."""
        return [element for element in self.elements if self.is_leaf(element)]

    def rollup(self, element_id: str) -> Rollup:
        """Что группа представляет собой сейчас — сумма по её листьям."""
        leaves = self.leaves_of(element_id)
        engaged = [item for item in leaves if item.engaged]
        alive = [item for item in engaged if item.alive]
        weight = sum(item.personnel_current for item in alive)

        def mean(attribute: str) -> float:
            if not alive:
                return 0.0
            if weight == 0:
                return sum(getattr(item, attribute) for item in alive) / len(alive)
            return (
                sum(getattr(item, attribute) * item.personnel_current for item in alive) / weight
            )

        return Rollup(
            leaves=len(leaves),
            engaged=len(engaged),
            alive=len(alive),
            personnel_full=sum(item.personnel_full for item in leaves),
            personnel_current=sum(item.personnel_current for item in leaves if item.alive),
            vehicles_full=sum(item.vehicles_full for item in leaves),
            vehicles_current=sum(item.vehicles_current for item in leaves if item.alive),
            morale=mean("morale"),
            ammo=mean("ammo"),
            suppression=mean("suppression"),
            fatigue=mean("fatigue"),
        )

    # -- доступ -------------------------------------------------------------
    def element(self, element_id: str) -> Element | None:
        for element in self.elements:
            if element.id == element_id:
                return element
        return None

    @property
    def engaged_elements(self) -> list[Element]:
        """Листья, введённые в бой; остальные — резерв.

        Группа с подгруппами сюда не попадает никогда: иначе её численность
        учлась бы дважды — и за себя, и за детей.
        """
        return [element for element in self.leaf_elements if element.engaged]

    @property
    def reserve_elements(self) -> list[Element]:
        """Резерв: в бою не участвует, пока его не введут."""
        return [element for element in self.leaf_elements if not element.engaged]

    @property
    def alive_elements(self) -> list[Element]:
        """Кто реально дерётся: введён в бой и ещё боеспособен.

        Все агрегаты батальона считаются по этому списку, поэтому резерв
        не завышает ни численность, ни мораль, ни боеспособность.
        """
        return [element for element in self.engaged_elements if element.alive]

    def order_for(self, element: Element) -> Order:
        """Приказ группы; если не задан — приказ отряда (§4.4)."""
        return element.order or self.order

    # -- агрегаты (только для чтения, считаются на лету) --------------------
    @property
    def personnel_full(self) -> int:
        return sum(element.personnel_full for element in self.engaged_elements)

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
        return sum(element.vehicles_full for element in self.engaged_elements)

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

    def raw_power(self, *, with_suppression: bool = False) -> float:
        """Сырая боевая мощь: численность × огонь × мораль × боезапас."""
        total = 0.0
        for element in self.alive_elements:
            value = (
                element.attack
                * element.personnel_current
                * (element.morale / 100.0)
                * (element.ammo / 100.0)
            )
            if with_suppression:
                value *= 1.0 - element.suppression / 100.0
            total += value
        return total

    def capture_start_power(self) -> None:
        """Запомнить мощь на начало боя. Зовётся движком один раз."""
        self.start_power = self.raw_power()

    def _power(self, *, with_suppression: bool) -> float:
        """Доля мощи от той, что была на начало боя, 0..100.

        Раньше делилось на «штат при стопроцентной морали и полном
        боезапасе», и нетронутый батальон показывал 75%: мораль стартует
        с 75 и входила в числитель, а в знаменатель — нет. Строка
        называлась «остаточная боеспособность», а числом была не доля от
        своего начала, а индекс от недостижимого идеала.
        """
        base = self.start_power if self.start_power else self.raw_power()
        if base <= 0:
            return 0.0
        return min(100.0 * self.raw_power(with_suppression=with_suppression) / base, 100.0)

    @property
    def combat_power(self) -> float:
        """Остаточная боеспособность, 0..100.

        Доля боевой мощи, которую отряд сохранил от той, с которой вошёл
        в бой: численность × мораль × боезапас. Подавление сюда не входит —
        оно спадает за пару ходов и показывается отдельной строкой, иначе
        любой отряд под огнём выглядел бы небоеспособным.
        """
        return self._power(with_suppression=False)

    @property
    def effective_power(self) -> float:
        """Боеспособность прямо сейчас: то же, но с учётом подавления."""
        return self._power(with_suppression=True)

    @property
    def organisation(self) -> float:
        """Организация, 0..100: связь × слаженность × доля живых элементов."""
        if not self.leaf_elements:
            return 0.0
        engaged = self.engaged_elements
        alive_share = len(self.alive_elements) / len(engaged) if engaged else 0.0
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
            "scale": str(self.scale),
            "groups": len(self.elements),
            "elements": len(self.engaged_elements),
            "reserve": len(self.reserve_elements),
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
            "effective_power": round(self.effective_power, 2),
            "organisation": round(self.organisation, 2),
        }

    def copy_deep(self) -> Battalion:
        return self.model_copy(deep=True)
