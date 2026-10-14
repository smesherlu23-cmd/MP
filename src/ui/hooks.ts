// Состояние, которое переживает переключение вкладок (выбранный узел, фильтры журнала и т.п.).

import { useCallback, useEffect, useState } from 'react';
import { openTab, tabKey } from './store';

const mem = new Map<string, unknown>();
const listeners = new Map<string, Set<(v: unknown) => void>>();

export function useTabState<T>(key: string, init: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => (mem.has(key) ? (mem.get(key) as T) : init));
  useEffect(() => {
    const fn = (x: unknown) => setV(x as T);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => void listeners.get(key)?.delete(fn);
  }, [key]);
  const set = useCallback(
    (nv: T | ((prev: T) => T)) =>
      setV((prev) => {
        const x = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
        mem.set(key, x);
        return x;
      }),
    [key],
  );
  return [v, set];
}

/** Задать состояние вкладки снаружи (например, выделить узел перед открытием). */
export function setTabState<T>(key: string, v: T) {
  mem.set(key, v);
  listeners.get(key)?.forEach((fn) => fn(v));
}

/** Открыть подразделение (ref: «lib:<id>» или «sc:<сценарий>:<id>») с выделенным узлом. */
export function openUnit(ref: string, nodeId: string, background = false) {
  setTabState(`${tabKey('formation', ref)}:sel`, nodeId);
  openTab('formation', ref, { background });
}
