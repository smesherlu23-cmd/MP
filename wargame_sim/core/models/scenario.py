"""Сценарий боя: две стороны, условия и сид (§7, §11)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from core.models.battalion import Battalion
from core.models.element import SCHEMA_VERSION
from core.models.enums import Side
from core.models.environment import Environment

#: Верхняя граница сида: помещается в 32-битное знаковое целое, поэтому
#: его удобно вводить руками и переносить между машинами.
MAX_SEED = 2**31 - 1


def new_id(prefix: str) -> str:
    """Короткий человекочитаемый идентификатор."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class Scenario(BaseModel):
    """Полностью описанный бой: его можно сохранить и повторить по сиду."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: int = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: new_id("scn"))
    name: str = "Без названия"
    battalion_a: Battalion
    battalion_b: Battalion
    environment: Environment = Field(default_factory=Environment)
    master_seed: int = Field(default=0, ge=0, le=MAX_SEED)
    notes: str = ""

    def normalised(self) -> Scenario:
        """Копия с корректно проставленными сторонами."""
        scenario = self.model_copy(deep=True)
        scenario.battalion_a.side = Side.A
        scenario.battalion_b.side = Side.B
        return scenario

    def battalion(self, side: Side | str) -> Battalion:
        return self.battalion_a if str(side) == "A" else self.battalion_b
