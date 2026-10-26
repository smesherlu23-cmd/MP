// Инспектор — панель справа (как в Pages и Keynote): свойства выбранного и вспомогательное, например журнал боя.
// Ширина меняется перетаскиванием края и запоминается; панель скрывается кнопкой в панели инструментов
// (Ctrl+Alt+I). У каждого инспектора (журнал, свойства) свои ширина и видимость.

import { useEffect, useState, type ReactNode } from 'react';
import { get, updateSettings, useApp, type Settings } from '../store';
import { Icon } from './Icon';
import { Splitter } from './ui';

const W = { min: 300, max: 760, def: 420 };

/** Журнал боя хранит настройки в прежних полях (inspector, inspectorWidth), остальные — в inspectors. */
const readShown = (st: Settings, id: string) => (id === 'log' ? st.inspector : st.inspectors?.[id]?.shown) ?? true;
const readWidth = (st: Settings, id: string) => (id === 'log' ? st.inspectorWidth : st.inspectors?.[id]?.width);

function save(id: string, patch: { shown?: boolean; width?: number }) {
  const st = get().settings;
  if (id === 'log')
    return updateSettings({ ...(patch.shown !== undefined && { inspector: patch.shown }), ...(patch.width && { inspectorWidth: patch.width }) });
  updateSettings({ inspectors: { ...st.inspectors, [id]: { ...st.inspectors?.[id], ...patch } } });
}

export const useInspectorShown = (id: string) => useApp((s) => readShown(s.settings, id));
export const inspectorShown = (id: string) => readShown(get().settings, id);
export const toggleInspector = (id: string) => save(id, { shown: !readShown(get().settings, id) });

/** Кнопка показа и скрытия инспектора — для панели инструментов. */
export function InspectorToggle({ id, label }: { id: string; label: string }) {
  const shown = useInspectorShown(id);
  return (
    <button
      type="button"
      className={`tb-icon${shown ? ' on' : ''}`}
      aria-pressed={shown}
      title={`${shown ? 'Скрыть' : 'Показать'}: ${label.toLowerCase()} (Ctrl+Alt+I)`}
      onClick={() => toggleInspector(id)}
    >
      <Icon name="inspector" size={17} />
    </button>
  );
}

export function Inspector({ id, label, def = W.def, children }: { id: string; label: string; def?: number; children: ReactNode }) {
  const shown = useInspectorShown(id);
  const saved = useApp((s) => readWidth(s.settings, id)) ?? def;
  const [w, setW] = useState<number | null>(null);
  const width = w ?? saved;
  useEffect(() => {
    if (w === null) return;
    const t = setTimeout(() => save(id, { width: w }), 300);
    return () => clearTimeout(t);
  }, [w, id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyI') {
        e.preventDefault();
        toggleInspector(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  return (
    // В узком окне инспектор не шире 40% окна — странице остаётся место.
    <aside className={`inspector${shown ? '' : ' hidden'}`} style={{ width: shown ? `min(${width}px, 40cqw)` : 0 }} aria-label={label} inert={!shown}>
      <div className="inspector-body" style={{ width: `min(${width}px, 40cqw)` }}>
        {children}
      </div>
      {shown && <Splitter side="right" label={`Ширина: ${label.toLowerCase()}`} width={width} min={W.min} max={W.max} def={def} onChange={setW} />}
    </aside>
  );
}
