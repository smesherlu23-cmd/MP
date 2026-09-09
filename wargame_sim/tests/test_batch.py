"""Массовое моделирование и статистика (§9)."""

from __future__ import annotations

import pytest

from core.batch import describe, percentile, run_batch, run_single
from core.models import Winner


def test_percentiles() -> None:
    values = list(range(1, 11))
    assert percentile(values, 0.0) == 1
    assert percentile(values, 1.0) == 10
    assert percentile(values, 0.5) == pytest.approx(5.5)


def test_describe_of_empty_series() -> None:
    dist = describe([])
    assert dist.mean == 0 and dist.p90 == 0


def test_run_uses_base_seed_plus_index(scenario, config) -> None:
    record = run_single(scenario, config, index=7, base_seed=100)
    assert record.seed == 107
    assert record.index == 7


def test_batch_produces_probabilities_and_records(scenario, config) -> None:
    batch = run_batch(scenario, config, runs=20, base_seed=500, processes=1)
    assert batch.runs == 20
    assert len(batch.records) == 20
    total = batch.win_probability_a + batch.win_probability_b + batch.draw_probability
    assert total == pytest.approx(1.0, abs=0.001)
    assert sum(batch.end_reasons.values()) == 20
    assert batch.turns.p10 <= batch.turns.p50 <= batch.turns.p90
    assert [record.index for record in batch.records] == list(range(20))


def test_batch_is_reproducible(scenario, config) -> None:
    first = run_batch(scenario, config, runs=10, base_seed=7, processes=1)
    second = run_batch(scenario, config, runs=10, base_seed=7, processes=1)
    assert first.model_dump() == second.model_dump()


def test_any_run_can_be_reopened_by_seed(scenario, config) -> None:
    """Из таблицы прогонов открывается точный повтор (§9)."""
    from core.engine import BattleEngine

    batch = run_batch(scenario, config, runs=5, base_seed=900, processes=1)
    record = batch.records[3]
    replay = BattleEngine(scenario, config, seed=record.seed, verbose=False).run()
    assert replay.winner == record.winner
    assert replay.turns == record.turns
    assert replay.side_a.personnel_lost == record.losses_a


def test_multiprocessing_matches_sequential(scenario, config) -> None:
    """Пул процессов даёт тот же результат, что и последовательный прогон."""
    sequential = run_batch(scenario, config, runs=8, base_seed=11, processes=1)
    parallel = run_batch(scenario, config, runs=8, base_seed=11, processes=2)
    assert [record.model_dump() for record in sequential.records] == [
        record.model_dump() for record in parallel.records
    ]


def test_progress_and_cancel(scenario, config) -> None:
    seen: list[int] = []
    batch = run_batch(
        scenario,
        config,
        runs=30,
        base_seed=1,
        processes=1,
        progress=lambda done, total: seen.append(done),
        cancelled=lambda: len(seen) >= 4,
    )
    assert batch.runs == 4
    assert seen == [1, 2, 3, 4]


@pytest.mark.slow
def test_equal_battalions_win_probability(symmetric_scenario, config) -> None:
    """Равные батальоны в равных условиях: 200 прогонов, 50% ± 5% (§12)."""
    batch = run_batch(symmetric_scenario, config, runs=200, base_seed=31000, processes=1)
    decisive = batch.win_probability_a + batch.win_probability_b
    assert decisive > 0.9, "почти все бои должны заканчиваться результативно"
    assert 0.45 <= batch.win_probability_a <= 0.55, batch.win_probability_a
    assert 0.45 <= batch.win_probability_b <= 0.55, batch.win_probability_b
    assert batch.turns.maximum <= symmetric_scenario.environment.max_turns
    assert Winner.A.value in {str(r.winner) for r in batch.records}
