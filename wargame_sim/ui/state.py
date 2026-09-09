"""Состояние приложения: то, что живёт между экранами.

Модуль не строит контролов и не знает про конкретные экраны — благодаря
этому его можно создать в тесте без запущенного Flet.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from core.batch import run_batch
from core.config import AppConfig, ConfigError, ConfigStore
from core.engine import BattleEngine
from core.models import BatchResult, Battalion, BattleResult, Scenario
from core.samples import make_scenario
from core.storage import (
    RESULTS_DIR,
    SCENARIOS_DIR,
    UNITS_DIR,
    StorageError,
    ensure_dirs,
    list_battalions,
    list_results,
    list_scenarios,
    save_battalion,
    save_result,
    save_scenario,
)

#: Маршруты приложения (§10).
ROUTES = {
    "home": "/",
    "units": "/units",
    "unit": "/units/{id}",
    "battle_setup": "/battle/setup",
    "battle": "/battle/{id}",
    "battle_result": "/battle/{id}/result",
    "batch": "/batch",
    "config": "/config",
    "archive": "/archive",
}


class AppState:
    """Общее состояние: конфиг, текущий сценарий, бой и результаты."""

    def __init__(
        self,
        page: Any | None = None,
        store: ConfigStore | None = None,
        *,
        data_dir: Path | None = None,
    ) -> None:
        self.page = page
        self.store = store or ConfigStore()
        self.data_dir = data_dir
        self.units_dir = (data_dir / "units") if data_dir else UNITS_DIR
        self.scenarios_dir = (data_dir / "scenarios") if data_dir else SCENARIOS_DIR
        self.results_dir = (data_dir / "results") if data_dir else RESULTS_DIR
        ensure_dirs(data_dir)

        self.config_error: str | None = None
        self._config: AppConfig | None = None

        self.scenario: Scenario = make_scenario(self.config)
        self.engine: BattleEngine | None = None
        self.result: BattleResult | None = None
        self.batch: BatchResult | None = None
        self.batch_running = False
        self.batch_cancelled = False
        self.batch_progress: tuple[int, int] = (0, 0)
        self.notifier: Callable[[str], None] | None = None
        self.navigator: Callable[[str], None] | None = None

    # -- конфигурация -------------------------------------------------------
    @property
    def config(self) -> AppConfig:
        """Актуальный конфиг; правки в файлах подхватываются на лету (§5)."""
        try:
            self._config = self.store.get()
            self.config_error = None
        except ConfigError as error:
            self.config_error = str(error)
            if self._config is None:
                raise
        return self._config

    def reload_config(self) -> AppConfig | None:
        try:
            self._config = self.store.reload()
            self.config_error = None
        except ConfigError as error:
            self.config_error = str(error)
            return None
        return self._config

    # -- сообщения ----------------------------------------------------------
    def notify(self, message: str) -> None:
        if self.notifier:
            self.notifier(message)

    def go(self, route: str) -> None:
        """Перейти на экран; как именно — решает роутер приложения."""
        if self.navigator is not None:
            self.navigator(route)

    def refresh(self, *controls: Any) -> None:
        """Обновить контролы, если приложение действительно запущено.

        В тестах экраны строятся без страницы — там обновлять нечего.
        """
        if self.page is None:
            return
        from ui.widgets.common import safe_update

        for control in controls:
            safe_update(control)

    # -- подразделения ------------------------------------------------------
    def units(self) -> list[tuple[Path, Battalion]]:
        return list_battalions(self.units_dir)

    def unit(self, unit_id: str) -> tuple[Path, Battalion] | None:
        for path, battalion in self.units():
            if battalion.id == unit_id:
                return path, battalion
        return None

    def save_unit(self, battalion: Battalion) -> Path:
        return save_battalion(battalion, self.units_dir)

    # -- сценарии -----------------------------------------------------------
    def scenarios(self) -> list[tuple[Path, Scenario]]:
        return list_scenarios(self.scenarios_dir)

    def save_scenario(self, scenario: Scenario) -> Path:
        return save_scenario(scenario, self.scenarios_dir)

    def load_scenario(self, scenario: Scenario) -> None:
        self.scenario = scenario.model_copy(deep=True)
        self.engine = None
        self.result = None

    # -- результаты ---------------------------------------------------------
    def results(self) -> list[tuple[Path, BattleResult]]:
        return list_results(self.results_dir)

    def save_result(self, result: BattleResult) -> Path:
        return save_result(result, self.results_dir)

    # -- бой ----------------------------------------------------------------
    def start_battle(self) -> BattleEngine:
        """Создать новый бой по текущему сценарию."""
        self.engine = BattleEngine(self.scenario, self.config)
        self.result = None
        return self.engine

    def ensure_battle(self) -> BattleEngine:
        if self.engine is None:
            return self.start_battle()
        return self.engine

    def finish_battle(self) -> BattleResult:
        engine = self.ensure_battle()
        self.result = engine.result()
        return self.result

    # -- массовое моделирование --------------------------------------------
    def run_batch(
        self,
        runs: int,
        base_seed: int,
        *,
        processes: int | None = None,
        progress: Callable[[int, int], None] | None = None,
    ) -> BatchResult:
        """Запустить N прогонов; отмена — через ``cancel_batch()``."""
        self.batch_running = True
        self.batch_cancelled = False
        self.batch_progress = (0, runs)

        def report(done: int, total: int) -> None:
            self.batch_progress = (done, total)
            if progress:
                progress(done, total)

        try:
            self.batch = run_batch(
                self.scenario,
                self.config,
                runs=runs,
                base_seed=base_seed,
                processes=processes,
                progress=report,
                cancelled=lambda: self.batch_cancelled,
                config_dir=self.store.directory,
            )
        finally:
            self.batch_running = False
        return self.batch

    def cancel_batch(self) -> None:
        self.batch_cancelled = True


__all__ = ["ROUTES", "AppState", "ConfigError", "StorageError"]
