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

#: Отступ вложенности в конфигах проекта.
INDENT = 2


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
    if isinstance(value, _InlineList):
        return format_list(value.values)
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


def _walk_keys(text: str):
    """Строки файла с их отступом и полным путём ключа."""
    stack: list[tuple[int, str]] = []
    for index, line in enumerate(text.splitlines(keepends=True)):
        body = line.rstrip("\n")
        if body.lstrip().startswith(("#", "-")) or not body.strip():
            yield index, line, None, None
            continue
        match = _LINE.match(body)
        if match is None:
            yield index, line, None, None
            continue
        indent = len(match["indent"])
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, match["key"].strip()))
        yield index, line, indent, tuple(key for _, key in stack)


def block_bounds(text: str, path: Sequence[str]) -> tuple[int, int, int]:
    """Границы блока по пути: первая строка, строка за блоком и отступ.

    Блок — сам ключ и всё, что вложено в него по отступу. Комментарии
    и пустые строки внутри блока считаются его частью.
    """
    target = tuple(path)
    start: int | None = None
    own_indent = 0
    end: int | None = None
    lines = text.splitlines(keepends=True)

    for index, _line, indent, current in _walk_keys(text):
        if start is None:
            if current == target:
                start, own_indent = index, indent or 0
            continue
        if indent is not None and indent <= own_indent:
            end = index
            break
    if start is None:
        raise PatchError(".".join(target))
    if end is None:
        end = len(lines)
    # Хвостовые пустые строки блоку не принадлежат, а пустая строка перед
    # ним — это его отбивка: она уходит вместе с блоком, поэтому удаление
    # и добавление записи дают файл без лишних пропусков.
    while end > start + 1 and not lines[end - 1].strip():
        end -= 1
    while start > 0 and not lines[start - 1].strip():
        start -= 1
    return start, end, own_indent


def remove_entry(text: str, path: Sequence[str]) -> str:
    """Убрать блок целиком — вместе с его собственными комментариями."""
    start, end, _ = block_bounds(text, path)
    lines = text.splitlines(keepends=True)
    return "".join(lines[:start] + lines[end:])


def append_entry(
    text: str, parent: Sequence[str], key: str, fields: Mapping[str, Any]
) -> str:
    """Добавить запись в конец блока ``parent``, сохранив оформление файла."""
    _start, end, parent_indent = block_bounds(text, parent)
    lines = text.splitlines(keepends=True)

    child_indent = parent_indent + INDENT
    for _index, _line, indent, current in _walk_keys(text):
        if current and len(current) == len(parent) + 1 and current[:-1] == tuple(parent):
            child_indent = indent or child_indent
            break

    block = [f"{' ' * child_indent}{key}:\n"]
    block += [
        f"{' ' * (child_indent + INDENT)}{name}: {format_scalar(value)}\n"
        for name, value in fields.items()
    ]
    tail = "" if lines[end - 1].endswith("\n") else "\n"
    return "".join(lines[:end]) + tail + "\n" + "".join(block) + "".join(lines[end:])


def format_list(values: Sequence[Any]) -> str:
    """Список в поточной записи YAML: ``[a, b, c]``."""
    return "[" + ", ".join(format_scalar(value) for value in values) + "]"


def patch_list(text: str, path: Sequence[str], values: Sequence[Any]) -> str:
    """Заменить список, записанный в одну строку (``folders: [...]``)."""
    return patch_scalar(text, path, _InlineList(values))


class _InlineList:
    """Обёртка, чтобы :func:`format_scalar` отдал поточный список."""

    def __init__(self, values: Sequence[Any]) -> None:
        self.values = list(values)


def field_notes(text: str) -> dict[tuple[str, ...], str]:
    """Пояснение к каждому ключу — из комментариев самого конфига.

    Конфиги в этом проекте подробно откомментированы по-русски, и редактор
    коэффициентов показывал вместо этого голый ключ вроде ``PRESSURE_EXPONENT``.
    Пояснение — комментарий в той же строке, а если его нет, то сплошной
    блок комментариев прямо над ключом с тем же отступом.
    """
    notes: dict[tuple[str, ...], str] = {}
    stack: list[tuple[int, str]] = []
    block: list[str] = []
    block_indent = -1

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            block, block_indent = [], -1
            continue
        if stripped.startswith("#"):
            indent = len(line) - len(line.lstrip())
            if block and indent != block_indent:
                block = []
            block_indent = indent
            block.append(stripped.lstrip("#").strip())
            continue
        if stripped.startswith("-"):
            block, block_indent = [], -1
            continue
        match = _LINE.match(line)
        if match is None:
            block, block_indent = [], -1
            continue
        indent = len(match["indent"])
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, match["key"].strip()))
        rest = match["rest"]
        comment_at = rest.find("#")
        inline = rest[comment_at + 1 :].strip() if comment_at >= 0 else ""
        above = " ".join(part for part in block if part) if block_indent == indent else ""
        note = inline or above
        if note:
            notes[tuple(key for _, key in stack)] = note
        block, block_indent = [], -1
    return notes


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
