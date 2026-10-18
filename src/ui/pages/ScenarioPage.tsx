// Сценарий: условия боя, стороны, их подразделения, укрепления, разведданные и задачи.

import { useState } from 'react';
import {
  OBJECTIVE_HAS_VALUE,
  OBJECTIVE_LABELS,
  OBJECTIVE_TYPES,
  createBattle,
  newId,
  newRootUnit,
  newObjective,
  randomSeed,
  summarizeUnits,
  defaultCommandLevel,
  plural,
  sideUnits,
  validateScenario,
  walkUnits,
  withoutExcluded,
  type ObjectiveType,
  type Ruleset,
  type Scenario,
  type UnitNode,
} from '../../engine';
import { effectsText } from '../components/EffectsEditor';
import { CommanderSelect } from '../components/CommanderSelect';
import { Crumbs } from '../components/Crumbs';
import { AddUnitsModal } from '../components/AddUnits';
import { PlanEditor, arrivalsOf } from '../components/PlanEditor';
import { Link } from '../components/Link';
import { Area, Btn, Card, Field, Info, Menu, Num, Section, Sel, fmt0, fmt1, pressable } from '../components/ui';
import { openUnit, useTabState } from '../hooks';
import { confirmDialog, deleteScenario, duplicateScenario, exportJson, historyStep, instantiateLibrary, openTab, putBattle, toast, toastUndoable, updateScenario, useApp, type Tab } from '../store';
import { DND_LIB, DND_NODE, computeStats, statsLine, statsTip } from './FormationPage';

/** Название нового боя: «Сценарий · бой N» (N — следующий номер для этого сценария). */
export function nextBattleName(sc: Scenario): string {
  let n = 0;
  for (const m of Object.values(useApp.getState().battleIndex)) {
    const k = m.scenarioId === sc.id ? / · бой (\d+)/.exec(m.name) : null;
    if (k) n = Math.max(n, Number(k[1]));
  }
  return `${sc.name} · бой ${n + 1}`;
}

/** Новый бой по сценарию — каждый раз со своей случайностью. */
export async function startBattle(sc: Scenario, rs: Ruleset) {
  const issues = validateScenario(sc, rs);
  const errors = issues.filter((x) => x.level === 'error');
  if (errors.length && !(await confirmDialog('В сценарии есть ошибки', `${errors.map((x) => `• ${x.text}`).join('\n')}\n\nВсё равно начать бой?`, 'Начать'))) return;
  const b = createBattle(sc, rs, { seed: randomSeed(), id: newId('bt'), name: nextBattleName(sc) });
  putBattle(b);
  openTab('battle', b.id);
}

const DEFAULT_OBJECTIVE_VALUE: Record<ObjectiveType, (maxTurns: number) => number> = {
  hold: (t) => t,
  take: () => 0,
  inflict: () => 20,
  preserve: () => 30,
  recon: () => 50,
  noRout: () => 0,
};

export function ScenarioPage({ tab }: { tab: Tab }) {
  const st = useApp();
  const sc = st.scenarios[tab.ref!];
  if (!sc) return <div className="empty">Сценарий не найден.</div>;
  const rs = st.rulesets[sc.rulesetId];
  const upd = (fn: (s: Scenario) => void) => updateScenario(sc.id, fn);
  const issues = validateScenario(sc, rs);
  const errors = issues.filter((x) => x.level === 'error');
  const warnings = issues.filter((x) => x.level === 'warning');

  const start = () => rs && startBattle(sc, rs);

  const changeRuleset = async (v: string) => {
    if (!(await confirmDialog('Сменить набор правил?', 'Типы, приказы и условия должны существовать в новом наборе — проверьте замечания после смены.'))) return;
    const nr = st.rulesets[v];
    upd((d) => {
      d.rulesetId = v;
      d.conditions = {};
      for (const cat of nr.conditions) d.conditions[cat.id] = cat.options[0]?.id ?? '';
      d.startBand = nr.rangeBands[0]?.id ?? '';
      for (const side of d.sides) {
        side.fortification = nr.fortifications[0]?.id ?? '';
        side.intel = nr.intelLevels[Math.min(1, nr.intelLevels.length - 1)]?.id ?? '';
      }
    });
  };

  return (
    <div className="page">
      <Crumbs items={[{ label: 'Сценарии', section: 'scenarios' }]} />
      <div className="page-head">
        <input className="title-input" value={sc.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <Btn kind="primary" onClick={start} disabled={!rs}>
          ▶ Начать бой
        </Btn>
        <Btn onClick={() => openTab('montecarlo', sc.id)} disabled={!rs} title="Сотни прогонов для оценки вероятностей исходов">
          Прогоны
        </Btn>
        <Menu
          items={[
            { label: 'Дублировать', onClick: () => duplicateScenario(sc.id) },
            { label: 'Сохранить в файл…', onClick: () => exportJson('scenario', sc.name, sc) },
            'sep',
            { label: 'Удалить сценарий', danger: true, onClick: () => deleteScenario(sc.id) },
          ]}
        />
      </div>

      {errors.length > 0 && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          {errors.map((x, i) => (
            <div key={i}>{x.text}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="muted small" style={{ marginTop: -8, marginBottom: 12 }} data-tip={warnings.map((x) => `• ${x.text}`).join('\n')}>
          <span className="warn">⚠</span> Замечаний: {warnings.length} — наведите, чтобы прочитать
        </div>
      )}

      <div className="stack">
        <Card title="Обстановка">
          <div className="fields">
            {rs?.conditions.map((cat) => {
              const opt = cat.options.find((o) => o.id === sc.conditions[cat.id]);
              return (
                <Field key={cat.id} label={cat.name} hint={opt ? effectsText(opt.effects) : undefined}>
                  <Sel value={sc.conditions[cat.id] ?? ''} onChange={(v) => upd((d) => void (d.conditions[cat.id] = v))} options={cat.options.map((o) => ({ value: o.id, label: o.name }))} />
                </Field>
              );
            })}
            <Field label="Начальная дистанция">
              <Sel value={sc.startBand} onChange={(v) => upd((d) => void (d.startBand = v))} options={(rs?.rangeBands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
            <Field label="Лимит ходов" hint={rs ? `≈ ${fmt1((sc.maxTurns * rs.turnMinutes) / 60)} ч боя` : undefined}>
              <Num value={sc.maxTurns} onChange={(v) => upd((d) => void (d.maxTurns = v))} min={1} max={500} integer width="100%" />
            </Field>
            <Field label="Набор правил">
              <Sel value={sc.rulesetId} onChange={changeRuleset} options={Object.values(st.rulesets).map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Area value={sc.description ?? ''} onChange={(v) => upd((d) => void (d.description = v))} rows={2} placeholder="Вводная (необязательно)" />
          </div>
        </Card>

        {rs ? (
          <div className="grid two">
            {[0, 1].map((i) => (
              <SideEditor key={i} sc={sc} i={i} rs={rs} />
            ))}
          </div>
        ) : (
          <div className="note bad">Набор правил сценария не найден — выберите другой.</div>
        )}

        {rs && <PlanEditor sc={sc} rs={rs} />}
        {rs && <ForceRatio sc={sc} rs={rs} />}
      </div>
    </div>
  );
}

/**
 * Структура подразделения стороны: компактное дерево, щелчок открывает узел в конструкторе.
 * Галочка — участвует ли часть в этом бою (снятая исключает её вместе с подчинёнными).
 */
function SideTree(props: {
  root: UnitNode;
  refId: string;
  rs: Ruleset;
  arrivals?: Map<string, number>;
  excluded?: Set<string>;
  onToggle?: (id: string, on: boolean) => void;
}) {
  const { root, refId, rs, arrivals, excluded, onToggle } = props;
  const stats = computeStats(root, rs);
  const orders = new Map(rs.orders.map((o) => [o.id, o.name]));
  const LIMIT = 150;
  const rows: { n: UnitNode; depth: number; off: boolean; inherited: boolean }[] = [];
  const walk = (n: UnitNode, depth: number, parentOff: boolean) => {
    const own = !!excluded?.has(n.id);
    if (depth > 0) rows.push({ n, depth, off: own || parentOff, inherited: parentOff });
    n.children.forEach((c) => walk(c, depth + 1, own || parentOff));
  };
  walk(root, 0, false);
  return (
    <div className="side-tree">
      {onToggle && <div className="faint small" style={{ padding: '2px 4px 4px' }}>Галочка — часть участвует в этом бою. Снимите, чтобы воевать без неё.</div>}
      {rows.slice(0, LIMIT).map(({ n, depth, off, inherited }) => (
        <div
          key={n.id}
          className={`side-node${off ? ' off' : ''}`}
          style={{ paddingLeft: 4 + (depth - 1) * 16 }}
          onClick={(e) => openUnit(refId, n.id, e.ctrlKey || e.metaKey)}
          title="Открыть в конструкторе"
          {...pressable((e) => openUnit(refId, n.id, e.ctrlKey || e.metaKey))}
        >
          {onToggle && (
            <input
              type="checkbox"
              className="part-check"
              checked={!off}
              disabled={inherited}
              title={inherited ? 'Не участвует вместе со старшим подразделением' : off ? 'Не участвует в бою — отметьте, чтобы вернуть' : 'Участвует в бою — снимите, чтобы исключить'}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onToggle(n.id, e.target.checked)}
            />
          )}
          {n.level && <span className="faint">{n.level}</span>}
          <span className="side-node-name">{n.name}</span>
          {n.attachedFrom !== undefined && <span className="badge info">придано</span>}
          {arrivals?.has(n.id) && <span className="badge warn" data-tip="Подкрепление по плану боя">с {arrivals.get(n.id)}-го хода</span>}
          {n.order && <span className="badge">{orders.get(n.order) ?? n.order}</span>}
          <span className="grow" />
          <span className="faint small nowrap" data-tip={statsTip(stats.get(n.id))}>
            {statsLine(stats.get(n.id))}
          </span>
        </div>
      ))}
      {rows.length > LIMIT && <div className="faint small" style={{ padding: '2px 4px' }}>… и ещё {rows.length - LIMIT} — откройте подразделение</div>}
    </div>
  );
}

function SideEditor({ sc, i, rs }: { sc: Scenario; i: number; rs: Ruleset }) {
  const side = sc.sides[i];
  const upd = (fn: (s: Scenario['sides'][number]) => void) => updateScenario(sc.id, (d) => fn(d.sides[i]));
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const excludedSet = new Set(side.excluded ?? []);
  const scRef = `sc:${sc.id}`;
  const defaultOrderName = rs.orders.find((o) => o.behavior === 'defend')?.name ?? 'Оборона';
  const [openIds, setOpenIds] = useTabState<string[]>(`sc-tree:${sc.id}`, []);
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(DND_LIB) || e.dataTransfer.types.includes(DND_NODE);
  const dragged = (e: React.DragEvent): { id: string; side: number } | null => {
    const raw = e.dataTransfer.getData(DND_NODE);
    if (!raw) return null;
    const x = JSON.parse(raw) as { ref: string; id: string; side?: number };
    return x.ref === scRef && typeof x.side === 'number' ? { id: x.id, side: x.side } : null;
  };
  /** Бросили на подразделение — придать ему. */
  const onRowDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const libId = e.dataTransfer.getData(DND_LIB);
    if (libId) {
      const c = instantiateLibrary(libId, { attachedFrom: '' });
      if (c) upd((d) => void d.formations.find((f) => f.id === targetId)?.children.push(c));
      if (c) toast(`«${c.name}» придано.`, 'good');
      return;
    }
    const x = dragged(e);
    if (!x || x.id === targetId) return;
    let name = '';
    updateScenario(sc.id, (d) => {
      const from = d.sides[x.side].formations;
      const k = from.findIndex((f) => f.id === x.id);
      const target = d.sides[i].formations.find((f) => f.id === targetId);
      if (k < 0 || !target) return;
      const [u] = from.splice(k, 1);
      u.attachedFrom = u.attachedFrom ?? '';
      name = u.name;
      target.children.push(u);
    });
    if (name) toast(`«${name}» придано подразделению. Отделить можно в его меню «⋯».`, 'good');
  };
  /** Бросили на список стороны — добавить копию из библиотеки или перевести с другой стороны. */
  const onListDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const libId = e.dataTransfer.getData(DND_LIB);
    if (libId) {
      const c = instantiateLibrary(libId);
      if (c) upd((d) => void d.formations.push(c));
      return;
    }
    const x = dragged(e);
    if (!x || x.side === i) return;
    updateScenario(sc.id, (d) => {
      const from = d.sides[x.side].formations;
      const k = from.findIndex((f) => f.id === x.id);
      if (k >= 0) d.sides[i].formations.push(from.splice(k, 1)[0]);
    });
  };
  return (
    <div className="card side-card" style={{ ['--side' as string]: side.color }}>
      <div className="card-head">
        <input type="color" value={side.color} onChange={(e) => upd((d) => void (d.color = e.target.value))} title="Цвет стороны" />
        <input className="title-input" style={{ fontSize: 15, fontWeight: 600, minWidth: 100, flex: 1 }} value={side.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <div
          className={`side-drop${over === 'list' ? ' over' : ''}`}
          onDragOver={(e) => {
            if (!accepts(e)) return;
            e.preventDefault();
            if (over !== 'list') setOver('list');
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
          onDrop={onListDrop}
        >
          {side.formations.map((f, fi) => {
            const live = withoutExcluded(f, side.excluded);
            const s = summarizeUnits(live ? [live] : [], rs);
            const attached = f.children.filter((c) => c.attachedFrom !== undefined);
            const isOpen = openIds.includes(f.id);
            const out = countExcluded(f, excludedSet);
            return (
              <div key={f.id}>
                <div
                  className={`side-unit${over === f.id ? ' drop-inside' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_NODE, JSON.stringify({ ref: scRef, id: f.id, side: i }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!accepts(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (over !== f.id) setOver(f.id);
                  }}
                  onDrop={(e) => onRowDrop(e, f.id)}
                  data-tip="Перетащите на другое подразделение, чтобы придать его; на другую сторону — чтобы перевести"
                >
                  <button
                    className="side-fold"
                    disabled={!f.children.length}
                    onClick={() => setOpenIds(isOpen ? openIds.filter((x) => x !== f.id) : [...openIds, f.id])}
                    title={f.children.length ? (isOpen ? 'Скрыть структуру' : 'Показать структуру и выбрать, какие части участвуют в бою') : undefined}
                  >
                    {f.children.length ? (isOpen ? '▾' : '▸') : ''}
                  </button>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link kind="formation" refId={`sc:${sc.id}:${f.id}`}>
                      {f.name}
                    </Link>
                    <span className="faint small" data-tip={s.equip.length ? s.equip.map((q) => `${q.name}: ${q.cur}`).join('\n') : undefined}>
                      {' '}
                      · {fmt0(s.persCur)} чел.
                    </span>
                    {attached.length > 0 && (
                      <span className="faint small" data-tip={attached.map((c) => c.name).join('\n')}>
                        {' '}
                        · придано: {attached.length}
                      </span>
                    )}
                    {out > 0 && (
                      <span className="badge warn" data-tip="Часть подразделения в этом бою не участвует — раскройте ▸, чтобы изменить">
                        без {out} {out === 1 ? 'части' : 'частей'}
                      </span>
                    )}
                  </div>
                  <Sel
                    value={f.order ?? ''}
                    width={130}
                    onChange={(v) => upd((d) => void (d.formations[fi].order = v || null))}
                    options={[{ value: '', label: `${defaultOrderName} (по умолч.)` }, ...rs.orders.map((o) => ({ value: o.id, label: o.name }))]}
                    title="Приказ подразделению"
                  />
                  <Btn
                    sm
                    kind="ghost"
                    icon
                    title="Убрать из сценария"
                    onClick={() => {
                      historyStep(`удаление «${f.name}» из сценария`);
                      upd((d) => void d.formations.splice(fi, 1));
                      toastUndoable(`«${f.name}» убрано из сценария.`);
                    }}
                  >
                    ×
                  </Btn>
                </div>
                {isOpen && (
                  <SideTree
                    root={f}
                    refId={`sc:${sc.id}:${f.id}`}
                    rs={rs}
                    arrivals={arrivalsOf(sc)}
                    excluded={excludedSet}
                    onToggle={(id, on) =>
                      upd((d) => {
                        const set = new Set(d.excluded ?? []);
                        if (on) set.delete(id);
                        else set.add(id);
                        d.excluded = [...set];
                      })
                    }
                  />
                )}
              </div>
            );
          })}
          {!side.formations.length && <div className="muted" style={{ padding: '6px 4px' }}>Нет подразделений — добавьте ниже или перетащите из навигатора слева</div>}
          {side.formations.length > 1 && (
            <div className="faint small" style={{ padding: '4px 4px 0' }}>
              Всего на стороне: {side.formations.length} {plural(side.formations.length, 'подразделение', 'подразделения', 'подразделений')}, {fmt0(summarizeUnits(sideUnits(side), rs).persCur)} чел.
            </div>
          )}
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            <Btn onClick={() => setAdding(true)} title="Несколько подразделений сразу, копии ×N, целиком или отдельные части. В сценарий добавляется копия — библиотека не меняется.">
              + Добавить подразделения…
            </Btn>
            <span className="grow" />
            <Btn
              kind="ghost"
              onClick={() => {
                const f = newRootUnit('Новое подразделение', { order: i === 0 ? 'attack' : 'defend', level: '' });
                upd((d) => void d.formations.push(f));
                openTab('formation', `sc:${sc.id}:${f.id}`);
              }}
            >
              + Новое
            </Btn>
          </div>
        </div>

        <div className="fields two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Укрепления" hint="Действуют на элементы в обороне, засаде, закреплении и резерве.">
            <Sel value={side.fortification} onChange={(v) => upd((d) => void (d.fortification = v))} options={rs.fortifications.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
          <Field label="Разведданные">
            <Sel value={side.intel} onChange={(v) => upd((d) => void (d.intel = v))} options={rs.intelLevels.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        </div>

        <div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <h4>Задачи</h4>
            <Info text="По задачам считается итог боя. Если задач нет, они выводятся из приказов: атака — захватить позицию, оборона — удержать. Вес — важность задачи в итоговой оценке." />
          </div>
          {!side.objectives.length && <div className="faint small">По приказам (автоматически)</div>}
          {side.objectives.map((o, oi) => (
            <div key={o.id} className="row" style={{ flexWrap: 'nowrap', marginBottom: 4, gap: 6 }}>
              <div className="grow">
                <Sel
                  value={o.type}
                  width="100%"
                  onChange={(v) =>
                    upd((d) => {
                      d.objectives[oi].type = v;
                      d.objectives[oi].value = DEFAULT_OBJECTIVE_VALUE[v](sc.maxTurns);
                    })
                  }
                  options={OBJECTIVE_TYPES.map((t) => ({ value: t, label: OBJECTIVE_LABELS[t] }))}
                />
              </div>
              {OBJECTIVE_HAS_VALUE[o.type] && (
                <Num value={o.value} onChange={(v) => upd((d) => void (d.objectives[oi].value = v))} min={0} width={78} suffix={o.type === 'hold' ? 'ход' : '%'} />
              )}
              <span className="faint small" data-tip="Вес задачи в итоговой оценке">
                вес
              </span>
              <Num value={o.weight} onChange={(v) => upd((d) => void (d.objectives[oi].weight = v))} min={0} step={0.5} width={48} />
              <Btn sm kind="ghost" icon onClick={() => upd((d) => void d.objectives.splice(oi, 1))} title="Убрать задачу">
                ×
              </Btn>
            </div>
          ))}
          <Btn sm kind="ghost" onClick={() => upd((d) => void d.objectives.push(newObjective(i === 0 ? 'take' : 'hold', i === 0 ? 0 : sc.maxTurns, 1)))}>
            + задача
          </Btn>
        </div>

        {rs.features.command && <SideCommanders sc={sc} i={i} rs={rs} />}
      </div>
      {adding && <AddUnitsModal sc={sc} side={i} rs={rs} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Сколько частей подразделения исключено из боя (считаются верхние исключённые узлы). */
function countExcluded(root: UnitNode, ex: Set<string>): number {
  if (!ex.size) return 0;
  let n = 0;
  const walk = (u: UnitNode) => u.children.forEach((c) => (ex.has(c.id) ? n++ : walk(c)));
  walk(root);
  return n;
}

/**
 * Командиры стороны в начале боя. Командир есть у каждого формирования — у подразделения целиком и у
 * каждого звена с подчинёнными; в конструкторе его нет. Здесь — насколько он хорош в этом сражении
 * (или «без командира»); это учитывают и бой, и прогоны. По ходу боя уровень меняет ГМ.
 */
function SideCommanders({ sc, i, rs }: { sc: Scenario; i: number; rs: Ruleset }) {
  const side = sc.sides[i];
  const [open, setOpen] = useTabState(`sc-cmd:${sc.id}:${i}`, false);
  const excluded = new Set(side.excluded ?? []);
  const list: { id: string; name: string; parent?: string; depth: number }[] = [];
  for (const f of side.formations)
    walkUnits(f, (n, p, depth) => {
      if (excluded.has(n.id) || (p && excluded.has(p.id))) return;
      if (depth === 0 || n.children.some((c) => !excluded.has(c.id))) list.push({ id: n.id, name: n.name, parent: p?.name, depth });
    });
  if (!list.length) return null;
  const counts = new Map<string, number>();
  for (const c of list) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const def = defaultCommandLevel(rs);
  const set = side.commanders ?? {};
  const valueOf = (id: string) => (id in set ? set[id] : def);
  const levelName = (v: number) => (v <= 0 ? 'без командира' : (rs.commandLevels[v - 1]?.name ?? ''));
  const changed = list.filter((c) => valueOf(c.id) !== def);
  const summary = changed.length
    ? changed.map((c) => `${c.name}: ${levelName(valueOf(c.id))}`.toLowerCase()).join(', ')
    : `${list.length === 1 ? 'командир' : `все ${list.length}`} — ${levelName(def).toLowerCase() || 'обычные'}`;
  const upd = (fn: (d: Scenario['sides'][number]) => void) => updateScenario(sc.id, (d) => fn(d.sides[i]));
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button className="sec-toggle" onClick={() => setOpen(!open)}>
          <span className="chev">{open ? '▾' : '▸'}</span>
          <h4>Командиры в начале боя</h4>
        </button>
        <Info text="Командир есть у каждого формирования — у подразделения целиком и у каждого звена с подчинёнными. Насколько он хорош в этом сражении (или что командира нет) — задаётся здесь; это учитывают и бой, и прогоны. По ходу боя ГМ меняет уровень в таблице сил — по обстановке." />
        <span className="faint small grow nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={summary}>
          {summary}
        </span>
      </div>
      {open && (
        <div className="cmd-list">
          {list.map((c) => (
            <div key={c.id} className="cmd-row" style={{ paddingLeft: 4 + Math.min(c.depth, 4) * 12 }}>
              <span className="grow" style={{ minWidth: 0 }}>
                {c.name}
                {(counts.get(c.name) ?? 0) > 1 && c.parent ? <span className="faint"> · {c.parent}</span> : null}
              </span>
              <CommanderSelect
                levels={rs.commandLevels}
                allowNone
                value={valueOf(c.id)}
                onChange={(v) =>
                  upd((d) => {
                    d.commanders = { ...(d.commanders ?? {}) };
                    if (v === def) delete d.commanders[c.id];
                    else d.commanders[c.id] = v;
                  })
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForceRatio({ sc, rs }: { sc: Scenario; rs: Ruleset }) {
  const sums = sc.sides.map((s) => summarizeUnits(sideUnits(s), rs));
  const band = sc.startBand;
  const ratio = (a: number, b: number) => (a <= 0 && b <= 0 ? '—' : b <= 0 ? '∞' : a <= 0 ? '0' : a >= b ? `${fmt1(a / b)} : 1` : `1 : ${fmt1(b / a)}`);
  const rows: { label: string; a: number; b: number; fmt?: (v: number) => string }[] = [
    { label: 'Личный состав', a: sums[0].persCur, b: sums[1].persCur },
    { label: 'Боевая ценность', a: sums[0].value, b: sums[1].value },
    ...rs.targetClasses.map((c) => ({
      label: `Огонь по «${c.name}»`,
      a: sums[0].fire[c.id]?.[band] ?? 0,
      b: sums[1].fire[c.id]?.[band] ?? 0,
      fmt: fmt1,
    })),
  ];
  for (const id of [...new Set(sums.flatMap((s) => s.equip.map((q) => q.id)))]) {
    rows.push({
      label: rs.componentTypes.find((t) => t.id === id)?.name ?? id,
      a: sums[0].equip.find((q) => q.id === id)?.cur ?? 0,
      b: sums[1].equip.find((q) => q.id === id)?.cur ?? 0,
    });
  }
  return (
    <Section
      id="scenario-ratio"
      title="Соотношение сил"
      summary={`люди ${ratio(sums[0].persCur, sums[1].persCur)} · боевая ценность ${ratio(sums[0].value, sums[1].value)}`}
      tight
    >
      <table className="tbl">
        <thead>
          <tr>
            <th />
            <th className="num" style={{ color: sc.sides[0].color }}>
              {sc.sides[0].name}
            </th>
            <th className="num" style={{ color: sc.sides[1].color }}>
              {sc.sides[1].name}
            </th>
            <th className="num">Соотношение</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{(r.fmt ?? fmt0)(r.a)}</td>
              <td className="num">{(r.fmt ?? fmt0)(r.b)}</td>
              <td className="num">{ratio(r.a, r.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint small" style={{ margin: '6px 14px 4px' }}>
        Огонь — на начальной дистанции, без учёта условий и состояния.
      </p>
    </Section>
  );
}
