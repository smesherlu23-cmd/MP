// Компетентность командира: в бою — прямо сейчас, в сценарии — в начале боя.

import { defaultCommandLevel, type LevelDef } from '../../engine';

export function CommanderSelect(props: { levels: LevelDef[]; value: number; onChange: (v: number) => void; disabled?: boolean; allowNone?: boolean; tip?: string }) {
  const def = defaultCommandLevel({ commandLevels: props.levels });
  const cls = !props.value ? 'none' : props.value < def ? 'worse' : props.value > def ? 'better' : '';
  return (
    <select
      className={`cmd-select ${cls}`}
      value={props.value}
      disabled={props.disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(Number(e.target.value))}
      data-tip={props.tip}
    >
      {props.allowNone && <option value={0}>без командира</option>}
      {props.levels.map((l, i) => (
        <option key={i} value={i + 1}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
