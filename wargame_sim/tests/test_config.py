"""Загрузка, валидация, hot-reload и сброс конфигурации (§5, §12)."""

from __future__ import annotations

import pytest
import yaml

from core.config import ConfigError, ConfigStore, Curve, introspect
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


# --------------------------------------------------------------------------
# Разбор по схеме и точечная правка текста (редактор коэффициентов)
# --------------------------------------------------------------------------
def test_describe_covers_every_scalar_of_a_section(config_copy: ConfigStore) -> None:
    """Редактор показывает ровно то, что лежит в файле, — ничего не теряя."""
    raw = config_copy.raw("combat")
    groups = introspect.describe("combat", raw)
    shown = {field.dotted for group in groups for field in group.fields}
    expected = set(introspect.flatten(raw)) - {"schema_version"}
    assert shown == expected


def test_describe_takes_bounds_from_schema(config_copy: ConfigStore) -> None:
    groups = introspect.describe("combat", config_copy.raw("combat"))
    fields = {field.dotted: field for group in groups for field in group.fields}
    cap = fields["combat.casualties.cap_per_turn"]
    assert (cap.minimum, cap.maximum) == (0.0, 1.0)
    assert fields["combat.detection.intel_levels"].kind == introspect.KIND_LIST
    assert fields["combat.curves.cohesion"].kind == introspect.KIND_CURVE


def test_describe_handles_numeric_keys(config_copy: ConfigStore) -> None:
    """Уровни опыта в YAML — числа; путь всё равно строковый."""
    groups = introspect.describe("experience", config_copy.raw("experience"))
    assert any(group.dotted == "experience.1" for group in groups)


def test_patch_scalar_keeps_comments_and_order(config_copy: ConfigStore) -> None:
    """Правка одного числа не должна стирать пояснения в конфиге."""
    before = config_copy.raw_text("combat")
    after = introspect.patch_scalar(before, ("combat", "casualties", "lethality"), 0.031)
    config_copy.save_text("combat", after)

    assert config_copy.get().cbt.casualties.lethality == pytest.approx(0.031)
    assert "# k_летальность" in after
    assert after.count("\n") == before.count("\n")
    assert yaml.safe_load(after)["combat"]["vehicles"] == yaml.safe_load(before)["combat"]["vehicles"]


def test_patch_scalar_writes_booleans_and_strings(config_copy: ConfigStore) -> None:
    toggles = introspect.patch_scalar(config_copy.raw_text("toggles"), ("toggles", "fuel"), False)
    config_copy.save_text("toggles", toggles)
    assert config_copy.get().tog.fuel is False

    types = introspect.patch_scalar(
        config_copy.raw_text("element_types"),
        ("element_types", "стрелковая_рота", "label"),
        "Стрелковая рота (штат)",
    )
    config_copy.save_text("element_types", types)
    assert config_copy.get().element_type("стрелковая_рота").label == "Стрелковая рота (штат)"


def test_patch_scalar_reports_unknown_path(config_copy: ConfigStore) -> None:
    with pytest.raises(introspect.PatchError):
        introspect.patch_scalar(config_copy.raw_text("combat"), ("combat", "выдумка"), 1)


def test_differences_finds_changed_values(config_copy: ConfigStore) -> None:
    defaults = yaml.safe_load(
        config_copy.default_path_for("combat").read_text(encoding="utf-8")
    )
    assert introspect.differences(config_copy.raw("combat"), defaults) == []

    data = config_copy.raw("combat")
    data["combat"]["casualties"]["lethality"] = 0.999
    config_copy.save("combat", data)
    assert introspect.differences(config_copy.raw("combat"), defaults) == [
        "combat.casualties.lethality"
    ]


def test_append_and_remove_entry_keep_the_file_intact(config_copy: ConfigStore) -> None:
    """Создание и удаление записи не должны стирать пояснения в конфиге."""
    before = config_copy.raw_text("vehicles")
    fields = {
        "label": "Бронированный тягач",
        "class": "транспорт",
        "crew": 2,
        "armour_front": 15.0,
        "armour_side": 10.0,
        "firepower": 0.0,
        "anti_tank": 0.0,
        "mobility": 55.0,
        "visibility": 50.0,
        "reliability": 85.0,
        "fuel_use": 1.1,
        "transport": 6,
    }
    added = introspect.append_entry(before, ("vehicles",), "Тягач", fields)
    config_copy.save_text("vehicles", added)
    assert config_copy.get().vehicle("Тягач").crew == 2
    assert "# crew           — экипаж" in added

    removed = introspect.remove_entry(added, ("vehicles", "Тягач"))
    assert removed == before  # обход туда-обратно не оставляет следов


def test_remove_entry_reports_unknown_path(config_copy: ConfigStore) -> None:
    with pytest.raises(introspect.PatchError):
        introspect.remove_entry(config_copy.raw_text("vehicles"), ("vehicles", "Звездолёт"))
