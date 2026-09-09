"""Чтение и запись данных: подразделения, сценарии, результаты (§11).

Формат — JSON с полем ``schema_version``; файлы читаемы и правятся руками.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from core.models import SCHEMA_VERSION, BatchResult, Battalion, BattleResult, Scenario

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
UNITS_DIR = DATA_DIR / "units"
SCENARIOS_DIR = DATA_DIR / "scenarios"
RESULTS_DIR = DATA_DIR / "results"

T = TypeVar("T", bound=BaseModel)


class StorageError(Exception):
    """Ошибка чтения или записи файла данных."""


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "_", value, flags=re.UNICODE).strip("_")
    return cleaned or "item"


def ensure_dirs(base: Path | None = None) -> None:
    """Создать каталоги данных, если их нет."""
    root = base or DATA_DIR
    for directory in (root / "units", root / "scenarios", root / "results"):
        directory.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: dict[str, Any]) -> Path:
    """Записать словарь в JSON (UTF-8, с отступами)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return path


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise StorageError(f"файл не найден: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise StorageError(f"повреждённый JSON в {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise StorageError(f"ожидался объект JSON в {path}")
    return data


def _check_version(path: Path, data: dict[str, Any]) -> None:
    version = data.get("schema_version", SCHEMA_VERSION)
    if not isinstance(version, int):
        raise StorageError(f"{path}: некорректное schema_version")
    if version > SCHEMA_VERSION:
        raise StorageError(
            f"{path}: файл версии {version}, программа понимает до {SCHEMA_VERSION}"
        )


def load_model(model: type[T], path: Path) -> T:
    """Прочитать модель из JSON с проверкой версии и понятной ошибкой."""
    data = read_json(path)
    _check_version(path, data)
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        details = "; ".join(
            f"{' → '.join(str(p) for p in item['loc'])}: {item['msg']}" for item in exc.errors()
        )
        raise StorageError(f"{path}: не соответствует схеме ({details})") from exc


def save_model(instance: BaseModel, path: Path) -> Path:
    return write_json(path, instance.model_dump(mode="json"))


# -- подразделения ----------------------------------------------------------
def save_battalion(battalion: Battalion, directory: Path | None = None) -> Path:
    directory = directory or UNITS_DIR
    path = directory / f"{_slug(battalion.id)}.json"
    return save_model(battalion, path)


def load_battalion(path: Path) -> Battalion:
    return load_model(Battalion, path)


def list_battalions(directory: Path | None = None) -> list[tuple[Path, Battalion]]:
    """Все сохранённые подразделения; повреждённые файлы пропускаются."""
    directory = directory or UNITS_DIR
    items: list[tuple[Path, Battalion]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            items.append((path, load_battalion(path)))
        except StorageError:
            continue
    return items


def delete_file(path: Path) -> None:
    if path.exists():
        path.unlink()


# -- сценарии ---------------------------------------------------------------
def save_scenario(scenario: Scenario, directory: Path | None = None) -> Path:
    directory = directory or SCENARIOS_DIR
    path = directory / f"{_slug(scenario.id)}.json"
    return save_model(scenario, path)


def load_scenario(path: Path) -> Scenario:
    return load_model(Scenario, path)


def list_scenarios(directory: Path | None = None) -> list[tuple[Path, Scenario]]:
    directory = directory or SCENARIOS_DIR
    items: list[tuple[Path, Scenario]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            items.append((path, load_scenario(path)))
        except StorageError:
            continue
    return items


# -- результаты -------------------------------------------------------------
def save_result(result: BattleResult, directory: Path | None = None) -> Path:
    directory = directory or RESULTS_DIR
    path = directory / f"{_slug(result.id)}.json"
    return save_model(result, path)


def load_result(path: Path) -> BattleResult:
    return load_model(BattleResult, path)


def list_results(directory: Path | None = None) -> list[tuple[Path, BattleResult]]:
    directory = directory or RESULTS_DIR
    items: list[tuple[Path, BattleResult]] = []
    for path in sorted(directory.glob("*.json"), reverse=True):
        try:
            items.append((path, load_result(path)))
        except StorageError:
            continue
    return items


def save_batch(batch: BatchResult, path: Path) -> Path:
    return save_model(batch, path)


# -- текстовый экспорт ------------------------------------------------------
def write_text(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path
