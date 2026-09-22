"""Состояние приложения: то, что живёт между экранами.

Модуль не строит контролов и не знает про конкретные экраны — благодаря
этому его можно создать в тесте без запущенного Flet.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
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
    list_scenarios,
    save_battalion,
    save_result,
    save_scenario,
    scan_battalions,
    scan_results,
)

#: Спросить у пользователя папку: заголовок, начальный каталог, что делать
#: с выбранным. Роутер подставляет сюда `ft.FilePicker`.
DirectoryAsker = Callable[[str, str, Callable[[str], None]], None]

#: То же для файла, плюс список допустимых расширений.
FileAsker = Callable[[str, str, tuple[str, ...], Callable[[str], None]], None]

#: Значение фильтра «без ограничения».
ALL = "*"

#: Фильтр стороны в таблицах элементов.
SIDE_BOTH = "AB"
SIDE_A = "A"
SIDE_B = "B"

#: Детальность журнала: только текст, плюс модификаторы, плюс изменения полей.
DETAIL_EVENTS = "events"
DETAIL_FACTORS = "factors"
DETAIL_ALL = "all"

#: Способ правки коэффициентов.
CONFIG_FIELDS = "fields"
CONFIG_YAML = "yaml"

#: Порог морали для блока «Требует внимания».
#: Настройки интерфейса рядом с данными: оформление — не часть боя,
#: поэтому в сценарий и в подразделения оно не лезет.
SETTINGS_FILE = "ui.json"

DEFAULT_ALARM_MORALE = 70

#: Число прогонов массового моделирования по умолчанию.
DEFAULT_RUNS = 100

#: Маршруты приложения (§10).
ROUTES = {
    "home": "/",
    "units": "/units",
    "unit": "/units/{id}",
    "materiel": "/materiel/{library}",
    "troops": "/troops",
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
        self.settings_path = (data_dir or UNITS_DIR.parent) / SETTINGS_FILE
        self.units_dir = (data_dir / "units") if data_dir else UNITS_DIR
        self.scenarios_dir = (data_dir / "scenarios") if data_dir else SCENARIOS_DIR
        self.results_dir = (data_dir / "results") if data_dir else RESULTS_DIR
        ensure_dirs(data_dir)

        self.config_error: str | None = None
        self._config: AppConfig | None = None

        self.scenario: Scenario = make_scenario(self.config)
        self.engine: BattleEngine | None = None
        #: Отпечаток сценария, по которому построен текущий бой. Пока он
        #: совпадает, бой можно продолжать; разошёлся — сценарий правили,
        #: и старый движок пришлось бы выдавать за новый.
        self._battle_source: str = ""
        self.result: BattleResult | None = None
        self.batch: BatchResult | None = None
        self.batch_running = False
        self.batch_cancelled = False
        self.batch_progress: tuple[int, int] = (0, 0)
        self.notifier: Callable[[str], None] | None = None
        #: Показать и закрыть модальное окно. Ставит роутер — состояние
        #: про flet по-прежнему ничего не знает.
        self.dialog_opener: Callable[[Any], None] | None = None
        self.dialog_closer: Callable[[], None] | None = None
        #: Спросить папку или файл системным окном. Тоже ставит роутер:
        #: `ft.FilePicker` — это flet, а состояние про flet не знает.
        self.directory_asker: DirectoryAsker | None = None
        self.file_asker: FileAsker | None = None
        self.navigator: Callable[[str], None] | None = None
        #: Горячие клавиши текущего экрана: «Ctrl+Enter» → что сделать.
        #: Экран заполняет её в `build`, роутер чистит перед сборкой.
        self.shortcuts: dict[str, Callable[[], None]] = {}
        self.theme_switcher: Callable[[bool], None] | None = None
        #: Ширина окна; 0 — окна нет (тест или скрипт), тогда берётся
        #: стартовая. По ней таблицы решают, сколько колонок показать.
        self.window_width: int = 0

        # -- экранное состояние редизайна -----------------------------------
        #: Раскрытый элемент в конструкторе — одновременно не больше одного.
        self.expanded_element: str | None = None
        #: Открытый батальон — показывается подпунктом в навигации.
        self.open_unit: tuple[str, str] | None = None
        #: Выбранная запись в каждой библиотеке мат.части.
        self.selected_materiel: dict[str, str] = {}
        #: Открытая папка библиотеки — пока она выбрана, справа карточка папки.
        self.selected_folder: dict[str, str] = {}
        #: Выбранный тип солдата в сборке юнитов.
        self.selected_troop: str = ""
        #: Открытая папка в сборке юнитов.
        self.selected_troop_folder: str = ""
        #: Выбранная группа на пульте боя: ``("A", "rota_1")``. Пока она
        #: выбрана, в подвале дерева показаны действия над ней.
        self.selected_group: tuple[str, str] | None = None
        #: Свёрнутые группы дерева — по умолчанию раскрыто всё, поэтому
        #: храним именно свёрнутые, а не раскрытые.
        self.collapsed_groups: set[tuple[str, str]] = set()
        #: На сколько частей делит кнопка «Разделить».
        self.split_parts: int = 2
        #: Фильтр стороны в таблицах элементов, отдельно для пульта и итога.
        self.run_side_filter: str = SIDE_BOTH
        self.result_side_filter: str = SIDE_BOTH
        #: Фильтры журнала и его детальность.
        self.journal_turn: str = ALL
        self.journal_element: str = ALL
        self.journal_event: str = ALL
        self.journal_detail: str = DETAIL_FACTORS
        #: Порог, ниже которого элемент попадает в «Требует внимания».
        self.alarm_morale: int = DEFAULT_ALARM_MORALE
        #: Экран коэффициентов: раздел и способ правки.
        self.config_section: str = "combat"
        self.config_view: str = CONFIG_FIELDS
        #: Архив: фильтр по исходу и строка поиска.
        self.archive_outcome: str = ALL
        self.archive_query: str = ""
        #: Параметры массового прогона.
        self.batch_runs: int = DEFAULT_RUNS
        self.batch_seed: int = self.scenario.master_seed
        self.batch_processes: int = 0
        #: Тёмная тема. Выбор запоминается между запусками: тема — это
        #: не настройка боя, переспрашивать её каждый раз незачем.
        self.dark_theme: bool = bool(self._settings().get("dark_theme", False))

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

    # -- настройки интерфейса ----------------------------------------------
    def _settings(self) -> dict[str, Any]:
        """Настройки интерфейса; битый или отсутствующий файл — не беда."""
        try:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save_settings(self, **values: Any) -> None:
        data = {**self._settings(), **values}
        try:
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            self.settings_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        except OSError:
            # Настройка оформления не стоит того, чтобы ронять приложение,
            # если каталог данных вдруг недоступен на запись.
            pass

    def toggle_theme(self) -> None:
        """Переключить светлую и тёмную тему и перерисовать текущий экран."""
        self.dark_theme = not self.dark_theme
        self._save_settings(dark_theme=self.dark_theme)
        if self.theme_switcher is not None:
            self.theme_switcher(self.dark_theme)

    def bind(self, keys: str, action: Callable[[], None]) -> None:
        """Повесить действие экрана на горячую клавишу.

        Все сочетания экранов — с модификатором: обработчик клавиатуры
        общий на всё окно, и `Пробел` или `Del` без модификатора попадал
        бы в него прямо во время набора текста в поле.
        """
        self.shortcuts[keys] = action

    def press(self, keys: str) -> bool:
        """Нажать сочетание. True — если его кто-то обработал."""
        action = self.shortcuts.get(keys)
        if action is None:
            return False
        action()
        return True

    def show_dialog(self, dialog: Any) -> None:
        """Открыть модальное окно; без запущенного окна — тихо ничего."""
        if self.dialog_opener is not None:
            self.dialog_opener(dialog)

    def close_dialog(self) -> None:
        if self.dialog_closer is not None:
            self.dialog_closer()

    # -- выбор папки и файла ------------------------------------------------
    def export_dir(self) -> Path:
        """Куда выгружали в прошлый раз; по умолчанию — каталог результатов."""
        remembered = self._settings().get("export_dir")
        if isinstance(remembered, str) and remembered:
            path = Path(remembered)
            if path.is_dir():
                return path
        return self.results_dir

    def ask_directory(self, title: str, on_pick: Callable[[Path], None]) -> None:
        """Спросить папку системным окном и запомнить выбор.

        Без запущенного окна спрашивать некого — тогда пишем туда же, куда
        писали раньше, чтобы выгрузка из теста или скрипта не молчала.
        """
        initial = self.export_dir()
        if self.directory_asker is None:
            on_pick(initial)
            return

        def picked(chosen: str) -> None:
            path = Path(chosen)
            self._save_settings(export_dir=str(path))
            on_pick(path)

        self.directory_asker(title, str(initial), picked)

    def ask_file(
        self,
        title: str,
        on_pick: Callable[[Path], None],
        *,
        extensions: Sequence[str] = (),
    ) -> None:
        """Спросить файл системным окном; без окна выбирать нечего."""
        if self.file_asker is None:
            return
        self.file_asker(
            title, str(self.export_dir()), tuple(extensions), lambda chosen: on_pick(Path(chosen))
        )

    def refresh(self, *controls: Any) -> None:
        """Обновить контролы, если приложение действительно запущено.

        В тестах экраны строятся без страницы — там обновлять нечего.
        """
        if self.page is None:
            return
        from ui.widgets.common import safe_update

        for control in controls:
            safe_update(control)

    # -- мат.часть ----------------------------------------------------------
    def materiel_usage(self, section: str, name: str) -> list[str]:
        """Где используется запись библиотеки: типы, солдаты, отряды."""
        config = self.config
        places: list[str] = []

        if section == "vehicles":
            for type_name, entry in config.element_types.element_types.items():
                if entry.defaults.vehicle_type == name:
                    places.append(f"тип «{type_name}»")
            for _path, battalion in self.units():
                if any(
                    group.vehicle_type == name
                    for element in battalion.elements
                    for group in element.vehicles
                ):
                    places.append(f"отряд «{battalion.name}»")
        elif section == "weapons":
            for troop_name, troop in config.troops.troops.items():
                if name in (troop.weapon, troop.secondary):
                    places.append(f"солдат «{troop_name}»")
        elif section == "gear":
            for troop_name, troop in config.troops.troops.items():
                if troop.gear == name:
                    places.append(f"солдат «{troop_name}»")
        elif section == "troops":
            for type_name, entry in config.element_types.element_types.items():
                if name in entry.composition:
                    places.append(f"тип «{type_name}»")
        return places

    # -- подразделения ------------------------------------------------------
    def units(self) -> list[tuple[Path, Battalion]]:
        return scan_battalions(self.units_dir).items

    def broken_units(self) -> list[tuple[Path, str]]:
        """Файлы подразделений, которые не читаются, и причина по каждому."""
        return scan_battalions(self.units_dir).broken

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
        return scan_results(self.results_dir).items

    def broken_results(self) -> list[tuple[Path, str]]:
        return scan_results(self.results_dir).broken

    def save_result(self, result: BattleResult) -> Path:
        return save_result(result, self.results_dir)

    # -- бой ----------------------------------------------------------------
    def scenario_fingerprint(self) -> str:
        """Отпечаток сценария: по нему видно, что его правили после начала боя."""
        return json.dumps(self.scenario.model_dump(mode="json"), sort_keys=True)

    def start_battle(self) -> BattleEngine:
        """Создать новый бой по текущему сценарию."""
        self.engine = BattleEngine(self.scenario, self.config)
        self._battle_source = self.scenario_fingerprint()
        self.result = None
        return self.engine

    def ensure_battle(self) -> BattleEngine:
        """Текущий бой, но не чужой: правка сценария начинает бой заново.

        Раньше сюда возвращался движок, построенный по прежнему сценарию —
        новый сид или другое подразделение на пульте не появлялись, и
        было непонятно, почему.
        """
        if self.engine is None or self._battle_source != self.scenario_fingerprint():
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
