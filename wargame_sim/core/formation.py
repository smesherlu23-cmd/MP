"""Деление отряда на подгруппы и сведение их обратно.

Здесь живёт вся арифметика перестроения: как разложить людей и машины по
подгруппам, ничего не потеряв и не придумав, и как собрать остатки назад.
Функции работают с моделью и ничего не знают ни о движке, ни о ходе боя —
перенос реестра потерь и записи в журнал делает :mod:`core.engine.battle`.

Главное правило: **сумма сходится**. Сколько людей и машин было в группе до
деления, столько же окажется в подгруппах после; сведение возвращает ровно
то, что осталось у листьев.
"""

from __future__ import annotations

from collections.abc import Sequence

from core.config import AppConfig
from core.models import (
    Battalion,
    Echelon,
    Element,
    VehicleGroup,
    echelon_below,
    echelon_ordinal,
)

#: Свойства, которые при делении просто копируются: это «плотности»
#: (мораль, выучка, боезапас), а не количества — их делить нечего.
INTENSIVE: tuple[str, ...] = (
    "type",
    "attack",
    "defense",
    "experience",
    "morale",
    "cohesion",
    "readiness",
    "ammo",
    "fuel",
    "equipment",
    "fatigue",
    "suppression",
    "order",
    "alive",
    "engaged",
)

#: Округляем выучку — она целая ступень, а не доля.
INTEGER_FIELDS: tuple[str, ...] = ("experience",)


class FormationError(ValueError):
    """Перестроение невозможно — с человекопонятным объяснением."""


# --------------------------------------------------------------------------
# целочисленная раскладка
# --------------------------------------------------------------------------
def apportion(total: int, weights: Sequence[float]) -> list[int]:
    """Разложить целое по долям, не потеряв и не добавив ни единицы.

    Метод наибольших остатков: целые части раздаются сразу, а остаток —
    тем, у кого дробная часть больше. Поэтому 7 человек на 2 подгруппы
    дают 4 и 3, а не 3 и 3 с потерянным седьмым.
    """
    count = len(weights)
    if count == 0:
        return []
    if total <= 0:
        return [0] * count
    scale = sum(weights)
    if scale <= 0:
        weights = [1.0] * count
        scale = float(count)
    exact = [total * weight / scale for weight in weights]
    shares = [int(value) for value in exact]
    remainder = total - sum(shares)
    order = sorted(range(count), key=lambda i: exact[i] - shares[i], reverse=True)
    for index in order[:remainder]:
        shares[index] += 1
    return shares


def fit_under(values: Sequence[int], caps: Sequence[int]) -> list[int]:
    """Прижать раскладку к потолкам, вернув излишек туда, где есть запас.

    Нужна, чтобы «в строю» ни у одной подгруппы не оказалось больше её же
    штата: сумма-то сходится, а вот отдельная подгруппа перебрать может.
    """
    result = list(values)
    spare = 0
    for index, cap in enumerate(caps):
        if result[index] > cap:
            spare += result[index] - cap
            result[index] = cap
    if not spare:
        return result
    for index, cap in enumerate(caps):
        if not spare:
            break
        room = cap - result[index]
        taken = min(room, spare)
        result[index] += taken
        spare -= taken
    return result


def _shared_counts(full: int, current: int, weights: Sequence[float]) -> list[tuple[int, int]]:
    """Разложить пару «штат / в строю» так, чтобы в строю не превысило штат."""
    fulls = apportion(full, weights)
    currents = fit_under(apportion(current, [float(value) for value in fulls]), fulls)
    return list(zip(fulls, currents, strict=True))


# --------------------------------------------------------------------------
# вспомогательное
# --------------------------------------------------------------------------
def unique_id(battalion: Battalion, stem: str) -> str:
    """Свободный id вида ``rota_1.2``; повторы разводит числовой хвост."""
    taken = {element.id for element in battalion.elements}
    if stem not in taken:
        return stem
    index = 2
    while f"{stem}_{index}" in taken:
        index += 1
    return f"{stem}_{index}"


def can_split(battalion: Battalion, element: Element) -> bool:
    """Делить можно лист: у группы с подгруппами делят её подгруппы."""
    return battalion.is_leaf(element)


def can_merge(battalion: Battalion, element: Element) -> bool:
    """Сводить есть что только там, где есть подгруппы."""
    return bool(battalion.children_of(element.id))


def _insert_after(battalion: Battalion, parent: Element, children: list[Element]) -> None:
    elements = list(battalion.elements)
    index = elements.index(parent) + 1
    battalion.elements = [*elements[:index], *children, *elements[index:]]


# --------------------------------------------------------------------------
# деление
# --------------------------------------------------------------------------
def split(
    battalion: Battalion,
    element_id: str,
    parts: int = 2,
    *,
    names: Sequence[str] | None = None,
    shares: Sequence[float] | None = None,
    echelon: Echelon | None = None,
) -> list[Element]:
    """Разделить группу на ``parts`` подгрупп.

    Группа остаётся в отряде, но перестаёт быть листом: воюют теперь
    подгруппы, а она показывает их сумму. Люди и машины раскладываются
    по долям ``shares`` (по умолчанию поровну) без потери единицы.
    """
    element = battalion.element(element_id)
    if element is None:
        raise FormationError(f"группы «{element_id}» в отряде нет")
    if not can_split(battalion, element):
        raise FormationError(
            f"«{element.name}» уже разделена — делить надо её подгруппы"
        )
    if parts < 2:
        raise FormationError("делить можно самое малое надвое")
    if shares is not None and len(shares) != parts:
        raise FormationError("долей должно быть столько же, сколько подгрупп")
    if names is not None and len(names) != parts:
        raise FormationError("имён должно быть столько же, сколько подгрупп")
    if element.personnel_full and element.personnel_full < parts:
        raise FormationError(
            f"в «{element.name}» {element.personnel_full} чел. — "
            f"на {parts} подгрупп не делится"
        )

    weights = [float(value) for value in shares] if shares else [1.0] * parts
    if any(weight < 0 for weight in weights):
        raise FormationError("доля не может быть отрицательной")

    personnel = _shared_counts(element.personnel_full, element.personnel_current, weights)
    vehicles: list[list[VehicleGroup]] = [[] for _ in range(parts)]
    for group in element.vehicles:
        for index, (count_full, count_current) in enumerate(
            _shared_counts(group.count_full, group.count_current, weights)
        ):
            if count_full:
                vehicles[index].append(
                    VehicleGroup(
                        vehicle_type=group.vehicle_type,
                        count_full=count_full,
                        count_current=count_current,
                        condition=group.condition,
                    )
                )

    child_echelon = echelon or echelon_below(element.echelon)
    children: list[Element] = []
    for index in range(parts):
        full, current = personnel[index]
        name = names[index] if names else echelon_ordinal(index + 1, child_echelon)
        children.append(
            Element(
                id=unique_id(battalion, f"{element.id}.{index + 1}"),
                name=name,
                echelon=child_echelon,
                parent=element.id,
                personnel_full=full,
                personnel_current=current,
                vehicles=vehicles[index],
                **{field: getattr(element, field) for field in INTENSIVE},
            )
        )
    _insert_after(battalion, element, children)
    return children


def detach_vehicles(
    battalion: Battalion,
    element_id: str,
    config: AppConfig,
    *,
    names: Sequence[str] | None = None,
) -> list[Element]:
    """Отделить технику группы в самостоятельный отряд.

    Машины уходят целиком, вместе с экипажами: сколько человек снимается,
    говорит поле ``crew`` карточки машины. Пехота остаётся спешенной — это
    и есть цена того, что танковое звено ушло действовать отдельно.
    """
    element = battalion.element(element_id)
    if element is None:
        raise FormationError(f"группы «{element_id}» в отряде нет")
    if not can_split(battalion, element):
        raise FormationError(f"«{element.name}» уже разделена")
    if not element.has_vehicles:
        raise FormationError(f"у «{element.name}» нет техники")

    crew_full = sum(
        group.count_full * config.vehicle(group.vehicle_type).crew for group in element.vehicles
    )
    crew_full = min(crew_full, element.personnel_full)
    if element.personnel_full - crew_full < 1 and element.personnel_full:
        raise FormationError(
            f"в «{element.name}» одни экипажи — отделять от них нечего"
        )
    foot_full = element.personnel_full - crew_full
    crew_current, foot_current = fit_under(
        apportion(element.personnel_current, [float(crew_full), float(foot_full)]),
        [crew_full, foot_full],
    )

    foot_name, crew_name = names or (f"{element.name} · пехота", f"{element.name} · техника")
    foot = Element(
        id=unique_id(battalion, f"{element.id}.foot"),
        name=foot_name,
        echelon=echelon_below(element.echelon),
        parent=element.id,
        personnel_full=foot_full,
        personnel_current=foot_current,
        vehicles=[],
        **{field: getattr(element, field) for field in INTENSIVE},
    )
    crew = Element(
        id=unique_id(battalion, f"{element.id}.veh"),
        name=crew_name,
        echelon=echelon_below(element.echelon),
        parent=element.id,
        personnel_full=crew_full,
        personnel_current=crew_current,
        vehicles=[group.model_copy(deep=True) for group in element.vehicles],
        **{field: getattr(element, field) for field in INTENSIVE},
    )
    _insert_after(battalion, element, [foot, crew])
    return [foot, crew]


# --------------------------------------------------------------------------
# сведение
# --------------------------------------------------------------------------
def merge(battalion: Battalion, element_id: str) -> Element:
    """Свести подгруппы обратно в группу — со всем, что от них осталось.

    Количества складываются, «плотности» усредняются по числу людей в
    строю: сведённая группа наследует состояние тех, кто в ней реально
    остался, а не среднее по списку.
    """
    element = battalion.element(element_id)
    if element is None:
        raise FormationError(f"группы «{element_id}» в отряде нет")
    if not can_merge(battalion, element):
        raise FormationError(f"«{element.name}» не разделена — сводить нечего")

    leaves = battalion.leaves_of(element_id)
    # Сначала обнуляем «в строю»: иначе новый штат не пройдёт проверку
    # «в строю не больше штата», когда сводится поредевшая группа.
    element.personnel_current = 0
    element.personnel_full = sum(leaf.personnel_full for leaf in leaves)
    element.personnel_current = sum(leaf.personnel_current for leaf in leaves)
    element.vehicles = _merge_vehicles(leaves)

    weight = sum(leaf.personnel_current for leaf in leaves)
    for field in INTENSIVE:
        if field in ("type", "order", "alive", "engaged"):
            continue
        if weight:
            value = (
                sum(getattr(leaf, field) * leaf.personnel_current for leaf in leaves) / weight
            )
        else:
            value = sum(getattr(leaf, field) for leaf in leaves) / len(leaves)
        setattr(element, field, round(value) if field in INTEGER_FIELDS else value)
    element.alive = any(leaf.alive for leaf in leaves)
    element.engaged = any(leaf.engaged for leaf in leaves)

    doomed = {item.id for item in battalion.subtree(element_id)} - {element_id}
    battalion.elements = [item for item in battalion.elements if item.id not in doomed]
    return element


def _merge_vehicles(leaves: Sequence[Element]) -> list[VehicleGroup]:
    """Сложить однотипные машины, усреднив состояние по числу в строю."""
    order: list[str] = []
    full: dict[str, int] = {}
    current: dict[str, int] = {}
    condition: dict[str, float] = {}
    for leaf in leaves:
        for group in leaf.vehicles:
            name = group.vehicle_type
            if name not in full:
                order.append(name)
                full[name] = current[name] = 0
                condition[name] = 0.0
            full[name] += group.count_full
            current[name] += group.count_current
            condition[name] += group.count_current * group.condition
    merged: list[VehicleGroup] = []
    for name in order:
        alive = current[name]
        merged.append(
            VehicleGroup(
                vehicle_type=name,
                count_full=full[name],
                count_current=alive,
                condition=condition[name] / alive if alive else 100.0,
            )
        )
    return merged


# --------------------------------------------------------------------------
# пересборка дерева
# --------------------------------------------------------------------------
def reassign(battalion: Battalion, element_id: str, parent_id: str | None) -> Element:
    """Переподчинить группу другой — или поднять её в корень."""
    element = battalion.element(element_id)
    if element is None:
        raise FormationError(f"группы «{element_id}» в отряде нет")
    if parent_id is not None:
        if battalion.element(parent_id) is None:
            raise FormationError(f"группы «{parent_id}» в отряде нет")
        if parent_id in {item.id for item in battalion.subtree(element_id)}:
            raise FormationError(
                f"«{element.name}» нельзя подчинить самой себе или своей подгруппе"
            )
    element.parent = parent_id
    return element


def set_engaged(battalion: Battalion, element_id: str, engaged: bool) -> list[Element]:
    """Ввести группу в бой или отвести в резерв — вместе со всеми подгруппами.

    Наряд сил назначается листьями, поэтому щелчок по старшей группе
    должен доходить до всех, кто за неё дерётся.
    """
    touched = [leaf for leaf in battalion.leaves_of(element_id) if leaf.engaged != engaged]
    for leaf in touched:
        leaf.engaged = engaged
    return touched
