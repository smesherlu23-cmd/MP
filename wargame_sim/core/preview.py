"""Сравнение сторон до боя (§7.1).

Перевес считается теми же функциями, которыми движок считает первый ход:
огневая мощь против устойчивости, с учётом приказов, местности, погоды,
времени суток и укреплений. Поэтому подпись на экране настройки не может
разойтись с тем, что произойдёт после нажатия «Начать бой».
"""

from __future__ import annotations

from dataclasses import dataclass

from core.config import AppConfig
from core.engine.formulas import firepower, resilience
from core.models import Scenario

#: Нейтральный множитель: без случайности и при полном контакте. Это не
#: коэффициент расчёта, а единица — значение, при котором модификатор
#: ничего не меняет.
NEUTRAL = 1.0


@dataclass(frozen=True)
class SideEdge:
    """Суммарные огневая мощь и устойчивость стороны на нулевом ходу."""

    side: str
    name: str
    order: str
    firepower: float
    resilience: float


@dataclass(frozen=True)
class Edge:
    """Сравнение сторон и готовая формулировка для ГМ."""

    a: SideEdge
    b: SideEdge
    ratio_a: float
    ratio_b: float
    text: str

    @property
    def leader(self) -> str:
        """Сторона с перевесом: «A», «B» или пустая строка при равенстве."""
        if self.ratio_a > self.ratio_b:
            return "A"
        if self.ratio_b > self.ratio_a:
            return "B"
        return ""


def _side_edge(scenario: Scenario, side: str, config: AppConfig) -> SideEdge:
    battalion = scenario.battalion(side)
    environment = scenario.environment
    total_fire = 0.0
    total_hold = 0.0
    for element in battalion.alive_elements:
        order_name = str(battalion.order_for(element))
        fire, _ = firepower(
            element,
            battalion,
            environment,
            config,
            order_name=order_name,
            noise=NEUTRAL,
            accuracy=NEUTRAL,
        )
        hold, _ = resilience(
            element, battalion, environment, config, order_name=order_name
        )
        total_fire += fire
        total_hold += hold
    return SideEdge(
        side=side,
        name=battalion.name,
        order=str(battalion.order),
        firepower=total_fire,
        resilience=total_hold,
    )


def _ratio(fire: float, hold: float) -> float:
    return fire / hold if hold else 0.0


def edge(scenario: Scenario, config: AppConfig) -> Edge:
    """Кто в выигрышном положении до первого выстрела и почему."""
    normalised = scenario.normalised()
    a = _side_edge(normalised, "A", config)
    b = _side_edge(normalised, "B", config)
    ratio_a = _ratio(a.firepower, b.resilience)
    ratio_b = _ratio(b.firepower, a.resilience)

    environment = normalised.environment
    lines = [
        f"Огонь A против устойчивости B — {ratio_a:.2f}"
        f" ({a.firepower:.0f} против {b.resilience:.0f}).",
        f"Огонь B против устойчивости A — {ratio_b:.2f}"
        f" ({b.firepower:.0f} против {a.resilience:.0f}).",
    ]
    if ratio_a > ratio_b:
        lines.append(
            f"Перевес у A: приказ «{a.order}» против «{b.order}»"
            f" по местности «{environment.terrain}»."
        )
    elif ratio_b > ratio_a:
        lines.append(
            f"Перевес у B: приказ «{b.order}» против «{a.order}»"
            f" по местности «{environment.terrain}»."
        )
    else:
        lines.append("Перевеса нет: соотношения совпадают.")

    return Edge(a=a, b=b, ratio_a=ratio_a, ratio_b=ratio_b, text=" ".join(lines))
