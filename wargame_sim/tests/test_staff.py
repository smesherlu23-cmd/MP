"""Штат подразделения считается по комплекту солдата (§4.1)."""

from __future__ import annotations

import pytest

from core.config import AppConfig, ConfigError
from core.models import Side
from core.samples import make_battalion
from core.staff import element_staff, soldier


def test_soldier_values_come_from_the_kit(config: AppConfig) -> None:
    """Доп. оружие добавляет огневую мощь и противотанковость с весом."""
    rifleman = soldier("Стрелок", config)
    grenadier = soldier("Гранатомётчик", config)
    share = config.staff.secondary_share

    assert rifleman.anti_tank == 0
    assert grenadier.anti_tank == pytest.approx(config.weapon("РПГ").anti_tank * share)
    assert grenadier.firepower > rifleman.firepower
    assert rifleman.protection == config.gear_entry(rifleman.gear).protection


def test_unknown_kit_gives_clear_error(config: AppConfig) -> None:
    with pytest.raises(ConfigError, match="не описано"):
        config.weapon("Бластер")
    with pytest.raises(ConfigError, match="не описан"):
        config.gear_entry("Скафандр")
    with pytest.raises(ConfigError, match="не описан"):
        config.troop("Десантник")


def test_composition_reproduces_the_hand_set_numbers(config: AppConfig) -> None:
    """Переход на состав не должен был сдвинуть ни одного типа элемента."""
    for name, entry in config.element_types.element_types.items():
        summary = element_staff(name, config)
        assert summary is not None, name
        assert summary.personnel == entry.defaults.personnel_full, name
        assert summary.attack == pytest.approx(entry.defaults.attack, abs=0.05), name
        assert summary.defense == pytest.approx(entry.defaults.defense, abs=0.05), name


def test_element_is_built_from_the_staff(config: AppConfig) -> None:
    battalion = make_battalion("bat_s", "Штат", Side.A, config)
    company = next(e for e in battalion.elements if e.type == "стрелковая_рота")
    summary = element_staff("стрелковая_рота", config)
    assert company.personnel_full == summary.personnel
    assert company.attack == pytest.approx(summary.attack)
    assert company.defense == pytest.approx(summary.defense)


def test_rearming_the_composition_changes_the_staff(config_copy) -> None:
    """Выдали роте пулемёты вместо автоматов — огневая мощь выросла."""
    from core.config.introspect import patch_scalar

    base = config_copy.get()
    before = element_staff("стрелковая_рота", base)

    config_copy.save_text(
        "troops",
        patch_scalar(config_copy.raw_text("troops"), ("troops", "Стрелок", "weapon"), "Ручной_пулемёт"),
    )
    after = element_staff("стрелковая_рота", config_copy.get())

    assert after.attack > before.attack
    assert after.personnel == before.personnel


def test_role_share_keeps_the_headquarters_from_fighting(config: AppConfig) -> None:
    """Штаб вооружён, но стрелковой ротой не является."""
    staff_entry = config.element_type("штаб")
    assert staff_entry.staff_attack < 1.0
    assert element_staff("штаб", config).attack < element_staff(
        "стрелковая_рота", config
    ).attack
