"""Деление отряда на подгруппы и сведение обратно (§4.2).

Главное здесь — сумма сходится: сколько людей и машин было в группе до
перестроения, столько же есть после. Всё остальное — следствие.
"""

from __future__ import annotations

import pytest

from core import formation as f
from core.config import AppConfig
from core.engine import BattleEngine
from core.models import Battalion, Echelon, Element, Scenario, Side
from core.samples import make_platoon, make_small_scenario


def _vehicle_group(battalion: Battalion) -> Element:
    return next(element for element in battalion.elements if element.has_vehicles)


# --------------------------------------------------------------------------
# раскладка целых
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("total", "weights"),
    [(7, [1, 1]), (120, [1, 1, 1]), (5, [3, 1]), (0, [1, 1]), (1, [1, 1, 1])],
)
def test_apportion_loses_nobody(total: int, weights: list[float]) -> None:
    """Раскладка по долям не теряет и не добавляет ни одного человека."""
    shares = f.apportion(total, weights)
    assert sum(shares) == total
    assert all(share >= 0 for share in shares)


def test_fit_under_returns_the_excess() -> None:
    """Излишек над потолком уходит туда, где есть запас."""
    assert f.fit_under([5, 5], [3, 9]) == [3, 7]
    assert sum(f.fit_under([5, 5], [3, 9])) == 10


# --------------------------------------------------------------------------
# деление
# --------------------------------------------------------------------------
def test_split_keeps_every_man_and_machine(scenario: Scenario) -> None:
    """После деления в отряде столько же людей и машин, сколько было."""
    battalion = scenario.battalion_a
    before = (battalion.personnel_full, battalion.personnel_current, battalion.vehicles_full)

    target = _vehicle_group(battalion)
    children = f.split(battalion, target.id, 3)

    assert len(children) == 3
    assert sum(child.personnel_full for child in children) == target.personnel_full
    assert sum(child.vehicles_full for child in children) == target.vehicles_full
    assert (
        battalion.personnel_full,
        battalion.personnel_current,
        battalion.vehicles_full,
    ) == before


def test_split_moves_the_group_off_the_firing_line(scenario: Scenario) -> None:
    """Разделённая группа сама не воюет — воюют её подгруппы."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    leaves_before = len(battalion.leaf_elements)

    f.split(battalion, target.id, 2)

    assert battalion.is_leaf(target) is False
    assert target not in battalion.engaged_elements
    assert len(battalion.leaf_elements) == leaves_before + 1


def test_split_names_subgroups_one_step_down(scenario: Scenario) -> None:
    """Рота делится на взводы: ступень подгруппы берётся из ступени группы."""
    battalion = scenario.battalion_a
    target = next(e for e in battalion.elements if e.echelon == Echelon.COMPANY)
    children = f.split(battalion, target.id, 3)

    assert [child.echelon for child in children] == [Echelon.PLATOON] * 3
    assert [child.name for child in children] == ["1-й взвод", "2-й взвод", "3-й взвод"]


def test_split_rejects_a_group_that_is_already_split(scenario: Scenario) -> None:
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    f.split(battalion, target.id, 2)
    with pytest.raises(f.FormationError, match="делить надо её подгруппы"):
        f.split(battalion, target.id, 2)


def test_split_rejects_a_group_smaller_than_the_parts(scenario: Scenario) -> None:
    battalion = scenario.battalion_a
    target = battalion.elements[0]
    with pytest.raises(f.FormationError, match="не делится"):
        f.split(battalion, target.id, target.personnel_full + 1)


def test_split_by_shares_follows_the_shares(scenario: Scenario) -> None:
    """Неравные доли дают неравные подгруппы — и всё равно точную сумму."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    children = f.split(battalion, target.id, 2, shares=[3, 1])

    assert children[0].personnel_full > children[1].personnel_full
    assert sum(child.personnel_full for child in children) == target.personnel_full


# --------------------------------------------------------------------------
# техника отдельным отрядом
# --------------------------------------------------------------------------
def test_detach_vehicles_takes_the_crews_along(
    scenario: Scenario, config: AppConfig
) -> None:
    """Техника уходит с экипажами, пехота остаётся спешенной."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    personnel = target.personnel_full
    vehicles = target.vehicles_full

    foot, crew = f.detach_vehicles(battalion, target.id, config)

    assert foot.vehicles_full == 0
    assert crew.vehicles_full == vehicles
    assert crew.personnel_full > 0
    assert foot.personnel_full + crew.personnel_full == personnel


def test_detach_refuses_a_group_without_vehicles(
    scenario: Scenario, config: AppConfig
) -> None:
    battalion = scenario.battalion_a
    bare = next(element for element in battalion.elements if not element.has_vehicles)
    with pytest.raises(f.FormationError, match="нет техники"):
        f.detach_vehicles(battalion, bare.id, config)


# --------------------------------------------------------------------------
# сведение
# --------------------------------------------------------------------------
def test_merge_returns_exactly_what_the_subgroups_had(scenario: Scenario) -> None:
    """Сведение возвращает остатки подгрупп, а не исходные числа."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    children = f.split(battalion, target.id, 3)
    children[0].personnel_current -= 7
    children[1].vehicles[0].count_current = 0

    merged = f.merge(battalion, target.id)

    assert merged.personnel_current == sum(child.personnel_current for child in children)
    assert merged.vehicles_current == sum(child.vehicles_current for child in children)
    assert battalion.is_leaf(merged)
    assert battalion.children_of(target.id) == []


def test_merge_survives_a_subgroup_wiped_out(scenario: Scenario) -> None:
    """Сведение поредевшей группы не спотыкается о проверку «в строю ≤ штат»."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    children = f.split(battalion, target.id, 2)
    for child in children:
        child.personnel_current = 0

    merged = f.merge(battalion, target.id)
    assert merged.personnel_current == 0
    assert merged.personnel_full == target.personnel_full


def test_merge_refuses_a_leaf(scenario: Scenario) -> None:
    battalion = scenario.battalion_a
    with pytest.raises(f.FormationError, match="не разделена"):
        f.merge(battalion, battalion.elements[0].id)


# --------------------------------------------------------------------------
# пересборка дерева
# --------------------------------------------------------------------------
def test_reassign_cannot_close_the_tree_into_a_ring(scenario: Scenario) -> None:
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    children = f.split(battalion, target.id, 2)
    with pytest.raises(f.FormationError, match="нельзя подчинить"):
        f.reassign(battalion, target.id, children[0].id)


def test_reassign_moves_the_whole_branch(scenario: Scenario) -> None:
    battalion = scenario.battalion_a
    first, second = battalion.elements[1], battalion.elements[2]
    f.split(battalion, first.id, 2)
    f.reassign(battalion, first.id, second.id)

    assert battalion.depth_of(first) == 1
    assert all(battalion.depth_of(child) == 2 for child in battalion.children_of(first.id))
    assert second in battalion.ancestors(battalion.children_of(first.id)[0])


def test_set_engaged_reaches_every_leaf(scenario: Scenario) -> None:
    """Отвод старшей группы в резерв уводит туда все её подгруппы."""
    battalion = scenario.battalion_a
    target = _vehicle_group(battalion)
    f.split(battalion, target.id, 3)

    f.set_engaged(battalion, target.id, False)
    assert all(not leaf.engaged for leaf in battalion.leaves_of(target.id))
    assert battalion.rollup(target.id).in_reserve

    f.set_engaged(battalion, target.id, True)
    assert all(leaf.engaged for leaf in battalion.leaves_of(target.id))


# --------------------------------------------------------------------------
# дерево как модель
# --------------------------------------------------------------------------
def test_tree_rejects_an_unknown_parent(config: AppConfig) -> None:
    platoon = make_platoon("p", "Взвод", Side.A, config)
    orphan = platoon.elements[-1].model_copy(deep=True)
    orphan.id = "orphan"
    orphan.parent = "нет такой группы"
    with pytest.raises(ValueError, match="старшей группы"):
        Battalion(id="x", name="x", elements=[*platoon.elements, orphan])


def test_aggregates_ignore_the_parent_group(config: AppConfig) -> None:
    """Старшая группа не считается дважды — за себя и за подгруппы."""
    platoon = make_platoon("p", "Взвод", Side.A, config)
    head = platoon.roots[0]

    assert head not in platoon.engaged_elements
    assert platoon.personnel_full == sum(
        leaf.personnel_full for leaf in platoon.leaf_elements
    )
    assert platoon.rollup(head.id).personnel_full == platoon.personnel_full


# --------------------------------------------------------------------------
# перестроение в бою
# --------------------------------------------------------------------------
def _balanced(engine: BattleEngine) -> None:
    for side in ("A", "B"):
        state = engine.state.side(side)
        started = sum(state.initial_personnel.values())
        standing = sum(
            element.personnel_current for element in state.battalion.leaf_elements
        )
        assert started == standing + state.total_personnel_lost()
        started_vehicles = sum(state.initial_vehicles.values())
        standing_vehicles = sum(
            element.vehicles_current for element in state.battalion.leaf_elements
        )
        assert started_vehicles == standing_vehicles + state.total_vehicles_lost()


def test_split_in_battle_keeps_the_registry_balanced(
    scenario: Scenario, config: AppConfig
) -> None:
    """Деление посреди боя не ломает «потеряно + в строю» (§4.2, §12)."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run_turns(4)
    _balanced(engine)

    target = _vehicle_group(engine.state.battalion("A"))
    children = engine.split("A", target.id, 3)
    _balanced(engine)

    side_state = engine.state.side("A")
    for child in children:
        assert (
            side_state.initial_personnel[child.id]
            == side_state.personnel_lost[child.id] + child.personnel_current
        )

    engine.run_turns(3)
    _balanced(engine)
    engine.merge("A", target.id)
    _balanced(engine)
    engine.run()
    _balanced(engine)


def test_battle_commands_are_written_to_the_journal(
    scenario: Scenario, config: AppConfig
) -> None:
    """Каждое перестроение видно в журнале фазой command."""
    engine = BattleEngine(scenario, config)
    engine.run_turns(2)
    target = _vehicle_group(engine.state.battalion("A"))
    engine.split("A", target.id, 2)
    engine.merge("A", target.id)
    engine.detach_vehicles("A", target.id)

    events = [entry.event for entry in engine.log.filter(phase="command")]
    assert events == ["group_split", "group_merged", "vehicles_detached"]


def test_detached_vehicles_fight_on_their_own(
    scenario: Scenario, config: AppConfig
) -> None:
    """Отделённая техника становится самостоятельной группой боя."""
    engine = BattleEngine(scenario, config, verbose=False)
    target = _vehicle_group(engine.state.battalion("A"))
    _foot, crew = engine.detach_vehicles("A", target.id)

    assert crew in engine.state.battalion("A").alive_elements
    engine.run_turns(3)
    _balanced(engine)


# --------------------------------------------------------------------------
# малый масштаб
# --------------------------------------------------------------------------
def test_platoon_fight_finishes_and_keeps_supply(config: AppConfig) -> None:
    """Взвод без штатного тыла не остаётся с нулевым боезапасом (§5 supply)."""
    engine = BattleEngine(make_small_scenario(config, seed=42), config, verbose=False)
    result = engine.run()

    assert 0 < result.turns < 30
    winner = result.side_a if str(result.winner) == "A" else result.side_b
    assert winner.supply > 50
    assert result.side_a.personnel_start == (
        result.side_a.personnel_end + result.side_a.personnel_lost
    )


def test_hold_task_scales_with_the_unit(config: AppConfig) -> None:
    """«Выстоять» взводу нужно меньше ходов, чем батальону."""
    assert config.task_turns(16, Echelon.PLATOON) < config.task_turns(16, Echelon.BATTALION)
    assert config.task_turns(16, Echelon.BATTALION) == 16
    assert config.task_turns(0, Echelon.SQUAD) == 0
