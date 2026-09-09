"""Загрузка, валидация, hot-reload и сброс конфигурации (§5, §12)."""

from __future__ import annotations

import pytest
import yaml

from core.config import ConfigError, ConfigStore, Curve
from core.config.schema import CONFIG_SCHEMAS


def test_all_sections_load(config) -> None:
    assert set(CONFIG_SCHEMAS) == set(ConfigStore().sections())
    assert config.cbt.casualties.lethality > 0
    assert config.order("атака").attack > 0


def test_curve_interpolates_and_clamps() -> None:
    curve = Curve.model_validate([{"x": 0, "y": 0.5}, {"x": 100, "y": 1.5}])
    assert curve(-10) == pytest.approx(0.5)
    assert curve(50) == pytest.approx(1.0)
    assert curve(1000) == pytest.approx(1.5)


def test_curve_rejects_unsorted_points() -> None:
    with pytest.raises(ValueError, match="возрастанию"):
        Curve.model_validate([{"x": 10, "y": 1.0}, {"x": 0, "y": 0.5}])


def test_broken_yaml_gives_clear_error(config_copy: ConfigStore) -> None:
    """Битый YAML — понятное исключение, а не падение (§12)."""
    (config_copy.directory / "combat.yaml").write_text("combat: [не словарь", encoding="utf-8")
    with pytest.raises(ConfigError) as info:
        config_copy.load()
    assert "combat" in str(info.value)
    assert "YAML" in str(info.value)


def test_invalid_value_gives_clear_error(config_copy: ConfigStore) -> None:
    """Число вне допустимого диапазона объясняется по-человечески."""
    path = config_copy.directory / "morale.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["morale"]["thresholds"]["retreat"] = 900
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ConfigError) as info:
        config_copy.load()
    message = str(info.value)
    assert "morale" in message
    assert "retreat" in message


def test_missing_file_gives_clear_error(config_copy: ConfigStore) -> None:
    (config_copy.directory / "terrain.yaml").unlink()
    with pytest.raises(ConfigError, match="файл не найден"):
        config_copy.load()


def test_unknown_order_reports_known_ones(config) -> None:
    with pytest.raises(ConfigError) as info:
        config.order("вальс")
    assert "атака" in str(info.value)


def test_hot_reload_picks_up_changes(config_copy: ConfigStore) -> None:
    """Правка конфига применяется без перезапуска (§5)."""
    first = config_copy.get()
    original = first.cbt.casualties.lethality

    data = config_copy.raw("combat")
    data["combat"]["casualties"]["lethality"] = original * 2
    config_copy.save("combat", data)

    assert config_copy.get().cbt.casualties.lethality == pytest.approx(original * 2)


def test_save_rejects_invalid_data_without_touching_file(config_copy: ConfigStore) -> None:
    before = config_copy.raw_text("combat")
    data = config_copy.raw("combat")
    data["combat"]["casualties"]["cap_per_turn"] = 5.0  # допустимо только 0..1
    with pytest.raises(ConfigError):
        config_copy.save("combat", data)
    assert config_copy.raw_text("combat") == before


def test_reset_section_restores_defaults(config_copy: ConfigStore) -> None:
    """Кнопка «сбросить к значениям по умолчанию» (§5)."""
    default_value = config_copy.get().cbt.casualties.lethality
    data = config_copy.raw("combat")
    data["combat"]["casualties"]["lethality"] = 0.999
    config_copy.save("combat", data)
    assert config_copy.get().cbt.casualties.lethality == pytest.approx(0.999)

    config_copy.reset_section("combat")
    assert config_copy.get().cbt.casualties.lethality == pytest.approx(default_value)


def test_defaults_directory_is_never_overwritten(config_copy: ConfigStore) -> None:
    reference = config_copy.default_path_for("combat").read_text(encoding="utf-8")
    data = config_copy.raw("combat")
    data["combat"]["casualties"]["lethality"] = 0.5
    config_copy.save("combat", data)
    assert config_copy.default_path_for("combat").read_text(encoding="utf-8") == reference
