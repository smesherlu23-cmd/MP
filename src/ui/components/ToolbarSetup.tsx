// Настройка окна (как «Настроить панель инструментов…» в macOS): какие кнопки показывать и масштаб интерфейса.

import { create } from 'zustand';
import { TOOLBAR_ITEMS, ZOOM, autoZoom, setTbShown, setZoom, tbShown, useScreenArea } from '../prefs';
import { updateSettings, useApp } from '../store';
import { Btn, Check, Field, Modal, Sel } from './ui';

const useOpen = create<{ open: boolean }>(() => ({ open: false }));

export const openToolbarSetup = () => useOpen.setState({ open: true });

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

export function ToolbarSetupHost() {
  const open = useOpen((x) => x.open);
  const st = useApp((s) => s.settings);
  if (!open) return null;
  const close = () => useOpen.setState({ open: false });
  return (
    <Modal
      title="Настройка окна"
      onClose={close}
      footer={
        <>
          <Btn kind="ghost" onClick={() => updateSettings({ toolbar: undefined })} title="Кнопки — как после установки">
            Как было
          </Btn>
          <span className="grow" />
          <Btn kind="primary" onClick={close}>
            Готово
          </Btn>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="muted small">Кнопки справа в панели инструментов. Действия открытой страницы показываются всегда.</div>
        <div className="tb-setup">
          {TOOLBAR_ITEMS.map((x) => (
            <Check key={x.id} value={tbShown(st, x.id)} onChange={(v) => setTbShown(x.id, v)}>
              {x.label}
            </Check>
          ))}
        </div>
        <Field label="Масштаб интерфейса" hint={ZOOM_HINT}>
          <ZoomSelect />
        </Field>
      </div>
    </Modal>
  );
}
