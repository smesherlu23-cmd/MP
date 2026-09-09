"""Шаблонные подразделения и сценарии.

Используются конструктором в UI («добавить из шаблона типа»), тестами и
демонстрационным сценарием для cli.
"""

from __future__ import annotations

from core.config import AppConfig, load_config
from core.models import (
    Battalion,
    Element,
    Environment,
    Order,
    Scenario,
    Side,
    VehicleGroup,
)

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
DEFAULT_VEHICLES: dict[str, tuple[str, int]] = {
    "бронегруппа": ("БМП", 10),
    "стрелковая_рота": ("БТР", 4),
    "тыл": ("Грузовик", 8),
}


def make_element(
    type_name: str,
    name: str,
    element_id: str,
    config: AppConfig,
    *,
    experience: int = 2,
    morale: float = 75.0,
    with_vehicles: bool = True,
) -> Element:
    """Элемент со стартовыми значениями из ``element_types.yaml``."""
    entry = config.element_type(type_name)
    defaults = entry.defaults
    vehicles: list[VehicleGroup] = []
    if with_vehicles and type_name in DEFAULT_VEHICLES:
        vehicle_type, count = DEFAULT_VEHICLES[type_name]
        vehicles.append(
            VehicleGroup(
                vehicle_type=vehicle_type,
                count_full=count,
                count_current=count,
                condition=100.0,
            )
        )
    return Element(
        id=element_id,
        name=name,
        type=type_name,
        personnel_full=defaults.personnel_full,
        personnel_current=defaults.personnel_full,
        attack=defaults.attack,
        defense=defaults.defense,
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
