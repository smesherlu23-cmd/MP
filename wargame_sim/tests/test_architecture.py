"""Архитектурные ограничения из §2."""

from __future__ import annotations

import ast
import subprocess
import sys
import textwrap
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CORE = PROJECT_ROOT / "core"
UI = PROJECT_ROOT / "ui"


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


def test_core_does_not_import_flet() -> None:
    """`core/` не импортирует flet (§2)."""
    offenders = [
        path.relative_to(PROJECT_ROOT)
        for path in CORE.rglob("*.py")
        if "flet" in _imported_modules(path)
    ]
    assert not offenders, f"flet импортируется в core: {offenders}"


def test_core_does_not_import_ui() -> None:
    offenders = [
        path.relative_to(PROJECT_ROOT)
        for path in CORE.rglob("*.py")
        if "ui" in _imported_modules(path)
    ]
    assert not offenders, f"core зависит от ui: {offenders}"


def test_core_is_importable_without_flet() -> None:
    """Ядро работает, даже если flet не установлен.

    Проверяется в отдельном процессе: перезагрузка модулей внутри текущего
    процесса подменила бы классы исключений и сломала другие тесты.
    """
    code = textwrap.dedent(
        f"""
        import builtins, sys
        sys.path.insert(0, {str(PROJECT_ROOT)!r})
        real_import = builtins.__import__

        def guard(name, *args, **kwargs):
            if name.split(".")[0] == "flet":
                raise ImportError("flet недоступен")
            return real_import(name, *args, **kwargs)

        builtins.__import__ = guard
        import core.batch, core.engine.battle, core.report, core.storage  # noqa: F401
        from core.samples import make_scenario
        from core.engine import run_battle
        assert run_battle(make_scenario()).turns > 0
        print("ok")
        """
    )
    completed = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    assert "ok" in completed.stdout


def test_ui_contains_no_formulas() -> None:
    """`ui/` не содержит формул — только вызовы core и отрисовка (§2).

    Признак формулы — арифметика над числовыми литералами, отличными от
    нейтральных 0, 1, 100 (проценты) и мелких констант вёрстки.
    """
    allowed = {0, 1, 2, 100}
    offenders: list[str] = []
    for path in UI.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.BinOp):
                continue
            if not isinstance(node.op, (ast.Mult, ast.Div, ast.Pow)):
                continue
            for side in (node.left, node.right):
                if (isinstance(side, ast.Constant) and isinstance(side.value, float)) or (
                    isinstance(side, ast.Constant)
                    and isinstance(side.value, int)
                    and side.value not in allowed
                ):
                    offenders.append(f"{path.relative_to(PROJECT_ROOT)}:{node.lineno}")
    assert not offenders, f"похоже на формулы в ui: {sorted(set(offenders))}"
