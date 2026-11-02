// Узкое окно (ноутбук с крупным масштабом, окно у края экрана): боковая панель и инспекторы не сжимают
// страницу, а выезжают поверх неё. Их видимость в узком окне — временная: сохранённые настройки (видимость
// в обычном окне) не меняются.

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { get, updateSettings, useApp } from './store';

/**
 * Меньше какой ширины (CSS px, с учётом масштаба) панель — поверх страницы: боковая — по ширине окна, инспектор — по
 * ширине области страницы (окно без боковой панели). Те же числа — в styles.css.
 */
export const NARROW = { side: 900, insp: 760 } as const;

const queries = new Map<number, MediaQueryList>();
function mq(px: number): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  let q = queries.get(px);
  if (!q) {
    q = window.matchMedia(`(max-width: ${px - 0.02}px)`);
    queries.set(px, q);
  }
  return q;
}

export const isNarrow = (px: number) => !!mq(px)?.matches;

export function useNarrow(px: number) {
  return useSyncExternalStore(
    (cb) => {
      const q = mq(px);
      q?.addEventListener('change', cb);
      return () => q?.removeEventListener('change', cb);
    },
    () => isNarrow(px),
    () => false,
  );
}

/** Ширина области страницы (без боковой панели) — её меряет окно (App). */
export const useMainWidth = create<{ w: number }>(() => ({ w: typeof window === 'undefined' ? 1440 : window.innerWidth }));
export const isInspNarrow = () => useMainWidth.getState().w < NARROW.insp;
export const useInspNarrow = () => useMainWidth((x) => x.w < NARROW.insp);

/** Что открыто поверх страницы в узком окне: боковая панель и инспекторы (по id). */
export const usePeek = create<{ side: boolean; insp: Record<string, boolean> }>(() => ({ side: false, insp: {} }));

export const sidebarShown = () => (isNarrow(NARROW.side) ? usePeek.getState().side : get().settings.sidebar);

export function useSidebarShown() {
  const narrow = useNarrow(NARROW.side);
  const peek = usePeek((x) => x.side);
  const saved = useApp((s) => s.settings.sidebar);
  return narrow ? peek : saved;
}

export function setSidebar(on: boolean) {
  if (isNarrow(NARROW.side)) usePeek.setState({ side: on });
  else updateSettings({ sidebar: on });
}

export const toggleSidebar = () => setSidebar(!sidebarShown());

/** Закрыть всё, что выехало поверх страницы (переход на другую страницу, Escape). */
export const closePeek = () => {
  const p = usePeek.getState();
  if (p.side || Object.values(p.insp).some(Boolean)) usePeek.setState({ side: false, insp: {} });
};
