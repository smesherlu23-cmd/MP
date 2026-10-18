// Управление боем для ГМ: «до события» и его настройки, прогноз «что дальше?», временные эффекты,
// удары огневой поддержки, групповые решения.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PAUSE,
  EngineContext,
  PAUSE_LABELS,
  STAT_LABELS,
  forecastAsync,
  plural,
  randomSeed,
  resolveRefs,
  withoutCurrentDecisions,
  type Battle,
  type Effects,
  type InterventionType,
  type MonteCarloResult,
  type PauseRules,
  type SideId,
  type StatKey,
} from '../../engine';
import { updateSettings, useApp } from '../store';
import { EffectsEditor, effectsText } from './EffectsEditor';
import { Btn, Check, Field, Modal, Num, Sel, Txt, fmt0, pct } from './ui';

export type Iv = (type: InterventionType, payload: Record<string, unknown>) => void;

const other = (s: SideId): SideId => (s === 'A' ? 'B' : 'A');

/** Цель решения: сторона целиком, формирование или выбранные элементы. */
export interface Target {
  side: SideId;
  formationId?: string;
  elementIds?: string[];
  label: string;
}

// ------------------------------------------------------------------ до события

export function usePauseRules(): PauseRules {
  const s = useApp((x) => x.settings.pauseRules);
  return { ...DEFAULT_PAUSE, ...(s ?? {}) };
}

export function PauseSettingsModal({ onClose }: { onClose: () => void }) {
  const rules = usePauseRules();
  const set = (patch: Partial<PauseRules>) => updateSettings({ pauseRules: { ...rules, ...patch } });
  return (
    <Modal title="Что останавливает «до события»" onClose={onClose} footer={<Btn onClick={onClose}>Готово</Btn>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Бой считается ход за ходом и встаёт на паузу, как только случается отмеченное — чтобы вы приняли решение. Настройка общая для всех боёв.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        {(Object.keys(PAUSE_LABELS) as (keyof typeof PAUSE_LABELS)[]).map((k) => (
          <Check key={k} value={rules[k]} onChange={(v) => set({ [k]: v })}>
            {PAUSE_LABELS[k]}
          </Check>
        ))}
        <div className="row">
          <Check value={rules.lossPct > 0} onChange={(v) => set({ lossPct: v ? 10 : 0 })}>
            потери стороны за ход не меньше
          </Check>
          <Num value={rules.lossPct || 10} onChange={(v) => set({ lossPct: Math.max(1, Math.min(100, v)) })} min={1} max={100} integer suffix="%" width={74} />
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ прогноз

function OutcomeBar({ r, b }: { r: MonteCarloResult; b: Battle }) {
  return (
    <div className="fc-bar" title={`${b.sides.A.name}: ${pct(r.winA)}, ничья: ${pct(r.draw)}, ${b.sides.B.name}: ${pct(r.winB)}`}>
      <div style={{ width: `${r.winA}%`, background: b.sides.A.color }} />
      <div style={{ width: `${r.draw}%` }} className="fc-draw" />
      <div style={{ width: `${r.winB}%`, background: b.sides.B.color }} />
    </div>
  );
}

const mean = (r: MonteCarloResult, key: string) => r.metrics.find((m) => m.key === key)?.stats.mean ?? 0;

/**
 * Прогноз с текущего хода: N продолжений боя с разными случайностями, без новых решений ГМ. Если после
 * последнего хода приняты решения — рядом прогноз без них: видно, что они дают.
 */
export function ForecastModal({ b, onClose }: { b: Battle; onClose: () => void }) {
  const saved = useApp((s) => s.settings.forecastRuns) ?? 100;
  const [n, setN] = useState(saved);
  const [res, setRes] = useState<{ now: MonteCarloResult; without?: MonteCarloResult } | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const closed = useRef(false);
  const decisions = b.interventions.filter((x) => x.turn === b.turn);
  // biome-ignore lint/correctness/useExhaustiveDependencies: бой меняется на месте: решения хода определяются числом вмешательств и ходом
  const base = useMemo(() => (decisions.length ? withoutCurrentDecisions(b) : null), [b, b.interventions.length, b.turn]);
  const run = async () => {
    setRunning(true);
    setRes(null);
    // Одинаковые случайности для обоих вариантов — разница только от решений.
    const seed = randomSeed();
    const total = base ? n * 2 : n;
    const stop = () => closed.current;
    const now = await forecastAsync(b, n, seed, (d) => setProgress(d / total), stop);
    const without = base ? await forecastAsync(base, n, seed, (d) => setProgress((n + d) / total), stop) : undefined;
    if (closed.current) return;
    setRes({ now, without });
    setRunning(false);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: прогноз считается один раз при открытии окна; дальше — кнопкой «Пересчитать»
  useEffect(() => {
    void run();
    return () => void (closed.current = true);
  }, []);
  const cols: { title: string; r: MonteCarloResult }[] = res
    ? [{ title: decisions.length ? 'С вашими решениями' : 'Если продолжить', r: res.now }, ...(res.without ? [{ title: 'Без них', r: res.without }] : [])]
    : [];
  const row = (label: string, fn: (r: MonteCarloResult) => React.ReactNode) => (
    <tr>
      <td>{label}</td>
      {cols.map((c) => (
        <td key={c.title} className="num">
          {fn(c.r)}
        </td>
      ))}
    </tr>
  );
  return (
    <Modal
      wide
      title={`Прогноз с ${b.turn}-го хода`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Прогоны не меняют бой; решения ГМ после этого момента в них не учитываются.</span>
          <span className="faint small">прогонов</span>
          <Num value={n} onChange={(v) => setN(Math.max(10, Math.min(2000, Math.round(v))))} min={10} max={2000} integer width={74} />
          <Btn
            onClick={() => {
              updateSettings({ forecastRuns: n });
              void run();
            }}
            disabled={running}
          >
            Пересчитать
          </Btn>
          <Btn kind="primary" onClick={onClose}>
            Закрыть
          </Btn>
        </>
      }
    >
      {decisions.length > 0 && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Ваши решения после {b.turn}-го хода:{' '}
          {b.log
            .filter((l) => l.phase === 'gm' && l.turn === b.turn)
            .map((l) =>
              resolveRefs(l.text, b)
                .replace(/^ГМ( изменил)?:?\s*/, '')
                .replace(/\.$/, ''),
            )
            .join('; ') || `${decisions.length}`}
          . {base ? 'Справа — тот же бой без них.' : 'Сравнить без них не получилось: бой сохранён другой версией программы.'}
        </p>
      )}
      {running && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="muted">Считаю продолжения боя…</div>
          <div className="meter">
            <div style={{ width: `${Math.round(progress * 100)}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      )}
      {res && (
        <table className="tbl forecast">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.title} className="num">
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Исход</td>
              {cols.map((c) => (
                <td key={c.title}>
                  <OutcomeBar r={c.r} b={b} />
                </td>
              ))}
            </tr>
            {row(`Победа: ${b.sides.A.name}`, (r) => (
              <b style={{ color: b.sides.A.color }}>{pct(r.winA)}</b>
            ))}
            {row('Ничья', (r) => pct(r.draw))}
            {row(`Победа: ${b.sides.B.name}`, (r) => (
              <b style={{ color: b.sides.B.color }}>{pct(r.winB)}</b>
            ))}
            {row(`Потери к концу: ${b.sides.A.name}`, (r) => `${fmt0(mean(r, 'A.personnelLoss'))} чел. · ${pct(mean(r, 'A.personnelLossPct'))}`)}
            {row(`Потери к концу: ${b.sides.B.name}`, (r) => `${fmt0(mean(r, 'B.personnelLoss'))} чел. · ${pct(mean(r, 'B.personnelLossPct'))}`)}
            {row('Бой продлится до хода (в среднем)', (r) => fmt0(mean(r, 'turns')))}
          </tbody>
        </table>
      )}
      {res && (
        <div className="faint small" style={{ marginTop: 8 }}>
          Самые частые исходы:{' '}
          {res.now.outcomes
            .slice()
            .sort((a, b2) => b2.count - a.count)
            .slice(0, 3)
            .map((o) => `${o.label} — ${pct(o.pct)}`)
            .join('; ')}
          .
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ временный эффект

export function EffectModal({ b, target, onClose, iv }: { b: Battle; target: Target; onClose: () => void; iv: Iv }) {
  const presets = b.ruleset.tempEffects ?? [];
  const [preset, setPreset] = useState(presets[0]?.id ?? '');
  const [name, setName] = useState(presets[0]?.name ?? 'Эффект');
  const [effects, setEffects] = useState<Effects>({ ...(presets[0]?.effects ?? { fire: 1.2 }) });
  const [turns, setTurns] = useState(presets[0]?.turns ?? 2);
  const pick = (id: string) => {
    setPreset(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setName(p.name);
      setEffects({ ...p.effects });
      setTurns(p.turns);
    }
  };
  const ok = Object.keys(effects).length > 0;
  return (
    <Modal
      title={`Временный эффект — ${target.label}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Действует со следующего хода; снять можно раньше срока.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!ok}
            onClick={() => {
              iv('addEffect', { side: target.side, formationId: target.formationId, elementIds: target.elementIds, name: name || 'Эффект', effects, turns });
              onClose();
            }}
          >
            Наложить
          </Btn>
        </>
      }
    >
      <div className="fields two">
        <Field label="Заготовка" hint={presets.find((x) => x.id === preset)?.description}>
          <Sel value={preset} onChange={pick} options={[...presets.map((p) => ({ value: p.id, label: p.name })), { value: '', label: 'свой эффект' }]} />
        </Field>
        <Field label="Ходов">
          <Num value={turns} onChange={(v) => setTurns(Math.max(1, Math.round(v)))} min={1} max={50} integer width="100%" />
        </Field>
        <Field label="Название (для журнала)">
          <Txt value={name} onChange={setName} />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>
          Множители характеристик
        </div>
        <EffectsEditor value={effects} onChange={setEffects} />
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        Заготовки эффектов — в наборе правил («Временные эффекты»).
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------------ удар огневой поддержки

/** Вызвать удар: средство стороны side по цели на стороне противника. */
export function StrikeModal({
  b,
  side,
  target,
  assetId,
  onClose,
  iv,
}: {
  b: Battle;
  side: SideId;
  target?: Target;
  assetId?: string;
  onClose: () => void;
  iv: Iv;
}) {
  const assets = (b.support ?? []).filter((a) => a.side === side);
  const [asset, setAsset] = useState(assetId ?? assets.find((a) => a.left > 0)?.id ?? '');
  const enemy = other(side);
  const formations = b.formations.filter((f) => f.side === enemy);
  const [fid, setFid] = useState<string>(target?.formationId ?? '');
  const a = assets.find((x) => x.id === asset);
  const type = a && b.ruleset.componentTypes.find((t) => t.id === a.typeId);
  const E = useMemo(() => new EngineContext(b), [b]);
  const depth = (id: string | null): number => (id ? 1 + depth(b.formations.find((f) => f.id === id)?.parentId ?? null) : 0);
  return (
    <Modal
      title={`Удар огневой поддержки — ${b.sides[side].name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Удар наносится в начале следующего хода; до него его можно отменить.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!a || a.left <= 0}
            onClick={() => {
              iv('strike', { side, assetId: asset, ...(target?.elementIds ? { elementIds: target.elementIds } : fid ? { formationId: fid } : {}) });
              onClose();
            }}
          >
            Вызвать удар
          </Btn>
        </>
      }
    >
      {!assets.length ? (
        <div className="note">У стороны «{b.sides[side].name}» нет огневой поддержки — её задают в сценарии, в карточке стороны.</div>
      ) : (
        <div className="fields two">
          <Field label="Средство" hint={a && type ? `${a.count} × ${type.name}; осталось ударов: ${a.left} из ${a.missions}` : undefined}>
            <Sel value={asset} onChange={setAsset} options={assets.map((x) => ({ value: x.id, label: `${x.name} (${x.left} из ${x.missions})` }))} />
          </Field>
          <Field label="Цель" hint="По необнаруженным целям удар слабее (огонь по площади).">
            {target?.elementIds ? (
              <div className="small" style={{ paddingTop: 6 }}>
                {target.label}
              </div>
            ) : (
              <Sel
                value={fid}
                onChange={setFid}
                options={[
                  { value: '', label: `вся сторона «${b.sides[enemy].name}»` },
                  ...formations.map((f) => ({ value: f.id, label: `${'  '.repeat(Math.max(0, depth(f.parentId)))}${resolveRefs(`[[f:${f.id}]]`, b)}` })),
                ]}
              />
            )}
          </Field>
        </div>
      )}
      {target?.elementIds && (
        <p className="faint small" style={{ marginBottom: 0 }}>
          Видны противнику сейчас: {target.elementIds.filter((id) => E.elements.get(id)?.spotted).length} из {target.elementIds.length}.
        </p>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ эффекты и поддержка в бою

/** Действующие эффекты, средства поддержки и заказанные удары — с кнопками «снять», «удар», «отменить». */
export function SupportPanel({
  b,
  iv,
  onStrike,
  onEffect,
}: {
  b: Battle;
  iv: Iv;
  onStrike: (side: SideId, assetId?: string) => void;
  onEffect: (t: Target) => void;
}) {
  const next = b.turn + 1;
  const effects = (b.effects ?? []).filter((x) => x.until >= next);
  const strikes = (b.strikes ?? []).filter((x) => !x.done && x.turn >= next);
  const support = b.support ?? [];
  const live = !b.finished;
  if (!live && !effects.length) return null;
  const whom = (x: { side: SideId; formationId?: string; elementIds?: string[] }, enemyTarget = false) =>
    x.formationId
      ? resolveRefs(`[[f:${x.formationId}]]`, b)
      : x.elementIds?.length
        ? x.elementIds.length > 2
          ? `${x.elementIds.length} ${plural(x.elementIds.length, 'элемент', 'элемента', 'элементов')}`
          : x.elementIds.map((id) => resolveRefs(`[[e:${id}]]`, b)).join(', ')
        : `вся сторона «${b.sides[enemyTarget ? other(x.side) : x.side].name}»`;
  return (
    <div className="support-panel">
      {(['A', 'B'] as SideId[]).map((side) => {
        const assets = support.filter((a) => a.side === side);
        const fx = effects.filter((x) => x.side === side);
        const st = strikes.filter((x) => x.side === side);
        return (
          <div key={side} className="support-side">
            <div className="row" style={{ gap: 6 }}>
              <b style={{ color: b.sides[side].color }}>{b.sides[side].name}</b>
              <span className="grow" />
              {live && (
                <button
                  type="button"
                  className="link-btn small"
                  onClick={() => onEffect({ side, label: `вся сторона «${b.sides[side].name}»` })}
                  title="Временный эффект на всю сторону"
                >
                  + эффект
                </button>
              )}
            </div>
            {assets.map((a) => {
              const t = b.ruleset.componentTypes.find((x) => x.id === a.typeId);
              return (
                <div key={a.id} className="support-item">
                  <span className="grow">
                    ✦ {a.name}{' '}
                    <span className="faint small">
                      · {a.count} × {t?.name ?? '?'}
                    </span>
                  </span>
                  <span className={`small ${a.left ? '' : 'faint'}`}>
                    {a.left} из {a.missions}
                  </span>
                  {live && (
                    <Btn sm disabled={a.left <= 0} onClick={() => onStrike(side, a.id)} title="Вызвать удар — он будет нанесён в начале следующего хода">
                      Удар…
                    </Btn>
                  )}
                </div>
              );
            })}
            {st.map((x) => (
              <div key={x.id} className="support-item planned">
                <span className="grow small">
                  ⟶ удар «{support.find((a) => a.id === x.assetId && a.side === x.side)?.name ?? '?'}» по {whom(x, true)} — в начале {x.turn}-го хода
                </span>
                {live && x.source === 'gm' && (
                  <button type="button" className="link-btn small" onClick={() => iv('cancelStrike', { strikeId: x.id })}>
                    отменить
                  </button>
                )}
              </div>
            ))}
            {fx.map((x) => (
              <div key={x.id} className="support-item effect" data-tip={effectsText(x.effects)}>
                <span className="grow small">
                  ◌ «{x.name}» — {whom(x)}, {x.from > b.turn ? `с ${x.from}-го ` : ''}до {x.until}-го хода
                </span>
                {live && (
                  <button type="button" className="link-btn small" onClick={() => iv('removeEffect', { effectId: x.id })}>
                    снять
                  </button>
                )}
              </div>
            ))}
            {!assets.length && !fx.length && !st.length && <div className="faint small">Эффектов и огневой поддержки нет.</div>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ групповые решения

const GROUP_FIELDS: { key: string; label: string; feature?: keyof Battle['ruleset']['features'] }[] = [
  { key: 'morale', label: 'Мораль', feature: 'morale' },
  { key: 'cohesion', label: 'Слаженность', feature: 'cohesion' },
  { key: 'readiness', label: 'Готовность', feature: 'readiness' },
  { key: 'suppression', label: 'Подавление', feature: 'suppression' },
  { key: 'fatigue', label: 'Усталость', feature: 'fatigue' },
  { key: 'ammo', label: 'Боезапас', feature: 'ammo' },
  { key: 'fuel', label: 'Топливо', feature: 'fuel' },
  { key: 'equipment', label: 'Снаряжение', feature: 'equipment' },
];

/** Изменить состояние сразу нескольких элементов: заданные поля — всем, пустые — не трогать. */
export function GroupEditModal({ b, ids, onClose, iv }: { b: Battle; ids: string[]; onClose: () => void; iv: Iv }) {
  const [patch, setPatch] = useState<Record<string, number>>({});
  const fields = GROUP_FIELDS.filter((x) => !x.feature || b.ruleset.features[x.feature]);
  const els = b.elements.filter((x) => ids.includes(x.id));
  const avg = (k: string) => (els.length ? Math.round(els.reduce((a, x) => a + ((x as unknown as Record<string, number>)[k] ?? 0), 0) / els.length) : 0);
  return (
    <Modal
      title={`Изменить ${ids.length} ${plural(ids.length, 'элемент', 'элемента', 'элементов')}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Заданное получат все выбранные; запишется в журнал одним решением ГМ.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!Object.keys(patch).length}
            onClick={() => {
              iv('editElement', { elementIds: ids, patch });
              onClose();
            }}
          >
            Применить
          </Btn>
        </>
      }
    >
      <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {fields.map((x) => (
          <Field
            key={x.key}
            label={
              <>
                {x.label} <span className="faint small">· сейчас в среднем {avg(x.key)}</span>
              </>
            }
          >
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <Check
                value={x.key in patch}
                onChange={(v) => {
                  const next = { ...patch };
                  if (v) next[x.key] = avg(x.key);
                  else delete next[x.key];
                  setPatch(next);
                }}
              />
              <Num
                value={patch[x.key] ?? avg(x.key)}
                onChange={(v) => setPatch({ ...patch, [x.key]: Math.max(0, Math.min(100, v)) })}
                min={0}
                max={100}
                width="100%"
              />
            </div>
          </Field>
        ))}
      </div>
    </Modal>
  );
}

/** Подпись множителей эффекта (для подсказок): «Огонь ×1.3, Инициатива ×1.5». */
export function effectsShort(e: Effects): string {
  return (Object.keys(e) as StatKey[]).map((k) => `${STAT_LABELS[k]} ×${e[k]}`).join(', ');
}
