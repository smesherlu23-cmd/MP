"""Управление боем: наряд сил, резерв и приказы по ходу (§6.1)."""

from __future__ import annotations

from core.config import AppConfig
from core.engine import BattleEngine
from core.models import EndReason, Order, Scenario, Winner


def _with_reserve(scenario: Scenario) -> tuple[Scenario, str]:
    scenario = scenario.model_copy(deep=True)
    reserve = scenario.battalion_a.elements[-1]
    reserve.engaged = False
    return scenario, reserve.id


def test_reserve_does_not_fight(scenario: Scenario, config: AppConfig) -> None:
    """Невведённый элемент не стреляет, по нему не стреляют и в сводку не идёт."""
    prepared, reserve_id = _with_reserve(scenario)
    engine = BattleEngine(prepared, config, verbose=False)
    battalion = engine.state.battalion("A")

    assert len(battalion.reserve_elements) == 1
    assert reserve_id not in {element.id for element in battalion.alive_elements}
    assert reserve_id not in engine.state.side("A").initial_personnel
    assert battalion.personnel_current < sum(
        element.personnel_current for element in battalion.elements
    )


def test_committed_reserve_joins_the_registry(scenario: Scenario, config: AppConfig) -> None:
    """После ввода в бой «потеряно + в строю» по-прежнему сходится (§4.2)."""
    prepared, reserve_id = _with_reserve(scenario)
    engine = BattleEngine(prepared, config, verbose=False)
    engine.run_turns(3)

    assert engine.commit("A", reserve_id) is True
    assert engine.commit("A", reserve_id) is False  # второй раз уже нечего вводить

    engine.run()
    report = engine.result().side_a
    assert report.personnel_start == report.personnel_end + report.personnel_lost
    assert reserve_id in {element.id for element in engine.state.battalion("A").elements}


def test_commit_is_written_to_the_journal(scenario: Scenario, config: AppConfig) -> None:
    prepared, reserve_id = _with_reserve(scenario)
    engine = BattleEngine(prepared, config)
    engine.run_turns(2)
    engine.commit("A", reserve_id)

    entries = [entry for entry in engine.log if entry.event == "reserve_committed"]
    assert len(entries) == 1
    assert entries[0].turn == 2


def test_order_can_be_changed_during_the_battle(scenario: Scenario, config: AppConfig) -> None:
    engine = BattleEngine(scenario, config)
    engine.run_turns(2)
    element = engine.state.battalion("A").alive_elements[1]

    assert engine.set_order("A", element.id, Order.ENTRENCH) is True
    assert engine.state.battalion("A").order_for(element) == Order.ENTRENCH
    # повторная установка того же приказа записи не плодит
    assert engine.set_order("A", element.id, Order.ENTRENCH) is False

    entries = [entry for entry in engine.log if entry.event == "order_changed"]
    assert len(entries) == 1
    assert entries[0].after["order"] == str(Order.ENTRENCH)


def test_stop_ends_the_battle_immediately(scenario: Scenario, config: AppConfig) -> None:
    """ГМ останавливает бой прямо сейчас — не дожидаясь разгрома или лимита."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run_turns(3)
    assert not engine.finished

    result = engine.stop()

    assert engine.finished
    assert engine.end_reason == EndReason.STOPPED
    assert result.turns == 3
    assert result.end_reason == EndReason.STOPPED


def test_stop_is_a_draw_when_forces_are_close(scenario: Scenario, config: AppConfig) -> None:
    """На старте боя стороны равны — остановка сразу даёт ничью, а не победу."""
    engine = BattleEngine(scenario, config, verbose=False)

    result = engine.stop()

    assert result.winner == Winner.DRAW
    assert result.end_reason == EndReason.STOPPED


def test_stop_declares_the_stronger_side_the_winner(
    scenario: Scenario, config: AppConfig
) -> None:
    """Победитель при остановке — та сторона, что сохранила больше мощи."""
    engine = BattleEngine(scenario, config, verbose=False)
    for element in engine.state.battalion("B").alive_elements:
        element.morale = 5.0

    result = engine.stop()

    assert engine.state.battalion("A").combat_power > engine.state.battalion("B").combat_power
    assert result.winner == Winner.A


def test_stop_after_the_battle_finished_does_not_rewrite_the_outcome(
    scenario: Scenario, config: AppConfig
) -> None:
    """Остановка законченного боя не подменяет настоящую причину исхода."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run()
    finished_reason = engine.end_reason
    finished_winner = engine.winner

    result = engine.stop()

    assert engine.end_reason == finished_reason
    assert result.winner == finished_winner
    assert result.end_reason != EndReason.STOPPED


def test_changed_order_actually_reaches_the_calculation(
    scenario: Scenario, config: AppConfig
) -> None:
    """Смена приказа меняет бой, а не только строку в журнале."""
    base = BattleEngine(scenario.model_copy(deep=True), config, verbose=False)
    base.run()

    changed = BattleEngine(scenario.model_copy(deep=True), config, verbose=False)
    changed.run_turns(2)
    for element in list(changed.state.battalion("A").alive_elements):
        changed.set_order("A", element.id, Order.ENTRENCH)
    changed.run()

    assert base.result().side_b.personnel_lost != changed.result().side_b.personnel_lost
