// Настраиваемое окно: какие кнопки в панели инструментов и масштаб интерфейса.

import { desktop } from './storage';
import { get, toast, updateSettings, type Settings } from './store';

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

export const ZOOM = { min: 0.8, max: 1.5, step: 0.1 };

export const zoomOf = (st: Settings) => st.zoom ?? 1;

export function setZoom(z: number) {
  const v = Math.round(Math.max(ZOOM.min, Math.min(ZOOM.max, z)) * 100) / 100;
  if (v === zoomOf(get().settings)) return;
  updateSettings({ zoom: v });
  toast(`Масштаб интерфейса: ${Math.round(v * 100)}%`);
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
