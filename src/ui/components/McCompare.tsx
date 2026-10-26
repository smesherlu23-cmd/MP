// Сравнение вариантов в массовом моделировании: перебор одного параметра («как исход зависит от X») или
// сравнение с другим сценарием. Все варианты считаются с одними и теми же случайностями — разница от параметра.

import { Icon } from './Icon';
import { useState } from 'react';
import { create } from 'zustand';
import {
  SWEEP_LABELS,
  randomSeed,
  runManyAsync,
  fmtDuration,
  scenarioTurns,
  sweepVariants,
  walkUnits,
  type MonteCarloResult,
  type Ruleset,
  type Scenario,
  type SideId,
  type SweepKind,
  type SweepParam,
} from '../../engine';
import { scenarioForBattle, toast, useApp } from '../store';
import { Btn, Field, Info, Num, Section, Seg, Sel, fmt0, fmt1 } from './ui';

interface Row {
  label: string;
  r: MonteCarloResult;
}
interface CmpState {
  byScenario: Record<string, { running: boolean; done: number; total: number; rows: Row[]; title: string; cancel?: boolean }>;
}
const useCmp = create<CmpState>(() => ({ byScenario: {} }));
const setCmp = (id: string, patch: Partial<CmpState['byScenario'][string]>) =>
  useCmp.setState((s) => ({
    byScenario: { ...s.byScenario, [id]: { ...(s.byScenario[id] ?? { running: false, done: 0, total: 0, rows: [], title: '' }), ...patch } },
  }));

const NEEDS_SIDE: SweepKind[] = ['commander', 'intel', 'fortification', 'order', 'supportCount'];
const mean = (r: MonteCarloResult, key: string) => r.metrics.find((m) => m.key === key)?.stats.mean ?? 0;

export function CompareSection({ sc, rs }: { sc: Scenario; rs: Ruleset }) {
  const scenarios = useApp((s) => s.scenarios);
  const state = useCmp((s) => s.byScenario[sc.id]);
  const [mode, setMode] = useState<'sweep' | 'scenario'>('sweep');
  const [p, setP] = useState<SweepParam>({ kind: 'commander', side: 'A' });
  const [other, setOther] = useState('');
  const [n, setN] = useState(100);
  const rsc = scenarioForBattle(sc);
  const side = (p.side ?? 'A') as SideId;
  const sd = rsc.sides.find((x) => x.id === side);
  const nodes: { value: string; label: string }[] = [];
  for (const f of sd?.formations ?? [])
    walkUnits(f, (u, _parent, depth) => {
      if (p.kind === 'commander' && depth > 0 && !u.children.length) return;
      nodes.push({ value: u.id, label: `${'  '.repeat(depth)}${u.name}` });
    });
  const others = Object.values(scenarios).filter((x) => x.id !== sc.id && x.rulesetId === sc.rulesetId);

  const variants = (): { label: string; scenario: Scenario }[] => {
    if (mode === 'scenario') {
      const o = scenarios[other];
      return o
        ? [
            { label: sc.name, scenario: rsc },
            { label: o.name, scenario: scenarioForBattle(o) },
          ]
        : [];
    }
    return sweepVariants(rsc, rs, p);
  };
  const run = async () => {
    const list = variants();
    if (list.length < 2) return toast('Выберите, что сравнивать: нужно хотя бы два варианта.', 'bad');
    const seed = randomSeed();
    const title =
      mode === 'scenario'
        ? `Сравнение со сценарием «${scenarios[other]?.name}»`
        : `${SWEEP_LABELS[p.kind]}${NEEDS_SIDE.includes(p.kind) ? ` — ${sd?.name}` : ''}`;
    setCmp(sc.id, { running: true, done: 0, total: list.length * n, rows: [], title, cancel: false });
    const rows: Row[] = [];
    for (let i = 0; i < list.length; i++) {
      if (useCmp.getState().byScenario[sc.id]?.cancel) break;
      const r = await runManyAsync(
        list[i].scenario,
        rs,
        n,
        seed,
        (d) => setCmp(sc.id, { done: i * n + d }),
        () => !!useCmp.getState().byScenario[sc.id]?.cancel,
      );
      rows.push({ label: list[i].label, r });
      setCmp(sc.id, { rows: [...rows] });
    }
    setCmp(sc.id, { running: false });
  };

  const rows = state?.rows ?? [];
  const best = rows.length ? Math.max(...rows.map((x) => x.r.winA)) : 0;
  return (
    <Section
      id="mc-compare"
      title="Сравнение вариантов"
      summary={rows.length ? state!.title : 'как исход зависит от командира, разведки, укреплений, хода ввода резерва…'}
    >
      <div className="row" style={{ alignItems: 'flex-end', gap: 10, marginBottom: 10 }}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sweep', label: 'Перебор параметра', title: 'Один параметр сценария принимает все значения по очереди' },
            { value: 'scenario', label: 'С другим сценарием', title: 'Например, с копией этого сценария, где что-то изменено' },
          ]}
        />
        <Info text="Каждый вариант — столько прогонов, сколько задано; у всех вариантов одни и те же случайности, поэтому разница — от самого параметра, а не от везения." />
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        {mode === 'sweep' ? (
          <>
            <Field label="Параметр">
              <Sel
                value={p.kind}
                onChange={(v) =>
                  setP({
                    kind: v,
                    side: p.side ?? 'A',
                    category: rs.conditions[0]?.id,
                    eventId: sc.events?.[0]?.id,
                    from: 1,
                    to: Math.min(scenarioTurns(sc, rs), 12),
                  })
                }
                options={(Object.keys(SWEEP_LABELS) as SweepKind[]).map((k) => ({ value: k, label: SWEEP_LABELS[k] }))}
                width={220}
              />
            </Field>
            {NEEDS_SIDE.includes(p.kind) && (
              <Field label="Сторона">
                <Sel
                  value={side}
                  onChange={(v) => setP({ ...p, side: v, nodeId: undefined, assetId: undefined })}
                  options={rsc.sides.map((x) => ({ value: x.id, label: x.name }))}
                  width={130}
                />
              </Field>
            )}
            {(p.kind === 'commander' || p.kind === 'order') && (
              <Field label={p.kind === 'commander' ? 'Формирование' : 'Подразделение'}>
                <Sel
                  value={p.nodeId ?? ''}
                  onChange={(v) => setP({ ...p, nodeId: v || undefined })}
                  options={[{ value: '', label: '— выберите —' }, ...nodes]}
                  width={240}
                />
              </Field>
            )}
            {p.kind === 'condition' && (
              <Field label="Категория">
                <Sel
                  value={p.category ?? ''}
                  onChange={(v) => setP({ ...p, category: v })}
                  options={rs.conditions.map((c) => ({ value: c.id, label: c.name }))}
                  width={180}
                />
              </Field>
            )}
            {p.kind === 'eventTurn' && (
              <>
                <Field label="Событие плана">
                  <Sel
                    value={p.eventId ?? ''}
                    onChange={(v) => setP({ ...p, eventId: v })}
                    options={[
                      { value: '', label: (sc.events ?? []).length ? '— выберите —' : 'в плане боя нет событий' },
                      ...(sc.events ?? []).map((e, i) => ({
                        value: e.id,
                        label: `${i + 1}. ${e.kind === 'arrive' ? 'подход' : e.kind === 'order' ? 'приказ' : e.kind === 'strike' ? 'удар' : e.kind === 'effect' ? 'эффект' : 'условия'}, ход ${e.turn}${e.note ? ` — ${e.note}` : ''}`,
                      })),
                    ]}
                    width={240}
                  />
                </Field>
                <Field label="С хода">
                  <Num
                    value={p.from ?? 1}
                    onChange={(v) => setP({ ...p, from: Math.max(1, Math.round(v)) })}
                    min={1}
                    max={scenarioTurns(sc, rs)}
                    integer
                    width={70}
                  />
                </Field>
                <Field label="по ход">
                  <Num
                    value={p.to ?? scenarioTurns(sc, rs)}
                    onChange={(v) => setP({ ...p, to: Math.max(1, Math.round(v)) })}
                    min={1}
                    max={scenarioTurns(sc, rs)}
                    integer
                    width={70}
                  />
                </Field>
              </>
            )}
            {p.kind === 'supportCount' && (
              <>
                <Field label="Средство">
                  <Sel
                    value={p.assetId ?? ''}
                    onChange={(v) => setP({ ...p, assetId: v })}
                    options={[
                      { value: '', label: sd?.support?.length ? '— выберите —' : 'нет огневой поддержки' },
                      ...(sd?.support ?? []).map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    width={200}
                  />
                </Field>
                <Field label="Ударов до">
                  <Num value={p.to ?? 6} onChange={(v) => setP({ ...p, to: Math.max(1, Math.round(v)) })} min={1} max={20} integer width={70} />
                </Field>
              </>
            )}
          </>
        ) : (
          <Field
            label="Сценарий для сравнения"
            hint={others.length ? undefined : 'Нет других сценариев с этим набором правил — сделайте копию («Дублировать») и измените в ней что-нибудь.'}
          >
            <Sel
              value={other}
              onChange={setOther}
              options={[{ value: '', label: '— выберите —' }, ...others.map((x) => ({ value: x.id, label: x.name }))]}
              width={280}
            />
          </Field>
        )}
        <Field label="Прогонов на вариант">
          <Num value={n} onChange={(v) => setN(Math.max(10, Math.min(5000, Math.round(v))))} min={10} max={5000} integer width={90} />
        </Field>
        {state?.running ? (
          <Btn kind="danger" onClick={() => setCmp(sc.id, { cancel: true })}>
            Остановить
          </Btn>
        ) : (
          <Btn kind="primary" onClick={() => void run()}>
            <Icon name="play" size={13} /> Сравнить
          </Btn>
        )}
        {state?.running && (
          <div className="grow" style={{ minWidth: 160 }}>
            <div className="meter" style={{ height: 10 }}>
              <div style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
            </div>
            <div className="small muted">
              {fmt0(state.done)} из {fmt0(state.total)}
            </div>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <table className="tbl compact" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{state!.title}</th>
              <th style={{ minWidth: 160 }} />
              <th className="num" style={{ color: rsc.sides[0].color }}>
                Победа: {rsc.sides[0].name}
              </th>
              <th className="num">Ничья</th>
              <th className="num" style={{ color: rsc.sides[1].color }}>
                Победа: {rsc.sides[1].name}
              </th>
              <th className="num">Потери {rsc.sides[0].name}</th>
              <th className="num">Потери {rsc.sides[1].name}</th>
              <th className="num">Длительность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.label} className={x.r.winA === best && rows.length > 2 ? 'best-row' : ''}>
                <td>{x.label}</td>
                <td>
                  <div className="fc-bar">
                    <div style={{ width: `${x.r.winA}%`, background: rsc.sides[0].color }} />
                    <div style={{ width: `${x.r.draw}%` }} className="fc-draw" />
                    <div style={{ width: `${x.r.winB}%`, background: rsc.sides[1].color }} />
                  </div>
                </td>
                <td className="num">
                  <b>{fmt1(x.r.winA)}%</b>
                </td>
                <td className="num">{fmt1(x.r.draw)}%</td>
                <td className="num">
                  <b>{fmt1(x.r.winB)}%</b>
                </td>
                <td className="num">{fmt1(mean(x.r, 'A.personnelLossPct'))}%</td>
                <td className="num">{fmt1(mean(x.r, 'B.personnelLossPct'))}%</td>
                <td className="num">{fmtDuration((mean(x.r, 'turns') * rs.turnMinutes) / 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
