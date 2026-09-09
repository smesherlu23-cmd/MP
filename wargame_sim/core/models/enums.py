"""Перечисления предметной области. Значения — те же слова, что в конфиге."""

from __future__ import annotations

from enum import StrEnum


class Side(StrEnum):
    A = "A"
    B = "B"


class Terrain(StrEnum):
    PLAIN = "равнина"
    HILLS = "холмы"
    FOREST = "лес"
    URBAN = "застройка"
    SWAMP = "болото"


class TimeOfDay(StrEnum):
    DAY = "день"
    TWILIGHT = "сумерки"
    NIGHT = "ночь"


class Weather(StrEnum):
    CLEAR = "ясная"
    RAIN = "дождь"
    SNOW = "снег"
    FOG = "туман"


class IntelLevel(StrEnum):
    NONE = "нет"
    PARTIAL = "частичные"
    FULL = "полные"


class Order(StrEnum):
    ATTACK = "атака"
    DEFENCE = "оборона"
    AMBUSH = "засада"
    RECON = "разведка"
    ENTRENCH = "закрепление"
    RETREAT = "отступление"
    PANIC = "паническое бегство"


class ContactLevel(StrEnum):
    NONE = "нет"
    PARTIAL = "частичный"
    FULL = "полный"


class BattalionState(StrEnum):
    FIGHTING = "в бою"
    RETREATING = "отступает"
    PANIC = "паника"
    ROUTED = "разгромлен"
    TASK_DONE = "задача выполнена"


class EndReason(StrEnum):
    ROUT = "разгром"
    RETREAT = "отступление"
    PANIC = "паника"
    TASK = "задача"
    TURN_LIMIT = "лимит ходов"


class Winner(StrEnum):
    A = "A"
    B = "B"
    DRAW = "ничья"
