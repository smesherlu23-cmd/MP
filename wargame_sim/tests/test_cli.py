"""Прогон без интерфейса (§12)."""

from __future__ import annotations

from pathlib import Path

import cli


def test_single_battle_prints_outcome(capsys, tmp_path: Path) -> None:
    code = cli.main(["--demo", "--seed", "42"])
    assert code == 0
    output = capsys.readouterr().out
    assert "Бой окончен" in output
    assert "Сид: 42" in output


def test_single_battle_writes_files(tmp_path: Path) -> None:
    report = tmp_path / "report.md"
    table = tmp_path / "table.csv"
    payload = tmp_path / "result.json"
    assert cli.main(
        ["--demo", "--seed", "5", "--out", str(report), "--csv", str(table), "--json", str(payload)]
    ) == 0
    assert "# Бой" in report.read_text(encoding="utf-8")
    assert "сторона;элемент" in table.read_text(encoding="utf-8")
    assert '"master_seed": 5' in payload.read_text(encoding="utf-8")


def test_batch_run(capsys, tmp_path: Path) -> None:
    summary = tmp_path / "batch.md"
    assert cli.main(
        ["--demo", "--runs", "6", "--processes", "1", "--seed", "3", "--out", str(summary)]
    ) == 0
    output = capsys.readouterr().out
    assert "Победа A" in output
    assert "прогонов 6" in output
    assert "## Вероятности исходов" in summary.read_text(encoding="utf-8")


def test_same_seed_same_console_output(capsys) -> None:
    cli.main(["--demo", "--seed", "77"])
    first = capsys.readouterr().out
    cli.main(["--demo", "--seed", "77"])
    assert capsys.readouterr().out == first


def test_missing_scenario_reports_error(capsys, tmp_path: Path) -> None:
    code = cli.main(["--scenario", str(tmp_path / "нет.json")])
    assert code == 2
    assert "Сценарий не загружен" in capsys.readouterr().err


def test_broken_config_reports_error(capsys, tmp_path: Path) -> None:
    (tmp_path / "combat.yaml").write_text("combat: [", encoding="utf-8")
    code = cli.main(["--demo", "--config", str(tmp_path)])
    assert code == 2
    assert "Конфигурация не загружена" in capsys.readouterr().err


def test_scenario_file_round_trip(tmp_path: Path, scenario) -> None:
    from core.storage import save_scenario

    path = save_scenario(scenario, tmp_path)
    assert cli.main(["--scenario", str(path), "--seed", "9"]) == 0
