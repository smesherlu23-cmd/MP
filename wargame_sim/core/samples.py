"""Шаблонные подразделения и сценарии.

Используются конструктором в UI («добавить из шаблона типа»), тестами и
демонстрационным сценарием для cli.
"""

from __future__ import annotations

from core.config import AppConfig, load_config
from core.models import (
    Battalion,
    Echelon,
    Element,
    Environment,
    Order,
    Scenario,
    Side,
    VehicleGroup,
)
from core.staff import element_staff

#: Типовой состав мотострелкового батальона: тип элемента и его название.
DEFAULT_COMPOSITION: tuple[tuple[str, str], ...] = (
    ("штаб", "Штаб батальона"),
    ("стрелковая_рота", "1-я рота"),
    ("стрелковая_рота", "2-я рота"),
    ("стрелковая_рота", "3-я рота"),
    ("миномётная_батарея", "Миномётная батарея"),
    ("разведвзвод", "Разведвзвод"),
    ("бронегруппа", "Бронегруппа"),
    ("тыл", "Тыл"),
)

#: Техника, добавляемая элементу по умолчанию.
def make_element(
    type_name: str,
    name: str,
    element_id: str,
    config: AppConfig,
    *,
    experience: int = 2,
    morale: float = 75.0,
    with_vehicles: bool = True,
    echelon: Echelon | None = None,
    parent: str | None = None,
) -> Element:
    """Элемент со стартовыми значениями из ``element_types.yaml``."""
    entry = config.element_type(type_name)
    defaults = entry.defaults
    # Если у типа задан состав, штат считается по нему: правка в
    # библиотеке оружия сразу видна в новом подразделении (§4.1).
    staff = element_staff(type_name, config)
    vehicles: list[VehicleGroup] = []
    if with_vehicles and defaults.vehicle_type and defaults.vehicle_count:
        vehicles.append(
            VehicleGroup(
                vehicle_type=defaults.vehicle_type,
                count_full=defaults.vehicle_count,
                count_current=defaults.vehicle_count,
            )
        )
    return Element(
        id=element_id,
        name=name,
        type=type_name,
        echelon=echelon or defaults.echelon,
        parent=parent,
        personnel_full=staff.personnel if staff else defaults.personnel_full,
        personnel_current=staff.personnel if staff else defaults.personnel_full,
        attack=staff.attack if staff else defaults.attack,
        defense=staff.defense if staff else defaults.defense,
        experience=experience,
        morale=morale,
        vehicles=vehicles,
    )


def make_battalion(
    battalion_id: str,
    name: str,
    side: Side,
    config: AppConfig | None = None,
    *,
    order: Order = Order.ATTACK,
    experience: int = 2,
    morale: float = 75.0,
    task: str = "",
) -> Battalion:
    """Батальон типового состава."""
    config = config or load_config()
    elements = [
        make_element(
            type_name,
            element_name,
            f"{type_name}_{index}",
            config,
            experience=experience,
            morale=morale,
        )
        for index, (type_name, element_name) in enumerate(DEFAULT_COMPOSITION, start=1)
    ]
    return Battalion(
        id=battalion_id,
        name=name,
        side=side,
        scale=Echelon.BATTALION,
        elements=elements,
        commander_influence=60.0,
        communications=85.0,
        order=order,
        task=task,
    )


def make_scenario(
    config: AppConfig | None = None,
    *,
    name: str = "Встречный бой",
    seed: int = 42,
    order_a: Order = Order.ATTACK,
    order_b: Order = Order.DEFENCE,
    environment: Environment | None = None,
    symmetric: bool = False,
) -> Scenario:
    """Демонстрационный сценарий.

    ``symmetric=True`` даёт полностью равные батальоны в равных условиях —
    на нём проверяется отсутствие перекоса в сторону A (§12).
    """
    config = config or load_config()
    if symmetric:
        order_a = order_b = Order.ATTACK
    battalion_a = make_battalion("bat_a", "1-й батальон", Side.A, config, order=order_a)
    battalion_b = make_battalion("bat_b", "2-й батальон", Side.B, config, order=order_b)
    return Scenario(
        id="scn_demo" if not symmetric else "scn_symmetric",
        name=name,
        battalion_a=battalion_a,
        battalion_b=battalion_b,
        environment=environment or Environment(),
        master_seed=seed,
    )


#: Мотострелковый взвод: три отделения и приданное танковое звено.
#: Показывает, что программа считает бой любого масштаба, а техника
#: живёт отдельной группой, а не полем внутри пехоты.
PLATOON_COMPOSITION: tuple[tuple[str, str, int], ...] = (
    ("стрелковая_рота", "1-е отделение", 9),
    ("стрелковая_рота", "2-е отделение", 9),
    ("стрелковая_рота", "3-е отделение", 9),
)


def make_platoon(
    battalion_id: str,
    name: str,
    side: Side,
    config: AppConfig | None = None,
    *,
    order: Order = Order.ATTACK,
    experience: int = 2,
    morale: float = 75.0,
    task: str = "",
    vehicle_type: str = "БТР",
    vehicle_count: int = 3,
) -> Battalion:
    """Взвод: управление, три отделения и звено техники отдельной группой."""
    config = config or load_config()
    head = make_element(
        "штаб",
        name,
        "vzvod",
        config,
        experience=experience,
        morale=morale,
        with_vehicles=False,
        echelon=Echelon.PLATOON,
    )
    # Управление взвода — это сама группа: воюют её подгруппы, поэтому
    # собственные числа она получит сведением, а не руками.
    elements = [head]
    for index, (type_name, element_name, personnel) in enumerate(
        PLATOON_COMPOSITION, start=1
    ):
        squad = make_element(
            type_name,
            element_name,
            f"otd_{index}",
            config,
            experience=experience,
            morale=morale,
            with_vehicles=False,
            echelon=Echelon.SQUAD,
            parent=head.id,
        )
        squad.personnel_current = 0
        squad.personnel_full = personnel
        squad.personnel_current = personnel
        elements.append(squad)
    crew = config.vehicle(vehicle_type).crew * vehicle_count
    armour = make_element(
        "бронегруппа",
        "Бронегруппа",
        "bron",
        config,
        experience=experience,
        morale=morale,
        with_vehicles=False,
        echelon=Echelon.TEAM,
        parent=head.id,
    )
    armour.personnel_current = 0
    armour.personnel_full = crew
    armour.personnel_current = crew
    armour.vehicles = [
        VehicleGroup(
            vehicle_type=vehicle_type, count_full=vehicle_count, count_current=vehicle_count
        )
    ]
    elements.append(armour)
    head.personnel_current = 0
    head.personnel_full = sum(item.personnel_full for item in elements[1:])
    head.personnel_current = head.personnel_full
    return Battalion(
        id=battalion_id,
        name=name,
        side=side,
        scale=Echelon.PLATOON,
        elements=elements,
        commander_influence=60.0,
        communications=85.0,
        order=order,
        task=task,
    )


def make_small_scenario(
    config: AppConfig | None = None,
    *,
    name: str = "Встречный бой взводов",
    seed: int = 42,
    order_a: Order = Order.ATTACK,
    order_b: Order = Order.DEFENCE,
    environment: Environment | None = None,
) -> Scenario:
    """Демонстрация малого масштаба: взвод против взвода."""
    config = config or load_config()
    return Scenario(
        id="scn_platoon",
        name=name,
        battalion_a=make_platoon("vzv_a", "1-й взвод", Side.A, config, order=order_a),
        battalion_b=make_platoon("vzv_b", "2-й взвод", Side.B, config, order=order_b),
        environment=environment or Environment(),
        master_seed=seed,
    )
