// Силы сторон и сценарии: правка, создание по шаблону, удаление, сборка сценария для боя.

import { produce } from 'immer';
import {
  clone,
  cloneUnit,
  newRootUnit,
  newId,
  newScenario,
  randomSeed,
  forceFromTemplate,
  scenarioForceIds,
  resolveScenario,
  nextName,
  locateNode,
  relinkScenario,
  restoreForce,
  restForce,
  resupplyForce,
  SUPPLY_LABEL,
  type SupplyKey,
  healForce,
  prepareForce,
  type BetweenPlan,
  repairForce,
  transferStrength,
  forceCondition,
  type RestPart,
  plural,
  returnUnit,
  transferUnit,
  type ForceCondition,
  type ForcesPatch,
  type UnitNode,
  type Id,
  type Scenario,
} from '../../engine';
import { storage } from '../storage';
import {
  chooseDialog,
  closeTabsWhere,
  flushSave,
  get,
  historyStep,
  openTab,
  record,
  scheduleSave,
  set,
  tabExists,
  toast,
  toastUndoable,
  updateSettings,
} from './core';
import { defaultRulesetId } from './library';

export function updateForce(id: Id, fn: (f: UnitNode) => void) {
  if (get().forces[id]) record('forces', id, 'edit');
  set((s) => {
    if (!s.forces[id]) return {};
    const next = produce(s.forces[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { forces: { ...s.forces, [id]: next } };
  });
  scheduleSave('forces', id, () => get().forces[id]);
}

export function addForce(f: UnitNode, open = true): Id {
  record('forces', f.id, 'add');
  set((s) => ({ forces: { ...s.forces, [f.id]: { ...f, updatedAt: new Date().toISOString() } } }));
  scheduleSave('forces', f.id, () => get().forces[f.id], 0);
  if (open) openTab('formation', `force:${f.id}`);
  return f.id;
}

/** Силы по шаблону (×count, с номерами по порядку). */
export function createForcesFromTemplate(templateId: Id, opts: { count?: number; faction?: string; name?: string; open?: boolean } = {}): Id[] {
  const tpl = get().formations[templateId];
  if (!tpl) return [];
  const n = Math.max(1, Math.min(50, opts.count ?? 1));
  const base = opts.name ?? tpl.name.replace(/ \(пример\)$/, '');
  const ids: Id[] = [];
  if (n > 1) historyStep(`создание сил по шаблону «${tpl.name}»`);
  for (let k = 0; k < n; k++) {
    const f = forceFromTemplate(tpl, { name: k ? nextName(base, k) : base, faction: opts.faction });
    ids.push(addForce(f, false));
  }
  if (opts.open !== false && ids.length === 1) openTab('formation', `force:${ids[0]}`);
  return ids;
}

/** Новые силы: по шаблону (как обычно) или пустое подразделение. */
export async function newForceDialog(faction?: string): Promise<Id | undefined> {
  const s = get();
  const list = Object.values(s.formations).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const v = await chooseDialog(
    'Новые силы — по какому шаблону?',
    [...list.map((t) => ({ value: t.id, label: t.name })), { value: '', label: 'Пустое подразделение (собрать вручную)' }],
    'Силы — конкретное подразделение: по шаблону берётся устройство и штат, а состояние и потери у каждого свои. Шаблон потом можно менять — силы обновятся по нему, сохранив потери.',
  );
  if (v === null) return;
  if (v) return createForcesFromTemplate(v, { faction })[0];
  return addForce(newRootUnit('Новое подразделение', { rulesetId: defaultRulesetId(), faction }));
}

/** Набор правил, по которому считаются силы. */
const rulesetOf = (f: UnitNode) => get().rulesets[f.rulesetId ?? defaultRulesetId() ?? ''];

/** Боеготовность сил: численность, раненые и ремонт, состояние. */
export function forceStatus(f: UnitNode): ForceCondition {
  return forceCondition(f, rulesetOf(f));
}

/** Можно ли что-то восстановить (некомплект, раненые, ремонт, состояние не в норме). */
export function canRestore(f: UnitNode): boolean {
  return restoreForce(f, rulesetOf(f)).changed;
}

/**
 * Полное восстановление «одной кнопкой»: раненые и техника возвращаются, недостающее — до штата,
 * состояние — к норме. Несколько подразделений — один шаг отмены. Возвращает, сколько восстановлено.
 */
export function restoreForces(ids: Id[]): number {
  const s = get();
  const todo = ids
    .map((id) => s.forces[id])
    .filter((f): f is UnitNode => !!f)
    .map((f) => ({ f, r: restoreForce(f, rulesetOf(f)) }))
    .filter((x) => x.r.changed);
  if (!todo.length) {
    toast('Восстанавливать нечего: силы в полном составе, состояние в норме.');
    return 0;
  }
  historyStep(todo.length === 1 ? `восстановление «${todo[0].f.name}»` : `восстановление сил (${todo.length})`);
  for (const { f, r } of todo) updateForce(f.id, (d) => void Object.assign(d, r.force));
  const pers = todo.reduce((a, x) => a + x.r.personnel, 0);
  const eq = todo.reduce((a, x) => a + x.r.equipment, 0);
  const gain = [pers ? `+${pers} чел.` : '', eq ? `+${eq} ед. техники и вооружения` : ''].filter(Boolean).join(', ');
  toastUndoable(
    `${todo.length === 1 ? `«${todo[0].f.name}» восстановлено` : `Восстановлено ${todo.length} ${plural(todo.length, 'подразделение', 'подразделения', 'подразделений')}`}: ${gain ? `${gain}, ` : ''}состояние в норме.`,
    'good',
  );
  return todo.length;
}

/** Действие над одним подразделением сил между боями: один шаг отмены, уведомление с «Отменить». */
function betweenStep(id: Id, label: string, fn: (f: UnitNode) => { force: UnitNode; changed: boolean }, message: (name: string) => string, nothing: string) {
  const f = get().forces[id];
  if (!f) return false;
  const r = fn(f);
  if (!r.changed) {
    toast(nothing);
    return false;
  }
  historyStep(`${label} «${f.name}»`);
  updateForce(id, (d) => void Object.assign(d, r.force));
  toastUndoable(message(f.name), 'good');
  return true;
}

/** Отдых: состояние бойцов в строю — к норме на pct%. */
export function restForceStep(id: Id, pct: number, parts: RestPart[]) {
  return betweenStep(
    id,
    'отдых',
    (f) => restForce(f, pct, parts),
    (n) => `«${n}»: отдых ${Math.round(pct)}% — состояние бойцов восстановлено.`,
    'Отдыхать незачем: состояние в норме.',
  );
}

/** Пополнить боезапас или топливо до level%. */
export function resupplyForceStep(id: Id, key: SupplyKey, level: number) {
  const what = SUPPLY_LABEL[key];
  return betweenStep(
    id,
    `пополнение: ${what.name.toLowerCase()}`,
    (f) => resupplyForce(f, key, level),
    (n) => `«${n}»: ${what.done.toLowerCase()} до ${Math.round(level)}%.`,
    `${what.name}: пополнять нечего — везде не меньше ${Math.round(level)}%.`,
  );
}

/** Лечить: раненые возвращаются в строй (не сверх штата). */
export function healForceStep(id: Id, pct = 100) {
  let count = 0;
  return betweenStep(
    id,
    'лечение',
    (f) => {
      const r = healForce(f, rulesetOf(f), pct);
      count = r.count;
      return r;
    },
    (n) => `«${n}»: в строй вернулись ${count} чел.`,
    'Лечить некого: раненых нет или штат уже заполнен.',
  );
}

/** Чинить: повреждённая техника и вооружение возвращаются в строй, состояние техники — к норме. */
export function repairForceStep(id: Id, pct = 100) {
  let count = 0;
  return betweenStep(
    id,
    'ремонт',
    (f) => {
      const r = repairForce(f, rulesetOf(f), pct);
      count = r.count;
      return r;
    },
    (n) => (count ? `«${n}»: отремонтировано ${count} ед. техники и вооружения.` : `«${n}»: состояние техники — в норме.`),
    'Чинить нечего: техника в строю и исправна.',
  );
}

/** Между боями: всё, что отмечено в плане, — одним шагом отмены и одной записью в боевом пути. */
export function prepareForceStep(id: Id, plan: BetweenPlan) {
  let done: string[] = [];
  return betweenStep(
    id,
    'подготовка к бою',
    (f) => {
      const r = prepareForce(f, rulesetOf(f), plan);
      done = r.done;
      return r;
    },
    (n) => `«${n}»: ${done.join('; ')}.`,
    'Делать нечего: силы в норме.',
  );
}

/** Пополнение из другого подразделения: по типам, сколько указано. Один шаг отмены на оба подразделения. */
export function transferStrengthStep(targetId: Id, donorId: Id, amounts: Record<Id, number>) {
  const s = get();
  const t = s.forces[targetId];
  const d = s.forces[donorId];
  if (!t || !d || t.id === d.id) return false;
  const r = transferStrength(t, d, rulesetOf(t), amounts);
  if (!r.changed) {
    toast('Передавать нечего.');
    return false;
  }
  historyStep(`пополнение «${t.name}» из «${d.name}»`);
  updateForce(t.id, (x) => void Object.assign(x, r.target));
  updateForce(d.id, (x) => void Object.assign(x, r.donor));
  const what = [r.personnel ? `${r.personnel} чел.` : '', r.equipment ? `${r.equipment} ед. техники и вооружения` : ''].filter(Boolean).join(' и ');
  toastUndoable(`Из «${d.name}» в «${t.name}» передано ${what}.`, 'good');
  return true;
}

// ------------------------------------------------------------------ команды

/** Палитра команд по умолчанию — различимые в обеих темах цвета. */
export const TEAM_PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

const teamKey = (f: UnitNode) => f.faction?.trim() || '';

/** Цвет команды: заданный, иначе цвет одноимённой стороны сценария, иначе из палитры по названию. */
export function teamColor(name: string): string {
  const key = name.trim();
  if (!key) return 'var(--faint)';
  const s = get();
  const own = s.settings.teamColors?.[key];
  if (own) return own;
  const low = key.toLowerCase();
  for (const sc of Object.values(s.scenarios)) for (const sd of sc.sides) if (sd.name.trim().toLowerCase() === low && sd.color) return sd.color;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
}

/** Стороны сценариев с таким же названием, как у команды. */
export function teamSides(name: string): { scenarioId: Id; sideId: string }[] {
  const low = name.trim().toLowerCase();
  if (!low) return [];
  return Object.values(get().scenarios).flatMap((sc) =>
    sc.sides.filter((sd) => sd.name.trim().toLowerCase() === low).map((sd) => ({ scenarioId: sc.id, sideId: sd.id })),
  );
}

/**
 * Команда: новое название и цвет. Название меняется у всех её сил (одним шагом отмены); по желанию — и у
 * одноимённых сторон сценариев, чтобы новые силы со стороны попадали в ту же команду.
 */
export function editTeam(from: string, opts: { name: string; color: string; renameSides: boolean }) {
  const a = from.trim();
  const b = opts.name.trim();
  const s = get();
  const ids = Object.values(s.forces)
    .filter((f) => teamKey(f) === a)
    .map((f) => f.id);
  const renamed = b !== a && ids.length > 0;
  const merge = renamed && !!b && Object.values(s.forces).some((f) => teamKey(f) === b);
  if (renamed) {
    const sides = opts.renameSides && a ? teamSides(a) : [];
    historyStep(`команда «${a || 'Без команды'}»`);
    for (const id of ids) updateForce(id, (d) => void (d.faction = b || undefined));
    for (const x of sides) updateScenario(x.scenarioId, (sc) => sc.sides.forEach((sd) => sd.id === x.sideId && (sd.name = b)));
    toastUndoable(
      merge
        ? `Силы команды «${a || 'Без команды'}» перешли в «${b}».`
        : `Команда «${a || 'Без команды'}» теперь «${b || 'Без команды'}»${sides.length ? `, стороны в сценариях — тоже (${sides.length})` : ''}.`,
    );
  }
  const key = renamed ? b : a;
  if (key && (opts.color !== teamColor(key) || renamed)) updateSettings({ teamColors: { ...(get().settings.teamColors ?? {}), [key]: opts.color } });
}

export function duplicateForce(id: Id): Id | undefined {
  const f = get().forces[id];
  if (!f) return;
  const c = cloneUnit(f);
  c.name = `${f.name} (копия)`;
  return addForce(c);
}

/** Сценарии, где участвует это подразделение сил. */
export function forceUsage(id: Id): Scenario[] {
  return Object.values(get().scenarios).filter((sc) => scenarioForceIds(sc).has(id));
}

export async function deleteForce(id: Id) {
  const f = get().forces[id];
  if (!f) return;
  const used = forceUsage(id);
  await flushSave('forces', id);
  historyStep(`удаление сил «${f.name}»`);
  record('forces', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.forces;
    return { forces: rest };
  });
  for (const sc of used) updateScenario(sc.id, (d) => d.sides.forEach((sd) => (sd.units = (sd.units ?? []).filter((u) => u.forceId !== id))));
  toastUndoable(`Силы «${f.name}» удалены${used.length ? ` и убраны из сценариев (${used.length})` : ''}.`);
  await storage.remove('forces', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `force:${id}`);
}

// ------------------------------------------------------------------ передача частей между подразделениями

/** Передача или возврат частей: силы и ссылки сценариев меняются одним шагом (Ctrl+Z отменяет). */
function applyForcesPatch(patch: ForcesPatch, label: string) {
  historyStep(label);
  const now = new Date().toISOString();
  for (const [id, f] of Object.entries(patch)) record('forces', id, f ? (get().forces[id] ? 'edit' : 'add') : 'delete');
  set((s) => {
    const forces = { ...s.forces };
    for (const [id, f] of Object.entries(patch)) {
      if (f) forces[id] = { ...f, updatedAt: now };
      else delete forces[id];
    }
    return { forces };
  });
  for (const [id, f] of Object.entries(patch)) {
    if (f) scheduleSave('forces', id, () => get().forces[id], 0);
    else void storage.remove('forces', id);
  }
  // Сценарии ссылаются на части по месту: перенесённая часть ищется там, где она теперь.
  for (const sc of Object.values(get().scenarios)) {
    const re = relinkScenario(sc, get().forces);
    if (re) updateScenario(sc.id, (d) => void (d.sides = re.sides));
  }
  closeTabsWhere((t) => !tabExists(t));
}

/** Временно передать часть сил (или силы целиком) в другое подразделение. Возвращает силы, куда передано. */
export function transferPart(nodeId: Id, targetId: Id): Id | null {
  const forces = get().forces;
  const what = locateNode(forces, nodeId)?.node;
  const to = locateNode(forces, targetId);
  const p = transferUnit(forces, nodeId, targetId);
  if (typeof p === 'string' || !what || !to) {
    toast(typeof p === 'string' ? p : 'Подразделение не найдено.', 'bad');
    return null;
  }
  applyForcesPatch(p, `передача «${what.name}» в «${to.node.name}»`);
  toastUndoable(`«${what.name}» передано в «${to.node.name}». Вернуть — «Вернуть…» в меню подразделения.`);
  return to.force.id;
}

/** Вернуть переданную часть на прежнее место. Возвращает силы, куда вернулась часть. */
export function returnPart(nodeId: Id): Id | null {
  const forces = get().forces;
  const what = locateNode(forces, nodeId)?.node;
  const p = returnUnit(forces, nodeId);
  if (typeof p === 'string' || !what?.transfer) {
    toast(typeof p === 'string' ? p : 'Подразделение не найдено.', 'bad');
    return null;
  }
  applyForcesPatch(p, `возврат «${what.name}»`);
  const home = locateNode(get().forces, nodeId)?.force;
  toastUndoable(home?.id === nodeId ? `«${what.name}» снова самостоятельные силы.` : `«${what.name}» возвращено в «${what.transfer.fromName}».`);
  return home?.id ?? null;
}

/** Сценарий, готовый к бою: стороны собраны из текущих сил. */
export function scenarioForBattle(sc: Scenario): Scenario {
  return resolveScenario(sc, get().forces);
}

// ------------------------------------------------------------------ сценарии

export function updateScenario(id: Id, fn: (s: Scenario) => void) {
  if (get().scenarios[id]) record('scenarios', id, 'edit');
  set((s) => {
    if (!s.scenarios[id]) return {};
    const next = produce(s.scenarios[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { scenarios: { ...s.scenarios, [id]: next } };
  });
  scheduleSave('scenarios', id, () => get().scenarios[id]);
}

export function addScenario(sc: Scenario, open = true): Id {
  record('scenarios', sc.id, 'add');
  set((s) => ({ scenarios: { ...s.scenarios, [sc.id]: sc } }));
  scheduleSave('scenarios', sc.id, () => get().scenarios[sc.id], 0);
  if (open) openTab('scenario', sc.id);
  return sc.id;
}

export function createScenario(rulesetId?: Id): Id {
  const s = get();
  const rs = s.rulesets[rulesetId ?? defaultRulesetId() ?? ''] ?? Object.values(s.rulesets)[0];
  const sc = newScenario(rs, 'Новый сценарий', randomSeed());
  // Стороны нового сценария ссылаются на силы.
  sc.sides.forEach((sd) => (sd.units = []));
  return addScenario(sc);
}

export function duplicateScenario(id: Id): Id | undefined {
  const sc = get().scenarios[id];
  if (!sc) return;
  const c = clone(sc);
  c.id = newId('sc');
  c.name = `${sc.name} (копия)`;
  return addScenario(c);
}

export async function deleteScenario(id: Id) {
  const sc = get().scenarios[id];
  if (!sc) return;
  await flushSave('scenarios', id);
  record('scenarios', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.scenarios;
    return { scenarios: rest };
  });
  toastUndoable(`Сценарий «${sc.name}» удалён (он в корзине). Бои по нему остались.`);
  await storage.remove('scenarios', id);
  closeTabsWhere((t) => ((t.kind === 'scenario' || t.kind === 'montecarlo') && t.ref === id) || (t.kind === 'formation' && !!t.ref?.startsWith(`sc:${id}:`)));
}

// ------------------------------------------------------------------ бои (живые объекты, без immer)
