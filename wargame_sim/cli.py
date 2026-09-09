#!/usr/bin/env python3
"""Прогон сценария без интерфейса — точка калибровки коэффициентов (§12).

Примеры:
    python cli.py --demo --seed 42
    python cli.py --scenario data/scenarios/x.json --seed 42 --runs 100
    python cli.py --demo --runs 200 --out data/results/batch.md --csv data/results/batch.csv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.batch import run_batch  # noqa: E402
from core.config import ConfigError, ConfigStore  # noqa: E402
from core.engine import BattleEngine  # noqa: E402
from core.report import (  # noqa: E402
    batch_csv,
    batch_markdown,
    batch_text,
    outcome_text,
    result_csv,
    result_markdown,
)
from core.samples import make_scenario  # noqa: E402
from core.storage import (  # noqa: E402
    StorageError,
    load_scenario,
    save_batch,
    save_result,
    save_scenario,
    write_text,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cli.py",
        description="Симулятор боя: прогон сценария без интерфейса.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--scenario", type=Path, help="путь к JSON-сценарию")
    source.add_argument(
        "--demo", action="store_true", help="использовать демонстрационный сценарий"
    )
    parser.add_argument("--seed", type=int, help="master_seed (переопределяет сценарий)")
    parser.add_argument("--runs", type=int, default=1, help="число прогонов")
    parser.add_argument("--config", type=Path, help="каталог с YAML-конфигом")
    parser.add_argument("--processes", type=int, help="процессов для массового прогона")
    parser.add_argument("--out", type=Path, help="файл отчёта (.md)")
    parser.add_argument("--csv", type=Path, help="файл таблицы (.csv)")
    parser.add_argument("--json", type=Path, help="файл результата (.json)")
    parser.add_argument("--log", action="store_true", help="печатать журнал боя")
    parser.add_argument(
        "--save", action="store_true", help="сохранить результат в data/results"
    )
    parser.add_argument(
        "--save-demo-scenario",
        action="store_true",
        help="записать демонстрационный сценарий в data/scenarios",
    )
    parser.add_argument(
        "--symmetric",
        action="store_true",
        help="демо-сценарий из двух одинаковых батальонов (проверка баланса)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        store = ConfigStore(args.config)
        config = store.load()
    except ConfigError as error:
        print(f"Конфигурация не загружена.\n{error}", file=sys.stderr)
        return 2

    try:
        if args.scenario:
            scenario = load_scenario(args.scenario)
        else:
            scenario = make_scenario(config, symmetric=args.symmetric)
    except StorageError as error:
        print(f"Сценарий не загружен: {error}", file=sys.stderr)
        return 2

    if args.seed is not None:
        scenario.master_seed = args.seed

    if args.save_demo_scenario:
        path = save_scenario(scenario)
        print(f"Сценарий сохранён: {path}")

    if args.runs <= 1:
        engine = BattleEngine(scenario, config, verbose=True)
        result = engine.run()
        print(outcome_text(result))
        if args.log:
            print()
            print(engine.log.to_markdown())
        if args.out:
            write_text(args.out, result_markdown(result))
            print(f"Отчёт: {args.out}")
        if args.csv:
            write_text(args.csv, result_csv(result))
            print(f"Таблица: {args.csv}")
        if args.json:
            write_text(args.json, result.model_dump_json(indent=2))
            print(f"Результат: {args.json}")
        if args.save:
            print(f"Результат сохранён: {save_result(result)}")
        return 0

    total = args.runs
    last_percent = -1

    def progress(done: int, count: int) -> None:
        nonlocal last_percent
        percent = int(100 * done / count)
        if percent != last_percent:
            last_percent = percent
            print(f"\rПрогон {done}/{count} ({percent}%)", end="", file=sys.stderr)

    batch = run_batch(
        scenario,
        config,
        runs=total,
        base_seed=scenario.master_seed,
        processes=args.processes,
        progress=progress,
        config_dir=args.config,
    )
    print("\r" + " " * 40 + "\r", end="", file=sys.stderr)
    print(batch_text(batch))

    if args.out:
        write_text(args.out, batch_markdown(batch))
        print(f"Отчёт: {args.out}")
    if args.csv:
        write_text(args.csv, batch_csv(batch))
        print(f"Таблица: {args.csv}")
    if args.json:
        write_text(args.json, batch.model_dump_json(indent=2))
        print(f"Результат: {args.json}")
    if args.save:
        path = save_batch(batch, Path("data/results") / f"batch_{batch.scenario_id}.json")
        print(f"Сводка сохранена: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
