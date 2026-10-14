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
import { Btn, Card, Check, Field, Menu, Meter, Modal, Num, Section, Sel, fmt0, pct } from '../components/ui';
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

  const conditions = rs.conditions
    .map((c) => c.options.find((o) => o.id === b.conditions[c.id])?.name)
    .filter(Boolean)
    .join(', ');
  const winnerColor = result.winner ? b.sides[result.winner].color : undefined;

  return (
    <div className="page fill">
      <div className="battle-head">
        <input className="title-input" value={b.name} onChange={(e) => renameBattle(b.id, e.target.value)} />
        {b.finished ? (
          <>
            <Btn kind="primary" onClick={() => copyText(formatReport(b))} title="Текстовый отчёт для игроков">
              Скопировать отчёт
            </Btn>
            <Btn onClick={() => restart(randomSeed())} title="Новый бой по тому же сценарию с другим сидом">
              Переиграть
            </Btn>
          </>
        ) : (
          <>
            <Btn kind="primary" onClick={() => step(1)} title="Рассчитать один ход">
              ▶ Ход
            </Btn>
            <Btn onClick={() => step(5)} title="Рассчитать пять ходов">
              ▶▶ 5
            </Btn>
            <Btn onClick={toEnd} title="Рассчитать бой до конца">
              До конца
            </Btn>
          </>
        )}
        <Menu
          items={[
            !b.finished && { label: 'Изменить условия и дистанцию…', onClick: () => setCondModal(true) },
            !b.finished && { label: 'Завершить бой сейчас', onClick: () => iv('endBattle', { reason: 'Бой остановлен ГМ' }), tip: 'Подвести итоги на текущем ходу' },
            'sep',
            { label: 'Переиграть с тем же сидом', onClick: () => restart(b.seed), tip: 'Тот же сид и те же решения дают тот же бой' },
            { label: 'Переиграть с новым сидом', onClick: () => restart(randomSeed()) },
            b.interventions.length > 0 && { label: 'Повторить с решениями ГМ', onClick: () => restart(b.seed, true), tip: 'Воспроизвести бой вместе с вашими вмешательствами до текущего хода' },
            'sep',
            !b.finished && { label: 'Скопировать отчёт', onClick: () => copyText(formatReport(b)) },
            { label: 'Сохранить отчёт с журналом…', onClick: () => exportText(`${b.name} — отчёт`, formatReport(b, { includeLog: true, logLevel: settings.logLevel }), 'txt') },
            { label: 'Сохранить бой в файл…', onClick: () => exportJson('battle', b.name, b), tip: 'JSON — можно передать другому ГМ и импортировать' },
            'sep',
            { label: 'Удалить бой', danger: true, onClick: () => deleteBattle(b.id) },
          ]}
        />
        <div className="meta" style={{ width: '100%' }}>
          <span>
            Ход <b>{b.turn}</b> из {b.scenario.maxTurns} · {Math.floor(elapsed / 60)} ч {elapsed % 60} мин
          </span>
          <span>
            Дистанция: <b>{band?.name ?? '—'}</b>
            {!b.finished && b.bandIndex < rs.rangeBands.length - 1 && b.closingProgress > 0 ? ` (сближение ${Math.round(b.closingProgress * 100)}%)` : ''}
          </span>
          {b.finished ? (
            <span>{conditions}</span>
          ) : (
            <span className="cond-link" data-tip="Изменить условия (вмешательство ГМ)" onClick={() => setCondModal(true)}>
              {conditions}
            </span>
          )}
          {b.finished && <b style={{ color: winnerColor }}>{result.headline}</b>}
          <span className="faint">
            <Link kind="scenario" refId={b.scenarioId}>
              сценарий
            </Link>{' '}
            · сид {b.seed}
          </span>
        </div>
      </div>

      <div className="battle-body">
        <div className="battle-main">
          <div className="subtabs">
            <button className={view === 'forces' ? 'on' : ''} onClick={() => setView('forces')}>
              Силы
            </button>
            <button className={view === 'result' ? 'on' : ''} onClick={() => setView('result')}>
              {b.finished ? 'Итоги' : 'Оценка'}
            </button>
            <button className={view === 'charts' ? 'on' : ''} onClick={() => setView('charts')}>
              Графики
            </button>
          </div>
          <div className="scroll">
            {view === 'forces' && <Forces b={b} E={E} result={result} tabKey={tab.key} onElement={setElModal} onFormation={setFmModal} iv={iv} />}
            {view === 'charts' && <Charts b={b} />}
            {view === 'result' && <Result b={b} result={result} onElement={setElModal} />}
          </div>
        </div>
        <div className="battle-log">
          <LogView b={b} rev={rev} tabKey={tab.key} defaultLevel={settings.logLevel} focus={focus} onElement={setElModal} onClearFocus={() => setFocus(null)} />
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

function Stat({ k, v, sub, color }: { k: string; v: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v" style={color ? { color } : undefined}>
        {v} {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

function SideSummary({ b, side, r }: { b: Battle; side: SideId; r: SideResult }) {
  const p = r.personnel;
  const f = b.ruleset.features;
  const lostEq = r.equipment.filter((q) => q.losses > 0);
  const objectives = r.objectives.map((o) => `${pct(o.score * 100)} — ${o.label}`).join('\n');
  return (
    <div className="card side-card" style={{ ['--side' as string]: b.sides[side].color }}>
      <div className="card-head">
        <span className="dot" style={{ background: b.sides[side].color }} />
        <h3>{b.sides[side].name}</h3>
        <span className="muted small" data-tip={`Выполнение задач:\n${objectives}`}>
          задачи {pct(r.score * 100)}
        </span>
      </div>
      <div className="card-body">
        <div className="stat-row">
          <Stat k="Личный состав" v={fmt0(p.current)} sub={`из ${fmt0(p.start)}`} />
          <Stat k="Потери" v={pct(p.lossPct)} sub={`${fmt0(p.losses)} чел.`} color={p.lossPct > 30 ? 'var(--bad)' : undefined} />
          <Stat k="Боеспособность" v={pct(r.combatEffectiveness)} />
          {f.morale && <Stat k="Мораль" v={Math.round(r.morale)} />}
        </div>
        <div className="meta" style={{ marginTop: 8 }}>
          <span>
            организация <b>{pct(r.organization)}</b>
          </span>
          {f.ammo && (
            <span>
              боезапас <b>{pct(r.supply.ammo)}</b>
            </span>
          )}
          {lostEq.length > 0 && <span className="bad">техника: {lostEq.map((q) => `${q.name} −${q.losses}`).join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

function Forces(props: { b: Battle; E: EngineContext; result: BattleResult; tabKey: string; onElement: (id: string) => void; onFormation: (id: string) => void; iv: Iv }) {
  const { b, result } = props;
  const [details, setDetails] = useTabState(`${props.tabKey}:details`, false);
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
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: -8 }}>
        <Check value={details} onChange={setDetails} title="Подавление, усталость, боезапас, техника, обнаружение">
          <span className="muted small">подробные столбцы</span>
        </Check>
      </div>
      {SIDES.map((side) => (
        <Card key={side} title={<span style={{ color: b.sides[side].color }}>{b.sides[side].name}</span>} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Элемент</th>
                  <th>Приказ</th>
                  <th className="num">Люди</th>
                  {b.ruleset.features.morale && <th>Мораль</th>}
                  <th className="num" data-tip="Остаточная боеспособность">
                    Боесп.
                  </th>
                  {details && <DetailHeaders b={b} />}
                </tr>
              </thead>
              <tbody>
                {rowsFor(side).map(({ f: fs, depth }) => (
                  <FormationRows key={fs.id} {...props} fs={fs} depth={depth} details={details} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function DetailHeaders({ b }: { b: Battle }) {
  const f = b.ruleset.features;
  return (
    <>
      <th className="num">Техн.</th>
      {f.suppression && <th className="num">Подавл.</th>}
      {f.fatigue && <th className="num">Устал.</th>}
      {f.ammo && <th className="num">БК</th>}
      {f.detection && <th data-tip="Обнаружен противником в этом ходу">Виден</th>}
    </>
  );
}

function FormationRows(props: { b: Battle; E: EngineContext; fs: FormationState; depth: number; details: boolean; onElement: (id: string) => void; onFormation: (id: string) => void; iv: Iv }) {
  const { b, E, fs, depth, details, iv } = props;
  const f = b.ruleset.features;
  const els = b.elements.filter((x) => x.formationId === fs.id);
  const cols = 4 + (f.morale ? 1 : 0) + (details ? 1 + [f.suppression, f.fatigue, f.ammo, f.detection].filter(Boolean).length : 0);
  const orderOptions = b.ruleset.orders.map((o) => ({ value: o.id, label: o.name }));
  return (
    <>
      <tr className="group">
        <td colSpan={cols} style={{ paddingLeft: 8 + depth * 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <a
              href="#"
              onClick={(e) => (e.preventDefault(), props.onFormation(fs.id))}
              data-tip={`${fs.level}${fs.commanderName ? ` · ${fs.commanderName}` : ''}\nПриказ всему формированию, командир, связь, снабжение`}
            >
              {fs.name}
            </a>
            <span className="faint small">
              {f.comms ? `связь ${Math.round(fs.comms)}% · ` : ''}снабжение {Math.round(fs.supply)}%
            </span>
            {fs.hqLost && <span className="badge bad">штаб потерян</span>}
            {fs.broken && <span className="badge bad">сломлено</span>}
          </div>
        </td>
      </tr>
      {els.map((el) => {
        const st = statusOf(E, el);
        const ce = el.startValue > 0 ? (combatEffectiveness(E, el) / el.startValue) * 100 : 0;
        const active = el.status === 'active' && !b.finished;
        const veh = el.comps.filter((c) => E.type(c.typeId).kind !== 'personnel');
        const vehNow = veh.reduce((a, c) => a + c.current, 0);
        const vehStart = veh.reduce((a, c) => a + c.start, 0);
        return (
          <tr key={el.id} className={el.status !== 'active' ? 'dim' : ''}>
            <td style={{ paddingLeft: 18 + depth * 14 }}>
              <span className={`status-dot ${st.cls}`} data-tip={st.label} />
              <a href="#" onClick={(e) => (e.preventDefault(), props.onElement(el.id))}>
                {el.name}
              </a>
              {el.isHQ && <span className="faint small"> · штаб</span>}
            </td>
            <td>
              {active && E.behavior(el) !== 'rout' ? (
                <Sel value={el.orderId} width={124} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={orderOptions} />
              ) : (
                <span className={`small ${st.cls}`}>{st.label}</span>
              )}
            </td>
            <td className="num">
              {fmt0(E.personnel(el))}
              <span className="faint">/{fmt0(el.startPersonnel)}</span>
            </td>
            {f.morale && (
              <td style={{ minWidth: 90 }}>
                <Meter value={el.morale} />
              </td>
            )}
            <td className="num">{pct(ce)}</td>
            {details && (
              <>
                <td className="num">{vehStart ? `${vehNow}/${vehStart}` : <span className="faint">—</span>}</td>
                {f.suppression && <td className={`num ${el.suppression > 50 ? 'bad' : ''}`}>{Math.round(el.suppression)}</td>}
                {f.fatigue && <td className="num">{Math.round(el.fatigue)}</td>}
                {f.ammo && <td className={`num ${el.ammo < b.ruleset.coefficients.lowAmmoThreshold ? 'bad' : ''}`}>{Math.round(el.ammo)}</td>}
                {f.detection && <td className="center">{el.status === 'active' ? (el.spotted ? 'да' : <span className="faint">—</span>) : ''}</td>}
              </>
            )}
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
  const canEdit = !b.finished && el.status === 'active';
  const log = b.log.filter((x) => x.refs?.includes(el.id) && x.level <= 1).slice(-30);
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
          <Btn kind="ghost" onClick={() => onFocusLog(el.id)}>
            Показать в журнале только его
          </Btn>
          <div className="grow" />
          {canEdit && (
            <Btn kind="primary" disabled={!dirty} onClick={apply} title="Изменение записывается в журнал как вмешательство ГМ">
              Применить
            </Btn>
          )}
          <Btn onClick={onClose}>Закрыть</Btn>
        </>
      }
    >
      <div className="meta" style={{ marginBottom: 12 }}>
        <span>{fs.name}</span>
        <span>опыт: {rs.experienceLevels[el.experience - 1]?.name}</span>
        <span>
          людей {fmt0(E.personnel(el))} из {fmt0(el.startPersonnel)}
        </span>
      </div>
      <div className="grid two">
        <div className="stack">
          {canEdit && (
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
              <Field label=" ">
                <Check value={el.holdFast} onChange={(v) => iv('editElement', { elementId: el.id, patch: { holdFast: v } })} title="Не отходит добровольно; шанс паники вдвое ниже">
                  стоять насмерть
                </Check>
              </Field>
            </div>
          )}
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Состав</th>
                <th className="num">Было</th>
                <th className="num">Сейчас</th>
                <th className="num" data-tip={'Люди: убито / ранено / пропало.\nТехника: уничтожено / повреждено / брошено.'}>
                  Потери
                </th>
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
                    <td className="num small nowrap">{t.kind === 'personnel' ? `${c.kia} / ${c.wia} / ${c.mia}` : `${c.destroyed} / ${c.damaged} / ${c.abandoned}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canEdit && (rs.features.ammo || rs.features.fuel) && (
            <div className="row">
              <span className="muted small">Подвезти:</span>
              {rs.features.ammo && (
                <Btn sm onClick={() => iv('resupply', { elementIds: [el.id], ammo: 25 })}>
                  боезапас +25%
                </Btn>
              )}
              {rs.features.fuel && (
                <Btn sm onClick={() => iv('resupply', { elementIds: [el.id], fuel: 25 })}>
                  топливо +25%
                </Btn>
              )}
            </div>
          )}
        </div>
        <div className="stack">
          <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
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
          <div className="stack small" style={{ gap: 3, maxHeight: 200, overflow: 'auto' }}>
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
      title="Условия боя"
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
      <p className="faint small" style={{ marginTop: 10, marginBottom: 0 }}>
        Действует со следующего хода и записывается в журнал.
      </p>
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
  return (
    <Modal
      title={fs.name}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={b.finished}
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
        <Field label="Приказ всем элементам" hint="Получат все элементы, включая вложенные подразделения.">
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
      {fs.hqLost && (
        <div className="note bad" style={{ marginTop: 10 }}>
          Штаб потерян: связь снижена, влияние командира утрачено.
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ графики

function Charts({ b }: { b: Battle }) {
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

function UnitTable({ u }: { u: UnitSummary }) {
  const p = u.personnel;
  return (
    <table className="tbl compact">
      <tbody>
        <tr>
          <td>Личный состав</td>
          <td className="num">
            <b>{fmt0(p.current)}</b> из {fmt0(p.start)}
          </td>
        </tr>
        <tr>
          <td>Потери</td>
          <td className="num" data-tip={`убито ${fmt0(p.kia)}, ранено ${fmt0(p.wia)}, пропало без вести ${fmt0(p.mia)}`}>
            <b className={p.lossPct > 25 ? 'bad' : ''}>
              {fmt0(p.losses)} ({pct(p.lossPct)})
            </b>{' '}
            <span className="faint">
              {fmt0(p.kia)} / {fmt0(p.wia)} / {fmt0(p.mia)}
            </span>
          </td>
        </tr>
        {u.equipment.map((q) => (
          <tr key={q.typeId}>
            <td>{q.name}</td>
            <td className="num" data-tip={q.losses ? `уничтожено ${q.destroyed}, повреждено ${q.damaged}, брошено ${q.abandoned}` : undefined}>
              <b>{q.current}</b> из {q.start}
              {q.losses > 0 && <span className="bad"> −{q.losses}</span>}
            </td>
          </tr>
        ))}
        <tr>
          <td>Боеспособность</td>
          <td className="num">
            <b>{pct(u.combatEffectiveness)}</b>
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
          <td className="num" data-tip={`боезапас ${pct(u.supply.ammo)}, топливо ${pct(u.supply.fuel)}, снаряжение ${pct(u.supply.equipment)}`}>
            БК {pct(u.supply.ammo)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Result({ b, result, onElement }: { b: Battle; result: BattleResult; onElement: (id: string) => void }) {
  const lib = useApp((s) => s.formations);
  const linked = b.scenario.sides.some((s) => s.formations.some((f) => f.templateId && lib[f.templateId]));
  const keyEvents = b.log.filter((x) => x.level === 0 && x.phase !== 'turn' && x.phase !== 'setup' && x.phase !== 'end');
  return (
    <div className="stack">
      <div>
        {!b.finished && <div className="muted small">Бой не окончен — оценка на текущий ход</div>}
        <div className="bignum" style={{ color: result.winner ? b.sides[result.winner].color : undefined }}>
          {result.headline}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {b.finished ? `${result.endReason}. ` : ''}Ходов: {result.turns}.
        </div>
      </div>
      <div className="grid two">
        {SIDES.map((s) => {
          const r = result.sides[s];
          return (
            <Card key={s} title={<span style={{ color: b.sides[s].color }}>{r.name}</span>} actions={<span className="muted small">задачи {pct(r.score * 100)}</span>}>
              <UnitTable u={r} />
              <div style={{ marginTop: 10 }}>
                {r.objectives.map((o) => (
                  <div key={o.objective.id} data-tip={o.explanation} style={{ marginBottom: 2 }}>
                    <b className={o.score >= 0.999 ? 'good' : o.score < 0.4 ? 'bad' : 'warn'}>{pct(o.score * 100)}</b> {o.label}
                  </div>
                ))}
              </div>
            </Card>
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
      {b.finished && (
        <Section id="battle-transfer" title="Перенести результаты в подразделения" summary="для кампании">
          <p className="muted small">Потери, раненые, повреждённая техника, мораль, усталость и снабжение записываются в подразделения.</p>
          <div className="row">
            <Btn onClick={() => saveResultsAsNew(b)}>Сохранить как новые</Btn>
            <Btn onClick={() => updateLibraryFromBattle(b)} disabled={!linked} title={linked ? '' : 'Подразделения боя не связаны с библиотекой'}>
              Обновить библиотеку
            </Btn>
            <Btn onClick={() => updateScenarioFromBattle(b)}>Обновить сценарий</Btn>
          </div>
        </Section>
      )}
    </div>
  );
}
