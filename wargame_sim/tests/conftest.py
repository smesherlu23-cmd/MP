"""Общие фикстуры тестов."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from core.config import AppConfig, ConfigStore
from core.models import Environment, Order, Scenario, Side
from core.samples import make_battalion, make_scenario

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = PROJECT_ROOT / "config"


@pytest.fixture(scope="session")
def config() -> AppConfig:
    """Рабочая конфигурация проекта."""
    return ConfigStore(CONFIG_DIR).load()


@pytest.fixture()
def config_copy(tmp_path: Path) -> ConfigStore:
    """Изолированная копия конфига — можно править, не трогая проект."""
    target = tmp_path / "config"
    shutil.copytree(CONFIG_DIR, target)
    return ConfigStore(target)


@pytest.fixture()
def scenario(config: AppConfig) -> Scenario:
    return make_scenario(config, seed=42)


@pytest.fixture()
def symmetric_scenario(config: AppConfig) -> Scenario:
    return make_scenario(config, symmetric=True, seed=1)


def scenario_with(
    config: AppConfig,
    *,
    order_a: Order = Order.ATTACK,
    order_b: Order = Order.DEFENCE,
    environment: Environment | None = None,
    seed: int = 7,
) -> Scenario:
    """Сценарий с заданными приказами и условиями."""
    return Scenario(
        id="scn_test",
        name="Тестовый бой",
        battalion_a=make_battalion("bat_a", "A", Side.A, config, order=order_a),
        battalion_b=make_battalion("bat_b", "B", Side.B, config, order=order_b),
        environment=environment or Environment(),
        master_seed=seed,
    )
