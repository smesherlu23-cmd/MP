"""Загрузка, валидация, горячая перезагрузка и сброс конфигурации.

Рабочие файлы лежат в ``config/``, эталонные — в ``config/defaults/`` и
никогда не перезаписываются (§5).
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from core.config.schema import (
    CONFIG_SCHEMAS,
    CombatConfig,
    ElementTypesConfig,
    ExperienceConfig,
    FatigueConfig,
    MoraleConfig,
    OrdersConfig,
    SupplyConfig,
    TerrainConfig,
    TimeOfDayConfig,
    TogglesConfig,
    WeatherConfig,
)

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


class ConfigError(Exception):
    """Понятная ошибка конфигурации: файл, раздел и что именно не так."""

    def __init__(self, section: str, path: Path, detail: str) -> None:
        self.section = section
        self.path = path
        self.detail = detail
        super().__init__(f"Ошибка в конфиге «{section}» ({path}):\n{detail}")


def _format_validation_error(error: ValidationError) -> str:
    lines = []
    for item in error.errors():
        location = " → ".join(str(part) for part in item["loc"]) or "корень"
        lines.append(f"  • {location}: {item['msg']}")
    return "\n".join(lines)


def _read_yaml(section: str, path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigError(section, path, "файл не найден")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(section, path, f"некорректный YAML: {exc}") from exc
    if raw is None:
        raise ConfigError(section, path, "файл пуст")
    if not isinstance(raw, dict):
        raise ConfigError(section, path, "ожидался словарь на верхнем уровне")
    return raw


def _validate(section: str, path: Path, raw: dict[str, Any]) -> BaseModel:
    model = CONFIG_SCHEMAS[section]
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(section, path, _format_validation_error(exc)) from exc


class AppConfig(BaseModel):
    """Полный набор коэффициентов, разобранный и проверенный."""

    model_config = {"arbitrary_types_allowed": True}

    terrain: TerrainConfig
    weather: WeatherConfig
    time_of_day: TimeOfDayConfig
    orders: OrdersConfig
    element_types: ElementTypesConfig
    experience: ExperienceConfig
    morale: MoraleConfig
    combat: CombatConfig
    supply: SupplyConfig
    fatigue: FatigueConfig
    toggles: TogglesConfig

    # -- удобные сокращения, чтобы формулы читались ближе к ТЗ --------------
    @property
    def cbt(self):
        return self.combat.combat

    @property
    def mor(self):
        return self.morale.morale

    @property
    def fat(self):
        return self.fatigue.fatigue

    @property
    def sup(self):
        return self.supply.supply

    @property
    def tog(self):
        return self.toggles.toggles

    def order(self, name: str):
        entry = self.orders.orders.get(name)
        if entry is None:
            raise ConfigError(
                "orders",
                Path("orders.yaml"),
                f"приказ «{name}» не описан; известны: {', '.join(sorted(self.orders.orders))}",
            )
        return entry

    def element_type(self, name: str):
        entry = self.element_types.element_types.get(name)
        if entry is None:
            known = ", ".join(sorted(self.element_types.element_types))
            raise ConfigError(
                "element_types",
                Path("element_types.yaml"),
                f"тип элемента «{name}» не описан; известны: {known}",
            )
        return entry

    def experience_level(self, level: int):
        entry = self.experience.experience.get(level)
        if entry is None:
            raise ConfigError(
                "experience",
                Path("experience.yaml"),
                f"уровень опыта {level} не описан",
            )
        return entry

    def terrain_entry(self, name: str):
        entry = self.terrain.terrain.get(name)
        if entry is None:
            raise ConfigError("terrain", Path("terrain.yaml"), f"местность «{name}» не описана")
        return entry

    def weather_entry(self, name: str):
        entry = self.weather.weather.get(name)
        if entry is None:
            raise ConfigError("weather", Path("weather.yaml"), f"погода «{name}» не описана")
        return entry

    def time_entry(self, name: str):
        entry = self.time_of_day.time_of_day.get(name)
        if entry is None:
            raise ConfigError(
                "time_of_day", Path("time_of_day.yaml"), f"время суток «{name}» не описано"
            )
        return entry


class ConfigStore:
    """Хранилище конфигурации с горячей перезагрузкой.

    ``get()`` возвращает разобранный :class:`AppConfig`; при изменении файлов
    на диске он пересобирается автоматически, без перезапуска приложения.
    """

    def __init__(self, directory: Path | str | None = None) -> None:
        self.directory = Path(directory) if directory else DEFAULT_CONFIG_DIR
        self.defaults_directory = self.directory / "defaults"
        self._config: AppConfig | None = None
        self._stamps: dict[str, float] = {}

    # -- пути ---------------------------------------------------------------
    def path_for(self, section: str) -> Path:
        return self.directory / f"{section}.yaml"

    def default_path_for(self, section: str) -> Path:
        return self.defaults_directory / f"{section}.yaml"

    # -- чтение -------------------------------------------------------------
    def raw(self, section: str) -> dict[str, Any]:
        """Сырое содержимое раздела — для редактора конфигурации."""
        if section not in CONFIG_SCHEMAS:
            raise ConfigError(section, self.path_for(section), "неизвестный раздел конфигурации")
        return _read_yaml(section, self.path_for(section))

    def raw_text(self, section: str) -> str:
        path = self.path_for(section)
        if not path.exists():
            raise ConfigError(section, path, "файл не найден")
        return path.read_text(encoding="utf-8")

    def load(self) -> AppConfig:
        """Прочитать и проверить все разделы заново."""
        parsed: dict[str, BaseModel] = {}
        stamps: dict[str, float] = {}
        for section in CONFIG_SCHEMAS:
            path = self.path_for(section)
            raw = _read_yaml(section, path)
            parsed[section] = _validate(section, path, raw)
            stamps[section] = path.stat().st_mtime_ns
        config = AppConfig(**parsed)
        self._config = config
        self._stamps = stamps
        return config

    def get(self) -> AppConfig:
        """Актуальная конфигурация; перечитывает изменённые файлы."""
        if self._config is None or self._changed_on_disk():
            return self.load()
        return self._config

    def reload(self) -> AppConfig:
        """Принудительно перечитать конфигурацию."""
        return self.load()

    def _changed_on_disk(self) -> bool:
        for section in CONFIG_SCHEMAS:
            path = self.path_for(section)
            if not path.exists():
                return True
            if self._stamps.get(section) != path.stat().st_mtime_ns:
                return True
        return False

    # -- запись -------------------------------------------------------------
    def save(self, section: str, data: dict[str, Any]) -> AppConfig:
        """Проверить и записать раздел; при ошибке файл не меняется."""
        path = self.path_for(section)
        _validate(section, path, data)
        payload = yaml.safe_dump(
            copy.deepcopy(data), allow_unicode=True, sort_keys=False, default_flow_style=False
        )
        path.write_text(payload, encoding="utf-8")
        return self.load()

    def save_text(self, section: str, text: str) -> AppConfig:
        """Записать раздел из текста YAML (редактор конфигурации в UI)."""
        path = self.path_for(section)
        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ConfigError(section, path, f"некорректный YAML: {exc}") from exc
        if not isinstance(data, dict):
            raise ConfigError(section, path, "ожидался словарь на верхнем уровне")
        _validate(section, path, data)
        path.write_text(text, encoding="utf-8")
        return self.load()

    def reset_section(self, section: str) -> AppConfig:
        """Вернуть раздел к эталонным значениям из ``config/defaults/``."""
        source = self.default_path_for(section)
        if not source.exists():
            raise ConfigError(section, source, "эталонный файл не найден")
        self.path_for(section).write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        return self.load()

    def reset_all(self) -> AppConfig:
        for section in CONFIG_SCHEMAS:
            source = self.default_path_for(section)
            if source.exists():
                self.path_for(section).write_text(
                    source.read_text(encoding="utf-8"), encoding="utf-8"
                )
        return self.load()

    def sections(self) -> list[str]:
        return list(CONFIG_SCHEMAS)


#: Общий экземпляр для приложения.
_STORE: ConfigStore | None = None


def get_store(directory: Path | str | None = None) -> ConfigStore:
    """Ленивый общий :class:`ConfigStore`."""
    global _STORE
    if _STORE is None or directory is not None:
        _STORE = ConfigStore(directory)
    return _STORE


def load_config(directory: Path | str | None = None) -> AppConfig:
    """Быстрый доступ к конфигурации (используется в cli и тестах)."""
    return get_store(directory).get()
