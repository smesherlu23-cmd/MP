// Состояние, которое переживает переключение вкладок (выбранный узел, фильтры журнала и т.п.).

import { useCallback, useState } from 'react';

const mem = new Map<string, unknown>();

export function useTabState<T>(key: string, init: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => (mem.has(key) ? (mem.get(key) as T) : init));
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
