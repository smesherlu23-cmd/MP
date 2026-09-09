"""Базовые формулы боя (§6.2).

Каждая функция возвращает не только число, но и список сработавших
модификаторов — он попадает в ``breakdown`` журнала (§8), чтобы ГМ видел,
из чего сложился результат.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.config import AppConfig
from core.models import Battalion, ContactLevel, Element, Environment


@dataclass
class Factors:
    """Накопитель множителей: произведение плюс расшифровка."""

    value: float = 1.0
    items: list[tuple[str, float]] = field(default_factory=list)

    def mul(self, name: str, factor: float) -> float:
        self.value *= factor
        self.items.append((name, factor))
        return self.value

    def add_note(self, name: str, factor: float) -> None:
        """Записать число в расшифровку, не меняя произведение."""
        self.items.append((name, factor))

    def extend(self, other: Factors, prefix: str = "") -> None:
        for name, factor in other.items:
            self.items.append((f"{prefix}{name}" if prefix else name, factor))

    def pairs(self) -> list[tuple[str, float]]:
        return list(self.items)


def state_coefficient(
    element: Element, battalion: Battalion, config: AppConfig
) -> tuple[float, Factors]:
    """K_сост — коэффициент состояния элемента.

    Выключенные тумблерами параметры (§4.5) в произведение не входят.
    """
    factors = Factors()
    toggles = config.tog
    experience = config.experience_level(element.experience)

    factors.mul("опыт", experience.combat)
    factors.mul("мораль", config.mor.state_curve(element.morale))

    effective_cohesion = element.cohesion * battalion.communications / 100.0
    factors.mul("связь", config.cbt.curves.cohesion(effective_cohesion))
    factors.mul("подавление", 1.0 - element.suppression / 100.0)

    if toggles.fatigue:
        factors.mul("усталость", config.fat.state_curve(element.fatigue))
    factors.mul("боезапас", config.sup.ammo.state_curve(element.ammo))
    if toggles.equipment:
        factors.mul("снаряжение", config.sup.equipment.state_curve(element.equipment))
    if toggles.readiness:
        factors.mul("готовность", config.cbt.curves.readiness(element.readiness))
    if toggles.fuel and (element.has_vehicles or config.sup.fuel.infantry_uses_fuel):
        factors.mul("топливо", config.sup.fuel.state_curve(element.fuel))
    if toggles.vehicle_condition and element.has_vehicles:
        factors.mul(
            "состояние техники",
            config.cbt.curves.vehicle_condition(element.vehicle_condition),
        )

    return factors.value, factors


def commander_factor(battalion: Battalion, config: AppConfig) -> float:
    """k_командир — влияние командира, если параметр включён."""
    if not config.tog.commander_influence:
        return 1.0
    return config.cbt.curves.commander(battalion.commander_influence)


def firepower(
    element: Element,
    battalion: Battalion,
    environment: Environment,
    config: AppConfig,
    *,
    order_name: str,
    noise: float,
    accuracy: float,
    first_strike: float = 1.0,
) -> tuple[float, Factors]:
    """Огневая мощь элемента с расшифровкой модификаторов."""
    order = config.order(order_name)
    terrain = config.terrain_entry(str(environment.terrain))
    weather = config.weather_entry(str(environment.weather))
    time_of_day = config.time_entry(str(environment.time_of_day))

    factors = Factors()
    factors.add_note("attack", element.attack)
    factors.mul("численность", element.personnel_ratio)

    state, state_factors = state_coefficient(element, battalion, config)
    factors.mul("K_сост", state)
    factors.extend(state_factors, prefix="сост:")

    factors.mul(f"приказ:{order_name}", order.attack)
    factors.mul(f"местность:{environment.terrain}", terrain.attack)
    factors.mul(f"погода:{environment.weather}", weather.accuracy)
    factors.mul(f"время:{environment.time_of_day}", time_of_day.accuracy)
    factors.mul("командир", commander_factor(battalion, config))
    factors.mul("контакт", accuracy)
    if first_strike != 1.0:
        factors.mul("первый удар", first_strike)
    factors.mul("случайность", noise)

    return element.attack * factors.value, factors


def resilience(
    element: Element,
    battalion: Battalion,
    environment: Environment,
    config: AppConfig,
    *,
    order_name: str,
) -> tuple[float, Factors]:
    """Устойчивость элемента с расшифровкой модификаторов."""
    order = config.order(order_name)
    terrain = config.terrain_entry(str(environment.terrain))
    fortification = environment.fortification(str(battalion.side))

    factors = Factors()
    factors.add_note("defense", element.defense)
    factors.mul("численность", element.personnel_ratio)

    state, state_factors = state_coefficient(element, battalion, config)
    factors.mul("K_сост", state)
    factors.extend(state_factors, prefix="сост:")

    factors.mul(f"приказ:{order_name}", order.defense)
    factors.mul(f"местность:{environment.terrain}", terrain.defense)
    factors.mul(f"укрепление:{fortification}", config.cbt.curves.fortification(fortification))

    return element.defense * factors.value, factors


def cover(battalion: Battalion, environment: Environment, config: AppConfig) -> float:
    """Доля потерь, поглощаемая укрытием: местность плюс укрепления."""
    terrain = config.terrain_entry(str(environment.terrain))
    fortification = environment.fortification(str(battalion.side))
    total = terrain.cover + config.cbt.curves.fortification_cover(fortification)
    return min(total, config.cbt.checks.max_cover)


def contact_accuracy(level: ContactLevel, config: AppConfig) -> float:
    """Множитель точности огня по уровню контакта."""
    return config.cbt.detection.accuracy.get(str(level), 0.0)


def contact_target_share(level: ContactLevel, config: AppConfig) -> float:
    """Доля элементов противника, доступная как цели при данном контакте."""
    return config.cbt.detection.target_share.get(str(level), 0.0)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
