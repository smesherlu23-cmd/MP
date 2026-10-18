// Бой: пошаговое управление, вмешательства ГМ, силы сторон, журнал, графики и итоги.

import { useEffect, useMemo, useState } from 'react';
import {
  EngineContext,
  STATUS_LABELS,
  applyIntervention,
  arrivalTurn,
  combatEffectiveness,
  computeResult,
  explainResult,
  formatReport,
  formatSideReport,
  lastBattleAction,
  plural,
  randomSeed,
  replayBattle,
  resolveRefs,
  runToEnd,
  stepTurn,
  stepUntilEvent,
  type Battle,
  type BattleResult,
  type ElementState,
  type FormationState,
  type SideId,
  type SideResult,
} from '../../engine';
import { EffectModal, ForecastModal, GroupEditModal, PauseSettingsModal, StrikeModal, SupportPanel, usePauseRules, type Target } from '../components/BattleControls';
import { LineChart } from '../components/Charts';
import { CommanderSelect } from '../components/CommanderSelect';
import { Crumbs } from '../components/Crumbs';
import { LogView, RichText } from '../components/LogView';
import { Btn, Card, Check, Field, Menu, Meter, Modal, Num, Section, Sel, fmt0, pct, pressable } from '../components/ui';
import { useTabState } from '../hooks';
import { nextBattleName } from './ScenarioPage';
import { applyResultsToForces, battleForces } from '../postBattle';
import {
  branchBattleDialog,
  deleteBattle,
  ensureFullLog,
  fmtDate,
  exportJson,
  exportText,
  forgetBattleRedo,
  loadBattle,
  openTab,
  putBattle,
  renameBattle,
  rewindBattleDialog,
  toast,
  touchBattle,
  undoBattle,
  useApp,
  useBattles,
  type Tab,
} from '../store';

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
  const [effectFor, setEffectFor] = useState<Target | null>(null);
  const [strikeFor, setStrikeFor] = useState<{ side: SideId; assetId?: string; target?: Target } | null>(null);
  const [pauseModal, setPauseModal] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [groupEdit, setGroupEdit] = useState<string[] | null>(null);
  const [pauseNote, setPauseNote] = useState<string[] | null>(null);
  const rules = usePauseRules();

  const E = useMemo(() => new EngineContext(b), [b, rev]);
  const result: BattleResult = useMemo(() => b.result ?? computeResult(E), [E]);
  const rs = b.ruleset;
  const band = rs.rangeBands[b.bandIndex];
  const elapsed = b.turn * rs.turnMinutes;

  const step = (n: number) => {
    forgetBattleRedo(b.id);
    setPauseNote(null);
    for (let i = 0; i < n && !b.finished; i++) stepTurn(b);
    touchBattle(b.id);
    if (b.finished) setView('result');
  };
  const toEnd = () => {
    forgetBattleRedo(b.id);
    setPauseNote(null);
    runToEnd(b);
    touchBattle(b.id);
    setView('result');
  };
  /** Ход за ходом, пока не случится важное (что именно — настраивается). */
  const untilEvent = () => {
    forgetBattleRedo(b.id);
    const { reasons } = stepUntilEvent(b, rules);
    touchBattle(b.id);
    if (b.finished) {
      setPauseNote(null);
      setView('result');
      return;
    }
    setPauseNote(reasons);
  };
  /** again — та же случайность (тот же бой заново), иначе — новый случайный бой. */
  const restart = (again: boolean, withInterventions = false) => {
    const nb = replayBattle(b, { seed: again ? b.seed : randomSeed(), withInterventions });
    const base = b.name.replace(/ \(повтор[^)]*\)$/, '');
    nb.name = again ? `${base} (повтор${withInterventions ? ' с решениями ГМ' : ''})` : nextBattleName({ ...b.scenario, id: b.scenarioId });
    putBattle(nb);
    openTab('battle', nb.id);
  };
  const iv = (type: Parameters<typeof applyIntervention>[1]['type'], payload: Record<string, unknown>) => {
    forgetBattleRedo(b.id);
    setPauseNote(null);
    applyIntervention(b, { type, payload });
    touchBattle(b.id);
    if (b.finished) setView('result');
  };

  const conditions = rs.conditions
    .map((c) => c.options.find((o) => o.id === b.conditions[c.id])?.name)
    .filter(Boolean)
    .join(', ');
  const winnerColor = result.winner ? b.sides[result.winner].color : undefined;
  const lastAction = lastBattleAction(b);
  const undoLabel = !lastAction ? '' : lastAction.kind === 'turn' ? `ход ${lastAction.turn}` : lastAction.label;
  const scenarioExists = !!useApp.getState().scenarios[b.scenarioId];

  return (
    <div className="page fill">
      <div className="battle-head">
        <div style={{ width: '100%', marginBottom: -6 }}>
          <Crumbs items={[{ label: 'Бои', section: 'battles' }, scenarioExists ? { label: b.scenario.name, open: ['scenario', b.scenarioId] } : { label: b.scenario.name }]} />
        </div>
        <input className="title-input" value={b.name} onChange={(e) => renameBattle(b.id, e.target.value)} />
        {b.finished ? (
          <>
            <Btn kind="primary" onClick={() => copyText(formatReport(b))} title="Полный отчёт для ГМ: все цифры обеих сторон. Донесения для игроков — в меню «⋯» и на вкладке «Итоги».">
              Скопировать отчёт
            </Btn>
            <Btn onClick={() => restart(false)} title="Новый бой по тому же сценарию — с другими случайностями">
              Переиграть
            </Btn>
          </>
        ) : (
          <>
            <Btn kind="primary" onClick={() => step(1)} title="Рассчитать один ход">
              ▶ Ход
            </Btn>
            <Btn
              onClick={untilEvent}
              title={`Считать ходы, пока не случится важное: ${Object.entries(rules)
                .filter(([k, v]) => k !== 'lossPct' && v)
                .length} видов событий${rules.lossPct ? `, потери за ход ≥ ${rules.lossPct}%` : ''}. Настроить — в меню «⋯».`}
            >
              ⏭ До события
            </Btn>
            <Btn onClick={() => step(5)} title="Рассчитать пять ходов">
              ▶▶ 5
            </Btn>
            <Btn onClick={toEnd} title="Рассчитать бой до конца">
              До конца
            </Btn>
            <Btn onClick={() => setForecastOpen(true)} title="Что дальше? Сотни продолжений боя с этого хода — вероятности исходов и потерь. Если вы только что приняли решения — рядом прогноз без них.">
              Прогноз
            </Btn>
          </>
        )}
        {undoLabel && (
          <Btn icon onClick={() => undoBattle(b.id)} title={`Отменить: ${undoLabel} (Ctrl+Z). Бой повторяется с теми же бросками.`}>
            ↶
          </Btn>
        )}
        <Menu
          items={[
            !!undoLabel && { label: `Отменить: ${undoLabel}`, kbd: 'Ctrl+Z', onClick: () => undoBattle(b.id) },
            b.turn > 0 && { label: 'Вернуться к ходу…', onClick: () => rewindBattleDialog(b.id), tip: 'Повторить бой до выбранного хода с теми же бросками и вашими решениями' },
            { label: 'Ответвить бой…', onClick: () => branchBattleDialog(b.id), tip: 'Копия боя с выбранного хода — сыграть иначе и сравнить; этот бой не меняется' },
            'sep',
            !b.finished && { label: 'Прогноз с этого хода…', onClick: () => setForecastOpen(true) },
            !b.finished && { label: 'Настроить «до события»…', onClick: () => setPauseModal(true) },
            'sep',
            !b.finished && { label: 'Изменить условия и дистанцию…', onClick: () => setCondModal(true) },
            !b.finished && { label: 'Завершить бой сейчас', onClick: () => iv('endBattle', { reason: 'Бой остановлен ГМ' }), tip: 'Подвести итоги на текущем ходу' },
            'sep',
            { label: 'Открыть сценарий', onClick: () => openTab('scenario', b.scenarioId) },
            'sep',
            { label: 'Переиграть (новый бой)', onClick: () => restart(false), tip: 'Тот же сценарий, другие случайности' },
            { label: 'Повторить этот же бой', onClick: () => restart(true), tip: 'Те же броски кубиков: без ваших решений бой пойдёт точно так же, как этот' },
            b.interventions.length > 0 && { label: 'Повторить с решениями ГМ', onClick: () => restart(true, true), tip: 'Воспроизвести этот бой вместе с вашими вмешательствами до текущего хода' },
            'sep',
            !b.finished && { label: 'Скопировать отчёт', onClick: () => copyText(formatReport(b)) },
            ...SIDES.map((sd) => ({
              label: `Донесение для «${b.sides[sd].name}»`,
              onClick: () => copyText(formatSideReport(b, sd)),
              tip: b.finished ? 'Для игроков стороны: свои силы и потери — точно, противник — оценкой по разведданным' : 'Донесения готовятся по итогам боя',
              disabled: !b.finished,
            })),
            {
              label: 'Сохранить отчёт с журналом…',
              onClick: () => {
                if (settings.logLevel === 2) ensureFullLog(b);
                exportText(`${b.name} — отчёт`, formatReport(b, { includeLog: true, logLevel: settings.logLevel }), 'txt');
              },
            },
            { label: 'Сохранить бой в файл…', onClick: () => exportJson('battle', b.name, b), tip: 'JSON — можно передать другому ГМ и импортировать' },
            'sep',
            { label: 'Удалить бой', danger: true, onClick: () => deleteBattle(b.id) },
          ]}
        />
        <div className="meta" style={{ width: '100%' }}>
          <span>
            Ход <b>{b.turn}</b> из {b.scenario.maxTurns} · {Math.floor(elapsed / 60)} ч {elapsed % 60} мин
          </span>
          {b.sectors ? (
            b.sectors.map((sec) => (
              <span key={sec.id}>
                {sec.name}: <b>{rs.rangeBands[sec.bandIndex]?.name ?? '—'}</b>
                {!b.finished && sec.bandIndex < rs.rangeBands.length - 1 && sec.closingProgress > 0 ? ` (сближение ${Math.round(sec.closingProgress * 100)}%)` : ''}
              </span>
            ))
          ) : (
            <span>
              Дистанция: <b>{band?.name ?? '—'}</b>
              {!b.finished && b.bandIndex < rs.rangeBands.length - 1 && b.closingProgress > 0 ? ` (сближение ${Math.round(b.closingProgress * 100)}%)` : ''}
            </span>
          )}
          {b.finished ? (
            <span>{conditions}</span>
          ) : (
            <span className="cond-link" data-tip="Изменить условия (вмешательство ГМ)" onClick={() => setCondModal(true)} {...pressable(() => setCondModal(true))}>
              {conditions}
            </span>
          )}
          {b.finished && <b style={{ color: winnerColor }}>{result.headline}</b>}
          {b.branchOf && (
            <span className="faint">
              ветка боя{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), openTab('battle', b.branchOf!.battleId))}>
                «{b.branchOf.name}»
              </a>{' '}
              с хода {b.branchOf.turn}
            </span>
          )}
        </div>
        {pauseNote && !b.finished && (
          <div className="pause-note">
            <b>Пауза после {b.turn}-го хода{pauseNote.length ? ':' : ''}</b> {pauseNote.length ? pauseNote.slice(0, 5).join('; ') : 'важного не произошло — достигнут предел ходов'}
            {pauseNote.length > 5 ? ` и ещё ${pauseNote.length - 5}` : ''}.
            <button type="button" className="link-btn small" onClick={() => setPauseNote(null)} title="Скрыть">
              {' '}
              ×
            </button>
          </div>
        )}
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
            {view === 'forces' && (
              <Forces
                b={b}
                E={E}
                result={result}
                tabKey={tab.key}
                onElement={setElModal}
                onFormation={setFmModal}
                iv={iv}
                onEffect={setEffectFor}
                onStrike={(side, assetId, target) => setStrikeFor({ side, assetId, target })}
                onGroupEdit={setGroupEdit}
              />
            )}
            {view === 'charts' && <Charts b={b} />}
            {view === 'result' && <Result b={b} result={result} onElement={setElModal} />}
          </div>
        </div>
        <div className="battle-log">
          <LogView b={b} rev={rev} tabKey={tab.key} defaultLevel={settings.logLevel} focus={focus} onElement={setElModal} onClearFocus={() => setFocus(null)} />
        </div>
      </div>

      {elModal && (
        <ElementModal
          b={b}
          E={E}
          id={elModal}
          onClose={() => setElModal(null)}
          iv={iv}
          onFocusLog={(x) => (setFocus(x), setElModal(null))}
          onEffect={(t) => (setElModal(null), setEffectFor(t))}
          onStrike={(side, t) => (setElModal(null), setStrikeFor({ side, target: t }))}
        />
      )}
      {condModal && <ConditionsModal b={b} onClose={() => setCondModal(false)} iv={iv} />}
      {fmModal && (
        <FormationModal
          b={b}
          id={fmModal}
          onClose={() => setFmModal(null)}
          iv={iv}
          onEffect={(t) => (setFmModal(null), setEffectFor(t))}
          onStrike={(side, t) => (setFmModal(null), setStrikeFor({ side, target: t }))}
        />
      )}
      {effectFor && <EffectModal b={b} target={effectFor} onClose={() => setEffectFor(null)} iv={iv} />}
      {strikeFor && <StrikeModal b={b} side={strikeFor.side} assetId={strikeFor.assetId} target={strikeFor.target} onClose={() => setStrikeFor(null)} iv={iv} />}
      {pauseModal && <PauseSettingsModal onClose={() => setPauseModal(false)} />}
      {forecastOpen && <ForecastModal b={b} onClose={() => setForecastOpen(false)} />}
      {groupEdit && <GroupEditModal b={b} ids={groupEdit} onClose={() => setGroupEdit(null)} iv={iv} />}
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
  if (el.status === 'pending') {
    const t = arrivalTurn(E.b, el);
    return { label: t && t > E.b.turn ? `Подойдёт на ${t}-м ходу` : STATUS_LABELS.pending, cls: 'status-out' };
  }
  if (el.status === 'destroyed') return { label: STATUS_LABELS.destroyed, cls: 'status-dead' };
  if (el.status === 'routed') return { label: STATUS_LABELS.routed, cls: 'status-dead' };
  return { label: STATUS_LABELS.withdrawn, cls: 'status-out' };
}

/** Стороны рядом: только то, что нужно, чтобы понять ход боя. full — для итогов (с техникой по типам). */
function SideCompare({ b, result, full }: { b: Battle; result: BattleResult; full?: boolean }) {
  const f = b.ruleset.features;
  const R = SIDES.map((s) => result.sides[s]);
  const eqTotal = (r: SideResult) => r.equipment.reduce((a, q) => ({ cur: a.cur + q.current, start: a.start + q.start, lost: a.lost + q.losses }), { cur: 0, start: 0, lost: 0 });
  const eqTip = (r: SideResult) => r.equipment.filter((q) => q.losses).map((q) => `${q.name}: −${q.losses}`).join('\n') || undefined;
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
                    <td key={r.side} className="num" data-tip={q?.losses ? `уничтожено ${q.destroyed}, повреждено ${q.damaged}, брошено ${q.abandoned}` : undefined}>
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
        {row('Боеспособность', (r) => <b>{pct(r.combatEffectiveness)}</b>)}
        {f.morale && row('Мораль', (r) => Math.round(r.morale))}
        {full && row('Организация', (r) => pct(r.organization))}
        {full && f.ammo && row('Боезапас', (r) => pct(r.supply.ammo), (r) => `топливо ${pct(r.supply.fuel)}, снаряжение ${pct(r.supply.equipment)}`)}
        {row(
          'Задачи',
          (r) => <b className={r.score >= 0.75 ? 'good' : r.score < 0.4 ? 'bad' : 'warn'}>{pct(r.score * 100)}</b>,
          (r) => r.objectives.map((o) => `${pct(o.score * 100)} — ${o.label}`).join('\n') || undefined,
        )}
      </tbody>
    </table>
  );
}

/** Итоги ветки (формирование со всеми подчинёнными): люди, средняя мораль, боеспособность. */
interface Agg {
  pers: number;
  start: number;
  moraleW: number;
  w: number;
  ce: number;
  ceStart: number;
}

function aggregate(b: Battle, E: EngineContext): Map<string, Agg> {
  const out = new Map<string, Agg>();
  const parent = new Map(b.formations.map((f) => [f.id, f.parentId]));
  for (const el of b.elements) {
    const pers = E.personnel(el);
    const ce = combatEffectiveness(E, el);
    for (let fid: string | null | undefined = el.formationId; fid; fid = parent.get(fid)) {
      const a = out.get(fid) ?? { pers: 0, start: 0, moraleW: 0, w: 0, ce: 0, ceStart: 0 };
      a.pers += pers;
      a.start += el.startPersonnel;
      if (el.status === 'active') {
        a.moraleW += el.morale * Math.max(1, pers);
        a.w += Math.max(1, pers);
      }
      a.ce += ce;
      a.ceStart += el.startValue;
      out.set(fid, a);
    }
  }
  return out;
}

/** У большого боя сразу свёрнуты формирования с третьего уровня — видно главное. */
function initialFold(b: Battle): string[] {
  if (b.elements.length <= 40) return [];
  const parent = new Map(b.formations.map((f) => [f.id, f.parentId]));
  const depth = (id: string) => {
    let d = 0;
    for (let p = parent.get(id); p; p = parent.get(p)) d++;
    return d;
  };
  return b.formations.filter((f) => depth(f.id) >= 2).map((f) => f.id);
}

/** Эффекты, которые действуют на элемент сейчас или со следующего хода. */
function effectsNext(b: Battle, E: EngineContext, el: ElementState) {
  const next = b.turn + 1;
  return (b.effects ?? []).filter(
    (x) =>
      x.side === el.side &&
      x.until >= next &&
      (!x.elementIds || x.elementIds.includes(el.id)) &&
      (!x.formationId || E.chain(el).some((f) => f.id === x.formationId)),
  );
}

const CMD_TIP = 'Командир сейчас. Меняйте по обстановке: удачное решение — выше, ошибка или растерянность — ниже.\nДействует со следующего хода и записывается в журнал.';

function Forces(props: {
  b: Battle;
  E: EngineContext;
  result: BattleResult;
  tabKey: string;
  onElement: (id: string) => void;
  onFormation: (id: string) => void;
  iv: Iv;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, assetId?: string, target?: Target) => void;
  onGroupEdit: (ids: string[]) => void;
}) {
  const { b, E, result, iv } = props;
  const [details, setDetails] = useTabState(`${props.tabKey}:details`, false);
  // Групповые решения: отмеченные элементы получают приказ, эффект, удар или правку разом.
  const [picked, setPicked] = useTabState<string[]>(`${props.tabKey}:picked`, []);
  const live = new Set(b.elements.filter((x) => x.status === 'active' || x.status === 'pending').map((x) => x.id));
  const sel = picked.filter((id) => live.has(id));
  const selSet = new Set(sel);
  const onSelect = (ids: string[], on: boolean) => setPicked(on ? [...new Set([...sel, ...ids])] : sel.filter((x) => !ids.includes(x)));
  const selSides = [...new Set(sel.map((id) => E.elements.get(id)!.side))];
  const oneSide = selSides.length === 1 ? selSides[0] : null;
  const selLabel = sel.length === 1 ? resolveRefs(`[[e:${sel[0]}]]`, b) : `${sel.length} ${plural(sel.length, 'элемент', 'элемента', 'элементов')}`;
  const enemySupport = oneSide ? (b.support ?? []).some((a) => a.side !== oneSide && a.left > 0) : false;
  const [folded, setFolded] = useTabState<string[]>(`${props.tabKey}:folded`, initialFold(b));
  const fold = new Set(folded);
  const agg = useMemo(() => aggregate(b, E), [E]);
  const toggle = (id: string) => setFolded(fold.has(id) ? folded.filter((x) => x !== id) : [...folded, id]);
  const withChildren = b.formations.filter((f) => b.formations.some((x) => x.parentId === f.id) || b.elements.some((x) => x.formationId === f.id));
  const rowsFor = (side: SideId) => {
    const rows: { f: FormationState; depth: number }[] = [];
    const walk = (fs: FormationState, depth: number) => {
      rows.push({ f: fs, depth });
      if (fold.has(fs.id)) return;
      for (const ch of b.formations.filter((x) => x.parentId === fs.id)) walk(ch, depth + 1);
    };
    for (const fs of b.formations.filter((x) => x.side === side && !x.parentId)) walk(fs, 0);
    return rows;
  };
  return (
    <div className="stack">
      <Card tight>
        <SideCompare b={b} result={result} />
      </Card>
      <SupportPanel b={b} iv={iv} onStrike={(side, assetId) => props.onStrike(side, assetId)} onEffect={props.onEffect} />
      {sel.length > 0 && !b.finished && (
        <div className="group-bar">
          <b>Выбрано: {selLabel}</b>
          <Sel
            value=""
            width={150}
            onChange={(v) => v && iv('setOrder', { elementIds: sel.filter((id) => E.elements.get(id)?.status === 'active'), orderId: v })}
            options={[{ value: '', label: 'приказ всем…' }, ...b.ruleset.orders.map((o) => ({ value: o.id, label: o.name }))]}
          />
          <Btn sm onClick={() => props.onGroupEdit(sel)} title="Мораль, усталость, боезапас… сразу всем выбранным">
            Изменить…
          </Btn>
          {b.ruleset.features.ammo && (
            <Btn sm onClick={() => iv('resupply', { elementIds: sel, ammo: 25 })}>
              боезапас +25%
            </Btn>
          )}
          <Btn sm disabled={!oneSide} onClick={() => oneSide && props.onEffect({ side: oneSide, elementIds: sel, label: selLabel })} title={oneSide ? 'Временный эффект на выбранных' : 'Эффект — для элементов одной стороны'}>
            Эффект…
          </Btn>
          {enemySupport && oneSide && (
            <Btn sm onClick={() => props.onStrike(oneSide === 'A' ? 'B' : 'A', undefined, { side: oneSide, elementIds: sel, label: selLabel })} title="Удар огневой поддержки противника по выбранным">
              Удар по выбранным…
            </Btn>
          )}
          <span className="grow" />
          <button type="button" className="link-btn small" onClick={() => setPicked([])}>
            снять выбор
          </button>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: -8, gap: 14 }}>
        {withChildren.length > 2 && (
          <span className="small">
            <a href="#" onClick={(e) => (e.preventDefault(), setFolded([]))}>
              развернуть всё
            </a>
            {' · '}
            <a href="#" onClick={(e) => (e.preventDefault(), setFolded(b.formations.filter((f) => f.parentId).map((f) => f.id)))}>
              свернуть до верхних
            </a>
          </span>
        )}
        <Check value={details} onChange={setDetails} title="Подавление, усталость, боезапас, техника, обнаружение">
          <span className="muted small">подробные столбцы</span>
        </Check>
      </div>
      {SIDES.map((side) => (
        <Card key={side} title={<span style={{ color: b.sides[side].color }}>{b.sides[side].name}</span>} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl compact forces">
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
                  <FormationRows
                    key={fs.id}
                    {...props}
                    fs={fs}
                    depth={depth}
                    details={details}
                    folded={fold.has(fs.id)}
                    onToggle={() => toggle(fs.id)}
                    agg={agg.get(fs.id)}
                    selected={selSet}
                    onSelect={onSelect}
                  />
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

function FormationRows(props: {
  b: Battle;
  E: EngineContext;
  fs: FormationState;
  depth: number;
  details: boolean;
  folded: boolean;
  onToggle: () => void;
  agg?: Agg;
  onElement: (id: string) => void;
  onFormation: (id: string) => void;
  iv: Iv;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}) {
  const { b, E, fs, depth, details, iv, agg, selected, onSelect } = props;
  const f = b.ruleset.features;
  const els = props.folded ? [] : b.elements.filter((x) => x.formationId === fs.id);
  // Отметка формирования — все его элементы (с подчинёнными), которые ещё в бою или подойдут.
  const subtree = useMemo(() => {
    const ids = new Set([fs.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
    }
    return b.elements.filter((x) => ids.has(x.formationId) && (x.status === 'active' || x.status === 'pending')).map((x) => x.id);
  }, [b, fs.id]);
  const allOn = subtree.length > 0 && subtree.every((id) => selected.has(id));
  // Участок — только если силы стороны стоят на разных участках (иначе метка ничего не говорит).
  const spread = !!b.sectors && new Set(b.elements.filter((x) => x.side === fs.side).map((x) => x.sector)).size > 1;
  const sectorName = (el: ElementState) => (spread ? b.sectors!.find((x) => x.id === el.sector)?.name : undefined);
  const detailCols = details ? 1 + [f.suppression, f.fatigue, f.ammo, f.detection].filter(Boolean).length : 0;
  const orderOptions = b.ruleset.orders.map((o) => ({ value: o.id, label: o.name }));
  const morale = agg && agg.w > 0 ? agg.moraleW / agg.w : 0;
  return (
    <>
      <tr className={`group${props.folded ? ' folded' : ''}`}>
        <td colSpan={2} style={{ paddingLeft: 4 + depth * 14 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {!b.finished && subtree.length > 0 && (
              <input type="checkbox" className="pick-check" checked={allOn} onChange={(e) => onSelect(subtree, e.target.checked)} title="Отметить всё формирование — для группового решения" />
            )}
            <button className="fold-btn" onClick={props.onToggle} title={props.folded ? 'Развернуть' : 'Свернуть'}>
              {props.folded ? '▸' : '▾'}
            </button>
            <a
              href="#"
              className="nowrap"
              onClick={(e) => (e.preventDefault(), props.onFormation(fs.id))}
              data-tip={`${fs.level}${f.comms ? `\nсвязь ${Math.round(fs.comms)}%` : ''}\nснабжение ${Math.round(fs.supply)}%\nЩелчок — приказ всем, связь, снабжение`}
            >
              {fs.name}
            </a>
            {f.command && (
              <CommanderSelect levels={b.ruleset.commandLevels} allowNone tip={CMD_TIP} value={fs.commandLevel} disabled={b.finished} onChange={(v) => iv('setFormation', { formationId: fs.id, commandLevel: v })} />
            )}
            {fs.hqLost && <span className="badge bad">штаб потерян</span>}
            {fs.broken && <span className="badge bad">сломлено</span>}
          </div>
        </td>
        <td className="num nowrap">
          {agg ? (
            <>
              {fmt0(agg.pers)}
              <span className="faint">/{fmt0(agg.start)}</span>
            </>
          ) : null}
        </td>
        {f.morale && <td style={{ minWidth: 90 }}>{agg && agg.w > 0 ? <Meter value={morale} /> : null}</td>}
        <td className="num">{agg && agg.ceStart > 0 ? pct((agg.ce / agg.ceStart) * 100) : ''}</td>
        {detailCols > 0 && <td colSpan={detailCols} />}
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
            <td style={{ paddingLeft: 24 + depth * 14 }}>
              {!b.finished && (el.status === 'active' || el.status === 'pending') && (
                <input type="checkbox" className="pick-check" checked={selected.has(el.id)} onChange={(e) => onSelect([el.id], e.target.checked)} title="Отметить — для группового решения" />
              )}
              <span className={`status-dot ${st.cls}`} data-tip={st.label} />
              <a href="#" onClick={(e) => (e.preventDefault(), props.onElement(el.id))}>
                {el.name}
              </a>
              {el.isHQ && <span className="faint small"> · штаб</span>}
              {sectorName(el) && <span className="badge sector-badge">{sectorName(el)}</span>}
              {effectsNext(b, E, el).length > 0 && (
                <span className="badge info fx-badge" data-tip={effectsNext(b, E, el).map((x) => `«${x.name}» до ${x.until}-го хода`).join('\n')}>
                  ◌ {effectsNext(b, E, el).length === 1 ? effectsNext(b, E, el)[0].name : `эффектов: ${effectsNext(b, E, el).length}`}
                </span>
              )}
            </td>
            <td>
              {active && E.behavior(el) !== 'rout' ? (
                <Sel value={el.orderId} width={124} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={orderOptions} />
              ) : (
                <span className={`small ${st.cls}`}>{st.label}</span>
              )}
              {el.status === 'pending' && !b.finished && (
                <button type="button" className="link-btn small" onClick={() => iv('arrive', { elementIds: [el.id] })} title="Подкрепление подходит раньше плана (вмешательство ГМ)">
                  {' '}
                  ввести сейчас
                </button>
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

/** Чем больше, тем хуже: полоска окрашивается наоборот. */
const HIGH_IS_BAD = new Set<keyof ElementState>(['suppression', 'fatigue']);

function StateRow({ label, value, inverse }: { label: string; value: number; inverse?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const good = inverse ? 100 - v : v;
  const color = good < 30 ? 'var(--bad)' : good < 60 ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="state-row">
      <span className="muted">{label}</span>
      <div className="meter">
        <div style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="num">{Math.round(value)}</span>
    </div>
  );
}

function ElementModal({
  b,
  E,
  id,
  onClose,
  iv,
  onFocusLog,
  onEffect,
  onStrike,
}: {
  b: Battle;
  E: EngineContext;
  id: string;
  onClose: () => void;
  iv: Iv;
  onFocusLog: (id: string) => void;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, t: Target) => void;
}) {
  const el = b.elements.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [patch, setPatch] = useState<Record<string, number>>({});
  const [comps, setComps] = useState<Record<string, number>>({});
  if (!el) return null;
  const rs = b.ruleset;
  const fs = E.formationOf(el);
  const st = statusOf(E, el);
  const canEdit = !b.finished && el.status === 'active';
  const editing = edit && canEdit;
  const selfRef = `[[e:${el.id}]]`;
  // Только события самого элемента (первая ссылка в записи — на него), без его имени в тексте.
  const firstRef = (t: string) => /\[\[e:([^\]]+)\]\]/.exec(t)?.[1];
  const ownText = (t: string) => {
    const x = t.startsWith(selfRef) ? t.slice(selfRef.length).replace(/^:\s*/, '') : t.replace(` ${selfRef}`, '');
    return x.replace(/^[а-яёa-z]/, (c) => c.toUpperCase());
  };
  const events = b.log
    .filter((x) => x.level <= 1 && x.phase !== 'turn' && x.refs?.includes(el.id) && firstRef(x.text) === el.id)
    .slice(-6)
    .reverse()
    .map((x) => ({ turn: x.turn, text: ownText(x.text) }));
  const dirty = Object.keys(patch).length + Object.keys(comps).length > 0;
  const stateKeys = EDITABLE.filter((x) => !x.feature || rs.features[x.feature]);
  const cancel = () => {
    setPatch({});
    setComps({});
    setEdit(false);
  };
  const apply = () => {
    const p: Record<string, unknown> = { ...patch };
    if (Object.keys(comps).length) p.comps = Object.entries(comps).map(([typeId, current]) => ({ typeId, current }));
    iv('editElement', { elementId: el.id, patch: p });
    cancel();
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
        editing ? (
          <>
            <span className="muted small grow">Изменение запишется в журнал как вмешательство ГМ.</span>
            <Btn onClick={cancel}>Отмена</Btn>
            <Btn kind="primary" disabled={!dirty} onClick={apply}>
              Применить
            </Btn>
          </>
        ) : (
          <>
            <Btn kind="ghost" onClick={() => onFocusLog(el.id)}>
              Все события в журнале
            </Btn>
            <div className="grow" />
            {canEdit && (
              <Btn onClick={() => onEffect({ side: el.side, elementIds: [el.id], label: el.name })} title="Временный эффект на этот элемент: дым, внезапность, растерянность…">
                Эффект…
              </Btn>
            )}
            {canEdit && (b.support ?? []).some((a) => a.side !== el.side && a.left > 0) && (
              <Btn onClick={() => onStrike(el.side === 'A' ? 'B' : 'A', { side: el.side, elementIds: [el.id], label: el.name })} title="Удар огневой поддержки противника по этому элементу">
                Удар…
              </Btn>
            )}
            {canEdit && (
              <Btn onClick={() => setEdit(true)} title="Пополнить или списать состав, поправить мораль, боезапас и т. п.">
                Изменить…
              </Btn>
            )}
            <Btn onClick={onClose}>Закрыть</Btn>
          </>
        )
      }
    >
      <div className="meta" style={{ marginBottom: 14 }}>
        <span>{fs.name}</span>
        <span>опыт: {rs.experienceLevels[el.experience - 1]?.name}</span>
        <span>
          {fmt0(E.personnel(el))} из {fmt0(el.startPersonnel)} чел.
        </span>
      </div>
      <div className="grid two align-start">
        <div className="stack">
          {canEdit && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="Приказ">
                <Sel value={el.orderId} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={rs.orders.map((o) => ({ value: o.id, label: o.name }))} />
              </Field>
              {rs.features.command && ((el.ownCommandLevel ?? 0) > 0 || editing) && (
                <Field label="Свой командир" hint="Обычно элементом командует его формирование; здесь ГМ может дать элементу собственного командира.">
                  <CommanderSelect levels={rs.commandLevels} allowNone tip={CMD_TIP} value={el.ownCommandLevel ?? 0} onChange={(v) => iv('editElement', { elementId: el.id, patch: { ownCommandLevel: v } })} />
                </Field>
              )}
              {editing && (
                <>
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
                  <Check value={el.holdFast} onChange={(v) => iv('editElement', { elementId: el.id, patch: { holdFast: v } })} title="Не отходит добровольно; шанс паники вдвое ниже">
                    стоять насмерть
                  </Check>
                </>
              )}
            </div>
          )}
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Состав</th>
                <th className="num">В строю</th>
                <th className="num">Потери</th>
              </tr>
            </thead>
            <tbody>
              {el.comps.map((c) => {
                const t = E.type(c.typeId);
                const pers = t.kind === 'personnel';
                const lost = c.start - c.current;
                return (
                  <tr key={c.typeId}>
                    <td>{t.name}</td>
                    <td className="num nowrap">
                      {editing ? (
                        <Num value={comps[c.typeId] ?? c.current} onChange={(v) => setComps({ ...comps, [c.typeId]: v })} min={0} integer width={64} title="Пополнение или списание" />
                      ) : (
                        <b>{c.current}</b>
                      )}{' '}
                      <span className="faint">из {c.start}</span>
                    </td>
                    <td
                      className="num"
                      data-tip={pers ? `убито ${c.kia}, ранено ${c.wia}, пропало ${c.mia}` : `уничтожено ${c.destroyed}, повреждено ${c.damaged}, брошено ${c.abandoned}`}
                    >
                      {lost > 0 ? <span className="bad">−{lost}</span> : <span className="faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editing && (rs.features.ammo || rs.features.fuel) && (
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
          {editing ? (
            <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {stateKeys.map((x) => (
                <Field key={x.key} label={x.label}>
                  <Num value={patch[x.key] ?? Math.round(el[x.key] as number)} onChange={(v) => setPatch({ ...patch, [x.key]: v })} min={0} max={100} width="100%" />
                </Field>
              ))}
            </div>
          ) : (
            <div className="state-list">
              {stateKeys.map((x) => (
                <StateRow key={x.key} label={x.label} value={el[x.key] as number} inverse={HIGH_IS_BAD.has(x.key)} />
              ))}
            </div>
          )}
          {!editing && (
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>
                Последние события
              </div>
              <div className="stack small" style={{ gap: 4 }}>
                {events.length ? (
                  events.map((x, i) => (
                    <div key={i}>
                      <span className="faint">ход {x.turn} · </span>
                      <RichText text={x.text} b={b} />
                    </div>
                  ))
                ) : (
                  <span className="faint">Событий пока нет.</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ConditionsModal({ b, onClose, iv }: { b: Battle; onClose: () => void; iv: Iv }) {
  const rs = b.ruleset;
  const [cond, setCond] = useState<Record<string, string>>({ ...b.conditions });
  const [bandIdx, setBand] = useState(b.bandIndex);
  // Участки: своя дистанция и свои условия (пусто — как на всём поле).
  const [secs, setSecs] = useState(() => (b.sectors ?? []).map((x) => ({ id: x.id, name: x.name, band: x.bandIndex, cond: { ...x.conditions } })));
  const setSec = (i: number, patch: Partial<(typeof secs)[number]>) => setSecs(secs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const apply = () => {
    if (Object.keys(cond).some((k) => cond[k] !== b.conditions[k])) iv('setConditions', { conditions: cond });
    if (!b.sectors && bandIdx !== b.bandIndex) iv('setBand', { bandIndex: bandIdx });
    secs.forEach((x, i) => {
      const was = b.sectors![i];
      if (x.band !== was.bandIndex) iv('setBand', { sector: x.id, bandIndex: x.band });
      const changed: Record<string, string> = {};
      for (const cat of rs.conditions) if ((x.cond[cat.id] ?? '') !== (was.conditions[cat.id] ?? '')) changed[cat.id] = x.cond[cat.id] ?? '';
      if (Object.keys(changed).length) iv('setConditions', { sector: x.id, conditions: changed });
    });
    onClose();
  };
  return (
    <Modal
      title="Условия боя"
      wide={!!b.sectors}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={apply}>
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
        {!b.sectors && (
          <Field label="Дистанция">
            <Sel value={bandIdx} onChange={setBand} options={rs.rangeBands.map((x, i) => ({ value: i, label: x.name }))} />
          </Field>
        )}
      </div>
      {secs.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div className="small muted">Участки боя: своя дистанция и условия поверх общих</div>
          {secs.map((x, i) => (
            <div key={x.id} className="row" style={{ gap: 8 }}>
              <b style={{ minWidth: 110 }}>{x.name}</b>
              <Sel value={x.band} onChange={(v) => setSec(i, { band: v })} options={rs.rangeBands.map((r, j) => ({ value: j, label: r.name }))} width={170} />
              {rs.conditions.map((c) => (
                <Sel
                  key={c.id}
                  value={x.cond[c.id] ?? ''}
                  onChange={(v) => setSec(i, { cond: { ...x.cond, [c.id]: v } })}
                  options={[{ value: '', label: `${c.name}: как на всём поле` }, ...c.options.map((o) => ({ value: o.id, label: `${c.name}: ${o.name}` }))]}
                  width={190}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="faint small" style={{ marginTop: 10, marginBottom: 0 }}>
        Действует со следующего хода и записывается в журнал.
      </p>
    </Modal>
  );
}

function FormationModal({
  b,
  id,
  onClose,
  iv,
  onEffect,
  onStrike,
}: {
  b: Battle;
  id: string;
  onClose: () => void;
  iv: Iv;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, t: Target) => void;
}) {
  const fs = b.formations.find((x) => x.id === id);
  const rs = b.ruleset;
  const [order, setOrder] = useState('');
  const [comms, setComms] = useState(fs?.comms ?? 100);
  const [supply, setSupply] = useState(fs?.supply ?? 100);
  const [cmd, setCmd] = useState(fs?.commandLevel ?? 0);
  if (!fs) return null;
  return (
    <Modal
      title={fs.name}
      onClose={onClose}
      footer={
        <>
          {!b.finished && (
            <Btn onClick={() => onEffect({ side: fs.side, formationId: fs.id, label: fs.name })} title="Временный эффект на всё формирование">
              Эффект…
            </Btn>
          )}
          {!b.finished && (b.support ?? []).some((a) => a.side !== fs.side && a.left > 0) && (
            <Btn onClick={() => onStrike(fs.side === 'A' ? 'B' : 'A', { side: fs.side, formationId: fs.id, label: fs.name })} title="Удар огневой поддержки противника по этому формированию">
              Удар…
            </Btn>
          )}
          <span className="grow" />
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
          <Field label="Командир">
            <Sel value={cmd} onChange={setCmd} options={[{ value: 0, label: 'без командира' }, ...rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))]} />
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

function Result({ b, result, onElement }: { b: Battle; result: BattleResult; onElement: (id: string) => void }) {
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
        <div className="result-why">{explainResult(result)}</div>
        {b.finished && <ForcesCard b={b} />}
        {b.finished && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">Скопировать:</span>
            <Btn sm onClick={() => copyText(formatReport(b))} title="Все цифры обеих сторон — для ГМ">
              полный отчёт (ГМ)
            </Btn>
            {SIDES.map((sd) => (
              <Btn key={sd} sm onClick={() => copyText(formatSideReport(b, sd))} title="Свои силы и потери — точно, противник — оценкой: чем хуже разведданные и чем меньше противника видели, тем шире диапазон">
                донесение для «{b.sides[sd].name}»
              </Btn>
            ))}
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
function ForcesCard({ b }: { b: Battle }) {
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
