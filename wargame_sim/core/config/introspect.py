"""Разбор конфигурации по схеме: группы, поля, границы, отличия от эталона.

Редактор коэффициентов не знает заранее, какие поля есть в разделе — он
строится по реальной схеме из :mod:`core.config.schema` и по реальному
содержимому YAML. Поэтому новый коэффициент появляется в интерфейсе сам,
без правок в ui (§2, §5).

Здесь же лежит точечная правка YAML: значение меняется прямо в тексте файла,
поэтому комментарии и порядок ключей, ради которых конфиг вообще читаем,
остаются на месте.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Union, get_args, get_origin

from pydantic import BaseModel

from core.config.schema import CONFIG_SCHEMAS

#: Виды полей, которые умеет показать редактор.
KIND_BOOL = "bool"
KIND_INT = "int"
KIND_FLOAT = "float"
KIND_TEXT = "text"
KIND_CURVE = "curve"
KIND_LIST = "list"

#: Границы для поля, у которого в схеме ограничений нет. Это не коэффициент
#: расчёта, а предел поля ввода: настоящую проверку делает pydantic при
#: сохранении, и она же покажет понятную ошибку.
UNBOUNDED_MIN = -1_000_000.0
UNBOUNDED_MAX = 1_000_000.0

#: Ключ, который редактировать нечего: версия схемы показана в подзаголовке.
VERSION_KEY = "schema_version"


@dataclass(frozen=True)
class FieldSpec:
    """Одно значение конфигурации: где лежит, что там и в каких пределах."""

    path: tuple[str, ...]
    kind: str
    value: Any
    minimum: float = UNBOUNDED_MIN
    maximum: float = UNBOUNDED_MAX

    @property
    def key(self) -> str:
        return self.path[-1]

    @property
    def dotted(self) -> str:
        return ".".join(self.path)

    @property
    def editable(self) -> bool:
        """Списки и кривые правятся в режиме YAML — там видно целиком."""
        return self.kind not in (KIND_CURVE, KIND_LIST)


@dataclass(frozen=True)
class GroupSpec:
    """Группа значений — один вложенный словарь YAML."""

    path: tuple[str, ...]
    fields: tuple[FieldSpec, ...]

    @property
    def dotted(self) -> str:
        return ".".join(self.path)

    @property
    def key(self) -> str:
        return self.path[-1] if self.path else ""


# --------------------------------------------------------------------------
# Схема: границы поля
# --------------------------------------------------------------------------
def _model_of(annotation: Any) -> type[BaseModel] | None:
    """Модель, стоящая за аннотацией: сама модель или значение словаря."""
    origin = get_origin(annotation)
    if origin is None:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            return annotation
        return None
    if origin is Union:
        for argument in get_args(annotation):
            found = _model_of(argument)
            if found is not None:
                return found
        return None
    if origin in (dict, Mapping):
        arguments = get_args(annotation)
        return _model_of(arguments[1]) if len(arguments) == 2 else None
    return None


def _is_mapping(annotation: Any) -> bool:
    return get_origin(annotation) in (dict, Mapping)


def _field_info(section: str, path: Sequence[str]) -> Any | None:
    """FieldInfo для точечного пути; ключи словарей пропускаются."""
    current: type[BaseModel] | None = CONFIG_SCHEMAS.get(section)
    info: Any | None = None
    skip_dynamic = False
    for key in path:
        if skip_dynamic:  # имя местности, приказа, типа элемента — не поле схемы
            skip_dynamic = False
            continue
        if current is None:
            return info
        field = current.model_fields.get(key)
        if field is None:
            return None
        info = field
        current = _model_of(field.annotation)
        skip_dynamic = _is_mapping(field.annotation)
    return info


def bounds(section: str, path: Sequence[str]) -> tuple[float, float]:
    """Границы значения из схемы. Строгие «>» ловятся уже при сохранении."""
    info = _field_info(section, path)
    low, high = UNBOUNDED_MIN, UNBOUNDED_MAX
    for item in getattr(info, "metadata", ()) or ():
        for attribute, target in (("ge", "low"), ("gt", "low"), ("le", "high"), ("lt", "high")):
            limit = getattr(item, attribute, None)
            if limit is None:
                continue
            if target == "low":
                low = float(limit)
            else:
                high = float(limit)
    return low, high


# --------------------------------------------------------------------------
# Разбор содержимого раздела
# --------------------------------------------------------------------------
def _kind(value: Any) -> str:
    if isinstance(value, bool):
        return KIND_BOOL
    if isinstance(value, int):
        return KIND_INT
    if isinstance(value, float):
        return KIND_FLOAT
    if isinstance(value, list):
        return KIND_CURVE if value and isinstance(value[0], Mapping) else KIND_LIST
    return KIND_TEXT


def describe(section: str, data: Mapping[str, Any]) -> list[GroupSpec]:
    """Группы и поля раздела в порядке, в котором они лежат в файле."""
    groups: list[GroupSpec] = []
    _walk(section, (), data, groups)
    return groups


def _walk(
    section: str,
    path: tuple[str, ...],
    data: Mapping[str, Any],
    groups: list[GroupSpec],
) -> None:
    fields: list[FieldSpec] = []
    children: list[tuple[tuple[str, ...], Mapping[str, Any]]] = []

    for raw_key, value in data.items():
        key = str(raw_key)  # ключи уровней опыта в YAML — числа
        current = (*path, key)
        if not path and key == VERSION_KEY:
            continue
        if isinstance(value, Mapping):
            children.append((current, value))
            continue
        kind = _kind(value)
        low, high = bounds(section, current)
        fields.append(FieldSpec(path=current, kind=kind, value=value, minimum=low, maximum=high))

    if fields:
        groups.append(GroupSpec(path=path, fields=tuple(fields)))
    for current, value in children:
        _walk(section, current, value, groups)


def flatten(data: Mapping[str, Any], prefix: tuple[str, ...] = ()) -> dict[str, Any]:
    """Словарь «точечный путь → значение»."""
    flat: dict[str, Any] = {}
    for raw_key, value in data.items():
        path = (*prefix, str(raw_key))
        if isinstance(value, Mapping):
            flat.update(flatten(value, path))
        else:
            flat[".".join(path)] = value
    return flat


def differences(current: Mapping[str, Any], reference: Mapping[str, Any]) -> list[str]:
    """Пути значений, которые отличаются от эталона из ``config/defaults``."""
    left, right = flatten(current), flatten(reference)
    return sorted(key for key in set(left) | set(right) if left.get(key) != right.get(key))


# --------------------------------------------------------------------------
# Точечная правка текста YAML
# --------------------------------------------------------------------------
_LINE = re.compile(r"^(?P<indent>[ ]*)(?P<key>[^\s#:][^:]*):(?P<rest>.*)$")
_PLAIN = re.compile(r"^[^\s#&*!|>'\"%@`{}\[\],][^#:]*$")


class PatchError(LookupError):
    """Значение по такому пути в тексте не найдено."""


def format_scalar(value: Any) -> str:
    """Скаляр в записи YAML: без потери типа и без лишних кавычек."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(float(value))
    text = str(value)
    if text and _PLAIN.match(text) and text.strip() == text:
        return text
    return json.dumps(text, ensure_ascii=False)


def patch_scalar(text: str, path: Sequence[str], value: Any) -> str:
    """Заменить одно значение прямо в тексте YAML.

    Комментарии, порядок ключей и выравнивание сохраняются: конфиг в этом
    проекте читают глазами, и терять пояснения из-за правки одного числа
    нельзя. Путь, которого в тексте нет, — :class:`PatchError`.
    """
    target = tuple(path)
    lines = text.splitlines(keepends=True)
    stack: list[tuple[int, str]] = []

    for index, line in enumerate(lines):
        body = line.rstrip("\n")
        if body.lstrip().startswith(("#", "-")) or not body.strip():
            continue
        match = _LINE.match(body)
        if match is None:
            continue
        indent = len(match["indent"])
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, match["key"].strip()))
        if tuple(key for _, key in stack) != target:
            continue

        rest = match["rest"]
        comment_at = rest.find("#")
        comment = rest[comment_at:] if comment_at >= 0 else ""
        head = f"{match['indent']}{match['key']}: {format_scalar(value)}"
        if comment:
            column = len(match["indent"]) + len(match["key"]) + 1 + comment_at
            head += " " * max(1, column - len(head)) + comment
        lines[index] = head + ("\n" if line.endswith("\n") else "")
        return "".join(lines)

    raise PatchError(".".join(target))
