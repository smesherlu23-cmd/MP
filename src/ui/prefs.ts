// Настраиваемое окно: какие кнопки в панели инструментов и масштаб интерфейса.

import { create } from 'zustand';
import { desktop } from './storage';
import { get, toast, updateSettings, useApp, type Settings } from './store';

export type ToolbarItem = 'nav' | 'create' | 'undo' | 'search' | 'find' | 'import' | 'zoom' | 'theme' | 'help';

/** Кнопки панели инструментов в порядке показа; def — показана ли по умолчанию. */
export const TOOLBAR_ITEMS: { id: ToolbarItem; label: string; def: boolean }[] = [
  { id: 'nav', label: 'Назад и вперёд', def: true },
  { id: 'create', label: 'Создать (+)', def: true },
  { id: 'undo', label: 'Отменить и повторить', def: true },
  { id: 'search', label: 'Поиск', def: true },
  { id: 'find', label: 'Найти всё (Ctrl+K)', def: false },
  { id: 'import', label: 'Импорт из файла', def: false },
  { id: 'zoom', label: 'Масштаб', def: false },
  { id: 'theme', label: 'Светлая или тёмная тема', def: false },
  { id: 'help', label: 'Справка', def: false },
];

export const tbShown = (st: Settings, id: ToolbarItem) => st.toolbar?.[id] ?? TOOLBAR_ITEMS.find((x) => x.id === id)!.def;

export function setTbShown(id: ToolbarItem, on: boolean) {
  updateSettings({ toolbar: { ...get().settings.toolbar, [id]: on } });
}

// ------------------------------------------------------------------ масштаб

export const ZOOM = { min: 0.8, max: 2, step: 0.1 };

/** Рабочая область экрана, на котором окно (без масштаба программы): в программе — от главного процесса, в браузере — screen. */
export const useScreenArea = create<{ w: number; h: number }>(
  () => desktop?.display ?? (typeof window === 'undefined' ? { w: 1920, h: 1040 } : { w: window.screen.availWidth, h: window.screen.availHeight }),
);
desktop?.onDisplay?.((d) => useScreenArea.setState(d));

/**
 * Масштаб «авто» — пока пользователь не выбрал свой: на экране до 2560×1400 обычный (100%), на большем — крупнее, чтобы
 * программа выглядела так же, как на 2560×1440: 4K при масштабе Windows 100% — 150%, 5K — 200%. Та же формула — в electron/main.ts.
 */
export function autoZoom({ w, h } = useScreenArea.getState()) {
  const f = Math.min(w / 2560, h / 1400);
  return f <= 1 ? 1 : Math.min(ZOOM.max, Math.floor(f * 10 + 1e-6) / 10);
}

export const zoomOf = (st: Settings) => st.zoom ?? autoZoom();

/** Масштаб в силе (свой или авто) — с подпиской на смену экрана. */
export function useZoom() {
  const own = useApp((s) => s.settings.zoom);
  const area = useScreenArea();
  return own ?? autoZoom(area);
}

const pct = (z: number) => `${Math.round(z * 100)}%`;

/** Свой масштаб или «auto» — по экрану. */
export function setZoom(z: number | 'auto') {
  if (z === 'auto') {
    if (get().settings.zoom === undefined) return;
    updateSettings({ zoom: undefined });
    toast(`Масштаб интерфейса: авто (${pct(autoZoom())})`);
    return;
  }
  const v = Math.round(Math.max(ZOOM.min, Math.min(ZOOM.max, z)) * 100) / 100;
  if (v === zoomOf(get().settings) && get().settings.zoom !== undefined) return;
  updateSettings({ zoom: v });
  toast(`Масштаб интерфейса: ${pct(v)}`);
}

export const zoomBy = (d: number) => setZoom(zoomOf(get().settings) + d);

/**
 * Применить масштаб: в программе — как масштаб страницы (всё окно, со всплывающими меню); в браузере —
 * свойством zoom у окна программы.
 */
export function applyZoom(z: number) {
  if (desktop?.setZoom) desktop.setZoom(z);
  else {
    const app = document.querySelector<HTMLElement>('.app');
    if (app) app.style.zoom = z === 1 ? '' : String(z);
  }
}
