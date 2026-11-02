// Сравнение вариантов в массовом моделировании: перебор одного параметра («как исход зависит от X») или
// сравнение с другим сценарием. Все варианты считаются с одними и теми же случайностями — разница от параметра.

import { Icon } from './Icon';
import { useState } from 'react';
import { create } from 'zustand';
import {
  COEFFICIENTS,
  EVENT_KIND_LABELS,
  STATE_KEYS,
  STATE_LABELS,
  SWEEP_LABELS,
  SWEEP_NEEDS,
  randomSeed,
  runManyAsync,
  fmtDuration,
  sweepDefaults,
  sweepRange,
  sweepVariants,
  walkUnits,
  type MonteCarloResult,
  type Ruleset,
  type Scenario,
  type SideId,
  type StateKey,
  type SweepKind,
  type SweepParam,
  type Variant,
} from '../../engine';
import { exportText, scenarioForBattle, toast, useApp } from '../store';
import { Btn, Field, Info, Menu, Num, Section, Seg, Sel, fmt0, fmt1 } from './ui';

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

const mean = (r: MonteCarloResult, key: string) => r.metrics.find((m) => m.key === key)?.stats.mean ?? 0;

/** Перебор в группах списка «Параметр». */
const SWEEP_GROUPS: { label: string; kinds: SweepKind[] }[] = [
  { label: 'Набор правил', kinds: ['coefficient', 'rule'] },
  { label: 'Обстановка', kinds: ['condition', 'startBand', 'duration', 'intel', 'fortification'] },
  { label: 'Подразделение', kinds: ['commander', 'order', 'state', 'strength', 'attack', 'defense', 'holdFast', 'sector'] },
  { label: 'План и поддержка', kinds: ['eventTurn', 'eventChance', 'supportCount'] },
];

/** Таблица сравнения: строки — варианты, столбцы — исходы, потери, задачи, длительность. */
function compareTable(rows: Row[], names: [string, string], turnMinutes: number): string[][] {
  const head = [
    'Вариант',
    `Победа: ${names[0]}, %`,
    'Ничья, %',
    `Победа: ${names[1]}, %`,
    `Потери ${names[0]}, %`,
    `Потери ${names[1]}, %`,
    `Задачи ${names[0]}, %`,
    `Задачи ${names[1]}, %`,
    'Длительность, ч',
  ];
  const r1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  return [
    head,
    ...rows.map((x) => [
      x.label,
      r1(x.r.winA),
      r1(x.r.draw),
      r1(x.r.winB),
      r1(mean(x.r, 'A.personnelLossPct')),
      r1(mean(x.r, 'B.personnelLossPct')),
      r1(mean(x.r, 'A.score')),
      r1(mean(x.r, 'B.score')),
      r1((mean(x.r, 'turns') * turnMinutes) / 60),
    ]),
  ];
}

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
  const need = SWEEP_NEEDS[p.kind];
  const nodes: { value: string; label: string }[] = [];
  for (const f of sd?.formations ?? [])
    walkUnits(f, (u, _parent, depth) => {
      if (need.node === 'formation' && depth > 0 && !u.children.length) return;
      nodes.push({ value: u.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${u.name}` });
    });
  const def = sweepDefaults(rsc, rs, p);
  const range = { from: p.from ?? def.from, to: p.to ?? def.to, step: p.step ?? def.step };
  const count = need.range ? sweepRange(range.from, range.to, range.step).length : 0;
  const coefs = COEFFICIENTS.filter((m) => !m.feature || rs.features[m.feature]);
  const pick = (kind: SweepKind) =>
    setP({
      kind,
      side: p.side ?? 'A',
      category: rs.conditions[0]?.id,
      eventId: sc.events?.[0]?.id,
      key: kind === 'coefficient' ? (p.key ?? coefs[0]?.key) : undefined,
      ruleId: kind === 'rule' ? (p.ruleId ?? rs.modifiers[0]?.id) : undefined,
      stateKey: kind === 'state' ? (p.stateKey ?? 'morale') : undefined,
      nodeId: SWEEP_NEEDS[kind].node && SWEEP_NEEDS[kind].node === need.node ? p.nodeId : undefined,
    });
  const others = Object.values(scenarios).filter((x) => x.id !== sc.id && x.rulesetId === sc.rulesetId);

  const variants = (): Variant[] => {
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
  const sweepTitle = () => {
    const parts: string[] = [SWEEP_LABELS[p.kind]];
    if (p.kind === 'coefficient') parts[0] = `Коэффициент «${coefs.find((m) => m.key === p.key)?.label ?? p.key}»`;
    if (p.kind === 'rule') parts[0] = `Правило «${rs.modifiers.find((m) => m.id === p.ruleId)?.name ?? '?'}»`;
    if (p.kind === 'state' && p.stateKey) parts[0] = `${STATE_LABELS[p.stateKey]} подразделения`;
    if (p.kind === 'condition') parts[0] = `${rs.conditions.find((c) => c.id === p.category)?.name ?? 'Условие'}`;
    if (need.side) parts.push(sd?.name ?? '');
    if (need.node && p.nodeId) parts.push(nodes.find((x) => x.value === p.nodeId)?.label.trim() ?? '');
    if (need.sector && p.sectorId) parts.push(`участок «${rsc.sectors?.find((x) => x.id === p.sectorId)?.name ?? '?'}»`);
    return parts.filter(Boolean).join(' — ');
  };
  const run = async () => {
    const list = variants();
    if (list.length < 2) return toast('Выберите, что сравнивать: нужно хотя бы два варианта.', 'bad');
    const seed = randomSeed();
    const title = mode === 'scenario' ? `Сравнение со сценарием «${scenarios[other]?.name}»` : sweepTitle();
    setCmp(sc.id, { running: true, done: 0, total: list.length * n, rows: [], title, cancel: false });
    const rows: Row[] = [];
    for (let i = 0; i < list.length; i++) {
      if (useCmp.getState().byScenario[sc.id]?.cancel) break;
      const r = await runManyAsync(
        list[i].scenario,
        list[i].ruleset ?? rs,
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
                onChange={pick}
                options={SWEEP_GROUPS.flatMap((g) => g.kinds.map((k) => ({ value: k, label: SWEEP_LABELS[k], group: g.label })))}
                width={240}
              />
            </Field>
            {p.kind === 'coefficient' && (
              <Field label="Коэффициент">
                <Sel
                  value={p.key ?? ''}
                  onChange={(v) => setP({ ...p, key: v, from: undefined, to: undefined, step: undefined })}
                  options={coefs.map((m) => ({ value: m.key, label: m.label, group: m.group, title: m.description }))}
                  width={260}
                />
              </Field>
            )}
            {p.kind === 'rule' && (
              <Field label="Правило">
                <Sel
                  value={p.ruleId ?? ''}
                  onChange={(v) => setP({ ...p, ruleId: v })}
                  options={
                    rs.modifiers.length
                      ? rs.modifiers.map((m) => ({ value: m.id, label: m.enabled ? m.name : `${m.name} (выключено)` }))
                      : [{ value: '', label: 'в наборе правил нет своих правил' }]
                  }
                  width={240}
                />
              </Field>
            )}
            {need.side && (
              <Field label="Сторона">
                <Sel
                  value={side}
                  onChange={(v) => setP({ ...p, side: v, nodeId: undefined, assetId: undefined })}
                  options={rsc.sides.map((x) => ({ value: x.id, label: x.name }))}
                  width={130}
                />
              </Field>
            )}
            {need.node && (
              <Field label={need.node === 'formation' ? 'Формирование' : 'Подразделение'}>
                <Sel
                  value={p.nodeId ?? ''}
                  onChange={(v) => setP({ ...p, nodeId: v || undefined })}
                  options={[{ value: '', label: '— выберите —' }, ...nodes]}
                  width={240}
                />
              </Field>
            )}
            {p.kind === 'state' && (
              <Field label="Показатель">
                <Sel
                  value={p.stateKey ?? 'morale'}
                  onChange={(v) => setP({ ...p, stateKey: v as StateKey, from: undefined, to: undefined, step: undefined })}
                  options={STATE_KEYS.map((k) => ({ value: k, label: STATE_LABELS[k] }))}
                  width={170}
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
            {need.sector && (rsc.sectors?.length ?? 0) > 1 && (
              <Field label="Где" hint="Всё поле — и участки со своим значением тоже; или только один участок.">
                <Sel
                  value={p.sectorId ?? ''}
                  onChange={(v) => setP({ ...p, sectorId: v || undefined })}
                  options={[{ value: '', label: 'всё поле' }, ...rsc.sectors!.map((x) => ({ value: x.id, label: `участок «${x.name}»` }))]}
                  width={180}
                />
              </Field>
            )}
            {need.event && (
              <>
                <Field label="Событие плана">
                  <Sel
                    value={p.eventId ?? ''}
                    onChange={(v) => setP({ ...p, eventId: v })}
                    options={[
                      { value: '', label: (sc.events ?? []).length ? '— выберите —' : 'в плане боя нет событий' },
                      ...(sc.events ?? []).map((e, i) => ({
                        value: e.id,
                        label: `${i + 1}. ${EVENT_KIND_LABELS[e.kind].toLowerCase()}, ход ${e.turn}${e.note ? ` — ${e.note}` : ''}`,
                      })),
                    ]}
                    width={240}
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
            {need.range && (
              <>
                <Field label="От">
                  <Num value={range.from} onChange={(v) => setP({ ...p, from: v })} width={80} />
                </Field>
                <Field label="До">
                  <Num value={range.to} onChange={(v) => setP({ ...p, to: v })} width={80} />
                </Field>
                <Field label="Шаг" hint={`Вариантов: ${count}${count >= 30 ? ' (больше 30 не бывает)' : ''}.`}>
                  <Num value={range.step} onChange={(v) => setP({ ...p, step: v > 0 ? v : range.step })} min={0} width={70} />
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
      {rows.length > 0 && !state?.running && (
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <Menu
            label="Выгрузить"
            items={[
              {
                label: 'Скопировать таблицу',
                onClick: () =>
                  navigator.clipboard
                    ?.writeText(
                      [state!.title, ...compareTable(rows, [rsc.sides[0].name, rsc.sides[1].name], rs.turnMinutes).map((x) => x.join('\t'))].join('\n'),
                    )
                    .then(() => toast('Таблица сравнения скопирована.', 'good')),
              },
              {
                label: 'Сохранить таблицу (CSV)…',
                onClick: () =>
                  void exportText(
                    `${sc.name} — ${state!.title}`,
                    `\ufeff${compareTable(rows, [rsc.sides[0].name, rsc.sides[1].name], rs.turnMinutes)
                      .map((x) => x.map((v, i) => (i === 0 ? `"${v.replace(/"/g, '""')}"` : v)).join(';'))
                      .join('\n')}`,
                    'csv',
                  ),
              },
            ]}
          />
        </div>
      )}
      {rows.length > 0 && (
        <table className="tbl compact" style={{ marginTop: 8 }}>
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
