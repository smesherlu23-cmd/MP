// Участки боя в сценарии: у каждого своя дистанция, при желании — своя местность и укрепления сторон.
// Подразделения назначаются на участок на сторонах; переброски между участками нет.

import { newId, nodeSectors, summarizeUnits, type Ruleset, type Scenario, type SectorDef, type UnitNode } from '../../engine';
import { historyStep, toastUndoable, updateScenario } from '../store';
import { Btn, Info, Section, Sel, Txt, fmt0 } from './ui';

const HINT =
  'Без участков бой идёт на одной общей дистанции. Если поле боя делится на направления (фланги, высота и деревня), задайте участки: у каждого своя дистанция и сближение, ' +
  'при желании — своя местность и укрепления. Наблюдение и прямой огонь — только в пределах участка; миномёты и артиллерия достают и соседние (коэффициент в наборе правил). ' +
  'Переброски между участками нет. Подразделения назначаются на участок на сторонах (по умолчанию — первый участок).';

export function SectorsEditor({ sc, rsc, rs }: { sc: Scenario; rsc: Scenario; rs: Ruleset }) {
  const sectors = sc.sectors ?? [];
  const upd = (fn: (d: Scenario) => void) => updateScenario(sc.id, fn);
  const setSec = (i: number, fn: (s: SectorDef) => void) => upd((d) => fn(d.sectors![i]));
  const add = () =>
    upd((d) => {
      d.sectors ??= [];
      if (!d.sectors.length) d.sectors.push({ id: newId('sec'), name: 'Участок 1' });
      d.sectors.push({ id: newId('sec'), name: `Участок ${d.sectors.length + 1}` });
    });
  const remove = (i: number) => {
    const sec = sectors[i];
    historyStep(`удаление участка «${sec.name}»`);
    upd((d) => {
      d.sectors!.splice(i, 1);
      for (const sd of d.sides) {
        if (!sd.sectorOf) continue;
        for (const [k, v] of Object.entries(sd.sectorOf)) if (v === sec.id) delete sd.sectorOf[k];
      }
      if (!d.sectors!.length) delete d.sectors;
    });
    toastUndoable(`Участок «${sec.name}» удалён; его подразделения — на первом участке.`);
  };

  // Сколько сил каждой стороны на участке.
  const counts = sectors.map((sec) =>
    rsc.sides.map((sd) => {
      const map = nodeSectors(sd, sectors[0]?.id ?? '');
      const nodes: UnitNode[] = [];
      const walk = (n: UnitNode) => {
        if (map.get(n.id) === sec.id && n.composition.length) nodes.push({ ...n, children: [] });
        n.children.forEach(walk);
      };
      for (const f of sd.formations) walk(f);
      return summarizeUnits(nodes, rs).persCur;
    }),
  );
  const bandName = (id?: string) => rs.rangeBands.find((b) => b.id === (id || sc.startBand))?.name ?? '—';
  const summary = sectors.length ? sectors.map((s) => `${s.name}: ${bandName(s.startBand).toLowerCase()}`).join(' · ') : 'одна общая дистанция';

  return (
    <Section id="scenario-sectors" title="Участки боя" summary={summary} defaultOpen={sectors.length > 0}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {HINT}
      </p>
      {sectors.map((sec, i) => (
        <div key={sec.id} className="plan-row sector-row">
          <div className="plan-main">
            <Txt value={sec.name} onChange={(v) => setSec(i, (s) => void (s.name = v))} placeholder="название участка" width={170} />
            <span className="plan-label">дистанция</span>
            <Sel
              value={sec.startBand ?? ''}
              onChange={(v) => setSec(i, (s) => void (v ? (s.startBand = v) : delete s.startBand))}
              options={[{ value: '', label: `как в сценарии (${bandName().toLowerCase()})` }, ...rs.rangeBands.map((b) => ({ value: b.id, label: b.name }))]}
              width={210}
            />
            <span className="grow" />
            <span className="faint small nowrap" title="Личный состав сторон на участке">
              {rsc.sides.map((sd, j) => `${sd.name}: ${fmt0(counts[i][j])}`).join(' · ')} чел.
            </span>
            <Btn sm kind="ghost" icon title="Удалить участок" onClick={() => remove(i)}>
              ×
            </Btn>
          </div>
          <div className="plan-extra">
            {rs.conditions.map((cat) => (
              <Sel
                key={cat.id}
                value={sec.conditions?.[cat.id] ?? ''}
                onChange={(v) =>
                  setSec(i, (s) => {
                    s.conditions ??= {};
                    if (v) s.conditions[cat.id] = v;
                    else delete s.conditions[cat.id];
                  })
                }
                options={[{ value: '', label: `${cat.name}: как в сценарии` }, ...cat.options.map((o) => ({ value: o.id, label: `${cat.name}: ${o.name}` }))]}
                width={215}
              />
            ))}
            {sc.sides.map((sd) => (
              <Sel
                key={sd.id}
                value={sec.fortification?.[sd.id] ?? ''}
                onChange={(v) =>
                  setSec(i, (s) => {
                    s.fortification ??= {};
                    if (v) s.fortification[sd.id] = v;
                    else delete s.fortification[sd.id];
                  })
                }
                options={[
                  { value: '', label: `${sd.name}: укрепления стороны` },
                  ...rs.fortifications.map((o) => ({ value: o.id, label: `${sd.name}: ${o.name}` })),
                ]}
                width={220}
                title={`Укрепления стороны «${sd.name}» на этом участке`}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: sectors.length ? 10 : 0 }}>
        <Btn sm onClick={add}>
          {sectors.length ? '+ Участок' : '+ Разделить поле боя на участки'}
        </Btn>
        {sectors.length > 0 && (
          <Info text="Назначить подразделение на участок — в карточке стороны, у подразделения (и у его частей в структуре ▸). Не назначенные — на первом участке." />
        )}
      </div>
    </Section>
  );
}

/**
 * Выбор участка для подразделения на стороне. У подразделения стороны (root) — сам участок (не задан —
 * первый); у части — «как у старшего» или свой.
 */
export function SectorSelect({
  sc,
  value,
  onChange,
  root,
  mini,
}: {
  sc: Scenario;
  value: string | undefined;
  onChange: (v: string) => void;
  root?: boolean;
  mini?: boolean;
}) {
  const sectors = sc.sectors ?? [];
  if (!sectors.length) return null;
  const opts = root
    ? sectors.map((s, i) => ({ value: i === 0 && !value ? '' : s.id, label: s.name }))
    : [{ value: '', label: 'участок ↑' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))];
  if (mini)
    return (
      <select
        className="order-mini sector-mini"
        value={value ?? ''}
        title="Участок боя этой части («участок ↑» — как у старшего)"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return <Sel value={value ?? ''} onChange={onChange} options={opts} width={120} title="Участок боя (подчинённые — там же, если им не задан свой)" />;
}
