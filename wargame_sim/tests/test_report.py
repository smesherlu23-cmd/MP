"""Итоговый отчёт и экспорт (§9, §11)."""

from __future__ import annotations

import pytest

from core import preview
from core.batch import run_batch
from core.engine import run_battle
from core.report import (
    batch_csv,
    batch_markdown,
    batch_text,
    outcome_text,
    result_csv,
    result_html,
    result_markdown,
)


def test_outcome_text_covers_required_numbers(scenario, config) -> None:
    """Итог содержит потери, боеспособность, организацию и снабжение (§14.1)."""
    result = run_battle(scenario, config)
    text = outcome_text(result)
    for expected in ("потери", "боеспособность", "организация", "снабжение", "Сид"):
        assert expected in text


def test_result_markdown_has_tables_and_log(scenario, config) -> None:
    result = run_battle(scenario, config)
    markdown = result_markdown(result)
    assert "## Сводка по сторонам" in markdown
    assert "## Элементы" in markdown
    assert "## Журнал" in markdown
    assert result.side_a.name in markdown


def test_result_html_is_self_contained(scenario, config) -> None:
    html = result_html(run_battle(scenario, config), include_log=False)
    assert html.startswith("<!doctype html>")
    assert "</html>" in html
    assert "<script" not in html


def test_result_csv_row_per_element(scenario, config) -> None:
    result = run_battle(scenario, config)
    rows = result_csv(result).strip().splitlines()
    expected = 1 + len(result.side_a.elements) + len(result.side_b.elements)
    assert len(rows) == expected


def test_batch_exports(scenario, config) -> None:
    batch = run_batch(scenario, config, runs=5, base_seed=3, processes=1)
    text = batch_text(batch)
    assert "Победа A" in text and "Способы завершения" in text
    markdown = batch_markdown(batch)
    assert "## Вероятности исходов" in markdown
    assert "## Прогоны" in markdown
    rows = batch_csv(batch).strip().splitlines()
    assert len(rows) == 6


# --------------------------------------------------------------------------
# Сравнение сторон до боя (экран настройки)
# --------------------------------------------------------------------------
def test_edge_names_the_stronger_side(scenario, config) -> None:
    """«Что даёт перевес» считается теми же формулами, что и первый ход."""
    edge = preview.edge(scenario, config)
    assert edge.a.firepower > 0 and edge.b.resilience > 0
    assert edge.leader in ("A", "B", "")
    assert str(scenario.environment.terrain) in edge.text
    assert f"{edge.ratio_a:.2f}" in edge.text


def test_edge_is_symmetric_for_equal_sides(scenario, config) -> None:
    """Зеркальный сценарий не должен давать перевеса ни одной стороне."""
    mirrored = scenario.model_copy(deep=True)
    mirrored.battalion_b = mirrored.battalion_a.model_copy(deep=True)
    mirrored.battalion_b.id = "bat_mirror"
    mirrored.environment.fortification_B = mirrored.environment.fortification_A
    edge = preview.edge(mirrored, config)
    assert edge.ratio_a == pytest.approx(edge.ratio_b)
    assert edge.leader == ""
