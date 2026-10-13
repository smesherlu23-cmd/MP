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
    <div className="stack" style={{ gap: 3 }}>
      {keys.map((k) => {
        const v = props.value[k] ?? 1;
        return (
          <div key={k} className="eff-row" data-tip={STAT_HINTS[k]}>
            <span className="grow small">{STAT_LABELS[k]}</span>
            <Num value={props.value[k]} onChange={(x) => set(k, x)} min={0} step={0.05} width={64} />
            <span className={`eff-pct ${v > 1 ? 'good' : v < 1 ? 'bad' : 'faint'}`}>
              {v >= 1 ? '+' : '−'}
              {Math.abs(Math.round((v - 1) * 100))}%
            </span>
            <span className="eff-del">
              <Btn kind="ghost" sm icon title="Убрать эффект" onClick={() => set(k, undefined)}>
                ×
              </Btn>
            </span>
          </div>
        );
      })}
      {free.length > 0 && (
        <select className="eff-add" value="" onChange={(e) => e.target.value && set(e.target.value as StatKey, 1)} title="Добавить эффект (множитель характеристики)">
          <option value="">+ эффект</option>
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
