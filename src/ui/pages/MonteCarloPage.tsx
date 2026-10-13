// Массовое моделирование сценария: вероятности исходов, средние потери, разброс, список прогонов.

import { Fragment, useMemo, useState } from 'react';
import { create } from 'zustand';
import { createBattle, newId, runManyAsync, runToEnd, type MonteCarloResult, type RunSummary, type SideId } from '../../engine';
import { Histogram, StackBar } from '../components/Charts';
import { Link } from '../components/Link';
import { Btn, Card, Field, Num, Txt, fmt1 } from '../components/ui';
import { useTabState } from '../hooks';
import { exportText, openTab, putBattle, toast, useApp, type Tab } from '../store';

interface McState {
  runs: Record<string, { running: boolean; done: number; n: number; result?: MonteCarloResult; at?: string; cancel?: boolean }>;
}
const useMC = create<McState>(() => ({ runs: {} }));
const setRun = (id: string, patch: Partial<McState['runs'][string]>) =>
  useMC.setState((s) => ({ runs: { ...s.runs, [id]: { ...(s.runs[id] ?? { running: false, done: 0, n: 0 }), ...patch } } }));

const SIDES: SideId[] = ['A', 'B'];

export function MonteCarloPage({ tab }: { tab: Tab }) {
  const st = useApp();
  const sc = st.scenarios[tab.ref!];
  const run = useMC((s) => s.runs[tab.ref!]);
  const [n, setN] = useTabState(`${tab.key}:n`, st.settings.mcRuns);
  const [seed, setSeed] = useTabState(`${tab.key}:seed`, sc?.seed ?? 'mc');
  const [metric, setMetric] = useTabState<string>(`${tab.key}:metric`, 'personnelLossPct');
  if (!sc) return <div className="empty">Сценарий не найден.</div>;
  const rs = st.rulesets[sc.rulesetId];
  if (!rs) return <div className="empty">Набор правил сценария не найден.</div>;
  const r = run?.result;
  const stale = r && run?.at && sc.updatedAt && sc.updatedAt > run.at;

  const start = async () => {
    setRun(sc.id, { running: true, done: 0, n, cancel: false });
    try {
      const res = await runManyAsync(
        sc,
        rs,
        n,
        seed,
        (done) => setRun(sc.id, { done }),
        () => !!useMC.getState().runs[sc.id]?.cancel,
      );
      setRun(sc.id, { running: false, result: res, at: new Date().toISOString() });
    } catch (e) {
      setRun(sc.id, { running: false });
      toast(`Ошибка моделирования: ${(e as Error).message}`, 'bad');
    }
  };

  return (
    <div className="page">
      <div className="crumbs">
        Массовое моделирование сценария{' '}
        <Link kind="scenario" refId={sc.id}>
          «{sc.name}»
        </Link>
      </div>
      <div className="page-head">
        <h1 className="grow">Вероятности исходов</h1>
      </div>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
          <Field label="Число прогонов">
            <Num value={n} onChange={setN} min={1} max={20000} integer width={110} />
          </Field>
          <Field label="Базовый сид" hint="Прогон №k использует сид «база#k» — любой можно повторить.">
            <Txt value={seed} onChange={setSeed} width={200} />
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
              ▶ Запустить {n} прогонов
            </Btn>
          )}
          {r && !run?.running && (
            <>
              <Btn onClick={() => exportText(`${sc.name} — прогоны`, toCsv(r, rs.componentTypes.map((t) => ({ id: t.id, name: t.name }))), 'csv')}>Экспорт CSV</Btn>
              <Btn onClick={() => navigator.clipboard?.writeText(summaryText(r, sc.name)).then(() => toast('Сводка скопирована.', 'good'))}>Копировать сводку</Btn>
            </>
          )}
        </div>
        {stale && <div className="note warn" style={{ marginTop: 10 }}>Сценарий изменился после этого моделирования — запустите заново, чтобы учесть изменения.</div>}
      </Card>

      {r && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="grid three">
            <Card>
              <div className="muted small">Победа: {r.sideNames.A}</div>
              <div className="bignum" style={{ color: sc.sides[0].color }}>
                {fmt1(r.winA)}%
              </div>
            </Card>
            <Card>
              <div className="muted small">Ничья</div>
              <div className="bignum">{fmt1(r.draw)}%</div>
            </Card>
            <Card>
              <div className="muted small">Победа: {r.sideNames.B}</div>
              <div className="bignum" style={{ color: sc.sides[1].color }}>
                {fmt1(r.winB)}%
              </div>
            </Card>
          </div>
          <Card title={`Распределение исходов (${r.n} прогонов, ${(r.ms / 1000).toFixed(1)} с)`}>
            <StackBar
              parts={r.outcomes.map((o, i) => ({
                label: o.label,
                value: o.count,
                color: o.winner ? shade(sc.sides[o.winner === 'A' ? 0 : 1].color, i, r.outcomes.length) : '#6b7785',
              }))}
            />
            <table className="tbl compact" style={{ marginTop: 10 }}>
              <tbody>
                {r.outcomes.map((o) => (
                  <tr key={o.key}>
                    <td>{o.label}</td>
                    <td className="num">{o.count}</td>
                    <td className="num" style={{ width: 80 }}>
                      {fmt1(o.pct)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <MetricsTable r={r} colors={{ A: sc.sides[0].color, B: sc.sides[1].color }} metric={metric} setMetric={setMetric} />
          <RunsTable r={r} scId={sc.id} colors={{ A: sc.sides[0].color, B: sc.sides[1].color }} />
        </div>
      )}
      {!r && !run?.running && (
        <div className="note" style={{ marginTop: 14 }}>
          Каждый прогон — полный бой без вмешательства ГМ (приказы — из сценария, отход и паника — автоматически). Для балансировки меняйте подразделения,
          условия или коэффициенты и сравнивайте результаты.
        </div>
      )}
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

function MetricsTable({ r, colors, metric, setMetric }: { r: MonteCarloResult; colors: Record<SideId, string>; metric: string; setMetric: (m: string) => void }) {
  const turns = r.metrics.find((m) => m.key === 'turns')!;
  const keys = [...new Set(r.metrics.filter((m) => m.side).map((m) => m.key.slice(2)))];
  const sel = SIDES.map((s) => r.metrics.find((m) => m.key === `${s}.${metric}`)).filter(Boolean) as MonteCarloResult['metrics'];
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
    <div className="grid two">
      <Card title="Показатели по прогонам" tight actions={<span className="faint small">наведите на число — медиана, мин–макс, σ</span>}>
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
            <tr title={tip(turns)}>
              <td>Длительность, ходов</td>
              <td className="num" colSpan={4}>
                <b>{fmt1(turns.stats.mean)}</b> <span className="muted small">(10–90%: {fmt1(turns.stats.p10)}–{fmt1(turns.stats.p90)})</span>
              </td>
            </tr>
            {keys.map((key) => {
              const a = r.metrics.find((x) => x.key === `A.${key}`);
              const b = r.metrics.find((x) => x.key === `B.${key}`);
              const m = a ?? b!;
              return (
                <tr key={key} className={key === metric ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setMetric(key)} title="Показать гистограмму">
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
        <Card title={`Распределение: ${sel[0]?.label.trim() ?? metric}${sel[0]?.unit ? `, ${sel[0].unit}` : ''}`}>
          <Histogram series={sel.map((m) => ({ name: r.sideNames[m.side!], color: colors[m.side!], values: m.values }))} unit={sel[0]?.unit === '%' ? '%' : ''} />
          <div className="faint small">Нажмите на строку таблицы, чтобы выбрать показатель.</div>
        </Card>
        <Card title="Длительность боя, ходов">
          <Histogram series={[{ name: 'Ходов', color: 'var(--accent)', values: turns.values }]} height={120} />
        </Card>
      </div>
    </div>
  );
}

function RunsTable({ r, scId, colors }: { r: MonteCarloResult; scId: string; colors: Record<SideId, string> }) {
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
  const rows = useMemo(() => [...r.runs].sort((a, b) => (val(a, sort.key) > val(b, sort.key) ? 1 : -1) * sort.dir), [r, sort]);
  const th = (key: string, label: string, color?: string) => (
    <th className="num" style={{ cursor: 'pointer', color }} onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : -1 })}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const openRun = (x: RunSummary, toEnd: boolean) => {
    const st = useApp.getState();
    const sc = st.scenarios[scId];
    const rs = st.rulesets[sc.rulesetId];
    const b = createBattle(sc, rs, { seed: x.seed, id: newId('bt'), name: `${sc.name} · прогон ${x.index + 1} (${x.seed})` });
    if (toEnd) runToEnd(b);
    putBattle(b);
    openTab('battle', b.id);
  };
  return (
    <Card title="Прогоны" tight actions={<span className="muted small">Нажмите на заголовок, чтобы отсортировать — например, найти худший для стороны исход.</span>}>
      <table className="tbl compact">
        <thead>
          <tr>
            {th('index', '№')}
            <th>Сид</th>
            <th>Исход</th>
            {th('turns', 'Ходов')}
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
              <td className="mono small">{x.seed}</td>
              <td className="small" style={{ color: x.winner ? colors[x.winner] : undefined }}>
                {x.headline}
              </td>
              <td className="num">{x.turns}</td>
              <td className="num">
                {x.sides.A.personnelLoss} <span className="faint">({Math.round(x.sides.A.personnelLossPct)}%)</span>
              </td>
              <td className="num">
                {x.sides.B.personnelLoss} <span className="faint">({Math.round(x.sides.B.personnelLossPct)}%)</span>
              </td>
              <td className="num">{Math.round(x.sides.A.ce)}%</td>
              <td className="num">{Math.round(x.sides.B.ce)}%</td>
              <td className="nowrap">
                <Btn sm onClick={() => openRun(x, true)} title="Открыть этот бой целиком, с журналом">
                  Открыть
                </Btn>{' '}
                <Btn sm kind="ghost" onClick={() => openRun(x, false)} title="Пройти этот бой пошагово (тот же сид)">
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
    </Card>
  );
}

function toCsv(r: MonteCarloResult, types: { id: string; name: string }[]): string {
  const typeIds = [...new Set(r.runs.flatMap((x) => SIDES.flatMap((s) => Object.keys(x.sides[s].equipmentLoss))))];
  const head = ['run', 'seed', 'outcome', 'winner', 'turns', 'end'];
  for (const s of SIDES) {
    head.push(`${s}_personnel_loss`, `${s}_personnel_loss_pct`, `${s}_kia`, `${s}_wia`, `${s}_mia`, `${s}_value_loss_pct`, `${s}_ce`, `${s}_org`, `${s}_morale`, `${s}_ammo`, `${s}_score`);
    for (const id of typeIds) head.push(`${s}_loss_${types.find((t) => t.id === id)?.name ?? id}`);
  }
  const q = (v: string | number) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : `"${v.replace(/"/g, '""')}"`);
  const lines = [head.map((h) => q(h)).join(';')];
  for (const x of r.runs) {
    const row: (string | number)[] = [x.index + 1, x.seed, x.outcomeName, x.winner ? r.sideNames[x.winner] : '', x.turns, x.endReason];
    for (const s of SIDES) {
      const d = x.sides[s];
      row.push(d.personnelLoss, d.personnelLossPct, d.kia, d.wia, d.mia, d.valueLossPct, d.ce, d.organization, d.morale, d.ammo, d.score);
      for (const id of typeIds) row.push(d.equipmentLoss[id] ?? 0);
    }
    lines.push(row.map(q).join(';'));
  }
  return '﻿' + lines.join('\n');
}

function summaryText(r: MonteCarloResult, name: string): string {
  const lines = [`Сценарий «${name}»: ${r.n} прогонов (базовый сид ${r.baseSeed}).`, `Победа ${r.sideNames.A}: ${fmt1(r.winA)}% · ничья: ${fmt1(r.draw)}% · победа ${r.sideNames.B}: ${fmt1(r.winB)}%.`];
  for (const o of r.outcomes) lines.push(`  ${o.label}: ${fmt1(o.pct)}%`);
  for (const m of r.metrics) {
    const side = m.side ? `${r.sideNames[m.side]} — ` : '';
    lines.push(`${side}${m.label.trim()}: в среднем ${fmt1(m.stats.mean)} ${m.unit}, медиана ${fmt1(m.stats.median)}, 10–90%: ${fmt1(m.stats.p10)}–${fmt1(m.stats.p90)}, разброс ${fmt1(m.stats.min)}–${fmt1(m.stats.max)}`);
  }
  return lines.join('\n');
}

