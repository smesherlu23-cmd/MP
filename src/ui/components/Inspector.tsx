// Инспектор — панель справа (как в Pages и Keynote): сведения о выбранном и вспомогательное, например журнал боя.
// Ширина меняется перетаскиванием края и запоминается; панель скрывается кнопкой в панели инструментов.

import { useEffect, useState, type ReactNode } from 'react';
import { updateSettings, useApp } from '../store';
import { Icon } from './Icon';
import { Splitter } from './ui';

const W = { min: 300, max: 760, def: 420 };

export const useInspectorShown = () => useApp((s) => s.settings.inspector ?? true);
export const toggleInspector = () => updateSettings({ inspector: !(useApp.getState().settings.inspector ?? true) });

/** Кнопка показа и скрытия инспектора — для панели инструментов. */
export function InspectorToggle({ label }: { label: string }) {
  const shown = useInspectorShown();
  return (
    <button
      type="button"
      className={`tb-icon${shown ? ' on' : ''}`}
      aria-pressed={shown}
      title={`${shown ? 'Скрыть' : 'Показать'}: ${label.toLowerCase()} (Ctrl+Alt+I)`}
      onClick={toggleInspector}
    >
      <Icon name="inspector" size={17} />
    </button>
  );
}

export function Inspector({ label, children }: { label: string; children: ReactNode }) {
  const shown = useInspectorShown();
  const saved = useApp((s) => s.settings.inspectorWidth) ?? W.def;
  const [w, setW] = useState<number | null>(null);
  const width = w ?? saved;
  useEffect(() => {
    if (w === null) return;
    const t = setTimeout(() => updateSettings({ inspectorWidth: w }), 300);
    return () => clearTimeout(t);
  }, [w]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyI') {
        e.preventDefault();
        toggleInspector();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    // В узком окне инспектор не шире 40% окна — странице остаётся место.
    <aside className={`inspector${shown ? '' : ' hidden'}`} style={{ width: shown ? `min(${width}px, 40cqw)` : 0 }} aria-label={label} inert={!shown}>
      <div className="inspector-body" style={{ width: `min(${width}px, 40cqw)` }}>
        {children}
      </div>
      {shown && <Splitter side="right" label={`Ширина: ${label.toLowerCase()}`} width={width} min={W.min} max={W.max} def={W.def} onChange={setW} />}
    </aside>
  );
}
