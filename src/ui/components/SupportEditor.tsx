// Огневая поддержка стороны вне поля боя: артиллерия, авиация, корабли. Её нельзя поразить; она бьёт
// по вызову ГМ в бою или по плану боя. Сила удара — огневая мощь типа из каталога × число единиц.

import { newId, plural, type Ruleset, type Scenario, type SupportAsset } from '../../engine';
import { useTabState } from '../hooks';
import { updateScenario } from '../store';
import { Btn, Info, Num, Sel, Txt } from './ui';

export function SideSupport({ sc, i, rs }: { sc: Scenario; i: number; rs: Ruleset }) {
  const side = sc.sides[i];
  const list = side.support ?? [];
  const [open, setOpen] = useTabState(`sc-sup:${sc.id}:${i}`, false);
  const upd = (fn: (l: SupportAsset[]) => void) =>
    updateScenario(sc.id, (d) => {
      const sd = d.sides[i];
      sd.support ??= [];
      fn(sd.support);
      if (!sd.support.length) delete sd.support;
    });
  // Сначала — оружие с закрытых позиций: обычно поддержка — это они.
  const types = [...rs.componentTypes].sort((a, b) => Number(b.indirect) - Number(a.indirect) || a.name.localeCompare(b.name, 'ru'));
  const typeName = (id: string) => rs.componentTypes.find((t) => t.id === id)?.name ?? '?';
  const summary = list.length
    ? list.map((a) => `${a.name}: ${a.count} × ${typeName(a.typeId).toLowerCase()}, ${a.missions} ${plural(a.missions, 'удар', 'удара', 'ударов')}`).join('; ')
    : 'нет';
  const add = () => {
    const t = types[0];
    if (!t) return;
    upd((l) => void l.push({ id: newId('sup'), name: t.indirect ? `${t.name} (поддержка)` : t.name, typeId: t.id, count: 4, missions: 3 }));
    setOpen(true);
  };
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button className="sec-toggle" onClick={() => setOpen(!open)}>
          <span className="chev">{open ? '▾' : '▸'}</span>
          <h4>Огневая поддержка</h4>
        </button>
        <Info text="Средства вне поля боя — артиллерия старшего начальника, авиация, корабли. Их нельзя поразить; удар наносится по вызову ГМ в бою (в начале следующего хода) или по плану боя. Сила удара — огневая мощь типа из каталога (лучшая по дистанциям) × число единиц; по необнаруженной цели — слабее." />
        <span className="faint small grow nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={summary}>
          {summary}
        </span>
      </div>
      {open && (
        <div className="cmd-list">
          {list.map((a, ai) => (
            <div key={a.id} className="cmd-row support-row">
              <Txt value={a.name} onChange={(v) => upd((l) => void (l[ai].name = v))} placeholder="название" width={150} />
              <Num value={a.count} onChange={(v) => upd((l) => void (l[ai].count = Math.max(1, Math.round(v))))} min={1} max={500} integer width={58} title="Сколько единиц участвует в одном ударе" />
              <span className="faint small">×</span>
              <Sel value={a.typeId} onChange={(v) => upd((l) => void (l[ai].typeId = v))} options={types.map((t) => ({ value: t.id, label: t.name }))} width={150} />
              <Num value={a.missions} onChange={(v) => upd((l) => void (l[ai].missions = Math.max(0, Math.round(v))))} min={0} max={99} integer width={64} suffix="уд." title="Сколько ударов доступно за бой" />
              <Btn sm kind="ghost" icon title="Убрать" onClick={() => upd((l) => void l.splice(ai, 1))}>
                ×
              </Btn>
            </div>
          ))}
          <Btn sm kind="ghost" onClick={add} disabled={!types.length}>
            + средство поддержки
          </Btn>
        </div>
      )}
    </div>
  );
}
