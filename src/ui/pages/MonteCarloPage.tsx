// Массовое моделирование сценария: вероятности исходов, средние потери, разброс, список прогонов.

import { Icon } from '../components/Icon';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { create } from 'zustand';
import { createBattle, fmtDuration, newId, randomSeed, runManyAsync, runToEnd, type MonteCarloResult, type RunSummary, type SideId } from '../../engine';
import { Histogram, StackBar } from '../components/Charts';
import { Crumbs } from '../components/Crumbs';
import { CompareSection } from '../components/McCompare';
import { Btn, Card, Field, Info, Menu, Num, Section, fmt1, pressable } from '../components/ui';
import { useTabState } from '../hooks';
import { exportText, fmtDate, openTab, putBattle, scenarioForBattle, toast, useApp, type Tab } from '../store';

interface McState {
  runs: Record<string, { running: boolean; done: number; n: number; result?: MonteCarloResult; at?: string; cancel?: boolean }>;
}
// Последний результат прогонов каждого сценария переживает перезапуск программы (до 12 сценариев).
const MC_KEY = 'warsim-mc-results';
const MC_KEEP = 12;
type Saved = Record<string, { n: number; result: MonteCarloResult; at: string }>;

function loadSaved(): McState['runs'] {
  try {
    const saved = JSON.parse(localStorage.getItem(MC_KEY) ?? '{}') as Saved;
    return Object.fromEntries(Object.entries(saved).map(([id, x]) => [id, { running: false, done: x.n, n: x.n, result: x.result, at: x.at }]));
  } catch {
    return {};
  }
}

function persist(runs: McState['runs']) {
  const done = Object.entries(runs)
    .filter(([, x]) => x.result && x.at && !x.running)
    .sort(([, a], [, b]) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, MC_KEEP);
  const saved: Saved = Object.fromEntries(done.map(([id, x]) => [id, { n: x.n, result: x.result!, at: x.at! }]));
  try {
    localStorage.setItem(MC_KEY, JSON.stringify(saved));
  } catch {
    // Не поместилось (очень большие прогоны) — храним меньше.
    try {
      localStorage.setItem(MC_KEY, JSON.stringify(Object.fromEntries(Object.entries(saved).slice(0, 3))));
    } catch {
      localStorage.removeItem(MC_KEY);
    }
  }
}

const useMC = create<McState>(() => ({ runs: loadSaved() }));
const setRun = (id: string, patch: Partial<McState['runs'][string]>) => {
  useMC.setState((s) => ({ runs: { ...s.runs, [id]: { ...(s.runs[id] ?? { running: false, done: 0, n: 0 }), ...patch } } }));
  if (patch.result) persist(useMC.getState().runs);
};

// ------------------------------------------------------------------ история прогонов

/** Краткие итоги прежних прогонов сценария — сравнить «до и после правки». */
interface HistEntry {
  at: string;
  n: number;
  winA: number;
  draw: number;
  winB: number;
  loss: Record<SideId, number>;
  score: Record<SideId, number>;
  hours: number;
  /** Когда сценарий и набор правил менялись в последний раз (для пометки «что менялось»). */
  scAt?: string;
  rsAt?: string;
}
const HIST_KEY = 'warsim-mc-history';
const HIST_KEEP = 5;

function loadHist(): Record<string, HistEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(HIST_KEY) ?? '{}') as Record<string, HistEntry[]>;
  } catch {
    return {};
  }
}

const useHist = create<{ h: Record<string, HistEntry[]> }>(() => ({ h: loadHist() }));

function saveHist(h: Record<string, HistEntry[]>) {
  useHist.setState({ h });
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(h));
  } catch {
    // Не поместилось — история не обязательна.
  }
}

function pushHist(scId: string, r: MonteCarloResult, scAt?: string, rsAt?: string) {
  const m = (key: string) => r.metrics.find((x) => x.key === key)?.stats.mean ?? 0;
  const e: HistEntry = {
    at: new Date().toISOString(),
    n: r.n,
    winA: r.winA,
    draw: r.draw,
    winB: r.winB,
    loss: { A: m('A.personnelLossPct'), B: m('B.personnelLossPct') },
    score: { A: m('A.score'), B: m('B.score') },
    hours: m('hours'),
    scAt,
    rsAt,
  };
  const h = useHist.getState().h;
  // Не больше 30 сценариев с историей: дольше всех не прогонявшиеся забываются.
  const keep = Object.entries({ ...h, [scId]: [e, ...(h[scId] ?? [])].slice(0, HIST_KEEP) })
    .sort(([, a], [, b]) => (b[0]?.at ?? '').localeCompare(a[0]?.at ?? ''))
    .slice(0, 30);
  saveHist(Object.fromEntries(keep));
}

const SIDES: SideId[] = ['A', 'B'];

export function MonteCarloPage({ tab }: { tab: Tab }) {
  const st = useApp();
  const sc = st.scenarios[tab.ref!];
  const run = useMC((s) => s.runs[tab.ref!]);
  const [n, setN] = useTabState(`${tab.key}:n`, st.settings.mcRuns);
  const [metric, setMetric] = useTabState<string>(`${tab.key}:metric`, 'personnelLossPct');
  if (!sc) return <div className="empty">Сценарий не найден.</div>;
  const rs = st.rulesets[sc.rulesetId];
  if (!rs) return <div className="empty">Набор правил сценария не найден.</div>;
  const r = run?.result;
  const stale = r && run?.at && sc.updatedAt && sc.updatedAt > run.at;

  const start = async () => {
    setRun(sc.id, { running: true, done: 0, n, cancel: false });
    try {
      // Прогоны — по текущему состоянию сил сторон.
      const res = await runManyAsync(
        scenarioForBattle(sc),
        rs,
        n,
        randomSeed(),
        (done) => setRun(sc.id, { done }),
        () => !!useMC.getState().runs[sc.id]?.cancel,
      );
      setRun(sc.id, { running: false, result: res, at: new Date().toISOString() });
      if (res.n) pushHist(sc.id, res, sc.updatedAt, rs.updatedAt);
    } catch (e) {
      setRun(sc.id, { running: false });
      toast(`Ошибка моделирования: ${(e as Error).message}`, 'bad');
    }
  };

  const colors = { A: sc.sides[0].color, B: sc.sides[1].color };
  return (
    <div className="page">
      <Crumbs
        items={[
          { label: 'Сценарии', section: 'scenarios' },
          { label: sc.name, open: ['scenario', sc.id] },
        ]}
      />
      <div className="page-head">
        <h1 className="grow">Прогоны</h1>
      </div>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
          <Field label="Число прогонов">
            <Num value={n} onChange={setN} min={1} max={20000} integer width={110} />
          </Field>
          {run?.running ? (
            <>
              <Btn kind="danger" onClick={() => setRun(sc.id, { cancel: true })}>
                Остановить
              </Btn>
              <div className="grow">
                <div className="meter" style={{ height: 10 }}>
                  <div style={{ width: `${(run.done / Math.max(1, run.n)) * 100}%` }} />
                </div>
                <div className="small muted">
                  {run.done} из {run.n}
                </div>
              </div>
            </>
          ) : (
            <Btn kind="primary" onClick={start}>
              <Icon name="play" size={13} /> Запустить
            </Btn>
          )}
          <div className="grow" />
          {r && !run?.running && (
            <Menu
              items={[
                {
                  label: 'Скопировать сводку',
                  onClick: () => navigator.clipboard?.writeText(summaryText(r, sc.name)).then(() => toast('Сводка скопирована.', 'good')),
                },
                {
                  label: 'Сохранить таблицу прогонов (CSV)…',
                  onClick: () =>
                    exportText(
                      `${sc.name} — прогоны`,
                      toCsv(
                        r,
                        rs.componentTypes.map((t) => ({ id: t.id, name: t.name })),
                      ),
                      'csv',
                    ),
                },
              ]}
            />
          )}
        </div>
        {stale && (
          <div className="note warn" style={{ marginTop: 10 }}>
            Сценарий изменился после этого моделирования — запустите заново.
          </div>
        )}
      </Card>

      {r && (
        <div className="stack" style={{ marginTop: 16 }}>
          <Card title={`Исходы · ${r.n} прогонов${run?.at ? ` · ${fmtDate(run.at)}` : ''}`}>
            <div className="stat-row" style={{ marginBottom: 12 }}>
              <div className="stat">
                <span className="k">Победа: {r.sideNames.A}</span>
                <span className="v" style={{ color: colors.A, fontSize: 26 }}>
                  {fmt1(r.winA)}%
                </span>
              </div>
              <div className="stat">
                <span className="k">Ничья</span>
                <span className="v" style={{ fontSize: 26 }}>
                  {fmt1(r.draw)}%
                </span>
              </div>
              <div className="stat">
                <span className="k">Победа: {r.sideNames.B}</span>
                <span className="v" style={{ color: colors.B, fontSize: 26 }}>
                  {fmt1(r.winB)}%
                </span>
              </div>
            </div>
            <StackBar
              parts={r.outcomes.map((o, i) => ({
                label: o.label,
                value: o.count,
                color: o.winner ? shade(colors[o.winner], i, r.outcomes.length) : '#6b7785',
                title: `${o.label}: ${fmt1(o.pct)}% (${o.count})`,
              }))}
            />
            <div className="meta" style={{ marginTop: 8 }}>
              {r.outcomes.map((o) => (
                <span key={o.key}>
                  {o.label} <b>{fmt1(o.pct)}%</b>
                </span>
              ))}
            </div>
          </Card>
          <MetricsTable r={r} colors={colors} metric={metric} setMetric={setMetric} tabKey={tab.key} scId={sc.id} />
          {r.meta && <Breakdown r={r} colors={colors} metric={metric} setMetric={setMetric} />}
          <Section id="mc-runs" title="Отдельные прогоны" summary="любой можно открыть как полноценный бой" tight>
            <RunsTable r={r} scId={sc.id} colors={colors} />
          </Section>
        </div>
      )}
      {!r && !run?.running && (
        <p className="muted" style={{ marginTop: 16 }}>
          Каждый прогон — полный бой без вмешательства ГМ: приказы из сценария, отход и паника — автоматически.
        </p>
      )}
      <History scId={sc.id} colors={colors} names={[sc.sides[0].name, sc.sides[1].name]} />
      <div style={{ marginTop: 16 }}>
        <CompareSection sc={sc} rs={rs} />
      </div>
    </div>
  );
}

function shade(hex: string, i: number, n: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const k = 0.55 + 0.45 * (1 - i / Math.max(1, n));
  const r = Math.round(((v >> 16) & 255) * k);
  const g = Math.round(((v >> 8) & 255) * k);
  const b = Math.round((v & 255) * k);
  return `rgb(${r},${g},${b})`;
}

const MAIN_METRICS = ['personnelLoss', 'personnelLossPct', 'kia', 'ce', 'score'];

function MetricsTable({
  r,
  colors,
  metric,
  setMetric,
  tabKey,
  scId,
}: {
  r: MonteCarloResult;
  colors: Record<SideId, string>;
  metric: string;
  setMetric: (m: string) => void;
  tabKey: string;
  scId: string;
}) {
  const [all, setAll] = useTabState(`${tabKey}:allMetrics`, false);
  // Длительность — в часах (у результатов прежней версии — пересчёт из ходов).
  const tm = useTurnMinutes(scId);
  const turnsRow = r.metrics.find((m) => m.key === 'turns')!;
  const hours =
    r.metrics.find((m) => m.key === 'hours') ??
    (() => {
      const f = (v: number) => (v * tm) / 60;
      const st = turnsRow.stats;
      return {
        ...turnsRow,
        values: turnsRow.values.map(f),
        stats: { mean: f(st.mean), sd: f(st.sd), min: f(st.min), p10: f(st.p10), median: f(st.median), p90: f(st.p90), max: f(st.max) },
      };
    })();
  const allKeys = [...new Set(r.metrics.filter((m) => m.side && !isBreakdown(m.key)).map((m) => m.key.slice(2)))];
  const keys = all ? allKeys : allKeys.filter((k) => MAIN_METRICS.includes(k));
  const sel = SIDES.map((s) => r.metrics.find((m) => m.key === `${s}.${metric}`)).filter(Boolean) as MonteCarloResult['metrics'];
  const selLabel = sel[0] ? (isBreakdown(sel[0].key) ? sel[0].label.replace(/\s+/g, ' ') : sel[0].label.trim()) : metric;
  const tip = (x: MonteCarloResult['metrics'][number]) =>
    `среднее ${fmt1(x.stats.mean)} · медиана ${fmt1(x.stats.median)} · 10–90%: ${fmt1(x.stats.p10)}–${fmt1(x.stats.p90)} · мин–макс: ${fmt1(x.stats.min)}–${fmt1(x.stats.max)} · σ ${fmt1(x.stats.sd)}`;
  const cells = (x?: MonteCarloResult['metrics'][number]) =>
    x ? (
      <>
        <td className="num" title={tip(x)}>
          <b>{fmt1(x.stats.mean)}</b>
        </td>
        <td className="num muted small nowrap" title={tip(x)}>
          {fmt1(x.stats.p10)}–{fmt1(x.stats.p90)}
        </td>
      </>
    ) : (
      <>
        <td className="num faint">—</td>
        <td />
      </>
    );
  return (
    <div className="grid two align-start">
      <Card
        title={
          <>
            Показатели{' '}
            <Info text="Среднее и диапазон, в который попадают 80% прогонов (от 10-го до 90-го процентиля). Наведите на число — медиана, минимум, максимум. Нажмите на строку — гистограмма справа." />
          </>
        }
        tight
        actions={
          <Btn sm kind="ghost" onClick={() => setAll(!all)}>
            {all ? 'Основные' : `Все (${allKeys.length})`}
          </Btn>
        }
      >
        <table className="tbl compact">
          <thead>
            <tr>
              <th rowSpan={2}>Показатель</th>
              {SIDES.map((s) => (
                <th key={s} colSpan={2} className="center" style={{ color: colors[s] }}>
                  {r.sideNames[s]}
                </th>
              ))}
            </tr>
            <tr>
              {SIDES.map((s) => (
                <Fragment key={s}>
                  <th className="num" style={{ top: 26 }}>
                    среднее
                  </th>
                  <th className="num" style={{ top: 26 }}>
                    10–90%
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr title={`${tip(hours)} ч; ходов в среднем ${fmt1(turnsRow.stats.mean)}`}>
              <td>Длительность боя</td>
              <td className="num" colSpan={4}>
                <b>{fmtDuration(hours.stats.mean)}</b>{' '}
                <span className="muted small">
                  (10–90%: {fmtDuration(hours.stats.p10)} – {fmtDuration(hours.stats.p90)})
                </span>
              </td>
            </tr>
            {keys.map((key) => {
              const a = r.metrics.find((x) => x.key === `A.${key}`);
              const b = r.metrics.find((x) => x.key === `B.${key}`);
              const m = a ?? b!;
              return (
                <tr
                  key={key}
                  className={key === metric ? 'sel' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setMetric(key)}
                  title="Показать гистограмму"
                  {...pressable(() => setMetric(key))}
                >
                  <td>
                    {m.label}
                    {m.unit ? <span className="faint">, {m.unit}</span> : null}
                  </td>
                  {cells(a)}
                  {cells(b)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="stack">
        <Card title={`Распределение: ${selLabel}${sel[0]?.unit ? `, ${sel[0].unit}` : ''}`}>
          <Histogram
            series={sel.map((m) => ({ name: r.sideNames[m.side!], color: colors[m.side!], values: m.values }))}
            unit={sel[0]?.unit === '%' ? '%' : ''}
          />
        </Card>
        <Card title="Длительность боя, ч">
          <Histogram series={[{ name: 'Часов', color: 'var(--accent)', values: hours.values }]} height={120} />
        </Card>
      </div>
    </div>
  );
}

/** Разбивка по задачам и формированиям — отдельная карточка, не в общем списке показателей. */
const isBreakdown = (key: string) => /^[AB]\.(obj|unit)\./.test(key);

/** Задачи сторон (в скольких прогонах выполнены) и потери формирований верхних уровней. */
function Breakdown({ r, colors, metric, setMetric }: { r: MonteCarloResult; colors: Record<SideId, string>; metric: string; setMetric: (m: string) => void }) {
  const meta = r.meta!;
  const row = (side: SideId, key: string, label: ReactNode, value: ReactNode, tip: string) => (
    <tr
      key={key}
      className={`${side}.${metric}` === key ? 'sel' : ''}
      style={{ cursor: 'pointer' }}
      onClick={() => setMetric(key.slice(2))}
      title={`${tip}. Нажмите — гистограмма выше`}
      {...pressable(() => setMetric(key.slice(2)))}
    >
      <td>{label}</td>
      {value}
    </tr>
  );
  return (
    <Card
      title={
        <>
          Задачи и подразделения{' '}
          <Info text="Задачи: в какой доле прогонов задача выполнена полностью и среднее выполнение. Подразделения — подчинённые старшего (роты батальона, взводы роты): средние потери личного состава и диапазон 80% прогонов. Нажмите на строку — гистограмма." />
        </>
      }
      tight
    >
      <div className="grid two align-start" style={{ gap: 0 }}>
        {SIDES.map((side) => (
          <table key={side} className="tbl compact">
            <thead>
              <tr>
                <th style={{ color: colors[side] }}>{r.sideNames[side]}</th>
                <th className="num">выполнена</th>
                <th className="num">в среднем</th>
              </tr>
            </thead>
            <tbody>
              {meta.objectives[side].map((label, i) => {
                const m = r.metrics.find((x) => x.key === `${side}.obj.${i}`);
                if (!m) return null;
                const done = m.values.length ? (m.values.filter((v) => v >= 99.5).length / m.values.length) * 100 : 0;
                return row(
                  side,
                  m.key,
                  label,
                  <>
                    <td className="num">
                      <b>{fmt1(done)}%</b>
                    </td>
                    <td className="num">{fmt1(m.stats.mean)}%</td>
                  </>,
                  `Задача выполнена полностью в ${fmt1(done)}% прогонов`,
                );
              })}
              {meta.units[side].length > 0 && (
                <tr>
                  <th>Подразделение</th>
                  <th className="num">потери</th>
                  <th className="num">10–90%</th>
                </tr>
              )}
              {meta.units[side].map((u) => {
                const m = r.metrics.find((x) => x.key === `${side}.unit.${u.id}`);
                if (!m) return null;
                return row(
                  side,
                  m.key,
                  <span style={{ paddingLeft: u.depth * 14 }}>{u.name}</span>,
                  <>
                    <td className="num">
                      <b>{fmt1(m.stats.mean)}%</b>
                    </td>
                    <td className="num muted small nowrap">
                      {fmt1(m.stats.p10)}–{fmt1(m.stats.p90)}
                    </td>
                  </>,
                  `Потери личного состава: медиана ${fmt1(m.stats.median)}%, мин–макс ${fmt1(m.stats.min)}–${fmt1(m.stats.max)}%`,
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </Card>
  );
}

/** Последние прогоны сценария: сравнить «до и после правки». */
function History({ scId, colors, names }: { scId: string; colors: Record<SideId, string>; names: [string, string] }) {
  const list = useHist((s) => s.h[scId]) ?? [];
  if (list.length < 2) return null;
  const delta = (v: number, prev: number | undefined) => {
    if (prev === undefined) return null;
    const d = v - prev;
    if (Math.abs(d) < 0.05) return null;
    return (
      <span className="faint small">
        {' '}
        ({d > 0 ? '+' : '−'}
        {fmt1(Math.abs(d))})
      </span>
    );
  };
  return (
    <div style={{ marginTop: 16 }}>
      <Section
        id="mc-history"
        title="Последние прогоны"
        summary={`${list.length} — сравнить до и после правки`}
        tight
        actions={
          <Btn
            sm
            kind="ghost"
            onClick={() => {
              const h = { ...useHist.getState().h };
              h[scId] = h[scId].slice(0, 1);
              saveHist(h);
            }}
            title="Оставить только последний"
          >
            Очистить
          </Btn>
        }
      >
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Когда</th>
              <th className="num">Прогонов</th>
              <th className="num" style={{ color: colors.A }}>
                Победа: {names[0]}
              </th>
              <th className="num">Ничья</th>
              <th className="num" style={{ color: colors.B }}>
                Победа: {names[1]}
              </th>
              <th className="num">Потери {names[0]}</th>
              <th className="num">Потери {names[1]}</th>
              <th className="num">Задачи {names[0]}</th>
              <th className="num">Задачи {names[1]}</th>
              <th className="num">Длительность</th>
              <th>Что менялось</th>
            </tr>
          </thead>
          <tbody>
            {list.map((x, i) => {
              const prev = list[i + 1];
              const changed = prev
                ? [x.scAt !== prev.scAt ? 'сценарий' : '', x.rsAt !== prev.rsAt ? 'набор правил' : ''].filter(Boolean).join(', ') || 'ничего'
                : '';
              return (
                <tr key={x.at}>
                  <td className="nowrap">{fmtDate(x.at)}</td>
                  <td className="num">{x.n}</td>
                  <td className="num">
                    <b>{fmt1(x.winA)}%</b>
                    {delta(x.winA, prev?.winA)}
                  </td>
                  <td className="num">
                    {fmt1(x.draw)}%{delta(x.draw, prev?.draw)}
                  </td>
                  <td className="num">
                    <b>{fmt1(x.winB)}%</b>
                    {delta(x.winB, prev?.winB)}
                  </td>
                  <td className="num">
                    {fmt1(x.loss.A)}%{delta(x.loss.A, prev?.loss.A)}
                  </td>
                  <td className="num">
                    {fmt1(x.loss.B)}%{delta(x.loss.B, prev?.loss.B)}
                  </td>
                  <td className="num">
                    {fmt1(x.score.A)}%{delta(x.score.A, prev?.score.A)}
                  </td>
                  <td className="num">
                    {fmt1(x.score.B)}%{delta(x.score.B, prev?.score.B)}
                  </td>
                  <td className="num">{fmtDuration(x.hours)}</td>
                  <td className="small muted">{changed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

/** Минут в ходу набора правил сценария (для пересчёта ходов в часы). */
const useTurnMinutes = (scId: string) => useApp((s) => s.rulesets[s.scenarios[scId]?.rulesetId ?? '']?.turnMinutes ?? 15);

function RunsTable({ r, scId, colors }: { r: MonteCarloResult; scId: string; colors: Record<SideId, string> }) {
  const tm = useTurnMinutes(scId);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'index', dir: 1 });
  const [page, setPage] = useState(0);
  const per = 50;
  const val = (x: RunSummary, key: string): number | string => {
    if (key === 'index') return x.index;
    if (key === 'turns') return x.turns;
    if (key === 'diff') return x.diff;
    const [side, k] = key.split('.') as [SideId, string];
    return (x.sides[side] as unknown as Record<string, number>)[k];
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: val — чистая функция
  const rows = useMemo(() => [...r.runs].sort((a, b) => (val(a, sort.key) > val(b, sort.key) ? 1 : -1) * sort.dir), [r, sort]);
  const th = (key: string, label: string, color?: string) => (
    <th className="num" style={{ cursor: 'pointer', color }} onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : -1 })}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const openRun = (x: RunSummary, toEnd: boolean) => {
    const st = useApp.getState();
    const sc = st.scenarios[scId];
    const rs = st.rulesets[sc.rulesetId];
    const b = createBattle(scenarioForBattle(sc), rs, { seed: x.seed, id: newId('bt'), name: `${sc.name} · прогон ${x.index + 1}` });
    if (toEnd) runToEnd(b);
    putBattle(b);
    openTab('battle', b.id);
  };
  return (
    <>
      <table className="tbl compact">
        <thead>
          <tr>
            {th('index', '№')}
            <th>Исход</th>
            {th('turns', 'Длительность')}
            {th('A.personnelLoss', `Потери ${r.sideNames.A}`, colors.A)}
            {th('B.personnelLoss', `Потери ${r.sideNames.B}`, colors.B)}
            {th('A.ce', `Боесп. ${r.sideNames.A}`, colors.A)}
            {th('B.ce', `Боесп. ${r.sideNames.B}`, colors.B)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.slice(page * per, page * per + per).map((x) => (
            <tr key={x.index}>
              <td className="num">{x.index + 1}</td>
              <td className="small" style={{ color: x.winner ? colors[x.winner] : undefined }}>
                {x.headline}
              </td>
              <td className="num" title={`${x.turns}-й ход`}>
                {fmtDuration(x.hours ?? (x.turns * tm) / 60)}
              </td>
              <td className="num">
                {x.sides.A.personnelLoss} <span className="faint">({Math.round(x.sides.A.personnelLossPct)}%)</span>
              </td>
              <td className="num">
                {x.sides.B.personnelLoss} <span className="faint">({Math.round(x.sides.B.personnelLossPct)}%)</span>
              </td>
              <td className="num">{Math.round(x.sides.A.ce)}%</td>
              <td className="num">{Math.round(x.sides.B.ce)}%</td>
              <td className="nowrap">
                <Btn sm kind="ghost" onClick={() => openRun(x, true)} title="Открыть этот бой целиком, с журналом">
                  Открыть
                </Btn>{' '}
                <Btn sm kind="ghost" onClick={() => openRun(x, false)} title="Пройти этот же бой пошагово, принимая решения">
                  Пошагово
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > per && (
        <div className="row" style={{ padding: 8, justifyContent: 'center' }}>
          <Btn sm disabled={page === 0} onClick={() => setPage(page - 1)}>
            ←
          </Btn>
          <span className="muted small">
            {page + 1} / {Math.ceil(rows.length / per)}
          </span>
          <Btn sm disabled={(page + 1) * per >= rows.length} onClick={() => setPage(page + 1)}>
            →
          </Btn>
        </div>
      )}
    </>
  );
}

function toCsv(r: MonteCarloResult, types: { id: string; name: string }[]): string {
  const typeIds = [...new Set(r.runs.flatMap((x) => SIDES.flatMap((s) => Object.keys(x.sides[s].equipmentLoss))))];
  const head = ['run', 'outcome', 'winner', 'turns', 'hours', 'end'];
  for (const s of SIDES) {
    head.push(
      `${s}_personnel_loss`,
      `${s}_personnel_loss_pct`,
      `${s}_kia`,
      `${s}_wia`,
      `${s}_mia`,
      `${s}_value_loss_pct`,
      `${s}_ce`,
      `${s}_org`,
      `${s}_morale`,
      `${s}_ammo`,
      `${s}_score`,
    );
    for (const id of typeIds) head.push(`${s}_loss_${types.find((t) => t.id === id)?.name ?? id}`);
    r.meta?.objectives[s].forEach((label, i) => head.push(`${s}_objective_${i + 1} ${label}`));
    for (const u of r.meta?.units[s] ?? []) head.push(`${s}_unit_loss_pct ${u.name}`);
  }
  const q = (v: string | number) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : `"${v.replace(/"/g, '""')}"`);
  const lines = [head.map((h) => q(h)).join(';')];
  for (const x of r.runs) {
    const row: (string | number)[] = [x.index + 1, x.outcomeName, x.winner ? r.sideNames[x.winner] : '', x.turns, x.hours ?? '', x.endReason];
    for (const s of SIDES) {
      const d = x.sides[s];
      row.push(d.personnelLoss, d.personnelLossPct, d.kia, d.wia, d.mia, d.valueLossPct, d.ce, d.organization, d.morale, d.ammo, d.score);
      for (const id of typeIds) row.push(d.equipmentLoss[id] ?? 0);
      r.meta?.objectives[s].forEach((_, i) => row.push(d.objectives?.[i] ?? ''));
      for (const u of r.meta?.units[s] ?? []) row.push(d.units?.[u.id] ?? '');
    }
    lines.push(row.map(q).join(';'));
  }
  return `﻿${lines.join('\n')}`;
}

function summaryText(r: MonteCarloResult, name: string): string {
  const lines = [
    `Сценарий «${name}»: ${r.n} прогонов.`,
    `Победа ${r.sideNames.A}: ${fmt1(r.winA)}% · ничья: ${fmt1(r.draw)}% · победа ${r.sideNames.B}: ${fmt1(r.winB)}%.`,
  ];
  for (const o of r.outcomes) lines.push(`  ${o.label}: ${fmt1(o.pct)}%`);
  for (const m of r.metrics) {
    const side = m.side ? `${r.sideNames[m.side]} — ` : '';
    lines.push(
      `${side}${m.label.trim()}: в среднем ${fmt1(m.stats.mean)} ${m.unit}, медиана ${fmt1(m.stats.median)}, 10–90%: ${fmt1(m.stats.p10)}–${fmt1(m.stats.p90)}, разброс ${fmt1(m.stats.min)}–${fmt1(m.stats.max)}`,
    );
  }
  return lines.join('\n');
}
