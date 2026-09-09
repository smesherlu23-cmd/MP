"""Хранение: JSON, версионирование схемы, понятные ошибки (§11)."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.engine import run_battle
from core.models import SCHEMA_VERSION, Battalion
from core.storage import (
    StorageError,
    ensure_dirs,
    list_battalions,
    list_scenarios,
    load_battalion,
    load_result,
    load_scenario,
    save_battalion,
    save_result,
    save_scenario,
)


def test_battalion_round_trip(tmp_path: Path, scenario) -> None:
    path = save_battalion(scenario.battalion_a, tmp_path)
    loaded = load_battalion(path)
    assert loaded == scenario.battalion_a
    assert loaded.schema_version == SCHEMA_VERSION


def test_scenario_round_trip(tmp_path: Path, scenario) -> None:
    path = save_scenario(scenario, tmp_path)
    assert load_scenario(path) == scenario


def test_result_round_trip(tmp_path: Path, scenario, config) -> None:
    result = run_battle(scenario, config)
    path = save_result(result, tmp_path)
    loaded = load_result(path)
    assert loaded.log_hash == result.log_hash
    assert len(loaded.log) == len(result.log)


def test_files_are_human_readable(tmp_path: Path, scenario) -> None:
    """Файлы читаемые и правятся руками вне программы (§11)."""
    path = save_scenario(scenario, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert "\n  " in text  # отступы
    assert scenario.battalion_a.name in text  # кириллица не экранирована


def test_listing_skips_broken_files(tmp_path: Path, scenario) -> None:
    save_battalion(scenario.battalion_a, tmp_path)
    (tmp_path / "broken.json").write_text("{не json", encoding="utf-8")
    items = list_battalions(tmp_path)
    assert len(items) == 1


def test_missing_file_message(tmp_path: Path) -> None:
    with pytest.raises(StorageError, match="файл не найден"):
        load_battalion(tmp_path / "нет.json")


def test_schema_mismatch_message(tmp_path: Path, scenario) -> None:
    path = save_battalion(scenario.battalion_a, tmp_path)
    data = path.read_text(encoding="utf-8").replace(
        f'"schema_version": {SCHEMA_VERSION}', f'"schema_version": {SCHEMA_VERSION + 5}'
    )
    path.write_text(data, encoding="utf-8")
    with pytest.raises(StorageError, match="понимает до"):
        load_battalion(path)


def test_invalid_content_message(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text('{"schema_version": 1, "id": "x"}', encoding="utf-8")
    with pytest.raises(StorageError, match="не соответствует схеме"):
        load_battalion(path)


def test_ensure_dirs(tmp_path: Path) -> None:
    ensure_dirs(tmp_path)
    assert (tmp_path / "units").is_dir()
    assert (tmp_path / "scenarios").is_dir()
    assert (tmp_path / "results").is_dir()


def test_empty_listings(tmp_path: Path) -> None:
    assert list_scenarios(tmp_path) == []
    assert list_battalions(tmp_path) == []


def test_battalion_rejects_duplicate_element_ids(scenario) -> None:
    elements = [scenario.battalion_a.elements[0], scenario.battalion_a.elements[0]]
    with pytest.raises(ValueError, match="повторяющиеся id"):
        Battalion(id="x", name="x", elements=elements)
