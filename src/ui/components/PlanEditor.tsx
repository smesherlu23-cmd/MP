// План боя: события сценария — подход подкреплений, смена приказа и условий, удар огневой поддержки,
// временный эффект. Наступают на заданном ходу или по условию (потери, выбыло, мораль, дистанция).
// Работают и в бою, и в массовых прогонах (там ГМ не вмешивается — план и есть его решения).

import {
  EVENT_KIND_LABELS,
  TRIGGER_LABELS,
  fmtDuration,
  hoursFor,
  newId,
  scenarioTurns,
  walkUnits,
  type EventTrigger,
  type Ruleset,
  type Scenario,
  type ScenarioEvent,
  type ScenarioEventKind,
  type SideId,
  type TriggerMetric,
} from '../../engine';
import { updateScenario } from '../store';
import { Btn, Info, Num, Section, Sel, Txt } from './ui';

const HINT =
  'События наступают в начале хода — в каждом бою и в каждом прогоне: на заданном ходу или когда выполнено условие («потери Синих ≥ 30% → резерв в бой»). ' +
  'Подкрепление до подхода в бою не участвует: не стреляет, не несёт потерь и не считается в задачах. Вероятность и разброс делают план неточным: массовые прогоны покажут, сколько от этого зависит. ' +
  'В бою ГМ может ввести подкрепление раньше («ввести сейчас» в таблице сил).';

const KIND_TIP: Record<ScenarioEventKind, string> = {
  arrive: 'Подразделение вне боя до этого хода, затем вступает со своим приказом.',
  order: 'Подразделение (со всеми подчинёнными) получает новый приказ: например, ввод резерва или отход.',
  conditions: 'Меняются условия боя: наступает ночь, начинается дождь…',
  strike: 'Средство огневой поддержки стороны (артиллерия, авиация) наносит удар по подразделению противника или по всей стороне.',
  effect: 'На сторону или подразделение на несколько ходов действует эффект: дымовая завеса, внезапность, растерянность…',
};

const TRIGGER_TIP: Record<TriggerMetric, string> = {
  losses: 'Потери личного состава стороны или подразделения от начальной численности.',
  out: 'Доля сил (по боевой ценности), которая уничтожена, бежит или отходит.',
  morale: 'Средняя мораль тех, кто ещё в бою.',
  band: 'Дистанция сократилась до выбранной или ещё ближе (на участке подразделения, если оно выбрано).',
};

const enemyOf = (s: SideId): SideId => (s === 'A' ? 'B' : 'A');

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
      const ev: ScenarioEvent = {
        id: newId('ev'),
        kind,
        turn: Math.min(scenarioTurns(sc, rs), last + 2 || 3),
        side: kind === 'conditions' ? undefined : 'A',
        chance: 100,
      };
      if (kind === 'strike') {
        ev.turn = 1;
        ev.assetId = sc.sides[0].support?.[0]?.id;
      }
      if (kind === 'effect') ev.effectId = rs.tempEffects[0]?.id;
      list.push(ev);
    });
  const sideNodes = (side: SideId) => {
    const sd = sc.sides.find((x) => x.id === side);
    const out: { value: string; label: string }[] = [];
    for (const f of sd?.formations ?? []) walkUnits(f, (n, _p, depth) => void out.push({ value: n.id, label: `${'  '.repeat(depth)}${n.name}` }));
    return out;
  };
  const sideName = (id?: SideId) => sc.sides.find((x) => x.id === id)?.name ?? '';
  const summary = events.length ? `${events.length} ${events.length === 1 ? 'событие' : events.length < 5 ? 'события' : 'событий'}` : 'событий нет';
  const hasSupport = sc.sides.some((s) => s.support?.length);

  return (
    <Section id="scenario-plan" title="План боя" summary={summary} defaultOpen={events.length > 0}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {HINT}
      </p>
      {events.map((ev, i) => {
        const set = (fn: (e: ScenarioEvent) => void) => upd((list) => fn(list[i]));
        const tr = ev.trigger;
        const setTr = (fn: (t: EventTrigger) => void) => set((e) => fn(e.trigger!));
        const side = ev.side ?? 'A';
        const assets = sc.sides.find((x) => x.id === side)?.support ?? [];
        return (
          <div key={ev.id} className="plan-row">
            <div className="plan-main">
              <span className="plan-label">{tr ? 'не раньше хода' : 'ход'}</span>
              <Num
                value={ev.turn}
                onChange={(v) => set((e) => void (e.turn = Math.max(1, Math.round(v))))}
                min={1}
                max={999}
                integer
                width={60}
                title={tr ? 'Раньше этого хода событие не наступит, даже если условие выполнено' : 'Ход, в начале которого событие наступает'}
              />
              <span className="faint small nowrap" title={`Ход — ${rs.turnMinutes} мин; ${ev.turn}-й ход начинается через столько времени от начала боя`}>
                {ev.turn > 1 ? `+${fmtDuration(hoursFor(ev.turn - 1, rs))}` : 'начало боя'}
              </span>
              <Sel
                value={ev.kind}
                onChange={(v) =>
                  set((e) => {
                    e.kind = v;
                    if (v === 'conditions') delete e.side;
                    else e.side ??= 'A';
                    if (v === 'strike') e.assetId ??= sc.sides.find((x) => x.id === e.side)?.support?.[0]?.id;
                    if (v === 'effect') e.effectId ??= rs.tempEffects[0]?.id;
                  })
                }
                options={(Object.keys(EVENT_KIND_LABELS) as ScenarioEventKind[]).map((k) => ({ value: k, label: EVENT_KIND_LABELS[k], title: KIND_TIP[k] }))}
                width={200}
              />
              {ev.kind !== 'conditions' && (
                <Sel
                  value={side}
                  onChange={(v) =>
                    set((e) => {
                      e.side = v;
                      delete e.nodeId;
                      delete e.targetNodeId;
                      if (e.kind === 'strike') e.assetId = sc.sides.find((x) => x.id === v)?.support?.[0]?.id;
                    })
                  }
                  options={sc.sides.map((s) => ({ value: s.id, label: s.name }))}
                  width={110}
                  title={ev.kind === 'strike' ? 'Чья огневая поддержка бьёт' : undefined}
                />
              )}
              {(ev.kind === 'arrive' || ev.kind === 'order' || ev.kind === 'effect') && (
                <Sel
                  value={ev.nodeId ?? ''}
                  onChange={(v) => set((e) => void (e.nodeId = v || undefined))}
                  options={[{ value: '', label: ev.kind === 'effect' ? '— вся сторона —' : '— подразделение —' }, ...sideNodes(side)]}
                  width={230}
                />
              )}
              {ev.kind === 'order' && (
                <Sel
                  value={ev.orderId ?? ''}
                  onChange={(v) => set((e) => void (e.orderId = v || undefined))}
                  options={[{ value: '', label: '— приказ —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name }))]}
                  width={150}
                />
              )}
              {ev.kind === 'strike' && (
                <>
                  <Sel
                    value={ev.assetId ?? ''}
                    onChange={(v) => set((e) => void (e.assetId = v || undefined))}
                    options={[
                      { value: '', label: assets.length ? '— средство —' : 'нет средств у стороны' },
                      ...assets.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    width={170}
                    title="Средство огневой поддержки стороны (задаётся в карточке стороны)"
                  />
                  <span className="plan-label">по</span>
                  <Sel
                    value={ev.targetNodeId ?? ''}
                    onChange={(v) => set((e) => void (e.targetNodeId = v || undefined))}
                    options={[{ value: '', label: `всей стороне ${sideName(enemyOf(side))}` }, ...sideNodes(enemyOf(side))]}
                    width={220}
                  />
                </>
              )}
              {ev.kind === 'effect' && (
                <>
                  <Sel
                    value={ev.effectId ?? ''}
                    onChange={(v) => set((e) => void (e.effectId = v || undefined))}
                    options={[{ value: '', label: '— эффект —' }, ...rs.tempEffects.map((x) => ({ value: x.id, label: x.name, title: x.description }))]}
                    width={170}
                  />
                  <Num
                    value={ev.turns ?? rs.tempEffects.find((x) => x.id === ev.effectId)?.turns ?? 1}
                    onChange={(v) => set((e) => void (e.turns = Math.max(1, Math.round(v))))}
                    min={1}
                    max={50}
                    integer
                    suffix="ход"
                    width={78}
                    title="Сколько ходов действует"
                  />
                </>
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
              <Sel
                value={tr ? 'trigger' : 'turn'}
                onChange={(v) =>
                  set((e) => {
                    if (v === 'turn') {
                      delete e.trigger;
                      delete e.delay;
                    } else {
                      e.trigger = { metric: 'losses', side: e.side ?? 'A', value: 30 };
                      e.turn = 1;
                      delete e.spread;
                    }
                  })
                }
                options={[
                  { value: 'turn', label: 'на заданном ходу' },
                  { value: 'trigger', label: 'когда выполнено условие' },
                ]}
                width={200}
              />
              {tr && (
                <>
                  <Sel
                    value={tr.metric}
                    onChange={(v) =>
                      setTr((t) => {
                        t.metric = v;
                        t.value = v === 'band' ? (rs.rangeBands[rs.rangeBands.length - 1]?.id ?? '') : v === 'morale' ? 40 : 30;
                      })
                    }
                    options={(Object.keys(TRIGGER_LABELS) as TriggerMetric[]).map((k) => ({
                      value: k,
                      label: TRIGGER_LABELS[k].replace(/[≥≤].*$/, '').trim(),
                      title: TRIGGER_TIP[k],
                    }))}
                    width={120}
                  />
                  {tr.metric !== 'band' && (
                    <>
                      <Sel
                        value={tr.side}
                        onChange={(v) =>
                          setTr((t) => {
                            t.side = v;
                            delete t.nodeId;
                          })
                        }
                        options={sc.sides.map((s) => ({ value: s.id, label: s.name }))}
                        width={110}
                      />
                      <Sel
                        value={tr.nodeId ?? ''}
                        onChange={(v) => setTr((t) => void (v ? (t.nodeId = v) : delete t.nodeId))}
                        options={[{ value: '', label: '— вся сторона —' }, ...sideNodes(tr.side)]}
                        width={200}
                      />
                      <span className="plan-label">{tr.metric === 'morale' ? '≤' : '≥'}</span>
                      <Num
                        value={Number(tr.value) || 0}
                        onChange={(v) => setTr((t) => void (t.value = Math.max(0, Math.min(100, v))))}
                        min={0}
                        max={100}
                        integer
                        suffix={tr.metric === 'morale' ? '' : '%'}
                        width={70}
                      />
                    </>
                  )}
                  {tr.metric === 'band' && (
                    <Sel
                      value={String(tr.value)}
                      onChange={(v) => setTr((t) => void (t.value = v))}
                      options={rs.rangeBands.map((b) => ({ value: b.id, label: `${b.name} или ближе` }))}
                      width={200}
                    />
                  )}
                  <span className="plan-label">задержка</span>
                  <Num
                    value={ev.delay ?? 0}
                    onChange={(v) => set((e) => void (e.delay = Math.max(0, Math.round(v)) || undefined))}
                    min={0}
                    max={20}
                    integer
                    suffix="ход"
                    width={78}
                    title="Через сколько ходов после выполнения условия событие наступит"
                  />
                </>
              )}
              <span className="plan-label">вероятность</span>
              <Num
                value={ev.chance ?? 100}
                onChange={(v) => set((e) => void (e.chance = Math.max(0, Math.min(100, v))))}
                min={0}
                max={100}
                integer
                suffix="%"
                width={74}
              />
              {!tr && (
                <>
                  <span className="plan-label">разброс ±</span>
                  <Num
                    value={ev.spread ?? 0}
                    onChange={(v) => set((e) => void (e.spread = Math.max(0, Math.round(v)) || undefined))}
                    min={0}
                    max={20}
                    integer
                    suffix="ход"
                    width={84}
                  />
                </>
              )}
              <Txt value={ev.note ?? ''} onChange={(v) => set((e) => void (e.note = v || undefined))} placeholder="примечание для журнала" width={220} />
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: events.length ? 10 : 0 }}>
        <Btn sm onClick={() => add('arrive')}>
          + Подход подкреплений
        </Btn>
        <Btn sm onClick={() => add('order')}>
          + Смена приказа
        </Btn>
        <Btn sm onClick={() => add('conditions')}>
          + Смена условий
        </Btn>
        <Btn sm onClick={() => add('strike')} title={hasSupport ? undefined : 'Сначала задайте огневую поддержку в карточке стороны'}>
          + Удар поддержки
        </Btn>
        <Btn
          sm
          onClick={() => add('effect')}
          disabled={!rs.tempEffects.length}
          title={rs.tempEffects.length ? undefined : 'В наборе правил нет заготовок эффектов'}
        >
          + Эффект
        </Btn>
        <Info text="Примеры: «ход 6, Синие, Танковая рота — подход подкреплений, вероятность 80%, разброс ±1» — танки подходят на 5–7-м ходу, а в одном бою из пяти не подходят вовсе. «Когда потери Красных ≥ 30%, задержка 1 — Красные, Резерв: приказ «Атака»» — контратака резерва. «Ход 1, удар поддержки по опорному пункту» — артподготовка." />
      </div>
    </Section>
  );
}

/** Подразделения, которые подходят позже: id узла → ход или «по условию» (для пометок в структуре сторон). */
export function arrivalsOf(sc: Scenario): Map<string, number | 'cond'> {
  const m = new Map<string, number | 'cond'>();
  for (const ev of sc.events ?? []) if (ev.kind === 'arrive' && ev.nodeId) m.set(ev.nodeId, ev.trigger ? 'cond' : ev.turn);
  return m;
}
