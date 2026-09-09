"""Результаты боя и массового моделирования (§9, §11)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.log import LogEntry
from core.models.element import SCHEMA_VERSION
from core.models.enums import EndReason, Winner


class ElementReport(BaseModel):
    """Итог по одному элементу."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    type: str
    alive: bool
    personnel_start: int
    personnel_end: int
    personnel_lost: int
    vehicles_start: int
    vehicles_end: int
    vehicles_lost: int
    vehicle_condition: float
    morale: float
    suppression: float
    fatigue: float
    ammo: float
    fuel: float
    equipment: float
    order: str


class SideReport(BaseModel):
    """Итог по одной стороне."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    side: str
    state: str
    task: str
    task_completed: bool
    personnel_start: int
    personnel_end: int
    personnel_lost: int
    personnel_loss_ratio: float
    vehicles_start: int
    vehicles_end: int
    vehicles_lost: int
    morale: float
    combat_power: float
    organisation: float
    supply: float
    ammo: float
    fuel: float
    equipment: float
    fatigue: float
    suppression: float
    elements: list[ElementReport] = Field(default_factory=list)


class BattleResult(BaseModel):
    """Результат одного боя вместе с журналом (§8)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SCHEMA_VERSION
    id: str
    scenario_id: str
    scenario_name: str
    master_seed: int
    turns: int
    max_turns: int
    winner: Winner
    end_reason: EndReason
    summary_text: str = ""
    side_a: SideReport
    side_b: SideReport
    log: list[LogEntry] = Field(default_factory=list)
    log_hash: str = ""

    def side(self, name: str) -> SideReport:
        return self.side_a if name == "A" else self.side_b


class RunRecord(BaseModel):
    """Одна строка таблицы массового моделирования."""

    model_config = ConfigDict(extra="forbid")

    index: int
    seed: int
    winner: Winner
    end_reason: EndReason
    turns: int
    losses_a: int
    losses_b: int
    loss_ratio_a: float
    loss_ratio_b: float
    vehicle_losses_a: int
    vehicle_losses_b: int
    combat_power_a: float
    combat_power_b: float


class Distribution(BaseModel):
    """Сводка по числовому ряду."""

    model_config = ConfigDict(extra="forbid")

    mean: float
    median: float
    p10: float
    p50: float
    p90: float
    minimum: float
    maximum: float


class BatchResult(BaseModel):
    """Статистика по N прогонам (§9)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SCHEMA_VERSION
    scenario_id: str
    scenario_name: str
    runs: int
    base_seed: int
    win_probability_a: float
    win_probability_b: float
    draw_probability: float
    end_reasons: dict[str, int] = Field(default_factory=dict)
    turns: Distribution
    losses_a: Distribution
    losses_b: Distribution
    vehicle_losses_a: Distribution
    vehicle_losses_b: Distribution
    records: list[RunRecord] = Field(default_factory=list)
