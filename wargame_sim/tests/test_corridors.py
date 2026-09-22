"""Коридоры осмысленности боя (§12).

Прежние тесты проверяли, что бой «не упал»: `assert result.turns <= max_turns`
проходил и при 0% побед атаки, и при 100%. Из-за этого мимо прошло всё сразу:
мораль росла под обстрелом, на любой местности кроме равнины атака не
побеждала ни разу за 150 прогонов, а исход решал не бой, а счётчик ходов в
задаче обороны.

Здесь проверяется не «работает», а «даёт осмысленный результат»:

* механика — быстрыми детерминированными тестами (мораль падает под огнём,
  слаженность рвётся, готовность тратится на команды, боезапас убывает);
* исход — статистическими коридорами: доля побед, длительность и то, что бой
  заканчивается боем, а не таймером.

Коридоры намеренно широкие. Их задача — ловить обрывы и константы
(«0% всегда», «ровно 16 ходов»), а не фиксировать точные числа: точные числа
меняются при каждой правке коэффициентов, и тест, который их стережёт,
превращается в помеху.
"""

from __future__ import annotations

import statistics
from collections import Counter

import pytest

from core.batch import run_batch
from core.config import AppConfig
from core.engine import BattleEngine
from core.engine.phases import recovery
from core.engine.state import BattleState, SideState
from core.models import (
    Environment,
    Order,
    Scenario,
    Side,
    Terrain,
    TimeOfDay,
    Weather,
)
from core.samples import make_battalion, make_scenario

#: Прогонов на один коридор. 60 даёт стандартную ошибку около 6 п.п., чего
#: хватает, чтобы отличить «бывает» от «не бывает никогда».
RUNS = 60

#: Для условий боя выборка больше: в самых тяжёлых (ночь, снег, застройка)
#: атака побеждает в 6–10% случаев, и на шестидесяти прогонах тест «победы
#: бывают» сам иногда падал бы на пустом месте.
ENVIRONMENT_RUNS = 120


class Outcome:
    """Итоги серии прогонов — то, по чему судят о коридоре.

    Считается через :func:`core.batch.run_batch`, то есть в несколько
    процессов: последовательный цикл на тех же выборках занимал полчаса, а
    набор тестов, который никто не гоняет, ничего не охраняет.
    """

    def __init__(
        self,
        config: AppConfig,
        runs: int = RUNS,
        *,
        base_seed: int = 1,
        **scenario_kwargs,
    ) -> None:
        scenario = make_scenario(config, **scenario_kwargs)
        batch = run_batch(scenario, config, runs=runs, base_seed=base_seed, processes=None)
        self.runs = runs
        self.limit = scenario.environment.max_turns
        self.attack_wins = batch.win_probability_a
        self.wins_a = round(batch.win_probability_a * runs)
        self.wins_b = round(batch.win_probability_b * runs)
        self.mean_turns = batch.turns.mean
        self.spread = batch.turns.p90 - batch.turns.p10
        self.max_turns = batch.turns.maximum
        self.reasons: Counter[str] = Counter(batch.end_reasons)
        self.winner_power = [
            record.combat_power_a if str(record.winner) == "A" else record.combat_power_b
            for record in batch.records
            if str(record.winner) in ("A", "B")
        ]

    @property
    def decided_by_clock(self) -> float:
        """Доля боёв, которые кончил счётчик, а не противник."""
        return (self.reasons["задача"] + self.reasons["лимит ходов"]) / self.runs

    def __str__(self) -> str:
        return (
            f"A {self.attack_wins:.0%}, ходов {self.mean_turns:.1f} "
            f"(разброс {self.spread}), по счётчику {self.decided_by_clock:.0%}, "
            f"причины {dict(self.reasons)}"
        )


# --------------------------------------------------------------------------
# Механика: быстро и без статистики
# --------------------------------------------------------------------------
def test_morale_falls_under_fire(scenario: Scenario, config: AppConfig) -> None:
    """Под обстрелом мораль падает.

    Ровно это и было сломано: командир и опыт начисляли морали больше, чем
    снимали потери, и рота, которую расстреливают, набирала по +2.3 за ход.
    """
    engine = BattleEngine(scenario, config, verbose=False)
    start = {
        element.id: element.morale for element in engine.state.battalion("B").alive_elements
    }
    engine.run_turns(6)

    under_fire = [
        element
        for element in engine.state.battalion("B").alive_elements
        if element.personnel_current < element.personnel_full
    ]
    assert under_fire, "за шесть ходов кто-то должен был понести потери"
    assert all(element.morale < start[element.id] for element in under_fire), (
        "мораль обстрелянных групп: "
        + ", ".join(
            f"{e.name} {start[e.id]:.0f}→{e.morale:.0f}" for e in under_fire
        )
    )


def test_morale_does_not_recover_under_fire(scenario: Scenario, config: AppConfig) -> None:
    """Восстановление морали работает только вне контакта."""
    engine = BattleEngine(scenario, config)
    engine.run_turns(5)
    recovered = [
        entry
        for entry in engine.log.filter(phase="recovery")
        if any(factor.factor == "восстановление морали" for factor in entry.breakdown)
    ]
    in_contact = engine.state.side("A").in_contact
    for entry in recovered:
        element_id = entry.actor.split("/", 1)[1]
        assert not in_contact.get(element_id, False), (
            f"{entry.actor} восстанавливает мораль, находясь в контакте"
        )


def test_cohesion_breaks_and_comes_back(scenario: Scenario, config: AppConfig) -> None:
    """Слаженность рвётся потерями и собирается вне контакта."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run_turns(8)
    worn = [
        element
        for element in engine.state.battalion("B").alive_elements
        if element.personnel_current < element.personnel_full
    ]
    assert worn, "кто-то должен был понести потери"
    assert any(element.cohesion < 80.0 for element in worn), (
        "слаженность обязана падать от потерь, иначе это просто константа"
    )

    # Вне контакта она возвращается.
    battalion = make_battalion("bat_r", "Отдых", Side.A, config)
    element = battalion.elements[0]
    element.cohesion = 40.0
    state = BattleState(
        environment=Environment(),
        sides={
            "A": SideState(battalion=battalion),
            "B": SideState(battalion=make_battalion("bat_s", "B", Side.B, config)),
        },
        turn=3,
    )
    from core.log import BattleLog

    recovery.run(state, config, BattleLog())
    assert element.cohesion > 40.0


def test_readiness_is_spent_by_commands(scenario: Scenario, config: AppConfig) -> None:
    """Команды ГМ стоят готовности: перестроение в бою не бесплатно."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run_turns(2)
    target = next(
        element
        for element in engine.state.battalion("A").alive_elements
        if element.has_vehicles
    )
    before = target.readiness
    children = engine.split("A", target.id, 2)
    assert all(child.readiness < before for child in children), "деление обязано стоить готовности"

    child = children[0]
    after_split = child.readiness
    engine.set_order("A", child.id, Order.DEFENCE)
    assert child.readiness < after_split, "смена приказа обязана стоить готовности"


def test_supply_runs_down_in_a_long_fight(scenario: Scenario, config: AppConfig) -> None:
    """Боезапас убывает: подвоз меньше расхода, иначе снабжение — украшение."""
    engine = BattleEngine(scenario, config, verbose=False)
    engine.run()
    lowest = min(element.ammo for element in engine.state.battalion("A").leaf_elements)
    assert lowest < 90.0, f"боезапас за весь бой не просел ниже {lowest:.0f}%"


def test_first_turn_has_nothing_to_recover(scenario: Scenario, config: AppConfig) -> None:
    """На первом ходу подвоза и отдыха нет — бой ещё не начинался."""
    engine = BattleEngine(scenario, config)
    engine.run_turns(1)
    assert not engine.log.filter(turn=1, phase="recovery")


def test_reserve_and_rear_can_rest(scenario: Scenario, config: AppConfig) -> None:
    """В контакте тот, кого видит противник, а не весь отряд разом.

    Раньше признак контакта ставился всей стороне, стоило ей увидеть хоть
    кого-нибудь. Отдыхать не мог никто, и усталость упиралась в потолок.
    """
    prepared = scenario.model_copy(deep=True)
    reserve = prepared.battalion_a.elements[-1]
    reserve.engaged = False
    engine = BattleEngine(prepared, config, verbose=False)
    engine.run_turns(6)
    flags = engine.state.side("A").in_contact
    assert not all(flags.values()), "в контакте не может быть весь отряд разом"


# --------------------------------------------------------------------------
# Коридоры исхода: статистика, поэтому @slow
# --------------------------------------------------------------------------
def _assert_not_degenerate(outcome: Outcome, tag: str) -> None:
    """Условия боя меняют его цену, но не отменяют сам бой.

    Проверяется вырожденность, а не точное число: у атаки должны быть
    победы, у длительности — разброс, а исход не может целиком сводиться к
    одной причине. Ровно это и было сломано: в лесу атака не побеждала ни
    разу за 150 прогонов, и каждый бой длился ровно шестнадцать ходов.
    """
    assert outcome.wins_a > 0, f"{tag}: атака не побеждает ни разу — {outcome}"
    assert outcome.attack_wins <= 0.60, f"{tag}: условия ничего не меняют — {outcome}"
    assert outcome.spread >= 2, f"{tag}: длительность без разброса — {outcome}"



@pytest.mark.slow
def test_defence_has_the_edge_at_parity(config: AppConfig) -> None:
    """При равных силах обороняющийся сильнее, но атака выигрывает не «никогда».

    Полоса широкая намеренно: 60 прогонов дают стандартную ошибку около
    6 п.п., и точное значение всё равно поедет при следующей правке
    коэффициентов. Тест ловит другое — что у атаки вообще есть шанс.
    """
    outcome = Outcome(config)
    assert 0.12 <= outcome.attack_wins <= 0.45, str(outcome)


@pytest.mark.slow
def test_battle_is_decided_by_combat_not_by_the_clock(config: AppConfig) -> None:
    """Бой заканчивает противник, а не счётчик ходов.

    До перекалибровки 45 боёв из 60 кончались выполнением задачи обороны
    ровно на шестнадцатом ходу — модель была секундомером. Длительность
    обязана иметь разброс, а задача — оставаться подстраховкой.
    """
    outcome = Outcome(config)
    assert outcome.decided_by_clock <= 0.45, str(outcome)
    assert outcome.spread >= 3, f"длительность без разброса: {outcome!s}"
    assert outcome.max_turns < outcome.limit, "бои упираются в предел ходов"


@pytest.mark.slow
def test_winner_keeps_a_force_worth_counting(config: AppConfig) -> None:
    """У победителя остаётся чем воевать дальше — но не всё.

    Величина — доля боевой мощи, с которой отряд вошёл в бой, поэтому
    коридор двусторонний: ноль означает, что модель перестала различать
    победу и взаимное истребление, а сотня — что победа не стоила ничего.
    """
    outcome = Outcome(config)
    mean_power = statistics.mean(outcome.winner_power)
    assert 45.0 <= mean_power <= 95.0, f"боеспособность победителя {mean_power:.0f}"


@pytest.mark.slow
@pytest.mark.parametrize("terrain", list(Terrain))
def test_terrain_is_a_gradient(config: AppConfig, terrain: Terrain) -> None:
    """Местность меняет цену боя, а не отменяет его.

    Самая дорогая находка диагностики: на любой местности кроме равнины
    атака не побеждала ни разу за 150 прогонов, и каждый бой длился ровно
    16 ходов. Причина — местность входила в обмен трижды (огонь,
    устойчивость, укрытие) и попадала точно в колено кривой обвала.
    """
    outcome = Outcome(
        config, runs=ENVIRONMENT_RUNS, environment=Environment(terrain=terrain)
    )
    _assert_not_degenerate(outcome, str(terrain))


@pytest.mark.slow
@pytest.mark.parametrize("weather", list(Weather))
def test_weather_is_a_gradient(config: AppConfig, weather: Weather) -> None:
    outcome = Outcome(
        config, runs=ENVIRONMENT_RUNS, environment=Environment(weather=weather)
    )
    _assert_not_degenerate(outcome, str(weather))


@pytest.mark.slow
@pytest.mark.parametrize("time_of_day", list(TimeOfDay))
def test_time_of_day_is_a_gradient(config: AppConfig, time_of_day: TimeOfDay) -> None:
    """Ночная атака тяжелее дневной, но возможна."""
    outcome = Outcome(
        config, runs=ENVIRONMENT_RUNS, environment=Environment(time_of_day=time_of_day)
    )
    _assert_not_degenerate(outcome, str(time_of_day))


@pytest.mark.slow
@pytest.mark.parametrize("order", [o for o in Order if o is not Order.PANIC])
def test_no_order_has_a_predetermined_outcome(config: AppConfig, order: Order) -> None:
    """Исход приказа зависит от того, кто напротив, а не предрешён заранее.

    «Засада всегда побеждает» и «отступление всегда проигрывает» — это не
    механика, а её отсутствие: результат известен до первого броска.

    Проверяются обе пары сразу, и приказу достаточно выиграть в одной, а
    проиграть в другой. Иначе тест ловил бы не поломку, а свойство пары:
    закрепление против обороны по построению даёт ничью (оба выполняют
    «выстоять»), а удачный отход от наступающего — тоже ничью, потому что
    противник одновременно выполняет свою задачу и занимает позицию.
    """
    against_attack = Outcome(config, order_a=order, order_b=Order.ATTACK)
    against_defence = Outcome(config, order_a=order, order_b=Order.DEFENCE)
    wins = against_attack.wins_a + against_defence.wins_a
    losses = against_attack.wins_b + against_defence.wins_b

    assert wins > 0, (
        f"{order}: не выигрывает ни у кого — "
        f"против атаки {against_attack}; против обороны {against_defence}"
    )
    assert losses > 0, (
        f"{order}: не проигрывает никому — "
        f"против атаки {against_attack}; против обороны {against_defence}"
    )


@pytest.mark.slow
def test_experience_is_a_scale_not_a_switch(config: AppConfig) -> None:
    """Опыт — шкала: каждая ступень меняет шансы, а не переключает исход.

    Было 0% / 28% / 98% / 100%: один шаг опыта превращал гарантированное
    поражение в гарантированную победу. Причина — `combat` входит в K_сост
    и умножает разом и огонь, и устойчивость, поэтому преимущество почти
    возводится в квадрат.
    """
    wins: list[float] = []
    for level in (1, 2, 3, 4):
        scenario = make_scenario(config)
        for element in scenario.battalion_a.elements:
            element.experience = level
        batch = run_batch(scenario, config, runs=RUNS, base_seed=1, processes=None)
        wins.append(batch.win_probability_a)

    assert wins == sorted(wins), f"опыт должен помогать монотонно: {wins}"
    middle = [value for value in wins if 0.10 <= value <= 0.90]
    assert len(middle) >= 2, f"опыт работает как переключатель, а не как шкала: {wins}"
    assert wins[-1] - wins[0] >= 0.30, f"опыт почти ни на что не влияет: {wins}"


@pytest.mark.slow
def test_equal_sides_stay_even(config: AppConfig) -> None:
    """Равные отряды в равных условиях — 50/50.

    Держится отдельно от остальных коридоров: это проверка на перекос
    движка, а не на калибровку.
    """
    outcome = Outcome(config, runs=200, symmetric=True)
    assert 0.42 <= outcome.attack_wins <= 0.58, str(outcome)
    assert outcome.wins_a + outcome.wins_b >= 0.9 * outcome.runs
