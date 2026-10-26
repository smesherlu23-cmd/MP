// Бой: пошаговое управление, вмешательства ГМ, силы сторон, журнал, графики и итоги.

import { useEffect, useMemo, useState } from 'react';
import {
  EngineContext,
  applyIntervention,
  computeResult,
  fmtDuration,
  formatReport,
  formatSideReport,
  lastBattleAction,
  randomSeed,
  replayBattle,
  runToEnd,
  stepTurn,
  stepUntilEvent,
  type Battle,
  type BattleResult,
  type SideId,
} from '../../engine';
import { EffectModal, ForecastModal, GroupEditModal, PauseSettingsModal, StrikeModal, usePauseRules, type Target } from '../components/BattleControls';
import { Crumbs } from '../components/Crumbs';
import { LogView } from '../components/LogView';
import { Inspector, InspectorToggle } from '../components/Inspector';
import { Btn, Menu, pressable, ToolbarSlot } from '../components/ui';
import { Icon } from '../components/Icon';
import { applyResultsToForces, battleForces } from '../postBattle';
import { useTabState } from '../hooks';
import { nextBattleName } from './ScenarioPage';
import {
  branchBattleDialog,
  deleteBattle,
  ensureFullLog,
  exportJson,
  exportText,
  forgetBattleRedo,
  loadBattle,
  openTab,
  putBattle,
  renameBattle,
  rewindBattleDialog,
  touchBattle,
  undoBattle,
  useApp,
  useBattles,
  type Tab,
} from '../store';
import { SIDES, copyText } from './battle/common';
import { Forces } from './battle/ForcesTable';
import { ConditionsModal, ElementModal, FormationModal } from './battle/Modals';
import { Charts, Result } from './battle/Result';

export function BattlePage({ tab }: { tab: Tab }) {
  const id = tab.ref!;
  const b = useBattles((s) => s.battles[id]);
  const rev = useBattles((s) => s.rev[id] ?? 0);
  const [missing, setMissing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: бой загружается один раз на страницу
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: бой меняется на месте: контекст пересоздаётся по ревизии
  const E = useMemo(() => new EngineContext(b), [b, rev]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: итог зависит от контекста, а он пересоздаётся с каждой ревизией боя
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
  // Итоги окончённого боя ещё не перенесены в силы — это главное действие после боя.
  const canRecord = b.finished && !b.appliedToForces && battleForces(b).length > 0;

  return (
    <div className="page fill">
      <div className="battle-head">
        <Crumbs
          items={[
            { label: 'Бои', section: 'battles' },
            scenarioExists ? { label: b.scenario.name, open: ['scenario', b.scenarioId] } : { label: b.scenario.name },
          ]}
        />
        <input className="title-input" value={b.name} onChange={(e) => renameBattle(b.id, e.target.value)} />
        <ToolbarSlot>
          {b.finished ? (
            <>
              <Btn onClick={() => restart(false)} title="Новый бой по тому же сценарию — с другими случайностями">
                Переиграть
              </Btn>
              <Btn
                kind={canRecord ? undefined : 'primary'}
                onClick={() => copyText(formatReport(b))}
                title="Полный отчёт для ГМ: все цифры обеих сторон. Донесения для игроков — в меню «⋯» и на вкладке «Итоги»."
              >
                Скопировать отчёт
              </Btn>
              {/* Главное после боя — перенести потери в силы; пока не сделано, это основная кнопка. */}
              {canRecord && (
                <Btn
                  kind="primary"
                  onClick={() => void applyResultsToForces(b)}
                  title="Потери, раненые, техника в ремонте, мораль и боезапас — в силы, участвовавшие в бою"
                >
                  Записать итоги в силы
                </Btn>
              )}
            </>
          ) : (
            <>
              <Btn kind="primary" onClick={() => step(1)} title="Рассчитать один ход">
                <Icon name="play" size={13} /> Ход
              </Btn>
              <Btn
                onClick={untilEvent}
                title={`Считать ходы, пока не случится важное: ${
                  Object.entries(rules).filter(([k, v]) => k !== 'lossPct' && v).length
                } видов событий${rules.lossPct ? `, потери за ход ≥ ${rules.lossPct}%` : ''}. Настроить — в меню «⋯».`}
              >
                <Icon name="skip" size={13} /> До события
              </Btn>
              <Btn onClick={() => step(5)} title="Рассчитать пять ходов">
                <Icon name="forward" size={14} /> 5
              </Btn>
              <Btn onClick={toEnd} title="Рассчитать бой до конца">
                До конца
              </Btn>
              <Btn
                onClick={() => setForecastOpen(true)}
                title="Что дальше? Сотни продолжений боя с этого хода — вероятности исходов и потерь. Если вы только что приняли решения — рядом прогноз без них."
              >
                Прогноз
              </Btn>
            </>
          )}
          {undoLabel && (
            <Btn icon onClick={() => undoBattle(b.id)} title={`Отменить: ${undoLabel} (Ctrl+Z). Бой повторяется с теми же бросками.`}>
              <Icon name="undo" size={16} />
            </Btn>
          )}
          <Menu
            items={[
              !!undoLabel && { label: `Отменить: ${undoLabel}`, kbd: 'Ctrl+Z', onClick: () => undoBattle(b.id) },
              b.turn > 0 && {
                label: 'Вернуться к ходу…',
                onClick: () => rewindBattleDialog(b.id),
                tip: 'Повторить бой до выбранного хода с теми же бросками и вашими решениями',
              },
              {
                label: 'Ответвить бой…',
                onClick: () => branchBattleDialog(b.id),
                tip: 'Копия боя с выбранного хода — сыграть иначе и сравнить; этот бой не меняется',
              },
              'sep',
              !b.finished && { label: 'Прогноз с этого хода…', onClick: () => setForecastOpen(true) },
              !b.finished && { label: 'Настроить «до события»…', onClick: () => setPauseModal(true) },
              'sep',
              !b.finished && { label: 'Изменить условия и дистанцию…', onClick: () => setCondModal(true) },
              !b.finished && {
                label: 'Завершить бой сейчас',
                onClick: () => iv('endBattle', { reason: 'Бой остановлен ГМ' }),
                tip: 'Подвести итоги на текущем ходу',
              },
              'sep',
              { label: 'Открыть сценарий', onClick: () => openTab('scenario', b.scenarioId) },
              'sep',
              { label: 'Переиграть (новый бой)', onClick: () => restart(false), tip: 'Тот же сценарий, другие случайности' },
              {
                label: 'Повторить этот же бой',
                onClick: () => restart(true),
                tip: 'Те же броски кубиков: без ваших решений бой пойдёт точно так же, как этот',
              },
              b.interventions.length > 0 && {
                label: 'Повторить с решениями ГМ',
                onClick: () => restart(true, true),
                tip: 'Воспроизвести этот бой вместе с вашими вмешательствами до текущего хода',
              },
              'sep',
              !b.finished && { label: 'Скопировать отчёт', onClick: () => copyText(formatReport(b)) },
              b.finished && !!b.appliedToForces && { label: 'Записать итоги в силы ещё раз…', onClick: () => void applyResultsToForces(b) },
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
          <InspectorToggle id="log" label="Журнал" />
        </ToolbarSlot>
        <div className="meta" style={{ width: '100%' }}>
          <span>
            Ход <b>{b.turn}</b> из {b.scenario.maxTurns} · {fmtDuration(elapsed / 60)} из {fmtDuration((b.scenario.maxTurns * rs.turnMinutes) / 60)}
          </span>
          {b.sectors ? (
            b.sectors.map((sec) => (
              <span key={sec.id}>
                {sec.name}: <b>{rs.rangeBands[sec.bandIndex]?.name ?? '—'}</b>
                {!b.finished && sec.bandIndex < rs.rangeBands.length - 1 && sec.closingProgress > 0
                  ? ` (сближение ${Math.round(sec.closingProgress * 100)}%)`
                  : ''}
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
            <span
              className="cond-link"
              data-tip="Изменить условия (вмешательство ГМ)"
              onClick={() => setCondModal(true)}
              {...pressable(() => setCondModal(true))}
            >
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
            <b>
              Пауза после {b.turn}-го хода{pauseNote.length ? ':' : ''}
            </b>{' '}
            {pauseNote.length ? pauseNote.slice(0, 5).join('; ') : 'важного не произошло — достигнут предел ходов'}
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
            <button type="button" className={view === 'forces' ? 'on' : ''} onClick={() => setView('forces')}>
              Силы
            </button>
            <button type="button" className={view === 'result' ? 'on' : ''} onClick={() => setView('result')}>
              {b.finished ? 'Итоги' : 'Оценка'}
            </button>
            <button type="button" className={view === 'charts' ? 'on' : ''} onClick={() => setView('charts')}>
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
        <Inspector id="log" label="Журнал">
          <div className="battle-log">
            <LogView
              b={b}
              rev={rev}
              tabKey={tab.key}
              defaultLevel={settings.logLevel}
              focus={focus}
              onElement={setElModal}
              onClearFocus={() => setFocus(null)}
            />
          </div>
        </Inspector>
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
      {strikeFor && (
        <StrikeModal b={b} side={strikeFor.side} assetId={strikeFor.assetId} target={strikeFor.target} onClose={() => setStrikeFor(null)} iv={iv} />
      )}
      {pauseModal && <PauseSettingsModal onClose={() => setPauseModal(false)} />}
      {forecastOpen && <ForecastModal b={b} onClose={() => setForecastOpen(false)} />}
      {groupEdit && <GroupEditModal b={b} ids={groupEdit} onClose={() => setGroupEdit(null)} iv={iv} />}
    </div>
  );
}
