"""Детерминированные потоки случайности (§7)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from core.engine.rng import RngStreams, stable_hash


def test_streams_are_reproducible() -> None:
    first = RngStreams(42)
    second = RngStreams(42)
    values_a = [first.uniform(1, "damage", "A/r1", 0.5, 1.5) for _ in range(10)]
    values_b = [second.uniform(1, "damage", "A/r1", 0.5, 1.5) for _ in range(10)]
    assert values_a == values_b


def test_streams_differ_by_key() -> None:
    rng = RngStreams(42)
    assert rng.random(1, "damage", "A/r1") != rng.random(1, "damage", "B/r1")
    assert rng.random(2, "damage", "A/r1") != rng.random(3, "damage", "A/r1")


def test_seed_changes_results() -> None:
    a = RngStreams(1).uniform(1, "damage", "A/r1", 0, 1)
    b = RngStreams(2).uniform(1, "damage", "A/r1", 0, 1)
    assert a != b


def test_stable_hash_survives_new_process() -> None:
    """hash() строк рандомизируется между процессами, blake2b — нет."""
    expected = stable_hash(42, 1, "damage", "A/r1")
    root = Path(__file__).resolve().parents[1]
    code = (
        f"import sys; sys.path.insert(0, {str(root)!r});"
        "from core.engine.rng import stable_hash;"
        "print(stable_hash(42, 1, 'damage', 'A/r1'))"
    )
    output = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=True,
        env={"PYTHONHASHSEED": "12345", "PATH": "/usr/bin:/bin"},
    )
    assert int(output.stdout.strip()) == expected


def test_stochastic_rounding_keeps_expectation() -> None:
    rng = RngStreams(3)
    samples = [
        rng.round_stochastic(0.4, turn, "casualties", "A/r1") for turn in range(400)
    ]
    assert set(samples) <= {0, 1}
    assert 0.3 < sum(samples) / len(samples) < 0.5
