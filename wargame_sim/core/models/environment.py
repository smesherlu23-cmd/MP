"""Условия боя (§4.3)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.models.element import SCHEMA_VERSION
from core.models.enums import IntelLevel, Terrain, TimeOfDay, Weather


class Environment(BaseModel):
    """Местность, время, погода, укрепления и разведданные сторон."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: int = SCHEMA_VERSION
    terrain: Terrain = Terrain.PLAIN
    time_of_day: TimeOfDay = TimeOfDay.DAY
    weather: Weather = Weather.CLEAR
    fortification_A: int = Field(default=0, ge=0, le=5)
    fortification_B: int = Field(default=0, ge=0, le=5)
    intel_A: IntelLevel = IntelLevel.PARTIAL
    intel_B: IntelLevel = IntelLevel.PARTIAL
    max_turns: int = Field(default=30, gt=0, le=500)

    def fortification(self, side: str) -> int:
        return self.fortification_A if str(side) == "A" else self.fortification_B

    def intel(self, side: str) -> IntelLevel:
        return self.intel_A if str(side) == "A" else self.intel_B
