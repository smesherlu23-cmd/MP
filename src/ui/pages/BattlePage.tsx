// Бой: пошаговое управление, вмешательства ГМ, силы сторон, журнал, графики и итоги.

import { useEffect, useMemo, useState } from 'react';
import {
  EngineContext,
  STATUS_LABELS,
  applyIntervention,
  combatEffectiveness,
  computeResult,
  formatReport,
  randomSeed,
  replayBattle,
  runToEnd,
  stepTurn,
  type Battle,
  type BattleResult,
  type ElementState,
  type FormationState,
  type SideId,
  type SideResult,
  type UnitSummary,
} from '../../engine';
import { LineChart } from '../components/Charts';
import { Link } from '../components/Link';
import { LogView, RichText } from '../components/LogView';
import { Btn, Card, Field, Kpi, Meter, Modal, Num, Sel, fmt0, pct } from '../components/ui';
import { useTabState } from '../hooks';
import { saveResultsAsNew, updateLibraryFromBattle, updateScenarioFromBattle } from '../postBattle';
import { deleteBattle, exportJson, exportText, loadBattle, openTab, putBattle, renameBattle, toast, touchBattle, useApp, useBattles, type Tab } from '../store';

const SIDES: SideId[] = ['A', 'B'];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Отчёт скопирован в буфер обмена.', 'good');
}

export function BattlePage({ tab }: { tab: Tab }) {
  const id = tab.ref!;
  const b = useBattles((s) => s.battles[id]);
  const rev = useBattles((s) => s.rev[id] ?? 0);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!b) loadBattle(id).then((x) => !x && setMissing(true));
  }, [id]);
  if (!b) return <div className="empty">{missing ? 'Бой не найден.' : 'Загрузка боя…'}</div>;
  return <BattleView b={b} rev={rev} tab={tab} />;
}

function BattleView({ b, rev, tab }: { b: Battle; rev: number; tab: Tab }) {
  const settings = useApp((s) => s.settings);
  const [view, setView] = useTabState<'forces' | 'charts' | 'result'>(`${tab.key}:view`, b.finished ? 'result' : 'forces');
  const [elModal, setElModal] = useState<string | null>(null);
  const [focus, setFocus] = useTabState<string | null>(`${tab.key}:focus`, null);
  const [condModal, setCondModal] = useState(false);
  const [fmModal, setFmModal] = useState<string | null>(null);
  const [wideLog, setWideLog] = useTabState(`${tab.key}:wideLog`, false);

  const E = useMemo(() => new EngineContext(b), [b, rev]);
  const result: BattleResult = useMemo(() => b.result ?? computeResult(E), [E]);
  const rs = b.ruleset;
  const band = rs.rangeBands[b.bandIndex];
  const elapsed = b.turn * rs.turnMinutes;

  const step = (n: number) => {
    for (let i = 0; i < n && !b.finished; i++) stepTurn(b);
    touchBattle(b.id);
    if (b.finished) setView('result');
  };
  const toEnd = () => {
    runToEnd(b);
    touchBattle(b.id);
    setView('result');
  };
  const restart = (seed: string, withInterventions = false) => {
    const nb = replayBattle(b, { seed, withInterventions });
    nb.name = `${b.scenario.name} · ${seed}${withInterventions ? ' (повтор с решениями ГМ)' : seed === b.seed ? ' (заново)' : ''}`;
    putBattle(nb);
    openTab('battle', nb.id);
  };
  const iv = (type: Parameters<typeof applyIntervention>[1]['type'], payload: Record<string, unknown>) => {
    applyIntervention(b, { type, payload });
    touchBattle(b.id);
    if (b.finished) setView('result');
  };

  const openEl = (eid: string) => setElModal(eid);

  return (
    <div className="page fill">
      <div className="battle-head">
        <div className="stack" style={{ gap: 2, minWidth: 260, flex: 1 }}>
          <div className="crumbs">
            Бой по сценарию{' '}
            <Link kind="scenario" refId={b.scenarioId}>
              «{b.scenario.name}»
            </Link>{' '}
            · сид <span className="mono">{b.seed}</span>
          </div>
          <input className="title-input" style={{ fontSize: 16, fontWeight: 600 }} value={b.name} onChange={(e) => renameBattle(b.id, e.target.value)} />
        </div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(110px, auto))' }}>
          <Kpi k="Ход" v={`${b.turn} / ${b.scenario.maxTurns}`} s={`${Math.floor(elapsed / 60)} ч ${elapsed % 60} мин`} />
          <Kpi k="Дистанция" v={<span style={{ fontSize: 14 }}>{band?.name ?? '—'}</span>} s={b.bandIndex < rs.rangeBands.length - 1 ? `сближение ${Math.round(b.closingProgress * 100)}%` : 'вплотную'} />
          <Kpi
            k={b.finished ? 'Итог' : 'Инициатива'}
            v={
              <span style={{ fontSize: 13 }}>
                {b.finished ? result.headline : b.turn ? `${b.sides.A.initiative} : ${b.sides.B.initiative}` : '—'}
              </span>
            }
          />
        </div>
        <div className="toolbar">
          <Btn kind="primary" onClick={() => step(1)} disabled={b.finished} title="Рассчитать один ход">
            ▶ Ход
          </Btn>
          <Btn onClick={() => step(5)} disabled={b.finished}>
            ⏩ 5 ходов
          </Btn>
          <Btn onClick={toEnd} disabled={b.finished}>
            ⏭ До конца
          </Btn>
          <Btn onClick={() => iv('endBattle', { reason: 'Бой остановлен ГМ' })} disabled={b.finished} title="Завершить бой сейчас и подвести итоги">
            ■ Завершить
          </Btn>
          <span className="sep" />
          <Btn onClick={() => setCondModal(true)} disabled={b.finished} title="Изменить условия или дистанцию (вмешательство ГМ)">
            ✎ Условия
          </Btn>
          <Btn onClick={() => restart(b.seed)} title="Новый бой с тем же сидом — тот же результат при тех же решениях">
            ↺ Заново
          </Btn>
          <Btn onClick={() => restart(randomSeed())} title="Новый бой с другим сидом">
            🎲 Новый сид
          </Btn>
          {b.interventions.length > 0 && (
            <Btn onClick={() => restart(b.seed, true)} title="Воспроизвести бой с теми же вмешательствами ГМ до текущего хода">
              ↻ Повтор с решениями ГМ
            </Btn>
          )}
          <span className="sep" />
          <Btn onClick={() => copyText(formatReport(b))} title="Скопировать отчёт для игроков">
            📋 Отчёт
          </Btn>
          <Btn onClick={() => exportText(`${b.name} — отчёт`, formatReport(b, { includeLog: true, logLevel: settings.logLevel }), 'txt')}>Экспорт</Btn>
          <Btn kind="ghost" onClick={() => exportJson('battle', b.name, b)} title="Сохранить бой в файл (можно импортировать)">
            JSON
          </Btn>
          <Btn kind="danger" onClick={() => deleteBattle(b.id)}>
            Удалить
          </Btn>
        </div>
        <div className="row" style={{ width: '100%', gap: 6 }}>
          {rs.conditions.map((c) => (
            <span key={c.id} className="chip">
              {c.name}: <b>{c.options.find((o) => o.id === b.conditions[c.id])?.name ?? '—'}</b>
            </span>
          ))}
          {SIDES.map((s) => (
            <span key={s} className="chip" style={{ borderColor: b.sides[s].color }}>
              {b.sides[s].name}: укрепления — {rs.fortifications.find((x) => x.id === b.sides[s].fortification)?.name}, разведданные —{' '}
              {rs.intelLevels.find((x) => x.id === b.sides[s].intel)?.name}
            </span>
          ))}
        </div>
      </div>

      <div className={`battle-body${wideLog ? ' log-wide' : ''}`}>
        <div className="battle-main">
          <div className="subtabs">
            <button className={view === 'forces' ? 'on' : ''} onClick={() => setView('forces')}>
              Силы сторон
            </button>
            <button className={view === 'charts' ? 'on' : ''} onClick={() => setView('charts')}>
              Динамика
            </button>
            <button className={view === 'result' ? 'on' : ''} onClick={() => setView('result')}>
              {b.finished ? 'Итоги боя' : 'Промежуточная оценка'}
            </button>
          </div>
          <div className="scroll">
            {view === 'forces' && <Forces b={b} E={E} result={result} onElement={openEl} onFormation={setFmModal} iv={iv} />}
            {view === 'charts' && <Charts b={b} />}
            {view === 'result' && <Result b={b} result={result} onElement={openEl} />}
          </div>
        </div>
        <div className="battle-log">
          <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
            <h3 className="grow">Журнал событий</h3>
            <Btn sm kind="ghost" onClick={() => setWideLog(!wideLog)} title="Шире / уже">
              {wideLog ? '⇥' : '⇤'}
            </Btn>
          </div>
          <LogView b={b} rev={rev} tabKey={tab.key} defaultLevel={settings.logLevel} focus={focus} onElement={openEl} onClearFocus={() => setFocus(null)} />
        </div>
      </div>

      {elModal && <ElementModal b={b} E={E} id={elModal} onClose={() => setElModal(null)} iv={iv} onFocusLog={(x) => (setFocus(x), setElModal(null))} />}
      {condModal && <ConditionsModal b={b} onClose={() => setCondModal(false)} iv={iv} />}
      {fmModal && <FormationModal b={b} id={fmModal} onClose={() => setFmModal(null)} iv={iv} />}
    </div>
  );
}

type Iv = (type: Parameters<typeof applyIntervention>[1]['type'], payload: Record<string, unknown>) => void;

// ------------------------------------------------------------------ силы сторон

function statusOf(E: EngineContext, el: ElementState): { label: string; cls: string } {
  if (el.status === 'active') {
    const bh = E.behavior(el);
    if (bh === 'retreat') return { label: 'Отходит', cls: 'status-retreat' };
    if (bh === 'rout') return { label: 'Бежит', cls: 'status-dead' };
    if (bh === 'reserve') return { label: 'В резерве', cls: 'status-out' };
    return { label: 'В бою', cls: 'status-active' };
  }
  if (el.status === 'destroyed') return { label: STATUS_LABELS.destroyed, cls: 'status-dead' };
  if (el.status === 'routed') return { label: STATUS_LABELS.routed, cls: 'status-dead' };
  return { label: STATUS_LABELS.withdrawn, cls: 'status-out' };
}

function SideSummary({ b, side, r }: { b: Battle; side: SideId; r: SideResult }) {
  const p = r.personnel;
  const f = b.ruleset.features;
  return (
    <div className="card side-card" style={{ ['--side' as string]: b.sides[side].color }}>
      <div className="card-head">
        <span className="dot" style={{ background: b.sides[side].color }} />
        <h3>{b.sides[side].name}</h3>
        <span className="badge" title="Выполнение задач на текущий момент">
          задачи {pct(r.score * 100)}
        </span>
      </div>
      <div className="card-body">
        <div className="kpis">
          <Kpi k="Личный состав" v={fmt0(p.current)} s={`из ${fmt0(p.start)} · потери ${fmt0(p.losses)} (${pct(p.lossPct)})`} color={p.lossPct > 30 ? 'var(--bad)' : undefined} />
          <Kpi k="Боеспособность" v={pct(r.combatEffectiveness)} s={`ценность ${pct(r.strength)}`} />
          <Kpi k="Организация" v={pct(r.organization)} />
          {f.morale && <Kpi k="Мораль" v={Math.round(r.morale)} />}
          {f.ammo && <Kpi k="Боезапас" v={pct(r.supply.ammo)} s={f.fuel ? `топливо ${pct(r.supply.fuel)}` : undefined} />}
        </div>
        {r.equipment.length > 0 && (
          <div className="row small" style={{ marginTop: 8, gap: 4 }}>
            {r.equipment.map((q) => (
              <span key={q.typeId} className="chip" title={`уничтожено ${q.destroyed}, повреждено ${q.damaged}, брошено ${q.abandoned}`}>
                {q.name}: <b>{q.current}</b>/{q.start}
                {q.losses > 0 && <span className="bad">−{q.losses}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="small muted" style={{ marginTop: 8 }}>
          {r.objectives.map((o) => (
            <div key={o.objective.id} title={o.explanation}>
              {o.score >= 0.999 ? '✔' : o.score > 0 ? '◐' : '○'} {o.label} — {pct(o.score * 100)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Forces({ b, E, result, onElement, onFormation, iv }: { b: Battle; E: EngineContext; result: BattleResult; onElement: (id: string) => void; onFormation: (id: string) => void; iv: Iv }) {
  const rs = b.ruleset;
  const f = rs.features;
  const orderOptions = rs.orders.map((o) => ({ value: o.id, label: o.name }));
  const rowsFor = (side: SideId) => {
    const rows: { f: FormationState; depth: number }[] = [];
    const walk = (fs: FormationState, depth: number) => {
      rows.push({ f: fs, depth });
      for (const ch of b.formations.filter((x) => x.parentId === fs.id)) walk(ch, depth + 1);
    };
    for (const fs of b.formations.filter((x) => x.side === side && !x.parentId)) walk(fs, 0);
    return rows;
  };
  return (
    <div className="stack">
      <div className="grid two">
        {SIDES.map((s) => (
          <SideSummary key={s} b={b} side={s} r={result.sides[s]} />
        ))}
      </div>
      {SIDES.map((side) => (
        <Card key={side} title={<span style={{ color: b.sides[side].color }}>{b.sides[side].name}: элементы</span>} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Элемент</th>
                  <th>Приказ</th>
                  <th>Состояние</th>
                  <th className="num">Люди</th>
                  <th className="num">Техн.</th>
                  {f.morale && <th>Мораль</th>}
                  {f.suppression && <th className="num" title="Подавление">Подавл.</th>}
                  {f.fatigue && <th className="num" title="Усталость">Устал.</th>}
                  {f.ammo && <th className="num" title="Боезапас">БК</th>}
                  <th className="num" title="Остаточная боеспособность">Боесп.</th>
                  {f.detection && <th title="Обнаружен противником в этом ходу">👁</th>}
                </tr>
              </thead>
              <tbody>
                {rowsFor(side).map(({ f: fs, depth }) => (
                  <FormationRows key={fs.id} b={b} E={E} fs={fs} depth={depth} orderOptions={orderOptions} onElement={onElement} onFormation={onFormation} iv={iv} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="faint small">Нажмите на название элемента, чтобы открыть его карточку: состав, потери, ручная правка состояния, журнал элемента.</p>
    </div>
  );
}

function FormationRows({ b, E, fs, depth, orderOptions, onElement, onFormation, iv }: { b: Battle; E: EngineContext; fs: FormationState; depth: number; orderOptions: { value: string; label: string }[]; onElement: (id: string) => void; onFormation: (id: string) => void; iv: Iv }) {
  const f = b.ruleset.features;
  const els = b.elements.filter((x) => x.formationId === fs.id);
  const cols = 6 + [f.morale, f.suppression, f.fatigue, f.ammo, f.detection].filter(Boolean).length;
  return (
    <>
      <tr className="group">
        <td colSpan={cols} style={{ paddingLeft: 8 + depth * 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <a href="#" onClick={(e) => (e.preventDefault(), onFormation(fs.id))} title="Командир, связь, снабжение, приказ всему формированию">
              ▦ {fs.name}
            </a>
            <span className="faint small">
              {fs.kind}
              {fs.commanderName ? ` · ${fs.commanderName}` : ''}
              {f.comms ? ` · связь ${Math.round(fs.comms)}%` : ''} · снабжение {Math.round(fs.supply)}%
            </span>
            {fs.hqLost && <span className="badge bad">штаб потерян</span>}
            {fs.broken && <span className="badge bad">сломлено</span>}
          </div>
        </td>
      </tr>
      {els.map((el) => {
        const st = statusOf(E, el);
        const pers = E.personnel(el);
        const veh = el.comps.filter((c) => E.type(c.typeId).kind !== 'personnel');
        const vehNow = veh.reduce((a, c) => a + c.current, 0);
        const vehStart = veh.reduce((a, c) => a + c.start, 0);
        const ce = el.startValue > 0 ? (combatEffectiveness(E, el) / el.startValue) * 100 : 0;
        const active = el.status === 'active' && !b.finished;
        return (
          <tr key={el.id} className={el.status !== 'active' ? 'dim' : ''}>
            <td style={{ paddingLeft: 18 + depth * 14 }}>
              <a href="#" onClick={(e) => (e.preventDefault(), onElement(el.id))}>
                {el.name}
              </a>
              {el.isHQ && <span className="badge warn" style={{ marginLeft: 4 }}>штаб</span>}
              {el.holdFast && <span className="badge" style={{ marginLeft: 4 }} title="Стоять насмерть">⚓</span>}
            </td>
            <td>
              {active ? (
                <Sel value={el.orderId} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={orderOptions} />
              ) : (
                <span className="muted small">{E.order(el).name}</span>
              )}
            </td>
            <td className={`small ${st.cls}`}>{st.label}</td>
            <td className="num">
              {fmt0(pers)}
              <span className="faint">/{fmt0(el.startPersonnel)}</span>
            </td>
            <td className="num">{vehStart ? `${vehNow}/${vehStart}` : <span className="faint">—</span>}</td>
            {f.morale && (
              <td style={{ minWidth: 90 }}>
                <Meter value={el.morale} />
              </td>
            )}
            {f.suppression && <td className={`num ${el.suppression > 50 ? 'bad' : ''}`}>{Math.round(el.suppression)}</td>}
            {f.fatigue && <td className="num">{Math.round(el.fatigue)}</td>}
            {f.ammo && <td className={`num ${el.ammo < b.ruleset.coefficients.lowAmmoThreshold ? 'bad' : ''}`}>{Math.round(el.ammo)}</td>}
            <td className="num">{pct(ce)}</td>
            {f.detection && <td className="center">{el.status === 'active' ? (el.spotted ? '👁' : <span className="faint">·</span>) : ''}</td>}
          </tr>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ карточка элемента

const EDITABLE: { key: keyof ElementState; label: string; feature?: keyof Battle['ruleset']['features'] }[] = [
  { key: 'morale', label: 'Мораль', feature: 'morale' },
  { key: 'cohesion', label: 'Слаженность', feature: 'cohesion' },
  { key: 'readiness', label: 'Готовность', feature: 'readiness' },
  { key: 'suppression', label: 'Подавление', feature: 'suppression' },
  { key: 'fatigue', label: 'Усталость', feature: 'fatigue' },
  { key: 'ammo', label: 'Боезапас', feature: 'ammo' },
  { key: 'fuel', label: 'Топливо', feature: 'fuel' },
  { key: 'equipment', label: 'Снаряжение', feature: 'equipment' },
  { key: 'vehicleCondition', label: 'Техсостояние', feature: 'vehicleCondition' },
];

function ElementModal({ b, E, id, onClose, iv, onFocusLog }: { b: Battle; E: EngineContext; id: string; onClose: () => void; iv: Iv; onFocusLog: (id: string) => void }) {
  const el = b.elements.find((x) => x.id === id);
  const [patch, setPatch] = useState<Record<string, number>>({});
  const [comps, setComps] = useState<Record<string, number>>({});
  if (!el) return null;
  const rs = b.ruleset;
  const fs = E.formationOf(el);
  const st = statusOf(E, el);
  const canEdit = !b.finished;
  const log = b.log.filter((x) => x.refs?.includes(el.id)).slice(-40);
  const dirty = Object.keys(patch).length + Object.keys(comps).length > 0;
  const apply = () => {
    const p: Record<string, unknown> = { ...patch };
    if (Object.keys(comps).length) p.comps = Object.entries(comps).map(([typeId, current]) => ({ typeId, current }));
    iv('editElement', { elementId: el.id, patch: p });
    setPatch({});
    setComps({});
  };
  return (
    <Modal
      wide
      title={
        <span>
          <span className="dot" style={{ background: b.sides[el.side].color, marginRight: 8 }} />
          {el.name} <span className={`small ${st.cls}`}>· {st.label}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => onFocusLog(el.id)}>Журнал только этого элемента</Btn>
          <div className="grow" />
          {canEdit && (
            <Btn kind="primary" disabled={!dirty} onClick={apply} title="Изменение записывается в журнал как вмешательство ГМ">
              Применить изменения
            </Btn>
          )}
          <Btn onClick={onClose}>Закрыть</Btn>
        </>
      }
    >
      <div className="muted small" style={{ marginBottom: 10 }}>
        {b.sides[el.side].name} · {fs.name} · {el.role || 'элемент'} · {E.order(el).name} · опыт: {rs.experienceLevels[el.experience - 1]?.name}
      </div>
      <div className="grid two">
        <div className="stack">
          <h4>Состав и потери</h4>
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Тип</th>
                <th className="num">Было</th>
                <th className="num">В строю</th>
                <th className="num" title="уничтожено / повреждено / брошено">Техника</th>
                <th className="num" title="убито / ранено / пропало">Люди</th>
              </tr>
            </thead>
            <tbody>
              {el.comps.map((c) => {
                const t = E.type(c.typeId);
                return (
                  <tr key={c.typeId}>
                    <td>{t.name}</td>
                    <td className="num">{c.start}</td>
                    <td className="num">
                      {canEdit ? (
                        <Num value={comps[c.typeId] ?? c.current} onChange={(v) => setComps({ ...comps, [c.typeId]: v })} min={0} integer width={70} title="Пополнение или списание (ГМ)" />
                      ) : (
                        c.current
                      )}
                    </td>
                    <td className="num small nowrap">{t.kind === 'personnel' ? '—' : `${c.destroyed} / ${c.damaged} / ${c.abandoned}`}</td>
                    <td className="num small nowrap">
                      {c.kia} / {c.wia} / {c.mia}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="small muted">
            Людей: {fmt0(E.personnel(el))} из {fmt0(el.startPersonnel)} (штат {fmt0(el.authorizedPersonnel)}){el.scattered ? `, рассеяно ${el.scattered}` : ''}. Боевая ценность{' '}
            {fmt0(E.value(el))} из {fmt0(el.startValue)}.
          </div>
          {canEdit && el.status === 'active' && (
            <div className="row">
              <Field label="Приказ">
                <Sel value={el.orderId} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={rs.orders.map((o) => ({ value: o.id, label: o.name }))} />
              </Field>
              <Field label="Эшелон">
                <Sel
                  value={el.echelon}
                  onChange={(v) => iv('editElement', { elementId: el.id, patch: { echelon: v } })}
                  options={[
                    { value: 'front', label: 'Первый' },
                    { value: 'support', label: 'Второй' },
                    { value: 'rear', label: 'Тыл' },
                  ]}
                />
              </Field>
              <Field label="Стоять насмерть">
                <Sel value={el.holdFast ? 'y' : 'n'} onChange={(v) => iv('editElement', { elementId: el.id, patch: { holdFast: v === 'y' } })} options={[{ value: 'n', label: 'нет' }, { value: 'y', label: 'да' }]} />
              </Field>
            </div>
          )}
          {canEdit && el.status === 'active' && (rs.features.ammo || rs.features.fuel) && (
            <div className="row">
              <span className="muted small">Снабжение (ГМ):</span>
              {rs.features.ammo && (
                <Btn sm onClick={() => iv('resupply', { elementIds: [el.id], ammo: 25 })}>
                  БК +25%
                </Btn>
              )}
              {rs.features.fuel && (
                <Btn sm onClick={() => iv('resupply', { elementIds: [el.id], fuel: 25 })}>
                  Топливо +25%
                </Btn>
              )}
            </div>
          )}
        </div>
        <div className="stack">
          <h4>Состояние {canEdit && <span className="faint">(можно править)</span>}</h4>
          <div className="fields">
            {EDITABLE.filter((x) => !x.feature || rs.features[x.feature]).map((x) => (
              <Field key={x.key} label={x.label}>
                {canEdit ? (
                  <Num value={patch[x.key] ?? Math.round((el[x.key] as number) * 10) / 10} onChange={(v) => setPatch({ ...patch, [x.key]: v })} min={0} max={100} width="100%" />
                ) : (
                  <span className="num">{Math.round(el[x.key] as number)}</span>
                )}
              </Field>
            ))}
          </div>
          <h4>События элемента</h4>
          <div className="stack small" style={{ gap: 3, maxHeight: 260, overflow: 'auto' }}>
            {log.length ? (
              log.map((x, i) => (
                <div key={i}>
                  <span className="faint">[{x.turn}]</span> <RichText text={x.text} b={b} />
                </div>
              ))
            ) : (
              <span className="faint">Событий пока нет.</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ConditionsModal({ b, onClose, iv }: { b: Battle; onClose: () => void; iv: Iv }) {
  const rs = b.ruleset;
  const [cond, setCond] = useState<Record<string, string>>({ ...b.conditions });
  const [bandIdx, setBand] = useState(b.bandIndex);
  return (
    <Modal
      title="Изменить условия боя"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            onClick={() => {
              if (Object.keys(cond).some((k) => cond[k] !== b.conditions[k])) iv('setConditions', { conditions: cond });
              if (bandIdx !== b.bandIndex) iv('setBand', { bandIndex: bandIdx });
              onClose();
            }}
          >
            Применить
          </Btn>
        </>
      }
    >
      <p className="muted small">Например, наступили сумерки или начался дождь. Изменение действует со следующего хода и записывается в журнал.</p>
      <div className="fields two">
        {rs.conditions.map((c) => (
          <Field key={c.id} label={c.name}>
            <Sel value={cond[c.id] ?? ''} onChange={(v) => setCond({ ...cond, [c.id]: v })} options={c.options.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        ))}
        <Field label="Дистанция">
          <Sel value={bandIdx} onChange={setBand} options={rs.rangeBands.map((x, i) => ({ value: i, label: x.name }))} />
        </Field>
      </div>
    </Modal>
  );
}

function FormationModal({ b, id, onClose, iv }: { b: Battle; id: string; onClose: () => void; iv: Iv }) {
  const fs = b.formations.find((x) => x.id === id);
  const rs = b.ruleset;
  const [order, setOrder] = useState('');
  const [comms, setComms] = useState(fs?.comms ?? 100);
  const [supply, setSupply] = useState(fs?.supply ?? 100);
  const [cmd, setCmd] = useState(fs?.commandLevel ?? 1);
  if (!fs) return null;
  const disabled = b.finished;
  return (
    <Modal
      title={fs.name}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={disabled}
            onClick={() => {
              const p: Record<string, unknown> = { formationId: fs.id };
              if (order) p.orderId = order;
              if (comms !== fs.comms) p.comms = comms;
              if (supply !== fs.supply) p.supply = supply;
              if (cmd !== fs.commandLevel) p.commandLevel = cmd;
              if (Object.keys(p).length > 1) iv('setFormation', p);
              onClose();
            }}
          >
            Применить
          </Btn>
        </>
      }
    >
      <div className="fields two">
        <Field label="Приказ всему формированию" hint="Получат все элементы, включая вложенные.">
          <Sel value={order} onChange={setOrder} options={[{ value: '', label: '— не менять —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name }))]} />
        </Field>
        {rs.features.command && (
          <Field label={`Командир${fs.commanderName ? ` (${fs.commanderName})` : ''}`}>
            <Sel value={cmd} onChange={setCmd} options={rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))} />
          </Field>
        )}
        {rs.features.comms && (
          <Field label="Связь, %">
            <Num value={comms} onChange={setComms} min={0} max={100} />
          </Field>
        )}
        <Field label="Снабжение, %">
          <Num value={supply} onChange={setSupply} min={0} max={100} />
        </Field>
      </div>
      {fs.hqLost && <div className="note bad" style={{ marginTop: 10 }}>Штаб формирования потерян: связь снижена, влияние командира утрачено.</div>}
    </Modal>
  );
}

// ------------------------------------------------------------------ динамика

function Charts({ b }: { b: Battle }) {
  const h = b.history;
  if (h.length < 2) return <div className="empty">Графики появятся после первого хода.</div>;
  const labels = h.map((x) => x.turn);
  const ser = (fn: (s: (typeof h)[number]['sides']['A']) => number, norm = false) =>
    SIDES.map((s) => {
      const base = norm ? fn(h[0].sides[s]) || 1 : 1;
      return { name: b.sides[s].name, color: b.sides[s].color, values: h.map((x) => (fn(x.sides[s]) / base) * (norm ? 100 : 1)) };
    });
  return (
    <div className="grid two">
      <Card title="Личный состав, чел.">
        <LineChart series={ser((x) => x.personnel)} labels={labels} xTitle="ход" />
      </Card>
      <Card title="Боеспособность, % от начальной">
        <LineChart series={ser((x) => x.ce, true)} labels={labels} yMax={100} yUnit="%" xTitle="ход" />
      </Card>
      {b.ruleset.features.morale && (
        <Card title="Средняя мораль элементов в бою">
          <LineChart series={ser((x) => x.morale)} labels={labels} yMax={100} xTitle="ход" />
        </Card>
      )}
      <Card title="Техника в строю">
        <LineChart series={ser((x) => x.vehicles)} labels={labels} xTitle="ход" />
      </Card>
      <Card title="Дистанция (0 — самая дальняя)">
        <LineChart series={[{ name: 'Дистанция', color: 'var(--accent)', values: h.map((x) => x.band) }]} labels={labels} yMax={Math.max(1, b.ruleset.rangeBands.length - 1)} xTitle="ход" />
        <div className="faint small">{b.ruleset.rangeBands.map((x, i) => `${i} — ${x.name}`).join(' · ')}</div>
      </Card>
      <Card title="Элементов в бою">
        <LineChart series={ser((x) => x.active)} labels={labels} xTitle="ход" />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ итоги

function UnitTable({ u }: { u: UnitSummary }) {
  const p = u.personnel;
  return (
    <table className="tbl compact">
      <tbody>
        <tr>
          <td>Личный состав</td>
          <td className="num">
            <b>{fmt0(p.current)}</b> из {fmt0(p.start)} <span className="faint">(штат {fmt0(p.authorized)})</span>
          </td>
        </tr>
        <tr>
          <td>Потери</td>
          <td className="num">
            <b className={p.lossPct > 25 ? 'bad' : ''}>
              {fmt0(p.losses)} ({pct(p.lossPct)})
            </b>
            : убито {fmt0(p.kia)}, ранено {fmt0(p.wia)}, пропало {fmt0(p.mia)}
          </td>
        </tr>
        {u.equipment.map((q) => (
          <tr key={q.typeId}>
            <td>{q.name}</td>
            <td className="num">
              <b>{q.current}</b> из {q.start}
              {q.losses > 0 && (
                <span className="bad">
                  {' '}
                  −{q.losses} ({pct(q.lossPct)}): {[q.destroyed && `уничт. ${q.destroyed}`, q.damaged && `повр. ${q.damaged}`, q.abandoned && `брошено ${q.abandoned}`].filter(Boolean).join(', ')}
                </span>
              )}
            </td>
          </tr>
        ))}
        <tr>
          <td>Остаточная боеспособность</td>
          <td className="num">
            <b>{pct(u.combatEffectiveness)}</b> <span className="faint">(боевая ценность {pct(u.strength)})</span>
          </td>
        </tr>
        <tr>
          <td>Организация</td>
          <td className="num">{pct(u.organization)}</td>
        </tr>
        <tr>
          <td>Мораль</td>
          <td className="num">{Math.round(u.morale)}</td>
        </tr>
        <tr>
          <td>Снабжение</td>
          <td className="num">
            БК {pct(u.supply.ammo)} · топливо {pct(u.supply.fuel)} · снаряжение {pct(u.supply.equipment)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Result({ b, result, onElement }: { b: Battle; result: BattleResult; onElement: (id: string) => void }) {
  const lib = useApp((s) => s.formations);
  const linked = b.scenario.sides.some((s) => s.formations.some((f) => f.sourceId && lib[f.sourceId]));
  return (
    <div className="stack">
      <div className="card" style={{ borderTop: `3px solid ${result.winner ? b.sides[result.winner].color : 'var(--accent)'}` }}>
        <div className="card-body">
          {!b.finished && <div className="badge warn" style={{ marginBottom: 6 }}>Бой не окончен — оценка на текущий ход</div>}
          <div className="bignum" style={{ color: result.winner ? b.sides[result.winner].color : undefined }}>
            {result.headline}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {b.finished ? `${result.endReason}. ` : ''}Ходов: {result.turns}. Выполнение задач: {b.sides.A.name} {pct(result.sides.A.score * 100)} — {b.sides.B.name}{' '}
            {pct(result.sides.B.score * 100)}.
          </div>
        </div>
      </div>
      <div className="grid two">
        {SIDES.map((s) => {
          const r = result.sides[s];
          return (
            <Card key={s} title={<span style={{ color: b.sides[s].color }}>{r.name}</span>} actions={<span className="badge">задачи {pct(r.score * 100)}</span>}>
              <UnitTable u={r} />
              <h4 style={{ margin: '12px 0 4px' }}>Задачи</h4>
              {r.objectives.map((o) => (
                <div key={o.objective.id} style={{ marginBottom: 4 }}>
                  <b className={o.score >= 0.999 ? 'good' : o.score < 0.4 ? 'bad' : 'warn'}>{pct(o.score * 100)}</b> {o.label}
                  <div className="faint small">{o.explanation}</div>
                </div>
              ))}
              {r.formations.length > 0 && (
                <>
                  <h4 style={{ margin: '12px 0 4px' }}>По формированиям</h4>
                  <table className="tbl compact">
                    <thead>
                      <tr>
                        <th>Формирование</th>
                        <th className="num">Люди</th>
                        <th className="num">Потери</th>
                        <th className="num">Боесп.</th>
                        <th className="num">Орг.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.formations.map((f) => (
                        <tr key={f.formationId}>
                          <td style={{ paddingLeft: 6 + f.depth * 14 }}>{f.name}</td>
                          <td className="num">
                            {fmt0(f.personnel.current)}/{fmt0(f.personnel.start)}
                          </td>
                          <td className="num">{pct(f.personnel.lossPct)}</td>
                          <td className="num">{pct(f.combatEffectiveness)}</td>
                          <td className="num">{pct(f.organization)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          );
        })}
      </div>
      {result.keyEvents.length > 0 && (
        <Card title="Ключевые события">
          <div className="stack small" style={{ gap: 3 }}>
            {b.log
              .filter((x) => x.level === 0 && x.phase !== 'turn' && x.phase !== 'setup' && x.phase !== 'end')
              .map((x, i) => (
                <div key={i}>
                  <span className="faint">Ход {x.turn}:</span> <RichText text={x.text} b={b} onElement={onElement} />
                </div>
              ))}
          </div>
        </Card>
      )}
      {b.finished && (
        <Card title="Перенести результаты (для кампании)">
          <p className="muted small">
            Потери, раненые (как «вернутся в строй»), повреждённая техника (как «в ремонте»), мораль, усталость и снабжение записываются в подразделения.
          </p>
          <div className="row">
            <Btn onClick={() => saveResultsAsNew(b)}>Сохранить как новые подразделения</Btn>
            <Btn onClick={() => updateLibraryFromBattle(b)} disabled={!linked} title={linked ? '' : 'Подразделения боя не связаны с библиотекой'}>
              Обновить исходные в библиотеке
            </Btn>
            <Btn onClick={() => updateScenarioFromBattle(b)}>Обновить подразделения сценария</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
