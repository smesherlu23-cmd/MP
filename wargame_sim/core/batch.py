"""Массовое моделирование: N прогонов одного сценария со статистикой (§9).

Прогон ``i`` использует сид ``base_seed + i``, поэтому любой прогон из таблицы
воспроизводится точно — достаточно открыть его по сиду.
"""

from __future__ import annotations

import multiprocessing as mp
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

from core.config import AppConfig, ConfigStore
from core.engine.battle import BattleEngine
from core.models import BatchResult, Distribution, RunRecord, Scenario, Winner

#: Значения, разделяемые с рабочими процессами пула.
_WORKER_SCENARIO: Scenario | None = None
_WORKER_CONFIG: AppConfig | None = None

DEFAULT_RUNS = 100


def percentile(values: Sequence[float], fraction: float) -> float:
    """Перцентиль с линейной интерполяцией (без внешних зависимостей)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return float(ordered[low] * (1.0 - weight) + ordered[high] * weight)


def describe(values: Sequence[float]) -> Distribution:
    """Среднее, медиана и p10/p50/p90 для ряда значений."""
    if not values:
        empty = Distribution(mean=0, median=0, p10=0, p50=0, p90=0, minimum=0, maximum=0)
        return empty
    return Distribution(
        mean=round(sum(values) / len(values), 4),
        median=round(percentile(values, 0.5), 4),
        p10=round(percentile(values, 0.10), 4),
        p50=round(percentile(values, 0.50), 4),
        p90=round(percentile(values, 0.90), 4),
        minimum=round(float(min(values)), 4),
        maximum=round(float(max(values)), 4),
    )


def run_single(scenario: Scenario, config: AppConfig, index: int, base_seed: int) -> RunRecord:
    """Один прогон массового моделирования."""
    seed = base_seed + index
    result = BattleEngine(scenario, config, seed=seed, verbose=False).run()
    return RunRecord(
        index=index,
        seed=seed,
        winner=result.winner,
        end_reason=result.end_reason,
        turns=result.turns,
        losses_a=result.side_a.personnel_lost,
        losses_b=result.side_b.personnel_lost,
        loss_ratio_a=result.side_a.personnel_loss_ratio,
        loss_ratio_b=result.side_b.personnel_loss_ratio,
        vehicle_losses_a=result.side_a.vehicles_lost,
        vehicle_losses_b=result.side_b.vehicles_lost,
        combat_power_a=result.side_a.combat_power,
        combat_power_b=result.side_b.combat_power,
    )


def _init_worker(scenario_data: dict, config_dir: str | None) -> None:
    """Инициализация рабочего процесса: сценарий и конфиг читаются один раз."""
    global _WORKER_SCENARIO, _WORKER_CONFIG
    _WORKER_SCENARIO = Scenario.model_validate(scenario_data)
    _WORKER_CONFIG = ConfigStore(Path(config_dir) if config_dir else None).load()


def _run_index(payload: tuple[int, int]) -> RunRecord:
    index, base_seed = payload
    assert _WORKER_SCENARIO is not None and _WORKER_CONFIG is not None
    return run_single(_WORKER_SCENARIO, _WORKER_CONFIG, index, base_seed)


def summarise(
    scenario: Scenario, records: Iterable[RunRecord], base_seed: int
) -> BatchResult:
    """Свернуть прогоны в статистику (§9)."""
    rows = sorted(records, key=lambda record: record.index)
    total = len(rows) or 1
    winners = Counter(str(record.winner) for record in rows)
    reasons = Counter(str(record.end_reason) for record in rows)

    return BatchResult(
        scenario_id=scenario.id,
        scenario_name=scenario.name,
        runs=len(rows),
        base_seed=base_seed,
        win_probability_a=round(winners.get(str(Winner.A), 0) / total, 4),
        win_probability_b=round(winners.get(str(Winner.B), 0) / total, 4),
        draw_probability=round(winners.get(str(Winner.DRAW), 0) / total, 4),
        end_reasons=dict(sorted(reasons.items())),
        turns=describe([record.turns for record in rows]),
        losses_a=describe([record.losses_a for record in rows]),
        losses_b=describe([record.losses_b for record in rows]),
        vehicle_losses_a=describe([record.vehicle_losses_a for record in rows]),
        vehicle_losses_b=describe([record.vehicle_losses_b for record in rows]),
        records=rows,
    )


def run_batch(
    scenario: Scenario,
    config: AppConfig | None = None,
    *,
    runs: int = DEFAULT_RUNS,
    base_seed: int | None = None,
    processes: int | None = None,
    progress: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    config_dir: str | Path | None = None,
) -> BatchResult:
    """Прогнать сценарий ``runs`` раз и собрать статистику.

    ``progress(done, total)`` вызывается после каждого прогона,
    ``cancelled()`` позволяет прервать расчёт из интерфейса.
    """
    scenario = scenario.normalised()
    base_seed = scenario.master_seed if base_seed is None else base_seed
    config = config or ConfigStore(Path(config_dir) if config_dir else None).load()
    runs = max(1, int(runs))
    workers = processes if processes is not None else min(mp.cpu_count(), runs)
    records: list[RunRecord] = []

    if workers <= 1:
        for index in range(runs):
            if cancelled and cancelled():
                break
            records.append(run_single(scenario, config, index, base_seed))
            if progress:
                progress(len(records), runs)
        return summarise(scenario, records, base_seed)

    payloads = [(index, base_seed) for index in range(runs)]
    context = mp.get_context("spawn")
    pool = context.Pool(
        processes=workers,
        initializer=_init_worker,
        initargs=(scenario.model_dump(mode="json"), str(config_dir) if config_dir else None),
    )
    aborted = False
    try:
        for record in pool.imap_unordered(_run_index, payloads, chunksize=1):
            records.append(record)
            if progress:
                progress(len(records), runs)
            if cancelled and cancelled():
                aborted = True
                break
    finally:
        # Отмена из интерфейса гасит пул сразу, обычное завершение — мягко.
        if aborted:
            pool.terminate()
        else:
            pool.close()
        pool.join()

    return summarise(scenario, records, base_seed)
