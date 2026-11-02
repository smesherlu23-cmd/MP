// Общее для разделов набора правил.

import type { Ruleset } from '../../../engine';

export type Upd = (fn: (r: Ruleset) => void) => void;

/** Сдвинуть элемент списка на место выше (−1) или ниже (+1). */
export function moveIn<T>(arr: T[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

/** Пункты меню «Выше / Ниже» для карточки списка: порядок карточек — порядок в выпадающих списках. */
export function moveItems(i: number, n: number, move: (dir: -1 | 1) => void, labels: [string, string] = ['Выше', 'Ниже']) {
  return [
    { label: labels[0], disabled: i === 0, onClick: () => move(-1) },
    { label: labels[1], disabled: i === n - 1, onClick: () => move(1) },
  ];
}
