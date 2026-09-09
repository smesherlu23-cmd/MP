"""Детерминированные потоки случайности (§7).

У боя один ``master_seed``. Каждый бросок берётся из потока, ключ которого —
``(master_seed, turn, phase, element_id)``. Глобальный ``random`` не
используется.

Встроенный ``hash()`` для строк рандомизируется от процесса к процессу
(PYTHONHASHSEED), поэтому ключ сворачивается устойчивым blake2b — иначе
массовое моделирование в ``multiprocessing.Pool`` теряло бы воспроизводимость.
"""

from __future__ import annotations

import hashlib
import random

#: Ширина сида, передаваемого в ``random.Random``.
SEED_BYTES = 8


def stable_hash(*parts: object) -> int:
    """Устойчивый (не зависящий от процесса) хеш ключа потока."""
    payload = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.blake2b(payload, digest_size=SEED_BYTES).digest()
    return int.from_bytes(digest, "big")


class RngStreams:
    """Набор именованных потоков одного боя.

    Поток создаётся лениво и переиспользуется в пределах ключа, поэтому
    несколько бросков подряд дают разные числа, но последовательность
    полностью определяется сидом и порядком фаз.
    """

    def __init__(self, master_seed: int) -> None:
        self.master_seed = int(master_seed)
        self._streams: dict[tuple[int, str, str], random.Random] = {}

    def stream(self, turn: int, phase: str, element_id: str = "-") -> random.Random:
        key = (turn, phase, element_id)
        stream = self._streams.get(key)
        if stream is None:
            stream = random.Random(stable_hash(self.master_seed, turn, phase, element_id))
            self._streams[key] = stream
        return stream

    # -- удобные обёртки ----------------------------------------------------
    def uniform(self, turn: int, phase: str, element_id: str, low: float, high: float) -> float:
        if high < low:
            low, high = high, low
        return self.stream(turn, phase, element_id).uniform(low, high)

    def random(self, turn: int, phase: str, element_id: str = "-") -> float:
        return self.stream(turn, phase, element_id).random()

    def round_stochastic(
        self, value: float, turn: int, phase: str, element_id: str
    ) -> int:
        """Округление с вероятностью, равной дробной части.

        Нужно, чтобы малые доли потерь не пропадали при округлении вниз,
        и чтобы небольшие элементы всё-таки несли потери.
        """
        if value <= 0:
            return 0
        whole = int(value)
        remainder = value - whole
        if remainder and self.random(turn, phase, f"{element_id}#round") < remainder:
            whole += 1
        return whole

    def reset(self) -> None:
        """Сбросить кэш потоков (используется при перезапуске боя)."""
        self._streams.clear()
