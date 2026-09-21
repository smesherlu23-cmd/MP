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


class Echelon(StrEnum):
    """Масштаб группы — от звена до полка.

    Порядок объявления значим: деление группы выдаёт подгруппам следующую
    ступень вниз, поэтому рота делится на взводы, а взвод — на отделения
    без единого числа в коде.
    """

    TEAM = "звено"
    SQUAD = "отделение"
    PLATOON = "взвод"
    COMPANY = "рота"
    BATTALION = "батальон"
    REGIMENT = "полк"


#: Ступени по возрастанию — источник правды для «уровнем ниже/выше».
ECHELON_ORDER: tuple[Echelon, ...] = (
    Echelon.TEAM,
    Echelon.SQUAD,
    Echelon.PLATOON,
    Echelon.COMPANY,
    Echelon.BATTALION,
    Echelon.REGIMENT,
)


#: Окончание порядкового числительного по роду слова: «1-й взвод», но
#: «1-я рота» и «1-е отделение». Нужен только для имён по умолчанию.
ECHELON_ORDINAL: dict[Echelon, str] = {
    Echelon.TEAM: "-е",
    Echelon.SQUAD: "-е",
    Echelon.PLATOON: "-й",
    Echelon.COMPANY: "-я",
    Echelon.BATTALION: "-й",
    Echelon.REGIMENT: "-й",
}


def echelon_ordinal(index: int, echelon: Echelon) -> str:
    """«1-й взвод», «2-я рота», «3-е отделение» — имя подгруппы по умолчанию."""
    return f"{index}{ECHELON_ORDINAL[echelon]} {echelon}"


def echelon_below(echelon: Echelon) -> Echelon:
    """Ступень ниже; ниже звена не опускаемся."""
    index = ECHELON_ORDER.index(echelon)
    return ECHELON_ORDER[max(0, index - 1)]


def echelon_above(echelon: Echelon) -> Echelon:
    """Ступень выше; выше полка не поднимаемся."""
    index = ECHELON_ORDER.index(echelon)
    return ECHELON_ORDER[min(len(ECHELON_ORDER) - 1, index + 1)]


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
