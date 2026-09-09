"""Структурированный журнал боя (§8).

Журнал — не текст, а поток записей. Поле ``breakdown`` обязательно для всех
изменений потерь, морали и боеспособности: по нему ГМ видит, какие именно
модификаторы сработали и с какими числами.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: Округление числовых значений в журнале — чтобы записи были читаемыми
#: и побитово воспроизводимыми.
VALUE_PRECISION = 4


def _round(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return round(value, VALUE_PRECISION)
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round(item) for item in value]
    return value


class Factor(BaseModel):
    """Один сработавший модификатор."""

    model_config = ConfigDict(extra="forbid")

    factor: str
    value: float

    def __init__(self, **data: Any) -> None:
        if "value" in data and isinstance(data["value"], float):
            data["value"] = round(data["value"], VALUE_PRECISION)
        super().__init__(**data)


class LogEntry(BaseModel):
    """Запись журнала."""

    model_config = ConfigDict(extra="forbid")

    turn: int
    phase: str
    actor: str | None = None
    target: str | None = None
    event: str
    before: dict[str, Any] = Field(default_factory=dict)
    after: dict[str, Any] = Field(default_factory=dict)
    breakdown: list[Factor] = Field(default_factory=list)
    text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class BattleLog:
    """Накопитель записей с фильтрами и экспортом.

    ``verbose=False`` оставляет только записи, объясняющие потери, мораль и
    исход боя: массовому моделированию подробности каждой фазы не нужны,
    а объём журнала определяет скорость прогона.
    """

    #: Фазы, которые пишутся только в подробном режиме.
    QUIET_PHASES = frozenset(
        {"detection", "targeting", "damage", "recovery", "supply", "fatigue"}
    )

    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose
        self.entries: list[LogEntry] = []

    def __len__(self) -> int:
        return len(self.entries)

    def __iter__(self):
        return iter(self.entries)

    def add(
        self,
        *,
        turn: int,
        phase: str,
        event: str,
        actor: str | None = None,
        target: str | None = None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        breakdown: Iterable[tuple[str, float]] | Iterable[Factor] | None = None,
        text: str = "",
    ) -> LogEntry | None:
        """Добавить запись; ``breakdown`` принимает пары (фактор, значение)."""
        if not self.verbose and phase in self.QUIET_PHASES:
            return None
        factors: list[Factor] = []
        for item in breakdown or ():
            if isinstance(item, Factor):
                factors.append(item)
            else:
                name, value = item
                factors.append(Factor(factor=name, value=float(value)))
        entry = LogEntry(
            turn=turn,
            phase=phase,
            actor=actor,
            target=target,
            event=event,
            before=_round(before or {}),
            after=_round(after or {}),
            breakdown=factors,
            text=text,
        )
        self.entries.append(entry)
        return entry

    # -- фильтры ------------------------------------------------------------
    def filter(
        self,
        *,
        turn: int | None = None,
        element: str | None = None,
        event: str | None = None,
        phase: str | None = None,
    ) -> list[LogEntry]:
        """Фильтр журнала по ходу, элементу, событию и фазе (§8)."""
        result = self.entries
        if turn is not None:
            result = [entry for entry in result if entry.turn == turn]
        if phase is not None:
            result = [entry for entry in result if entry.phase == phase]
        if event is not None:
            result = [entry for entry in result if entry.event == event]
        if element is not None:
            result = [
                entry for entry in result if element in (entry.actor, entry.target)
            ]
        return list(result)

    def turns(self) -> list[int]:
        return sorted({entry.turn for entry in self.entries})

    def events(self) -> list[str]:
        return sorted({entry.event for entry in self.entries})

    def phases(self) -> list[str]:
        return sorted({entry.phase for entry in self.entries})

    def actors(self) -> list[str]:
        names = {entry.actor for entry in self.entries if entry.actor}
        names |= {entry.target for entry in self.entries if entry.target}
        return sorted(names)

    # -- экспорт ------------------------------------------------------------
    def to_list(self) -> list[dict[str, Any]]:
        return [entry.to_dict() for entry in self.entries]

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_list(), ensure_ascii=False, indent=indent, sort_keys=True)

    def canonical(self) -> str:
        """Каноническая форма журнала — основа для хеша воспроизводимости."""
        return json.dumps(self.to_list(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def digest(self) -> str:
        """Стабильный хеш журнала (одинаков между процессами и запусками)."""
        return hashlib.sha256(self.canonical().encode("utf-8")).hexdigest()

    def to_markdown(self) -> str:
        """Журнал в виде Markdown — для отчёта ГМ."""
        lines: list[str] = ["# Журнал боя", ""]
        for turn in self.turns():
            lines.append(f"## Ход {turn}")
            lines.append("")
            for entry in self.filter(turn=turn):
                head = f"**{entry.phase}**"
                if entry.actor:
                    head += f" · {entry.actor}"
                if entry.target:
                    head += f" → {entry.target}"
                lines.append(f"- {head}: {entry.text or entry.event}")
                if entry.breakdown:
                    factors = ", ".join(f"{f.factor} = {f.value:g}" for f in entry.breakdown)
                    lines.append(f"  - модификаторы: {factors}")
                if entry.before and entry.after:
                    changed = [
                        f"{key}: {entry.before[key]} → {entry.after[key]}"
                        for key in entry.before
                        if key in entry.after and entry.before[key] != entry.after[key]
                    ]
                    if changed:
                        lines.append(f"  - изменения: {'; '.join(changed)}")
            lines.append("")
        return "\n".join(lines)


def log_hash(entries: list[LogEntry]) -> str:
    """Хеш готового списка записей (для результатов, загруженных с диска)."""
    payload = json.dumps(
        [entry.to_dict() for entry in entries],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
