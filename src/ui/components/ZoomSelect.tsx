// Масштаб интерфейса: список для настроек.

import { ZOOM, autoZoom, setZoom, useScreenArea } from '../prefs';
import { useApp } from '../store';
import { Sel } from './ui';

/** Варианты масштаба интерфейса для списка: «авто» (по экрану) и свои. */
export function zoomOptions() {
  const auto = autoZoom();
  return [
    { value: 'auto', label: `Авто — ${Math.round(auto * 100)}%` },
    ...Array.from({ length: Math.round((ZOOM.max - ZOOM.min) / ZOOM.step) + 1 }, (_, i) => {
      const v = Math.round((ZOOM.min + i * ZOOM.step) * 100) / 100;
      return { value: String(v), label: `${Math.round(v * 100)}%` };
    }),
  ];
}

/** Список масштаба: «авто», пока свой не выбран. */
export function ZoomSelect() {
  const own = useApp((s) => s.settings.zoom);
  useScreenArea();
  return (
    <Sel value={own === undefined ? 'auto' : String(own)} width={180} onChange={(v) => setZoom(v === 'auto' ? 'auto' : Number(v))} options={zoomOptions()} />
  );
}

export const ZOOM_HINT = 'Авто — по размеру экрана: обычный, а на 4K и больше — крупнее. Ctrl+плюс и Ctrl+минус — крупнее и мельче, Ctrl+0 — снова авто.';
