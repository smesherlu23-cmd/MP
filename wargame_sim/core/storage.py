"""Чтение и запись данных: подразделения, сценарии, результаты (§11).

Формат — JSON с полем ``schema_version``; файлы читаемы и правятся руками.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from core.models import (
    SCHEMA_VERSION,
    BatchResult,
    Battalion,
    BattleResult,
    BattleSnapshot,
    Scenario,
)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
UNITS_DIR = DATA_DIR / "units"
SCENARIOS_DIR = DATA_DIR / "scenarios"
RESULTS_DIR = DATA_DIR / "results"
BATTLES_DIR = DATA_DIR / "battles"

T = TypeVar("T", bound=BaseModel)


class StorageError(Exception):
    """Ошибка чтения или записи файла данных."""


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "_", value, flags=re.UNICODE).strip("_")
    return cleaned or "item"


def ensure_dirs(base: Path | None = None) -> None:
    """Создать каталоги данных, если их нет."""
    root = base or DATA_DIR
    for directory in (
        root / "units",
        root / "scenarios",
        root / "results",
        root / "battles",
    ):
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


@dataclass(frozen=True)
class Scan(Generic[T]):
    """Содержимое каталога: что прочиталось и что не прочиталось.

    Молча пропускать битый файл нельзя: для ГМ подразделение просто
    исчезает из списка, и он не знает, что файл на диске есть, но не
    читается. Поэтому причина отказа доходит до интерфейса.
    """

    items: list[tuple[Path, T]]
    broken: list[tuple[Path, str]]


def scan_models(
    model: type[T], directory: Path, *, newest_first: bool = False
) -> Scan[T]:
    """Прочитать все JSON каталога, запомнив причину по каждому отказу."""
    items: list[tuple[Path, T]] = []
    broken: list[tuple[Path, str]] = []
    if not directory.exists():
        return Scan(items, broken)
    for path in sorted(directory.glob("*.json"), reverse=newest_first):
        try:
            items.append((path, load_model(model, path)))
        except StorageError as error:
            broken.append((path, str(error)))
    return Scan(items, broken)


# -- подразделения ----------------------------------------------------------
def save_battalion(battalion: Battalion, directory: Path | None = None) -> Path:
    directory = directory or UNITS_DIR
    path = directory / f"{_slug(battalion.id)}.json"
    return save_model(battalion, path)


def load_battalion(path: Path) -> Battalion:
    return load_model(Battalion, path)


def scan_battalions(directory: Path | None = None) -> Scan[Battalion]:
    """Подразделения и причины по нечитаемым файлам."""
    return scan_models(Battalion, directory or UNITS_DIR)


def list_battalions(directory: Path | None = None) -> list[tuple[Path, Battalion]]:
    """Только читаемые подразделения; про остальные спросите `scan_battalions`."""
    return scan_battalions(directory).items


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


def scan_scenarios(directory: Path | None = None) -> Scan[Scenario]:
    return scan_models(Scenario, directory or SCENARIOS_DIR)


def list_scenarios(directory: Path | None = None) -> list[tuple[Path, Scenario]]:
    return scan_scenarios(directory).items


# -- результаты -------------------------------------------------------------
def save_result(result: BattleResult, directory: Path | None = None) -> Path:
    directory = directory or RESULTS_DIR
    path = directory / f"{_slug(result.id)}.json"
    return save_model(result, path)


def load_result(path: Path) -> BattleResult:
    return load_model(BattleResult, path)


def scan_results(directory: Path | None = None) -> Scan[BattleResult]:
    """Результаты — новые сверху — и причины по нечитаемым файлам."""
    return scan_models(BattleResult, directory or RESULTS_DIR, newest_first=True)


def list_results(directory: Path | None = None) -> list[tuple[Path, BattleResult]]:
    return scan_results(directory).items


# -- бой в процессе ---------------------------------------------------------
def _log_path(path: Path) -> Path:
    """Журнал лежит рядом с состоянием, отдельным файлом."""
    return path.with_suffix(".log.jsonl")


def save_battle(snapshot: BattleSnapshot, directory: Path | None = None) -> Path:
    """Сохранить бой целиком — с него он и поднимется.

    Раньше бой жил только в памяти: закрыли окно на пятнадцатом ходу — и
    нет ни журнала, ни потерь, ни перестроений.

    Журнал пишется **отдельным файлом и дописыванием**. За бой он набирает
    около 3500 записей, и полная перезапись стоила 240 мс — на каждую
    команду ГМ, а команд за бой десятки. Состояние без журнала — 20 КиБ и
    пара миллисекунд, дописать несколько строк — столько же.
    """
    directory = directory or BATTLES_DIR
    path = directory / f"{_slug(snapshot.id)}.json"
    log_path = _log_path(path)

    # Сколько записей уже лежит на диске — берётся из файла состояния, а не
    # пересчётом строк журнала: считать три с половиной тысячи строк на
    # каждую команду ГМ значит вернуть ту же задержку, от которой уходили.
    written = 0
    if path.exists() and log_path.exists():
        try:
            written = int(read_json(path).get("log_entries", 0))
        except (StorageError, TypeError, ValueError):
            written = 0
    # Бой начали заново: на диске записей больше, чем в памяти.
    if written > len(snapshot.log) or not log_path.exists():
        log_path.unlink(missing_ok=True)
        written = 0

    path.parent.mkdir(parents=True, exist_ok=True)
    if written < len(snapshot.log):
        with log_path.open("a", encoding="utf-8") as handle:
            for entry in snapshot.log[written:]:
                handle.write(
                    json.dumps(entry.model_dump(mode="json"), ensure_ascii=False) + "\n"
                )

    # Журнал из дампа исключается, а не обнуляется после: сериализовать
    # три с половиной тысячи записей, чтобы тут же их выбросить, — это и
    # были те самые десятки миллисекунд на каждую команду.
    head = snapshot.model_dump(mode="json", exclude={"log"})
    head["log"] = []
    head["log_entries"] = len(snapshot.log)
    return write_json(path, head)


def load_battle(path: Path) -> BattleSnapshot:
    """Прочитать бой: состояние из ``.json``, журнал из соседнего ``.jsonl``."""
    data = read_json(path)
    _check_version(path, data)
    data.pop("log_entries", None)
    log_path = _log_path(path)
    if log_path.exists():
        data["log"] = [
            json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line
        ]
    try:
        return BattleSnapshot.model_validate(data)
    except ValidationError as exc:
        details = "; ".join(
            f"{' → '.join(str(part) for part in item['loc'])}: {item['msg']}"
            for item in exc.errors()
        )
        raise StorageError(f"{path}: не соответствует схеме ({details})") from exc


def delete_battle(path: Path) -> None:
    """Убрать бой вместе с его журналом."""
    delete_file(path)
    _log_path(path).unlink(missing_ok=True)


def scan_battles(directory: Path | None = None) -> Scan[BattleSnapshot]:
    """Сохранённые бои — новые сверху — и причины по нечитаемым файлам."""
    directory = directory or BATTLES_DIR
    items: list[tuple[Path, BattleSnapshot]] = []
    broken: list[tuple[Path, str]] = []
    if not directory.exists():
        return Scan(items, broken)
    for path in sorted(directory.glob("*.json"), reverse=True):
        if path.name.endswith(".log.jsonl"):
            continue
        try:
            items.append((path, load_battle(path)))
        except StorageError as error:
            broken.append((path, str(error)))
    return Scan(items, broken)


def save_batch(batch: BatchResult, path: Path) -> Path:
    return save_model(batch, path)


# -- текстовый экспорт ------------------------------------------------------
def write_text(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path
