#!/usr/bin/env python3
"""Запуск десктопного приложения: python app.py"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ui.app import run  # noqa: E402

if __name__ == "__main__":
    run()
