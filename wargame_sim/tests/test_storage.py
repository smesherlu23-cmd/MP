"""Хранение: JSON, версионирование схемы, понятные ошибки (§11)."""

from __future__ import annotations

import json
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
    scan_battalions,
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


def test_broken_file_is_reported_not_swallowed(tmp_path: Path, scenario) -> None:
    """Нечитаемый файл попадает в `broken`, а не исчезает из списка молча.

    Молчаливый пропуск выглядел для ГМ как «подразделение пропало»:
    файл на диске есть, а в списке его нет, и почему — неизвестно.
    """
    save_battalion(scenario.battalion_a, tmp_path)
    (tmp_path / "broken.json").write_text("{не json", encoding="utf-8")
    (tmp_path / "future.json").write_text('{"schema_version": 999}', encoding="utf-8")

    scan = scan_battalions(tmp_path)
    assert [battalion.id for _, battalion in scan.items] == [scenario.battalion_a.id]
    assert {path.name for path, _ in scan.broken} == {"broken.json", "future.json"}
    assert any("повреждённый JSON" in reason for _, reason in scan.broken)
    assert any("999" in reason for _, reason in scan.broken)

    # Старый список по-прежнему отдаёт только читаемое.
    assert len(list_battalions(tmp_path)) == 1


def test_battle_survives_being_put_away(tmp_path: Path, scenario, config) -> None:
    """Снимок поднимает бой там же, где его бросили, и теми же бросками.

    Бой жил только в памяти: закрытое окно стоило пятнадцати ходов.
    Снимок делается на границе хода, поэтому продолженный бой идёт
    ровно так же, как непрерывный, — это и проверяется.
    """
    from core.engine import BattleEngine
    from core.storage import load_battle, save_battle, scan_battles

    straight = BattleEngine(scenario, config, verbose=False)
    straight.run()

    engine = BattleEngine(scenario, config, verbose=False)
    engine.run_turns(6)
    path = save_battle(engine.snapshot(), tmp_path)
    resumed = BattleEngine.from_snapshot(load_battle(path), config, verbose=False)
    resumed.run()

    assert resumed.state.turn == straight.state.turn
    assert resumed.winner == straight.winner
    assert resumed.end_reason == straight.end_reason
    for side in ("A", "B"):
        assert (
            resumed.state.side(side).total_personnel_lost()
            == straight.state.side(side).total_personnel_lost()
        )
    found = scan_battles(tmp_path)
    assert len(found.items) == 1 and not found.broken


def test_snapshot_keeps_the_journal(tmp_path: Path, scenario, config) -> None:
    """Поднятый бой продолжает прежний журнал, а не начинает пустой."""
    from core.engine import BattleEngine
    from core.storage import load_battle, save_battle

    engine = BattleEngine(scenario, config)
    engine.run_turns(4)
    written = len(engine.log)
    path = save_battle(engine.snapshot(), tmp_path)

    resumed = BattleEngine.from_snapshot(load_battle(path), config)
    assert len(resumed.log) == written
    resumed.step()
    assert len(resumed.log) > written


def test_saving_a_battle_stays_cheap(tmp_path: Path, scenario, config) -> None:
    """Сохранение после команды не переписывает весь журнал.

    За бой журнал набирает около 3500 записей. Полная перезапись стоила
    240 мс — на каждую команду ГМ, а команд за бой десятки. Журнал живёт
    отдельным файлом и дописывается, состояние пишется без него.
    """
    import time

    from core.engine import BattleEngine
    from core.storage import save_battle

    engine = BattleEngine(scenario, config)
    engine.run_turns(8)
    path = save_battle(engine.snapshot(), tmp_path)
    log_path = path.with_suffix(".log.jsonl")
    assert log_path.exists() and len(engine.log) > 500

    # Команда добавляет одну запись — сохранение обязано быть почти даром.
    engine.set_order("A", engine.state.battalion("A").leaf_elements[0].id, None)
    start = time.perf_counter()
    save_battle(engine.snapshot(), tmp_path)
    elapsed = (time.perf_counter() - start) * 1000
    assert elapsed < 60, f"сохранение после команды заняло {elapsed:.0f} мс"

    head = json.loads(path.read_text(encoding="utf-8"))
    assert head["log"] == [], "журнал не должен дублироваться в файле состояния"
    assert head["log_entries"] == len(engine.log)


def test_restarting_a_battle_does_not_keep_the_old_journal(
    tmp_path: Path, scenario, config
) -> None:
    """Бой начали заново — журнал обнуляется, а не дописывается к прежнему."""
    from core.engine import BattleEngine
    from core.storage import load_battle, save_battle

    engine = BattleEngine(scenario, config)
    engine.run_turns(6)
    path = save_battle(engine.snapshot(), tmp_path)
    long_log = len(engine.log)

    fresh = BattleEngine(scenario, config)
    fresh.run_turns(1)
    save_battle(fresh.snapshot(), tmp_path)

    restored = load_battle(path)
    assert restored.turn == 1
    assert len(restored.log) == len(fresh.log) < long_log
