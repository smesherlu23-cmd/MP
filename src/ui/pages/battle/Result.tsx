// Итоги и оценка боя, сравнение сторон, графики, запись итогов в силы.

import { dec, explainResult, fmtDuration, formatReport, formatSideReport, plural, type Battle, type BattleResult, type SideResult } from '../../../engine';
import { LineChart } from '../../components/Charts';
import { RichText } from '../../components/LogView';
import { Btn, Card, Menu, Section, fmt0, pct } from '../../components/ui';
import { applyResultsToForces, battleForces } from '../../postBattle';
import { exportText, fmtDate, useApp } from '../../store';
import { SIDES, copyText, printText } from './common';

/** Стороны рядом: только то, что нужно, чтобы понять ход боя. full — для итогов (с техникой по типам). */
export function SideCompare({ b, result, full }: { b: Battle; result: BattleResult; full?: boolean }) {
  const f = b.ruleset.features;
  const R = SIDES.map((s) => result.sides[s]);
  const eqTotal = (r: SideResult) =>
    r.equipment.reduce((a, q) => ({ cur: a.cur + q.current, start: a.start + q.start, lost: a.lost + q.losses }), { cur: 0, start: 0, lost: 0 });
  const eqTip = (r: SideResult) =>
    r.equipment
      .filter((q) => q.losses)
      .map((q) => `${q.name}: −${q.losses}`)
      .join('\n') || undefined;
  const lostTypes = [...new Set(R.flatMap((r) => r.equipment.filter((q) => q.losses > 0).map((q) => q.typeId)))];
  const row = (label: React.ReactNode, cell: (r: SideResult) => React.ReactNode, tip?: (r: SideResult) => string | undefined) => (
    <tr>
      <td>{label}</td>
      {R.map((r) => (
        <td key={r.side} className="num" data-tip={tip?.(r)}>
          {cell(r)}
        </td>
      ))}
    </tr>
  );
  return (
    <table className="tbl compare">
      <thead>
        <tr>
          <th />
          {R.map((r) => (
            <th key={r.side} className="num">
              <span className="dot" style={{ background: b.sides[r.side].color }} /> {r.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {row('Личный состав', (r) => (
          <>
            <b>{fmt0(r.personnel.current)}</b> <span className="faint">из {fmt0(r.personnel.start)}</span>
          </>
        ))}
        {row(
          'Потери',
          (r) => (
            <span className={r.personnel.lossPct > 25 ? 'bad' : ''}>
              {fmt0(r.personnel.losses)} <span className="faint">· {pct(r.personnel.lossPct)}</span>
            </span>
          ),
          (r) => `убито ${fmt0(r.personnel.kia)}, ранено ${fmt0(r.personnel.wia)}, пропало без вести ${fmt0(r.personnel.mia)}`,
        )}
        {!full &&
          R.some((r) => r.equipment.length) &&
          row(
            'Вооружение и техника',
            (r) => {
              const t = eqTotal(r);
              if (!t.start) return <span className="faint">—</span>;
              return (
                <>
                  {t.cur} <span className="faint">из {t.start}</span>
                  {t.lost > 0 && <span className="bad"> −{t.lost}</span>}
                </>
              );
            },
            eqTip,
          )}
        {full &&
          lostTypes.map((id) => {
            const name = R.map((r) => r.equipment.find((q) => q.typeId === id)?.name).find(Boolean);
            return (
              <tr key={id}>
                <td className="muted">{name}</td>
                {R.map((r) => {
                  const q = r.equipment.find((x) => x.typeId === id);
                  return (
                    <td
                      key={r.side}
                      className="num"
                      data-tip={q?.losses ? `уничтожено ${q.destroyed}, повреждено ${q.damaged}, брошено ${q.abandoned}` : undefined}
                    >
                      {q ? (
                        <>
                          {q.current} <span className="faint">из {q.start}</span>
                          {q.losses > 0 && <span className="bad"> −{q.losses}</span>}
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        {row(
          'Боеспособность',
          (r) => (
            <b>{pct(r.combatEffectiveness)}</b>
          ),
          () => 'Остаточная боеспособность стороны в целом (по боевой ценности, с моралью и усталостью); у элементов в таблице сил — своя.',
        )}
        {f.morale && row('Мораль', (r) => Math.round(r.morale))}
        {b.sides.A.luck !== undefined &&
          row(
            'Удача и исполнение',
            (r) => {
              const v = b.sides[r.side].luck ?? 1;
              return <span className={v >= 1.1 ? 'good' : v <= 0.9 ? 'bad' : 'faint'}>×{dec(v, 2)}</span>;
            },
            () =>
              'Выпадает каждой стороне в начале боя: множитель огня и стойкости — внезапность, слаженность, ошибки, везение («Удача и исполнение стороны» в наборе правил).',
          )}
        {full && row('Организация', (r) => pct(r.organization))}
        {full &&
          f.ammo &&
          row(
            'Боезапас',
            (r) => pct(r.supply.ammo),
            (r) => `топливо ${pct(r.supply.fuel)}, снаряжение ${pct(r.supply.equipment)}`,
          )}
        {row(
          'Задачи',
          (r) => (
            <b className={r.score >= 0.75 ? 'good' : r.score < 0.4 ? 'bad' : 'warn'}>{pct(r.score * 100)}</b>
          ),
          (r) => r.objectives.map((o) => `${pct(o.score * 100)} — ${o.label}`).join('\n') || undefined,
        )}
      </tbody>
    </table>
  );
}

/** Отчёт для ГМ и донесения сторон — для копирования, файла и печати. */
const reports = (b: Battle) => [
  { label: 'Полный отчёт', text: () => formatReport(b) },
  ...SIDES.map((sd) => ({ label: `Донесение для «${b.sides[sd].name}»`, text: () => formatSideReport(b, sd) })),
];

export function Result({ b, result, onElement }: { b: Battle; result: BattleResult; onElement: (id: string) => void }) {
  const keyEvents = b.log.filter((x) => x.level === 0 && x.phase !== 'turn' && x.phase !== 'setup' && x.phase !== 'end');
  return (
    <div className="stack">
      <div>
        {!b.finished && <div className="muted small">Бой не окончен — оценка на текущий ход</div>}
        <div className="bignum" style={{ color: result.winner ? b.sides[result.winner].color : undefined }}>
          {result.headline}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {b.finished ? `${result.endReason}. ` : ''}Длительность: {fmtDuration((result.turns * b.ruleset.turnMinutes) / 60)} ({result.turns}{' '}
          {plural(result.turns, 'ход', 'хода', 'ходов')}).
        </div>
        <div className="result-why">{explainResult(result)}</div>
        {b.finished && <ForcesCard b={b} />}
        {b.finished && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">Скопировать:</span>
            <Btn sm onClick={() => copyText(formatReport(b))} title="Все цифры обеих сторон — для ГМ">
              полный отчёт (ГМ)
            </Btn>
            {SIDES.map((sd) => (
              <Btn
                key={sd}
                sm
                onClick={() => copyText(formatSideReport(b, sd))}
                title="Свои силы и потери — точно, противник — оценкой: чем хуже разведданные и чем меньше противника видели, тем шире диапазон"
              >
                донесение для «{b.sides[sd].name}»
              </Btn>
            ))}
            <Menu
              sm
              label="Сохранить или напечатать…"
              title="Отчёт и донесения — в текстовый файл или на печать (в том числе в PDF)"
              items={[
                ...reports(b).flatMap((r) => [
                  { label: `${r.label} — в файл…`, onClick: () => void exportText(`${b.name} — ${r.label}`, r.text(), 'txt') },
                  { label: `${r.label} — печать…`, onClick: () => printText(`${b.name} — ${r.label}`, r.text()) },
                ]),
              ]}
            />
          </div>
        )}
      </div>
      <Card tight>
        <SideCompare b={b} result={result} full />
      </Card>
      <div className="grid two">
        {SIDES.map((s) => {
          const r = result.sides[s];
          if (!r.objectives.length) return <div key={s} />;
          return (
            <div key={s} className="objectives">
              <div className="small" style={{ color: b.sides[s].color, fontWeight: 600, marginBottom: 4 }}>
                Задачи: {r.name}
              </div>
              {r.objectives.map((o) => (
                <div key={o.objective.id} data-tip={o.explanation}>
                  <b className={o.score >= 0.999 ? 'good' : o.score < 0.4 ? 'bad' : 'warn'}>{pct(o.score * 100)}</b> {o.label}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Section id="battle-formations" title="По формированиям">
        <div className="grid two">
          {SIDES.map((s) => (
            <table key={s} className="tbl compact">
              <thead>
                <tr>
                  <th style={{ color: b.sides[s].color }}>{b.sides[s].name}</th>
                  <th className="num">Люди</th>
                  <th className="num">Потери</th>
                  <th className="num">Боесп.</th>
                </tr>
              </thead>
              <tbody>
                {result.sides[s].formations.map((f) => (
                  <tr key={f.formationId}>
                    <td style={{ paddingLeft: 6 + f.depth * 14 }}>{f.name}</td>
                    <td className="num">
                      {fmt0(f.personnel.current)}/{fmt0(f.personnel.start)}
                    </td>
                    <td className="num">{pct(f.personnel.lossPct)}</td>
                    <td className="num">{pct(f.combatEffectiveness)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </Section>
      {keyEvents.length > 0 && (
        <Section id="battle-key-events" title="Ключевые события" summary={`${keyEvents.length}`}>
          <div className="stack small" style={{ gap: 3 }}>
            {keyEvents.map((x, i) => (
              <div key={i}>
                <span className="faint">Ход {x.turn}:</span> <RichText text={x.text} b={b} onElement={onElement} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Итоги боя — в силы сторон: в конкретные подразделения, а не в шаблоны. */
export function ForcesCard({ b }: { b: Battle }) {
  useApp((s) => s.forces);
  const list = battleForces(b);
  if (!list.length)
    return (
      <div className="note" style={{ marginTop: 12 }}>
        Подразделения этого боя не связаны с «Силами» (бой начат до их появления или силы удалены) — записать итоги некуда.
      </div>
    );
  return (
    <div className={`note forces-note${b.appliedToForces ? ' done' : ''}`} style={{ marginTop: 12 }}>
      <div className="grow">
        {b.appliedToForces ? (
          <>
            <b>Итоги записаны в силы</b> {fmtDate(b.appliedToForces)}: {list.map((f) => f.name).join(', ')}.
          </>
        ) : (
          <>
            <b>Записать итоги в силы?</b> Потери, раненые и техника в ремонте, мораль, усталость и боезапас лягут на подразделения, участвовавшие в бою:{' '}
            {list.map((f) => f.name).join(', ')}. Следующий бой с ними начнётся уже с этими потерями; шаблоны не меняются.
          </>
        )}
      </div>
      <Btn kind={b.appliedToForces ? undefined : 'primary'} onClick={() => void applyResultsToForces(b)}>
        {b.appliedToForces ? 'Записать ещё раз…' : 'Записать итоги в силы'}
      </Btn>
    </div>
  );
}

export function Charts({ b }: { b: Battle }) {
  const h = b.history;
  if (h.length < 2) return <div className="empty">Графики появятся после первого хода.</div>;
  const labels = h.map((x) => x.turn);
  const ser = (fn: (s: (typeof h)[number]['sides']['A']) => number, norm = false) =>
    SIDES.map((s) => {
      const base = norm ? fn(h[0].sides[s]) || 1 : 1;
      return { name: b.sides[s].name, color: b.sides[s].color, values: h.map((x) => (fn(x.sides[s]) / base) * (norm ? 100 : 1)) };
    });
  const hasVehicles = h[0].sides.A.vehicles + h[0].sides.B.vehicles > 0;
  return (
    <div className="grid two">
      <Card title="Личный состав">
        <LineChart series={ser((x) => x.personnel)} labels={labels} xTitle="ход" />
      </Card>
      <Card title="Боеспособность, %">
        <LineChart series={ser((x) => x.ce, true)} labels={labels} yMax={100} yUnit="%" xTitle="ход" />
      </Card>
      {b.ruleset.features.morale && (
        <Card title="Мораль">
          <LineChart series={ser((x) => x.morale)} labels={labels} yMax={100} xTitle="ход" />
        </Card>
      )}
      {hasVehicles && (
        <Card title="Техника в строю">
          <LineChart series={ser((x) => x.vehicles)} labels={labels} xTitle="ход" />
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ итоги
