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
  type UnitNode,
  type Id,
  type Scenario,
} from '../../engine';
import { storage } from '../storage';
import { chooseDialog, closeTabsWhere, confirmDialog, flushSave, get, historyStep, openTab, record, scheduleSave, set, toastUndoable } from './core';
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
    [
      ...list.map((t) => ({ value: t.id, label: `${t.level ? `${t.level} · ` : ''}${t.name}` })),
      { value: '', label: 'Пустое подразделение (собрать вручную)' },
    ],
    'Силы — конкретное подразделение: по шаблону берётся устройство и штат, а состояние и потери у каждого свои. Шаблон потом можно менять — силы обновятся по нему, сохранив потери.',
  );
  if (v === null) return;
  if (v) return createForcesFromTemplate(v, { faction })[0];
  return addForce(newRootUnit('Новое подразделение', { rulesetId: defaultRulesetId(), level: '', faction }));
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
  const text = used.length ? `Оно участвует в сценариях: ${used.map((x) => `«${x.name}»`).join(', ')} — там его не станет.` : undefined;
  if (!(await confirmDialog(`Удалить силы «${f.name}»?`, text, 'Удалить', true))) return;
  await flushSave('forces', id);
  historyStep(`удаление сил «${f.name}»`);
  record('forces', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.forces;
    return { forces: rest };
  });
  for (const sc of used) updateScenario(sc.id, (d) => d.sides.forEach((sd) => (sd.units = (sd.units ?? []).filter((u) => u.forceId !== id))));
  toastUndoable(`Силы «${f.name}» удалены (они в корзине).`);
  await storage.remove('forces', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `force:${id}`);
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
  if (!(await confirmDialog(`Удалить сценарий «${sc.name}»?`, 'Сохранённые бои по нему останутся.', 'Удалить', true))) return;
  await flushSave('scenarios', id);
  record('scenarios', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.scenarios;
    return { scenarios: rest };
  });
  toastUndoable(`Сценарий «${sc.name}» удалён (он в корзине).`);
  await storage.remove('scenarios', id);
  closeTabsWhere((t) => ((t.kind === 'scenario' || t.kind === 'montecarlo') && t.ref === id) || (t.kind === 'formation' && !!t.ref?.startsWith(`sc:${id}:`)));
}

// ------------------------------------------------------------------ бои (живые объекты, без immer)
