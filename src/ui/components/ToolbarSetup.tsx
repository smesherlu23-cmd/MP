// Настройка окна (как «Настроить панель инструментов…» в macOS): какие кнопки показывать и масштаб интерфейса.

import { create } from 'zustand';
import { TOOLBAR_ITEMS, ZOOM, setTbShown, setZoom, tbShown, zoomOf } from '../prefs';
import { updateSettings, useApp } from '../store';
import { Btn, Check, Field, Modal, Sel } from './ui';

const useOpen = create<{ open: boolean }>(() => ({ open: false }));

export const openToolbarSetup = () => useOpen.setState({ open: true });

/** Варианты масштаба интерфейса для списка. */
export const ZOOM_OPTIONS = Array.from({ length: Math.round((ZOOM.max - ZOOM.min) / ZOOM.step) + 1 }, (_, i) => {
  const v = Math.round((ZOOM.min + i * ZOOM.step) * 100) / 100;
  return { value: String(v), label: `${Math.round(v * 100)}%${v === 1 ? ' (обычный)' : ''}` };
});

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
        <Field label="Масштаб интерфейса" hint="Ctrl+плюс и Ctrl+минус — крупнее и мельче, Ctrl+0 — обычный.">
          <Sel value={String(zoomOf(st))} width={180} onChange={(v) => setZoom(Number(v))} options={ZOOM_OPTIONS} />
        </Field>
      </div>
    </Modal>
  );
}
