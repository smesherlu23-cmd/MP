"""Pydantic-схемы конфигурационных файлов.

Каждому YAML-файлу из ``config/`` соответствует одна модель. Валидация даёт
понятное сообщение об ошибке вместо падения приложения (§5, §12).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from core.config.curve import Curve

Strict = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------
# terrain.yaml
# --------------------------------------------------------------------------
class TerrainEntry(BaseModel):
    model_config = Strict

    attack: float = Field(gt=0)
    defense: float = Field(gt=0)
    detection: float = Field(gt=0)
    fatigue: float = Field(ge=0)
    speed: float = Field(gt=0)
    cover: float = Field(ge=0, le=0.95)


class TerrainConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    terrain: dict[str, TerrainEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# weather.yaml
# --------------------------------------------------------------------------
class WeatherEntry(BaseModel):
    model_config = Strict

    detection: float = Field(gt=0)
    accuracy: float = Field(gt=0)
    fatigue: float = Field(ge=0)
    vehicles: float = Field(gt=0)


class WeatherConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    weather: dict[str, WeatherEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# time_of_day.yaml
# --------------------------------------------------------------------------
class TimeOfDayEntry(BaseModel):
    model_config = Strict

    detection: float = Field(gt=0)
    accuracy: float = Field(gt=0)


class TimeOfDayConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    time_of_day: dict[str, TimeOfDayEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# orders.yaml
# --------------------------------------------------------------------------
TaskKind = Literal["enemy_routed", "hold_turns", "ambush", "recon", "disengage", "none"]


class OrderTask(BaseModel):
    """Условие выполнения боевой задачи для приказа (§6.3)."""

    model_config = Strict

    kind: TaskKind = "none"
    turns: int = Field(default=0, ge=0)
    damage_ratio: float = Field(default=0.0, ge=0, le=1)
    intel_level: str | None = None
    personnel_ratio: float = Field(default=0.0, ge=0, le=1)


class OrderEntry(BaseModel):
    model_config = Strict

    attack: float = Field(ge=0)
    defense: float = Field(gt=0)
    visibility: float = Field(gt=0)
    detection_speed: float = Field(gt=0)
    ammo_use: float = Field(ge=0)
    fuel_use: float = Field(ge=0)
    fatigue_gain: float = Field(ge=0)
    morale_resistance: float = Field(gt=0)
    initiative: float = 0.0
    disengage: float = Field(default=0.0, ge=0, le=1)
    task: OrderTask = Field(default_factory=OrderTask)


class OrdersConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    orders: dict[str, OrderEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# element_types.yaml
# --------------------------------------------------------------------------
class ElementTypeDefaults(BaseModel):
    model_config = Strict

    personnel_full: int = Field(ge=0)
    attack: float = Field(ge=0, le=100)
    defense: float = Field(ge=0, le=100)


class ElementTypeEntry(BaseModel):
    model_config = Strict

    label: str
    combat: bool = True
    hq: bool = False
    supply_source: bool = False
    recon: bool = False
    target_priority: float = Field(ge=0)
    vulnerability: float = Field(ge=0)
    anti_tank: float = Field(ge=0, le=1)
    detection: float = Field(gt=0)
    stealth: float = Field(gt=0)
    defaults: ElementTypeDefaults


class ElementTypesConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    element_types: dict[str, ElementTypeEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# experience.yaml
# --------------------------------------------------------------------------
class ExperienceEntry(BaseModel):
    model_config = Strict

    combat: float = Field(gt=0)
    morale_resistance: float = Field(gt=0)
    detection: float = Field(gt=0)
    suppression_recovery: float = Field(gt=0)
    initiative: float = 0.0
    morale_bonus: float = 0.0


class ExperienceConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    experience: dict[int, ExperienceEntry] = Field(min_length=1)


# --------------------------------------------------------------------------
# morale.yaml
# --------------------------------------------------------------------------
class MoraleWeights(BaseModel):
    model_config = Strict

    k1_casualties: float = Field(ge=0)
    k2_suppression: float = Field(ge=0)
    k3_vehicle_losses: float = Field(ge=0)
    k4_no_hq: float = Field(ge=0)
    k5_commander: float = Field(ge=0)
    k6_experience: float = Field(ge=0)
    k7_side_success: float = Field(ge=0)


class MoraleThresholds(BaseModel):
    model_config = Strict

    retreat: float = Field(ge=0, le=100)
    panic: float = Field(ge=0, le=100)


class MoraleBody(BaseModel):
    model_config = Strict

    weights: MoraleWeights
    thresholds: MoraleThresholds
    recovery_per_turn: float = Field(ge=0)
    min: float = Field(ge=0, le=100)
    max: float = Field(ge=0, le=100)
    state_curve: Curve


class MoraleConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    morale: MoraleBody


# --------------------------------------------------------------------------
# fatigue.yaml
# --------------------------------------------------------------------------
class FatigueBody(BaseModel):
    model_config = Strict

    gain_per_turn: float = Field(ge=0)
    gain_in_contact: float = Field(ge=0)
    gain_per_casualty_share: float = Field(ge=0)
    recovery_per_turn: float = Field(ge=0)
    recovery_experience_weight: float = Field(ge=0)
    min: float = Field(ge=0, le=100)
    max: float = Field(ge=0, le=100)
    state_curve: Curve


class FatigueConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    fatigue: FatigueBody


# --------------------------------------------------------------------------
# supply.yaml
# --------------------------------------------------------------------------
class AmmoSupply(BaseModel):
    model_config = Strict

    base_per_turn: float = Field(ge=0)
    intensity_weight: float = Field(ge=0)
    resupply_per_turn: float = Field(ge=0)
    resupply_without_source: float = Field(ge=0)
    min: float = Field(ge=0, le=100)
    max: float = Field(ge=0, le=100)
    state_curve: Curve


class FuelSupply(AmmoSupply):
    model_config = Strict

    infantry_uses_fuel: bool = False


class EquipmentSupply(BaseModel):
    model_config = Strict

    loss_per_turn: float = Field(ge=0)
    loss_per_casualty_share: float = Field(ge=0)
    resupply_per_turn: float = Field(ge=0)
    min: float = Field(ge=0, le=100)
    max: float = Field(ge=0, le=100)
    state_curve: Curve


class SupplyBody(BaseModel):
    model_config = Strict

    ammo: AmmoSupply
    fuel: FuelSupply
    equipment: EquipmentSupply
    source_efficiency_curve: Curve


class SupplyConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    supply: SupplyBody


# --------------------------------------------------------------------------
# combat.yaml
# --------------------------------------------------------------------------
class NoiseRange(BaseModel):
    model_config = Strict

    min: float = Field(ge=0)
    max: float = Field(ge=0)


class CasualtiesConfig(BaseModel):
    model_config = Strict

    lethality: float = Field(ge=0)
    pressure_exponent: float = Field(gt=0)
    cap_per_turn: float = Field(gt=0, le=1)
    defense_epsilon: float = Field(gt=0)
    first_strike_bonus: float = Field(gt=0)
    noise: NoiseRange


class VehiclesConfig(BaseModel):
    model_config = Strict

    lethality: float = Field(ge=0)
    pressure_exponent: float = Field(gt=0)
    cap_per_turn: float = Field(gt=0, le=1)
    defense_epsilon: float = Field(gt=0)
    condition_share: float = Field(ge=0, le=1)
    condition_loss_per_hit: float = Field(ge=0)
    disabled_below_condition: float = Field(ge=0, le=100)
    crew_loss_per_vehicle: float = Field(ge=0)
    abandoned_on_panic: float = Field(ge=0, le=1)


class ContactThresholds(BaseModel):
    model_config = Strict

    частичный: float
    полный: float


class DetectionConfig(BaseModel):
    model_config = Strict

    base: float = Field(gt=0)
    intel: dict[str, float]
    recon_element_bonus: float = Field(ge=0)
    recon_bonus_cap: float = Field(ge=0)
    contact_thresholds: ContactThresholds
    target_share: dict[str, float]
    accuracy: dict[str, float]
    intel_gain_per_turn: float = Field(ge=0)
    intel_levels: list[str] = Field(min_length=1)


class InitiativeConfig(BaseModel):
    model_config = Strict

    cohesion_weight: float = Field(ge=0)
    intel: dict[str, float]
    roll: NoiseRange
    ambush_bonus: float
    readiness_weight: float = Field(ge=0)


class TargetingConfig(BaseModel):
    model_config = Strict

    priority_exponent: float = Field(ge=0)
    noise: NoiseRange
    min_weight: float = Field(ge=0, le=1)
    hq_focus_bonus: float = Field(ge=0)
    supply_focus_bonus: float = Field(ge=0)


class SuppressionConfig(BaseModel):
    model_config = Strict

    gain: float = Field(ge=0)
    gain_exponent: float = Field(gt=0)
    recovery: float = Field(ge=0)
    min: float = Field(ge=0, le=100)
    max: float = Field(ge=0, le=100)


class CombatCurves(BaseModel):
    model_config = Strict

    cohesion: Curve
    commander: Curve
    readiness: Curve
    vehicle_condition: Curve
    fortification: Curve
    fortification_cover: Curve


class ChecksConfig(BaseModel):
    model_config = Strict

    rout_personnel_ratio: float = Field(ge=0, le=1)
    element_dead_personnel_ratio: float = Field(ge=0, le=1)
    panic_pursuit_losses: float = Field(ge=0, le=1)
    disengage_threshold: float = Field(gt=0)
    default_max_turns: int = Field(gt=0)
    max_cover: float = Field(ge=0, lt=1)


class CombatBody(BaseModel):
    model_config = Strict

    casualties: CasualtiesConfig
    vehicles: VehiclesConfig
    detection: DetectionConfig
    initiative: InitiativeConfig
    targeting: TargetingConfig
    suppression: SuppressionConfig
    curves: CombatCurves
    checks: ChecksConfig


class CombatConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    combat: CombatBody


# --------------------------------------------------------------------------
# toggles.yaml
# --------------------------------------------------------------------------
class TogglesBody(BaseModel):
    model_config = Strict

    fuel: bool = True
    equipment: bool = True
    vehicle_condition: bool = True
    readiness: bool = True
    commander_influence: bool = True
    intel: bool = True
    fatigue: bool = True


class TogglesConfig(BaseModel):
    model_config = Strict

    schema_version: int = 1
    toggles: TogglesBody


#: Соответствие «имя файла без расширения» -> модель.
CONFIG_SCHEMAS: dict[str, type[BaseModel]] = {
    "terrain": TerrainConfig,
    "weather": WeatherConfig,
    "time_of_day": TimeOfDayConfig,
    "orders": OrdersConfig,
    "element_types": ElementTypesConfig,
    "experience": ExperienceConfig,
    "morale": MoraleConfig,
    "combat": CombatConfig,
    "supply": SupplyConfig,
    "fatigue": FatigueConfig,
    "toggles": TogglesConfig,
}
