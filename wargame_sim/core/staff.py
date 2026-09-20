"""Штат подразделения: из комплекта солдата — в числа элемента (§4.1).

Тип элемента может быть описан составом: сколько каких солдат в нём по
штату. Тогда численность, огневая мощь и устойчивость не задаются руками,
а считаются по карточкам оружия, обмундирования и техники — и правка
в библиотеке сразу видна в подразделении.

Все веса перевода живут в ``troops.yaml`` (раздел ``staff``): в коде нет
ни одного коэффициента.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.config import AppConfig


@dataclass(frozen=True)
class SoldierValues:
    """Что солдат даёт подразделению со своим комплектом."""

    name: str
    label: str
    firepower: float
    anti_tank: float
    protection: float
    ammo: int
    weapon: str
    secondary: str
    gear: str


def soldier(name: str, config: AppConfig) -> SoldierValues:
    """Числа одного типа солдата по его комплекту."""
    entry = config.troop(name)
    rules = config.staff
    weapon = config.weapon(entry.weapon)
    gear = config.gear_entry(entry.gear)

    firepower = weapon.firepower
    anti_tank = weapon.anti_tank
    if entry.secondary:
        second = config.weapon(entry.secondary)
        firepower += second.firepower * rules.secondary_share
        anti_tank += second.anti_tank * rules.secondary_share

    return SoldierValues(
        name=name,
        label=entry.label,
        firepower=firepower,
        anti_tank=anti_tank,
        protection=gear.protection,
        ammo=entry.ammo,
        weapon=entry.weapon,
        secondary=entry.secondary,
        gear=entry.gear,
    )


@dataclass(frozen=True)
class StaffSummary:
    """Штат типа элемента, посчитанный по составу."""

    personnel: int
    attack: float
    defense: float
    anti_tank: float
    breakdown: list[tuple[str, float]] = field(default_factory=list)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def element_staff(type_name: str, config: AppConfig) -> StaffSummary | None:
    """Штат типа элемента или ``None``, если состав не задан.

    Огневая мощь и устойчивость нормируются на численность: это качество
    подразделения в шкале 0..100, которое движок потом домножает на долю
    оставшихся в строю.
    """
    entry = config.element_type(type_name)
    if not entry.composition:
        return None

    rules = config.staff
    personnel = sum(entry.composition.values())
    if personnel <= 0:
        return None

    fire = 0.0
    anti_tank_fire = 0.0
    protection = 0.0
    for troop_name, count in entry.composition.items():
        values = soldier(troop_name, config)
        fire += count * values.firepower
        anti_tank_fire += count * values.anti_tank
        protection += count * values.protection

    vehicle_fire = 0.0
    vehicle_armour = 0.0
    defaults = entry.defaults
    if defaults.vehicle_type and defaults.vehicle_count:
        vehicle = config.vehicle(defaults.vehicle_type)
        vehicle_fire = defaults.vehicle_count * vehicle.firepower * rules.vehicle_firepower
        vehicle_armour = defaults.vehicle_count * vehicle.armour_front

    attack = _clamp(
        (fire + vehicle_fire) / personnel * rules.attack_scale * entry.staff_attack,
        0.0,
        100.0,
    )
    defense = _clamp(
        (
            rules.defense_base
            + protection / personnel * rules.defense_protection
            + vehicle_armour / personnel * rules.defense_vehicle
        )
        * entry.staff_defense,
        0.0,
        100.0,
    )
    # Противотанковость — доля огня штата, работающая по технике.
    total_fire = fire + vehicle_fire
    anti_tank = _clamp(anti_tank_fire / total_fire, 0.0, 1.0) if total_fire else 0.0

    return StaffSummary(
        personnel=personnel,
        attack=attack,
        defense=defense,
        anti_tank=anti_tank,
        breakdown=[
            ("огонь пехоты", fire),
            ("огонь техники", vehicle_fire),
            ("защищённость", protection / personnel),
            ("броня на человека", vehicle_armour / personnel),
            ("доля огня роли", entry.staff_attack),
            ("доля стойкости роли", entry.staff_defense),
        ],
    )
