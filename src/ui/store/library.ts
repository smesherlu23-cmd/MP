// Наборы правил и шаблоны: правка, создание, удаление; копии шаблонов и их обновление.

import { produce } from 'immer';
import {
  clone,
  cloneUnit,
  findUnit,
  instantiate,
  isOutdated,
  makeBlankRuleset,
  newRootUnit,
  updateFromTemplate,
  walkUnits,
  newId,
  normalizeRuleset,
  type UnitNode,
  type Id,
  type Ruleset,
} from '../../engine';
import { storage } from '../storage';
import { chooseDialog, closeTabsWhere, confirmDialog, flushSave, get, openTab, record, scheduleSave, set, toast, toastUndoable } from './core';
import { updateForce } from './forces';
import { useBattles } from './battles';

export function updateRuleset(id: Id, fn: (r: Ruleset) => void) {
  if (get().rulesets[id]) record('rulesets', id, 'edit');
  set((s) => {
    if (!s.rulesets[id]) return {};
    const next = produce(s.rulesets[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { rulesets: { ...s.rulesets, [id]: next } };
  });
  scheduleSave('rulesets', id, () => get().rulesets[id]);
}

export function replaceRuleset(r: Ruleset) {
  const n = normalizeRuleset(r);
  record('rulesets', n.id, get().rulesets[n.id] ? 'edit' : 'add');
  set((s) => ({ rulesets: { ...s.rulesets, [n.id]: n } }));
  scheduleSave('rulesets', n.id, () => get().rulesets[n.id], 0);
}

export function createRuleset(from?: Id): Id {
  const src = from ? get().rulesets[from] : undefined;
  const r = src ? { ...clone(src), id: newId('rs'), name: `${src.name.replace(/ \(пример\)$/, '')} (копия)`, updatedAt: undefined } : makeBlankRuleset();
  replaceRuleset(r);
  openTab('ruleset', r.id);
  return r.id;
}

/** Новый набор правил: на основе существующего (по умолчанию — того, с которым работают) или пустой. */
export async function newRulesetDialog(): Promise<Id | undefined> {
  const s = get();
  const def = defaultRulesetId();
  const list = Object.values(s.rulesets).sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : a.name.localeCompare(b.name, 'ru')));
  const v = await chooseDialog(
    'Новый набор правил — на основе чего?',
    [
      ...list.map((r) => ({ value: r.id, label: `На основе «${r.name}»${r.era ? ` — ${r.era}` : ''}` })),
      { value: '', label: 'Пустой: каталог типов с нуля, остальное — по умолчанию' },
    ],
    'Проще всего взять похожий набор и поменять в нём нужное: типы и их огневую мощь, приказы, условия, коэффициенты. Исходный набор не изменится.',
  );
  if (v === null) return;
  return createRuleset(v || undefined);
}

export async function deleteRuleset(id: Id) {
  const s = get();
  const r = s.rulesets[id];
  if (!r) return;
  if (Object.keys(s.rulesets).length <= 1) {
    toast('Нельзя удалить единственный набор правил.', 'bad');
    return;
  }
  // Подтверждение — только когда набор нужен сценариям; иначе удаление сразу, с «Отменить» в уведомлении.
  const users = Object.values(s.scenarios).filter((x) => x.rulesetId === id).length;
  if (
    users &&
    !(await confirmDialog(`Удалить набор правил «${r.name}»?`, `Его используют сценарии: ${users}. Их придётся перевести на другой набор.`, 'Удалить', true))
  )
    return;
  await flushSave('rulesets', id);
  record('rulesets', id, 'delete');
  set((st) => {
    const { [id]: _, ...rest } = st.rulesets;
    return { rulesets: rest };
  });
  toastUndoable(`Набор правил «${r.name}» удалён (он в корзине).`);
  await storage.remove('rulesets', id);
  closeTabsWhere((t) => t.kind === 'ruleset' && t.ref === id);
}

// ------------------------------------------------------------------ подразделения

/** Ссылка вкладки конструктора: «lib:id» — шаблон, «force:id» — силы. */
export function resolveFormation(ref: string): { f: UnitNode; rulesetId?: Id; kind: 'template' | 'force' } | null {
  const s = get();
  const [scope, a] = ref.split(':');
  if (scope === 'lib') {
    const f = s.formations[a];
    return f ? { f, rulesetId: f.rulesetId, kind: 'template' } : null;
  }
  if (scope === 'force') {
    const f = s.forces[a];
    return f ? { f, rulesetId: f.rulesetId, kind: 'force' } : null;
  }
  return null;
}

export function updateFormationRef(ref: string, fn: (f: UnitNode) => void) {
  const [scope, a] = ref.split(':');
  if (scope === 'lib') return updateFormation(a, fn);
  if (scope === 'force') return updateForce(a, fn);
}

export function updateFormation(id: Id, fn: (f: UnitNode) => void) {
  if (get().formations[id]) record('formations', id, 'edit');
  set((s) => {
    if (!s.formations[id]) return {};
    const next = produce(s.formations[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { formations: { ...s.formations, [id]: next } };
  });
  scheduleSave('formations', id, () => get().formations[id]);
}

export function addFormation(f: UnitNode, open = true): Id {
  record('formations', f.id, 'add');
  set((s) => ({ formations: { ...s.formations, [f.id]: f } }));
  scheduleSave('formations', f.id, () => get().formations[f.id], 0);
  if (open) openTab('formation', `lib:${f.id}`);
  return f.id;
}

/**
 * Набор правил для нового подразделения или сценария: тот, с которым сейчас работают
 * (открытая вкладка), иначе — самый используемый, иначе — последний изменённый.
 */
export function defaultRulesetId(): Id | undefined {
  const s = get();
  const t = s.tabs.find((x) => x.key === s.active);
  let ctx: Id | undefined;
  if (t?.kind === 'ruleset') ctx = t.ref;
  else if (t?.kind === 'scenario' || t?.kind === 'montecarlo') ctx = s.scenarios[t.ref!]?.rulesetId;
  else if (t?.kind === 'formation') ctx = resolveFormation(t.ref!)?.rulesetId;
  else if (t?.kind === 'battle') ctx = useBattles.getState().battles[t.ref!]?.ruleset.id;
  if (ctx && s.rulesets[ctx]) return ctx;
  const used = new Map<Id, number>();
  for (const f of Object.values(s.formations)) if (f.rulesetId) used.set(f.rulesetId, (used.get(f.rulesetId) ?? 0) + 1);
  for (const sc of Object.values(s.scenarios)) used.set(sc.rulesetId, (used.get(sc.rulesetId) ?? 0) + 1);
  // При равенстве (например, сразу после установки примеров) — основной пример, «Универсальный».
  const main = (r: Ruleset) => (r.id === 'rs-universal' ? 0 : 1);
  return Object.values(s.rulesets).sort(
    (a, b) =>
      (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) ||
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
      main(a) - main(b) ||
      a.name.localeCompare(b.name, 'ru'),
  )[0]?.id;
}

export function createFormation(rulesetId?: Id): Id {
  return addFormation(newRootUnit('Новое подразделение', { rulesetId: rulesetId ?? defaultRulesetId() }));
}

export function duplicateFormation(id: Id): Id | undefined {
  const f = get().formations[id];
  if (!f) return;
  const c = cloneUnit(f);
  c.name = `${f.name} (копия)`;
  return addFormation(c);
}

export async function deleteFormation(id: Id) {
  const f = get().formations[id];
  if (!f) return;
  await flushSave('formations', id);
  record('formations', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.formations;
    return { formations: rest };
  });
  toastUndoable(`Шаблон «${f.name}» удалён (он в корзине). Силы по нему остались.`);
  await storage.remove('formations', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `lib:${id}`);
}

// ------------------------------------------------------------------ силы

/** Все копии шаблона: в других шаблонах и в силах. */
export function templateUsages(templateId: Id): { ref: string; owner: string; nodeId: Id; outdated: boolean }[] {
  const s = get();
  const tpl = s.formations[templateId];
  const out: { ref: string; owner: string; nodeId: Id; outdated: boolean }[] = [];
  const scan = (root: UnitNode, ref: string, owner: string) =>
    walkUnits(root, (n) => {
      if (n.templateId === templateId && n.id !== templateId) out.push({ ref, owner, nodeId: n.id, outdated: isOutdated(n, tpl) });
    });
  for (const f of Object.values(s.formations)) if (f.id !== templateId) scan(f, `lib:${f.id}`, f.name);
  for (const f of Object.values(s.forces)) scan(f, `force:${f.id}`, f.name);
  return out;
}

/** Обновить одну копию по её шаблону (на месте). */
export function updateCopy(ref: string, nodeId: Id) {
  updateFormationRef(ref, (root) => {
    const replace = (list: UnitNode[]): boolean => {
      const i = list.findIndex((x) => x.id === nodeId);
      if (i >= 0) {
        const tpl = get().formations[list[i].templateId ?? ''];
        if (tpl) list[i] = updateFromTemplate(JSON.parse(JSON.stringify(list[i])), tpl);
        return true;
      }
      return list.some((x) => replace(x.children));
    };
    if (root.id === nodeId) {
      const tpl = get().formations[root.templateId ?? ''];
      if (tpl) Object.assign(root, updateFromTemplate(JSON.parse(JSON.stringify(root)), tpl), { id: root.id });
    } else replace(root.children);
  });
}

/** Обновить все устаревшие копии шаблона. */
export function updateAllCopies(templateId: Id): number {
  const list = templateUsages(templateId).filter((u) => u.outdated);
  for (const u of list) updateCopy(u.ref, u.nodeId);
  if (list.length) toast(`Обновлено копий: ${list.length}.`, 'good');
  return list.length;
}

/** Копия шаблона для вставки. */
export function instantiateLibrary(id: Id, opts: { attachedFrom?: string; name?: string } = {}): UnitNode | null {
  const tpl = get().formations[id];
  return tpl ? instantiate(tpl, opts) : null;
}

/** Есть ли в дереве узел из этого шаблона (чтобы не вставить шаблон сам в себя). */
export function containsTemplate(root: UnitNode, templateId: Id): boolean {
  if (root.id === templateId) return true;
  let found = false;
  walkUnits(root, (n) => {
    if (n.templateId === templateId) found = true;
  });
  return found;
}

export { findUnit };
