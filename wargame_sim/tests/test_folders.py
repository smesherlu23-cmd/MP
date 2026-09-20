"""Папки библиотек: дерево, переименование, перенос, удаление."""

from __future__ import annotations

import pytest
import yaml

from core.config import ConfigStore
from core.config.folders import create, is_inside, move, name_of, parent_of, remove, rename, tree
from core.config.introspect import PatchError


def _load(text: str) -> dict:
    return yaml.safe_load(text)


def test_tree_fills_in_missing_levels() -> None:
    """Папка «Броня/Танки» видна, даже если «Броня» отдельно не объявлена."""
    assert tree(["Броня/Танки"]) == ["Броня", "Броня/Танки"]


def test_path_helpers() -> None:
    assert parent_of("Броня/Танки") == "Броня"
    assert parent_of("Броня") == ""
    assert name_of("Броня/Танки") == "Танки"
    assert is_inside("Броня/Танки", "Броня")
    assert not is_inside("Бронемашины", "Броня")


def test_create_makes_a_nested_folder(config_copy: ConfigStore) -> None:
    text, path = create(config_copy.raw_text("vehicles"), config_copy.raw("vehicles"), "Танки", "Основные")
    assert path == "Танки/Основные"
    assert "Танки/Основные" in _load(text)["folders"]


def test_rename_moves_subfolders_and_entries(config_copy: ConfigStore) -> None:
    text = config_copy.raw_text("vehicles")
    raw = config_copy.raw("vehicles")
    text, _ = create(text, raw, "Танки", "Основные")
    raw = _load(text)

    text, path = rename(text, raw, "vehicles", "Танки", "Бронетехника")
    result = _load(text)

    assert path == "Бронетехника"
    assert "Бронетехника/Основные" in result["folders"]
    assert result["vehicles"]["Танк"]["folder"] == "Бронетехника"
    assert "# crew           — экипаж" in text  # пояснения на месте


def test_move_forbids_putting_a_folder_into_itself(config_copy: ConfigStore) -> None:
    text = config_copy.raw_text("vehicles")
    raw = config_copy.raw("vehicles")
    text, _ = create(text, raw, "Танки", "Основные")
    raw = _load(text)
    with pytest.raises(PatchError):
        move(text, raw, "vehicles", "Танки", "Танки/Основные")


def test_move_nests_a_folder(config_copy: ConfigStore) -> None:
    text, path = move(
        config_copy.raw_text("vehicles"), config_copy.raw("vehicles"), "vehicles", "Танки", "Транспорт"
    )
    result = _load(text)
    assert path == "Транспорт/Танки"
    assert result["vehicles"]["Танк"]["folder"] == "Транспорт/Танки"


def test_remove_lifts_the_contents_one_level(config_copy: ConfigStore) -> None:
    """Удаление папки ничего не теряет — содержимое поднимается выше."""
    text = config_copy.raw_text("vehicles")
    raw = config_copy.raw("vehicles")
    text, _ = create(text, raw, "Танки", "Основные")
    raw = _load(text)

    text = remove(text, raw, "vehicles", "Танки")
    result = _load(text)

    assert "Танки" not in result["folders"]
    assert "Основные" in result["folders"]
    assert result["vehicles"]["Танк"]["folder"] == ""
    # запись никуда не делась
    assert set(result["vehicles"]) == set(raw["vehicles"])


def test_folder_operations_survive_validation(config_copy: ConfigStore) -> None:
    """После любой операции файл остаётся валидным для pydantic."""
    text = config_copy.raw_text("vehicles")
    raw = config_copy.raw("vehicles")
    text, _ = create(text, raw, "", "Трофеи")
    config_copy.save_text("vehicles", text)
    assert "Трофеи" in config_copy.get().vehicles.folders
