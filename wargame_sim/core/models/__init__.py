"""Модели данных предметной области (§4)."""

from core.models.battalion import Battalion, Rollup
from core.models.element import SCHEMA_VERSION, Element, VehicleGroup
from core.models.enums import (
    ECHELON_ORDER,
    ECHELON_ORDINAL,
    BattalionState,
    ContactLevel,
    Echelon,
    EndReason,
    IntelLevel,
    Order,
    Side,
    Terrain,
    TimeOfDay,
    Weather,
    Winner,
    echelon_above,
    echelon_below,
    echelon_ordinal,
)
from core.models.environment import Environment
from core.models.result import (
    BatchResult,
    BattleResult,
    Distribution,
    ElementReport,
    RunRecord,
    SideReport,
)
from core.models.scenario import MAX_SEED, Scenario, new_id

__all__ = [
    "ECHELON_ORDER",
    "ECHELON_ORDINAL",
    "MAX_SEED",
    "SCHEMA_VERSION",
    "BatchResult",
    "Battalion",
    "BattalionState",
    "BattleResult",
    "ContactLevel",
    "Distribution",
    "Echelon",
    "Element",
    "ElementReport",
    "EndReason",
    "Environment",
    "IntelLevel",
    "Order",
    "Rollup",
    "RunRecord",
    "Scenario",
    "Side",
    "SideReport",
    "Terrain",
    "TimeOfDay",
    "VehicleGroup",
    "Weather",
    "Winner",
    "echelon_above",
    "echelon_below",
    "echelon_ordinal",
    "new_id",
]
