"""Журнал событий: структура, breakdown, фильтры, экспорт (§8)."""

from __future__ import annotations

from core.engine import BattleEngine
from core.log import BattleLog, log_hash

#: События, для которых поле breakdown обязательно (§8).
REQUIRE_BREAKDOWN = {
    "losses_inflicted",
    "morale_changed",
    "suppressed",
    "firepower",
    "resilience",
    "pressure",
}


def test_entries_have_required_fields(scenario, config) -> None:
    result = BattleEngine(scenario, config).run()
    assert result.log
    for entry in result.log:
        assert entry.turn >= 0
        assert entry.phase
        assert entry.event


def test_breakdown_present_for_losses_and_morale(scenario, config) -> None:
    """Для любой строки потерь или изменения морали видны модификаторы (§14.5)."""
    result = BattleEngine(scenario, config).run()
    checked = set()
    for entry in result.log:
        if entry.event in REQUIRE_BREAKDOWN:
            assert entry.breakdown, f"нет breakdown у события {entry.event}"
            assert all(item.factor for item in entry.breakdown)
            checked.add(entry.event)
    assert {"losses_inflicted", "morale_changed"} <= checked


def test_losses_entries_show_before_and_after(scenario, config) -> None:
    result = BattleEngine(scenario, config).run()
    losses = [entry for entry in result.log if entry.event == "losses_inflicted"]
    assert losses
    for entry in losses:
        assert entry.before["personnel"] >= entry.after["personnel"]
        assert entry.actor and entry.target


def test_filters(scenario, config) -> None:
    engine = BattleEngine(scenario, config)
    engine.run()
    log = engine.log
    assert log.turns()
    assert log.events()
    first_turn = log.filter(turn=1)
    assert first_turn and all(entry.turn == 1 for entry in first_turn)
    actor = log.actors()[0]
    by_actor = log.filter(element=actor)
    assert by_actor and all(
        actor in (entry.actor, entry.target) for entry in by_actor
    )
    by_event = log.filter(event="losses_inflicted")
    assert all(entry.event == "losses_inflicted" for entry in by_event)


def test_export_formats(scenario, config) -> None:
    engine = BattleEngine(scenario, config)
    engine.run()
    markdown = engine.log.to_markdown()
    assert "# Журнал боя" in markdown
    assert "модификаторы" in markdown
    assert engine.log.to_json().startswith("[")


def test_digest_is_stable_and_matches_result(scenario, config) -> None:
    engine = BattleEngine(scenario, config)
    result = engine.run()
    assert engine.log.digest() == result.log_hash
    assert log_hash(result.log) == result.log_hash


def test_quiet_log_keeps_essential_events(scenario, config) -> None:
    """Тихий режим сохраняет то, что объясняет исход."""
    quiet = BattleEngine(scenario, config, verbose=False).run()
    events = {entry.event for entry in quiet.log}
    assert {"losses_inflicted", "morale_changed", "battle_finished"} <= events
    assert len(quiet.log) < len(BattleEngine(scenario, config).run().log)


def test_quiet_mode_does_not_change_the_battle(scenario, config) -> None:
    """Подробность журнала не влияет на расчёт."""
    loud = BattleEngine(scenario, config).run()
    quiet = BattleEngine(scenario, config, verbose=False).run()
    assert loud.turns == quiet.turns
    assert loud.winner == quiet.winner
    assert loud.side_a.personnel_lost == quiet.side_a.personnel_lost


def test_add_returns_none_when_filtered() -> None:
    log = BattleLog(verbose=False)
    assert log.add(turn=1, phase="detection", event="contact") is None
    assert log.add(turn=1, phase="casualties", event="losses_inflicted") is not None
