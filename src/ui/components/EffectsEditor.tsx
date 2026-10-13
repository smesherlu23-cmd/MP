// Редактор набора эффектов «характеристика ×множитель».

import { STAT_HINTS, STAT_KEYS, STAT_LABELS, type Effects, type StatKey } from '../../engine';
import { Btn, Num } from './ui';

export function EffectsEditor(props: { value: Effects; onChange: (v: Effects) => void; compact?: boolean }) {
  const keys = STAT_KEYS.filter((k) => props.value[k] !== undefined);
  const free = STAT_KEYS.filter((k) => props.value[k] === undefined);
  const set = (k: StatKey, v: number | undefined) => {
    const next: Effects = { ...props.value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    props.onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      {keys.length === 0 && <span className="faint small">Нет эффектов — всё ×1.</span>}
      {keys.map((k) => (
        <div key={k} className="row" style={{ gap: 6, flexWrap: 'nowrap' }} title={STAT_HINTS[k]}>
          <span className="grow small">{STAT_LABELS[k]}</span>
          <span className="faint">×</span>
          <Num value={props.value[k]} onChange={(v) => set(k, v)} min={0} step={0.05} width={70} />
          <span className={`small nowrap ${(props.value[k] ?? 1) > 1 ? 'good' : (props.value[k] ?? 1) < 1 ? 'bad' : 'faint'}`} style={{ width: 44, textAlign: 'right' }}>
            {(props.value[k] ?? 1) >= 1 ? '+' : '−'}
            {Math.abs(Math.round(((props.value[k] ?? 1) - 1) * 100))}%
          </span>
          <Btn kind="ghost" sm icon title="Убрать эффект" onClick={() => set(k, undefined)}>
            ×
          </Btn>
        </div>
      ))}
      {free.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && set(e.target.value as StatKey, 1)}
          style={{ alignSelf: 'flex-start', color: 'var(--muted)' }}
          title="Добавить эффект"
        >
          <option value="">+ эффект…</option>
          {free.map((k) => (
            <option key={k} value={k} title={STAT_HINTS[k]}>
              {STAT_LABELS[k]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Краткая запись эффектов для подсказок: «Огонь ×0.8, Обнаружение ×0.5». */
export function effectsText(e: Effects): string {
  const parts = STAT_KEYS.filter((k) => e[k] !== undefined && e[k] !== 1).map((k) => `${STAT_LABELS[k]} ×${e[k]}`);
  return parts.length ? parts.join(', ') : 'без эффектов';
}
