"""Папки библиотек: дерево, переименование, перенос, удаление.

Папка — это путь через «/»: ``Бронетехника/Танки``. Список папок хранится
в разделе отдельно от записей, поэтому пустая папка не исчезает, а у
записи есть поле ``folder`` с полным путём.

Все операции возвращают новый текст YAML: правки идут точечно, поэтому
пояснения в конфигах остаются на месте (§5).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from core.config.introspect import PatchError, patch_list, patch_scalar

#: Разделитель уровней в пути папки.
SEPARATOR = "/"

#: Куда попадают записи, у которых папка не указана.
ROOT = ""


def parent_of(path: str) -> str:
    """Родительская папка; у папки верхнего уровня — корень."""
    return path.rpartition(SEPARATOR)[0]


def name_of(path: str) -> str:
    """Собственное имя папки без пути."""
    return path.rpartition(SEPARATOR)[2]


def join(parent: str, name: str) -> str:
    name = name.replace(SEPARATOR, "-").strip()
    return f"{parent}{SEPARATOR}{name}" if parent else name


def depth(path: str) -> int:
    return path.count(SEPARATOR) if path else 0


def is_inside(path: str, folder: str) -> bool:
    """Лежит ли ``path`` в папке ``folder`` или в её подпапках."""
    return path == folder or path.startswith(folder + SEPARATOR)


def tree(folders: Sequence[str]) -> list[str]:
    """Папки в порядке обхода дерева: родитель, потом его содержимое.

    Недостающие промежуточные уровни достраиваются: папка
    ``Броня/Танки`` без объявленной ``Броня`` всё равно покажется в дереве.
    """
    known: set[str] = set()
    for path in folders:
        parts = path.split(SEPARATOR)
        for index in range(1, len(parts) + 1):
            known.add(SEPARATOR.join(parts[:index]))
    return sorted(known, key=lambda path: [part.lower() for part in path.split(SEPARATOR)])


def unique(name: str, taken: Sequence[str]) -> str:
    """Имя, которого ещё нет среди ``taken``."""
    if name not in taken:
        return name
    index = 2
    while f"{name} {index}" in taken:
        index += 1
    return f"{name} {index}"


def _folders_of(raw: Mapping[str, object]) -> list[str]:
    folders = raw.get("folders", [])
    return [str(item) for item in folders] if isinstance(folders, list) else []


def _entries_of(raw: Mapping[str, object], key: str) -> dict[str, Mapping[str, object]]:
    entries = raw.get(key, {})
    return dict(entries) if isinstance(entries, dict) else {}


def create(text: str, raw: Mapping[str, object], parent: str, name: str) -> tuple[str, str]:
    """Завести папку внутри ``parent``. Возвращает текст и путь новой папки."""
    folders = _folders_of(raw)
    path = join(parent, unique(name, [name_of(f) for f in folders if parent_of(f) == parent]))
    return patch_list(text, ("folders",), [*folders, path]), path


def rename(
    text: str, raw: Mapping[str, object], key: str, path: str, new_name: str
) -> tuple[str, str]:
    """Переименовать папку вместе с подпапками и записями внутри."""
    folders = _folders_of(raw)
    if path not in tree(folders):
        raise PatchError(path)
    target = join(parent_of(path), new_name)
    if target == path or not name_of(target):
        return text, path

    moved = [target if item == path else _replace_prefix(item, path, target) for item in folders]
    text = patch_list(text, ("folders",), moved)
    text = _move_entries(text, raw, key, path, target)
    return text, target


def move(
    text: str, raw: Mapping[str, object], key: str, path: str, new_parent: str
) -> tuple[str, str]:
    """Перенести папку в другую — так делается вложенность."""
    folders = _folders_of(raw)
    if new_parent and is_inside(new_parent, path):
        raise PatchError(f"{path} → {new_parent}")
    target = join(new_parent, name_of(path))
    if target == path:
        return text, path

    moved = [target if item == path else _replace_prefix(item, path, target) for item in folders]
    text = patch_list(text, ("folders",), moved)
    text = _move_entries(text, raw, key, path, target)
    return text, target


def remove(text: str, raw: Mapping[str, object], key: str, path: str) -> str:
    """Удалить папку. Содержимое и подпапки поднимаются на уровень выше."""
    folders = _folders_of(raw)
    up = parent_of(path)
    kept: list[str] = []
    for item in folders:
        if item == path:
            continue
        if is_inside(item, path):
            kept.append(join(up, item[len(path) + 1 :]))
            continue
        kept.append(item)
    text = patch_list(text, ("folders",), kept)

    for entry_key, entry in _entries_of(raw, key).items():
        folder = str(entry.get("folder", ""))
        if not is_inside(folder, path):
            continue
        rest = folder[len(path) + 1:] if folder != path else ""
        text = patch_scalar(text, (key, entry_key, "folder"), join(up, rest) if rest else up)
    return text


def _replace_prefix(item: str, old: str, new: str) -> str:
    if not is_inside(item, old):
        return item
    rest = item[len(old) :]
    return new + rest


def _move_entries(
    text: str, raw: Mapping[str, object], key: str, old: str, new: str
) -> str:
    for entry_key, entry in _entries_of(raw, key).items():
        folder = str(entry.get("folder", ""))
        if not is_inside(folder, old):
            continue
        text = patch_scalar(text, (key, entry_key, "folder"), _replace_prefix(folder, old, new))
    return text
