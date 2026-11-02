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
import { Btn, Info, Menu, Num, Section, Sel } from './ui';

const HINT = [
  'События наступают в начале хода — в каждом бою и в каждом прогоне: на заданном ходу или когда выполнено условие («потери Синих ≥ 30% → резерв в бой»).',
  'Подкрепление до подхода в бою не участвует: не стреляет, не несёт потерь и не считается в задачах. В бою ГМ может ввести его раньше («ввести сейчас» в таблице сил).',
  'Вероятность и разброс делают план неточным: массовые прогоны покажут, сколько от этого зависит.',
].join('\n\n');

const KIND_TIP: Record<ScenarioEventKind, string> = {
  arrive: 'Подразделение вне боя до этого хода, затем вступает со своим приказом.',
  order: 'Подразделение (со всеми подчинёнными) получает новый приказ: например, ввод резерва или отход.',
  conditions: 'Меняются условия боя: наступает ночь, начинается дождь…',
  strike: 'Средство огневой поддержки стороны (артиллерия, авиация) наносит удар по подразделению противника или по всей стороне.',
  effect: 'На сторону или подразделение на несколько ходов действует эффект: дымовая завеса, внезапность, растерянность…',
  band: 'Дистанция меняется сразу: внезапное сближение, отход на дальнюю дистанцию — на всём поле или на участке.',
  resupply: 'Подвоз боезапаса, топлива или снаряжения подразделению или всей стороне.',
  command: 'У формирования меняются командир, связь или снабжение: прибыл новый командир, восстановлена связь.',
  fortification: 'Меняются укрепления стороны (разбиты, дооборудованы) — на всём поле или на участке — или её разведданные.',
  transfer: 'Подразделение перебрасывается на другой участок: несколько ходов в пути (вне боя), потом вступает в бой там.',
};

/** Какие события относятся к подразделению стороны и что значит «не выбрано». */
const NODE_PICK: Partial<Record<ScenarioEventKind, string>> = {
  arrive: '— подразделение —',
  order: '— подразделение —',
  effect: '— вся сторона —',
  resupply: '— вся сторона —',
  command: '— формирование —',
  transfer: '— подразделение —',
};
/** События, не относящиеся к одной стороне. */
const NO_SIDE = new Set<ScenarioEventKind>(['conditions', 'band']);

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
        side: NO_SIDE.has(kind) ? undefined : 'A',
        chance: 100,
      };
      if (kind === 'band') ev.bandId = rs.rangeBands[rs.rangeBands.length - 1]?.id;
      if (kind === 'resupply') ev.ammo = 25;
      if (kind === 'fortification') ev.fortificationId = rs.fortifications[0]?.id;
      if (kind === 'transfer') {
        ev.sectorId = sc.sectors?.[1]?.id ?? sc.sectors?.[0]?.id;
        ev.turns = 1;
      }
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
    for (const f of sd?.formations ?? [])
      walkUnits(f, (n, _p, depth) => void out.push({ value: n.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${n.name}` }));
    return out;
  };
  /** Формирования стороны (узлы с подчинёнными и корни) — у них есть командир. */
  const sideGroups = (side: SideId) => {
    const sd = sc.sides.find((x) => x.id === side);
    const out: { value: string; label: string }[] = [];
    for (const f of sd?.formations ?? [])
      walkUnits(
        f,
        (n, _p, depth) => void ((depth === 0 || n.children.length) && out.push({ value: n.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${n.name}` })),
      );
    return out;
  };
  const sectors = sc.sectors ?? [];
  const sideName = (id?: SideId) => sc.sides.find((x) => x.id === id)?.name ?? '';
  const summary = events.length ? `${events.length} ${events.length === 1 ? 'событие' : events.length < 5 ? 'события' : 'событий'}` : 'событий нет';
  const hasSupport = sc.sides.some((s) => s.support?.length);

  return (
    <Section id="scenario-plan" title="План боя" hint={HINT} summary={summary} defaultOpen={events.length > 0}>
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
                    if (NO_SIDE.has(v)) delete e.side;
                    else e.side ??= 'A';
                    if (v === 'band') e.bandId ??= rs.rangeBands[rs.rangeBands.length - 1]?.id;
                    if (v === 'transfer') e.sectorId ??= sc.sectors?.[1]?.id ?? sc.sectors?.[0]?.id;
                    if (v === 'strike') e.assetId ??= sc.sides.find((x) => x.id === e.side)?.support?.[0]?.id;
                    if (v === 'effect') e.effectId ??= rs.tempEffects[0]?.id;
                  })
                }
                options={(Object.keys(EVENT_KIND_LABELS) as ScenarioEventKind[])
                  .filter((k) => k !== 'transfer' || k === ev.kind || sectors.length > 1)
                  .map((k) => ({ value: k, label: EVENT_KIND_LABELS[k], title: KIND_TIP[k] }))}
                width={228}
              />
              {!NO_SIDE.has(ev.kind) && (
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
              {NODE_PICK[ev.kind] && (
                <Sel
                  value={ev.nodeId ?? ''}
                  onChange={(v) => set((e) => void (e.nodeId = v || undefined))}
                  options={[{ value: '', label: NODE_PICK[ev.kind]! }, ...(ev.kind === 'command' ? sideGroups(side) : sideNodes(side))]}
                  width={230}
                />
              )}
              {ev.kind === 'band' && (
                <Sel
                  value={ev.bandId ?? ''}
                  onChange={(v) => set((e) => void (e.bandId = v || undefined))}
                  options={[{ value: '', label: '— дистанция —' }, ...rs.rangeBands.map((b) => ({ value: b.id, label: b.name, title: b.description }))]}
                  width={150}
                />
              )}
              {(ev.kind === 'conditions' || ev.kind === 'band' || ev.kind === 'fortification') && sectors.length > 1 && (
                <Sel
                  value={ev.sectorId ?? ''}
                  onChange={(v) => set((e) => void (e.sectorId = v || undefined))}
                  options={[{ value: '', label: 'всё поле' }, ...sectors.map((x) => ({ value: x.id, label: `участок «${x.name}»` }))]}
                  width={170}
                  title={
                    ev.kind === 'fortification'
                      ? 'Где меняются укрепления (разведданные — всегда для всей стороны)'
                      : 'Где меняется: на всём поле (и на участках со своими условиями) или на одном участке'
                  }
                />
              )}
              {ev.kind === 'resupply' && (
                <>
                  {(['ammo', 'fuel', 'equipment'] as const)
                    .filter((k) => rs.features[k] || ev[k])
                    .map((k) => (
                      <Num
                        key={k}
                        value={ev[k] ?? 0}
                        onChange={(v) => set((e) => void (v > 0 ? (e[k] = Math.min(100, v)) : delete e[k]))}
                        min={0}
                        max={100}
                        integer
                        suffix="%"
                        width={78}
                        emptyAs={0}
                        title={`${{ ammo: 'Боезапас', fuel: 'Топливо', equipment: 'Снаряжение' }[k]}: сколько процентов подвезти`}
                        placeholder={{ ammo: 'БК', fuel: 'топл.', equipment: 'снар.' }[k]}
                      />
                    ))}
                </>
              )}
              {ev.kind === 'command' && (
                <>
                  {rs.features.command && (
                    <Sel
                      value={ev.commandLevel === undefined ? '' : String(ev.commandLevel)}
                      onChange={(v) => set((e) => void (v === '' ? delete e.commandLevel : (e.commandLevel = Number(v))))}
                      options={[
                        { value: '', label: 'командир: не менять' },
                        { value: '0', label: 'без командира' },
                        ...rs.commandLevels.map((l, j) => ({ value: String(j + 1), label: `командир: ${l.name}`, title: l.description })),
                      ]}
                      width={190}
                    />
                  )}
                  {rs.features.comms && (
                    <Num
                      value={ev.comms}
                      onChange={(v) => set((e) => void (v >= 0 ? (e.comms = Math.min(100, v)) : delete e.comms))}
                      emptyAs={-1}
                      min={0}
                      max={100}
                      integer
                      suffix="%"
                      width={78}
                      placeholder="связь"
                      title="Связь формирования, %; пусто — не менять"
                    />
                  )}
                  <Num
                    value={ev.supply}
                    onChange={(v) => set((e) => void (v >= 0 ? (e.supply = Math.min(100, v)) : delete e.supply))}
                    emptyAs={-1}
                    min={0}
                    max={100}
                    integer
                    suffix="%"
                    width={78}
                    placeholder="снабж."
                    title="Снабжение формирования, %; пусто — не менять"
                  />
                </>
              )}
              {ev.kind === 'fortification' && (
                <>
                  <Sel
                    value={ev.fortificationId ?? ''}
                    onChange={(v) => set((e) => void (e.fortificationId = v || undefined))}
                    options={[
                      { value: '', label: 'укрепления: не менять' },
                      ...rs.fortifications.map((o) => ({ value: o.id, label: `укрепления: ${o.name}`, title: o.description })),
                    ]}
                    width={200}
                  />
                  <Sel
                    value={ev.intelId ?? ''}
                    onChange={(v) => set((e) => void (e.intelId = v || undefined))}
                    options={[
                      { value: '', label: 'разведданные: не менять' },
                      ...rs.intelLevels.map((o) => ({ value: o.id, label: `разведданные: ${o.name}`, title: o.description })),
                    ]}
                    width={210}
                  />
                </>
              )}
              {ev.kind === 'transfer' && (
                <>
                  <span className="plan-label">на</span>
                  <Sel
                    value={ev.sectorId ?? ''}
                    onChange={(v) => set((e) => void (e.sectorId = v || undefined))}
                    options={[{ value: '', label: '— участок —' }, ...sectors.map((x) => ({ value: x.id, label: x.name }))]}
                    width={150}
                  />
                  <span className="plan-label">в пути</span>
                  <Num
                    value={ev.turns ?? 1}
                    onChange={(v) => set((e) => void (e.turns = Math.max(0, Math.round(v))))}
                    min={0}
                    max={20}
                    integer
                    suffix="ход."
                    width={78}
                    title="Сколько ходов подразделение в пути (вне боя); 0 — сразу"
                  />
                </>
              )}
              {ev.kind === 'order' && (
                <Sel
                  value={ev.orderId ?? ''}
                  onChange={(v) => set((e) => void (e.orderId = v || undefined))}
                  options={[{ value: '', label: '— приказ —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: o.description }))]}
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
                    options={[{ value: '', label: `всей стороне «${sideName(enemyOf(side))}»` }, ...sideNodes(enemyOf(side))]}
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
                    suffix="ход."
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
                    suffix="ход."
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
                    suffix="ход."
                    width={84}
                  />
                </>
              )}
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
        <Menu
          sm
          label="+ Другое событие"
          alignLeft
          items={[
            {
              label: 'Удар поддержки',
              onClick: () => add('strike'),
              disabled: !hasSupport,
              tip: hasSupport ? KIND_TIP.strike : 'Сначала задайте огневую поддержку в карточке стороны',
            },
            {
              label: 'Временный эффект',
              onClick: () => add('effect'),
              disabled: !rs.tempEffects.length,
              tip: rs.tempEffects.length ? KIND_TIP.effect : 'В наборе правил нет заготовок эффектов',
            },
            { label: 'Смена дистанции', onClick: () => add('band'), tip: KIND_TIP.band },
            { label: 'Подвоз', onClick: () => add('resupply'), tip: KIND_TIP.resupply },
            { label: 'Командир и связь', onClick: () => add('command'), tip: KIND_TIP.command },
            { label: 'Укрепления и разведданные', onClick: () => add('fortification'), tip: KIND_TIP.fortification },
            {
              label: 'Переброска на участок',
              onClick: () => add('transfer'),
              disabled: sectors.length < 2,
              tip: sectors.length < 2 ? 'Нужно хотя бы два участка (раздел «Участки» сценария)' : KIND_TIP.transfer,
            },
          ]}
        />
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
