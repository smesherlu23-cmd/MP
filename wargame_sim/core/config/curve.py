"""Кусочно-линейная кривая — способ задать любой коэффициент из YAML.

Все зависимости вида «параметр 0..100 -> множитель» описываются списком точек
в конфиге, поэтому ни одно число не приходится хардкодить в формулах.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class CurvePoint(BaseModel):
    """Узел кривой: значение аргумента и соответствующий множитель."""

    model_config = {"extra": "forbid"}

    x: float
    y: float


class Curve(BaseModel):
    """Монотонная по x последовательность узлов с линейной интерполяцией.

    За пределами диапазона кривая продолжается константой крайнего узла.
    """

    model_config = {"extra": "forbid"}

    points: list[CurvePoint] = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def _accept_bare_list(cls, data: Any) -> Any:
        """В YAML кривая пишется просто списком точек — без обёртки."""
        if isinstance(data, list):
            return {"points": data}
        return data

    @field_validator("points")
    @classmethod
    def _sorted_by_x(cls, points: list[CurvePoint]) -> list[CurvePoint]:
        xs = [p.x for p in points]
        if xs != sorted(xs):
            raise ValueError("точки кривой должны идти по возрастанию x")
        if len(set(xs)) != len(xs):
            raise ValueError("точки кривой не должны повторять x")
        return points

    def __call__(self, value: float) -> float:
        """Значение кривой в точке ``value``."""
        points = self.points
        if value <= points[0].x:
            return points[0].y
        if value >= points[-1].x:
            return points[-1].y
        for left, right in pairwise(points):
            if left.x <= value <= right.x:
                span = right.x - left.x
                if span == 0:
                    return right.y
                ratio = (value - left.x) / span
                return left.y + ratio * (right.y - left.y)
        return points[-1].y  # pragma: no cover - недостижимо при отсортированных точках
