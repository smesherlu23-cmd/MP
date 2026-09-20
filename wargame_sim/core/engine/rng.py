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
import math
import random
from statistics import NormalDist

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

    def binomial(
        self, trials: int, probability: float, turn: int, phase: str, element_id: str
    ) -> int:
        """Сколько из ``trials`` испытаний удалось при вероятности ``probability``.

        Так бросаются потери: не «посчитали долю и округлили», а честный
        разброс, который сам собой зависит от размера цели — взвод колбасит,
        батальон усредняется. Матожидание равно ``trials * probability``,
        поэтому калибровка от перехода на бросок не едет.

        Берётся ровно один бросок потока (обратная функция распределения),
        поэтому расход потока не зависит от численности: бой остаётся
        воспроизводимым, даже когда в роте стало на человека меньше.
        """
        if trials <= 0 or probability <= 0:
            return 0
        if probability >= 1:
            return trials

        draw = self.random(turn, phase, element_id)
        term = (1.0 - probability) ** trials
        if term == 0.0:
            return self._binomial_normal(trials, probability, draw)

        cumulative = term
        ratio = probability / (1.0 - probability)
        successes = 0
        while draw > cumulative and successes < trials:
            successes += 1
            term *= ratio * (trials - successes + 1) / successes
            cumulative += term
        return successes

    @staticmethod
    def _binomial_normal(trials: int, probability: float, draw: float) -> int:
        """Нормальное приближение — только когда точная сумма недостижима.

        ``(1-p)^n`` уходит за точность double лишь при огромных ``n``, каких
        в батальонном бою не бывает; приближение оставлено, чтобы функция
        не возвращала молча среднее вместо броска.
        """
        mean = trials * probability
        deviation = math.sqrt(trials * probability * (1.0 - probability))
        value = NormalDist(mean, deviation).inv_cdf(draw)
        return max(0, min(trials, round(value)))

    def reset(self) -> None:
        """Сбросить кэш потоков (используется при перезапуске боя)."""
        self._streams.clear()
