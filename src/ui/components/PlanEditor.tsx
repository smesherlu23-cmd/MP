// План боя: события сценария по ходам — подход подкреплений, смена приказа, смена условий.
// Работают и в бою, и в массовых прогонах (там ГМ не вмешивается — план и есть его решения).

import { EVENT_KIND_LABELS, newId, walkUnits, type Ruleset, type Scenario, type ScenarioEvent, type ScenarioEventKind, type SideId } from '../../engine';
import { updateScenario } from '../store';
import { Btn, Info, Num, Section, Sel, Txt } from './ui';

const HINT =
  'События наступают в начале указанного хода — в каждом бою и в каждом прогоне. Подкрепление до подхода в бою не участвует: не стреляет, не несёт потерь и не считается в задачах. ' +
  'Вероятность и разброс по времени делают план неточным: массовые прогоны покажут, сколько от этого зависит. В бою ГМ может ввести подкрепление раньше («ввести сейчас» в таблице сил).';

const KIND_TIP: Record<ScenarioEventKind, string> = {
  arrive: 'Подразделение вне боя до этого хода, затем вступает со своим приказом.',
  order: 'Подразделение (со всеми подчинёнными) получает новый приказ: например, ввод резерва или отход.',
  conditions: 'Меняются условия боя: наступает ночь, начинается дождь…',
  strike: 'Средство огневой поддержки стороны (артиллерия, авиация) наносит удар по подразделению противника или по всей стороне.',
  effect: 'На сторону или подразделение на несколько ходов действует эффект: дымовая завеса, внезапность, растерянность…',
};

export function PlanEditor({ sc, rs }: { sc: Scenario; rs: Ruleset }) {
  const events = sc.events ?? [];
  const upd = (fn: (list: ScenarioEvent[]) => void) =>
    updateScenario(sc.id, (d) => {
      d.events ??= [];
      fn(d.events);
    });
  const add = (kind: ScenarioEventKind) =>
    upd((list) => {
      const last = Math.max(0, ...list.map((x) => x.turn));
      list.push({ id: newId('ev'), kind, turn: Math.min(sc.maxTurns, last + 2 || 3), side: kind === 'conditions' ? undefined : 'A', chance: 100 });
    });
  const sideNodes = (side: SideId) => {
    const sd = sc.sides.find((x) => x.id === side);
    const out: { value: string; label: string }[] = [];
    for (const f of sd?.formations ?? []) walkUnits(f, (n, _p, depth) => void out.push({ value: n.id, label: `${'  '.repeat(depth)}${n.name}${n.level ? ` · ${n.level}` : ''}` }));
    return out;
  };
  const summary = events.length ? `${events.length} ${events.length === 1 ? 'событие' : events.length < 5 ? 'события' : 'событий'}` : 'событий нет';

  return (
    <Section id="scenario-plan" title="План боя" summary={summary} defaultOpen={events.length > 0}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {HINT}
      </p>
      {events.map((ev, i) => {
        const set = (fn: (e: ScenarioEvent) => void) => upd((list) => fn(list[i]));
        return (
          <div key={ev.id} className="plan-row">
            <div className="plan-main">
              <span className="plan-label">ход</span>
              <Num value={ev.turn} onChange={(v) => set((e) => void (e.turn = Math.max(1, Math.round(v))))} min={1} max={999} integer width={60} title="Ход, в начале которого событие наступает" />
              <Sel
                value={ev.kind}
                onChange={(v) =>
                  set((e) => {
                    e.kind = v;
                    if (v === 'conditions') delete e.side;
                    else e.side ??= 'A';
                  })
                }
                options={(Object.keys(EVENT_KIND_LABELS) as ScenarioEventKind[]).map((k) => ({ value: k, label: EVENT_KIND_LABELS[k], title: KIND_TIP[k] }))}
                width={190}
              />
              {ev.kind !== 'conditions' && (
                <>
                  <Sel
                    value={ev.side ?? 'A'}
                    onChange={(v) =>
                      set((e) => {
                        e.side = v;
                        delete e.nodeId;
                      })
                    }
                    options={sc.sides.map((s) => ({ value: s.id, label: s.name }))}
                    width={110}
                  />
                  <Sel
                    value={ev.nodeId ?? ''}
                    onChange={(v) => set((e) => void (e.nodeId = v || undefined))}
                    options={[{ value: '', label: '— подразделение —' }, ...sideNodes(ev.side ?? 'A')]}
                    width={240}
                  />
                </>
              )}
              {ev.kind === 'order' && (
                <Sel
                  value={ev.orderId ?? ''}
                  onChange={(v) => set((e) => void (e.orderId = v || undefined))}
                  options={[{ value: '', label: '— приказ —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name }))]}
                  width={150}
                />
              )}
              {ev.kind === 'conditions' &&
                rs.conditions.map((c) => (
                  <Sel
                    key={c.id}
                    value={ev.conditions?.[c.id] ?? ''}
                    onChange={(v) =>
                      set((e) => {
                        e.conditions ??= {};
                        if (v) e.conditions[c.id] = v;
                        else delete e.conditions[c.id];
                      })
                    }
                    options={[{ value: '', label: `${c.name}: не менять` }, ...c.options.map((o) => ({ value: o.id, label: `${c.name}: ${o.name}` }))]}
                    width={170}
                  />
                ))}
              <span className="grow" />
              <Btn sm kind="ghost" icon title="Удалить событие" onClick={() => upd((list) => void list.splice(i, 1))}>
                ×
              </Btn>
            </div>
            <div className="plan-extra">
              <span className="plan-label">вероятность</span>
              <Num value={ev.chance ?? 100} onChange={(v) => set((e) => void (e.chance = Math.max(0, Math.min(100, v))))} min={0} max={100} integer suffix="%" width={74} />
              <span className="plan-label">разброс ±</span>
              <Num value={ev.spread ?? 0} onChange={(v) => set((e) => void (e.spread = Math.max(0, Math.round(v)) || undefined))} min={0} max={20} integer suffix="ход" width={84} />
              <Txt value={ev.note ?? ''} onChange={(v) => set((e) => void (e.note = v || undefined))} placeholder="примечание для журнала" width={260} />
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: events.length ? 10 : 0 }}>
        <Btn sm onClick={() => add('arrive')}>+ Подход подкреплений</Btn>
        <Btn sm onClick={() => add('order')}>+ Смена приказа</Btn>
        <Btn sm onClick={() => add('conditions')}>+ Смена условий</Btn>
        <Info text="Пример: «ход 6, Синие, Танковая рота — подход подкреплений, вероятность 80%, разброс ±1» — танки подходят на 5–7-м ходу, а в одном бою из пяти не подходят вовсе." />
      </div>
    </Section>
  );
}

/** Подразделения, которые подходят позже: id узла → ход (для пометок в структуре сторон). */
export function arrivalsOf(sc: Scenario): Map<string, number> {
  const m = new Map<string, number>();
  for (const ev of sc.events ?? []) if (ev.kind === 'arrive' && ev.nodeId) m.set(ev.nodeId, ev.turn);
  return m;
}
