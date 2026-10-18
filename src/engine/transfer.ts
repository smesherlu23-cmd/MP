// Перенос между наборами правил: копирование типов, приказов, условий, правил и эффектов из другого
// набора; сопоставление типов состава, когда шаблон или силы переходят на другой набор правил.

import { clone } from './defaults';
import type { ComponentType, Id, Ruleset, UnitNode } from './types';
import { walkUnits } from './units';

export type TransferKind = 'componentTypes' | 'orders' | 'conditions' | 'fortifications' | 'intelLevels' | 'modifiers' | 'tempEffects';

export const TRANSFER_LABELS: Record<TransferKind, string> = {
  componentTypes: 'Типы (каталог)',
  orders: 'Приказы',
  conditions: 'Условия боя',
  fortifications: 'Укрепления',
  intelLevels: 'Разведданные',
  modifiers: 'Свои правила',
  tempEffects: 'Временные эффекты',
};

export const TRANSFER_KINDS = Object.keys(TRANSFER_LABELS) as TransferKind[];

export interface TransferResult {
  ruleset: Ruleset;
  added: number;
  replaced: number;
  notes: string[];
}

/** Огневая мощь типа на дистанциях другого набора: та же дистанция по id, иначе — по порядку (от дальней к ближней). */
function remapFirepower(t: ComponentType, from: Ruleset, to: Ruleset, notes: Set<string>): ComponentType['firepower'] {
  const out: ComponentType['firepower'] = {};
  const ns = from.rangeBands.length;
  const nt = to.rangeBands.length;
  for (const [cls, row] of Object.entries(t.firepower)) {
    out[cls] = {};
    to.rangeBands.forEach((band, j) => {
      let src = from.rangeBands.find((x) => x.id === band.id);
      if (!src && ns) {
        src = from.rangeBands[Math.round((j * (ns - 1)) / Math.max(1, nt - 1))];
        notes.add('Дистанции наборов различаются — огневая мощь перенесена по порядку дистанций (от дальней к ближней); проверьте её в каталоге.');
      }
      out[cls][band.id] = src ? (row[src.id] ?? 0) : 0;
    });
  }
  return out;
}

/** Скопировать выбранное из набора source в копию target. Одинаковые id заменяются, новые добавляются. */
export function transferFromRuleset(target: Ruleset, source: Ruleset, sel: Partial<Record<TransferKind, Id[]>>): TransferResult {
  const rs = clone(target);
  const notes = new Set<string>();
  let added = 0;
  let replaced = 0;
  const put = <T extends { id: Id }>(list: T[], item: T) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      list[i] = item;
      replaced++;
    } else {
      list.push(item);
      added++;
    }
  };
  for (const id of sel.componentTypes ?? []) {
    const t = source.componentTypes.find((x) => x.id === id);
    if (!t) continue;
    const copy = clone(t);
    // Классы целей, которых нет в наборе, переносятся вместе с типом.
    const classes = new Set([copy.targetClass, ...Object.keys(copy.firepower)]);
    for (const cls of classes) {
      if (rs.targetClasses.some((x) => x.id === cls)) continue;
      const c = source.targetClasses.find((x) => x.id === cls);
      if (!c) continue;
      rs.targetClasses.push(clone(c));
      notes.add(`Добавлен класс целей «${c.name}».`);
    }
    copy.firepower = remapFirepower(copy, source, rs, notes);
    put(rs.componentTypes, copy);
  }
  for (const id of sel.orders ?? []) {
    const o = source.orders.find((x) => x.id === id);
    if (o) put(rs.orders, clone(o));
  }
  for (const id of sel.conditions ?? []) {
    const c = source.conditions.find((x) => x.id === id);
    if (c) put(rs.conditions, clone(c));
  }
  for (const id of sel.fortifications ?? []) {
    const o = source.fortifications.find((x) => x.id === id);
    if (o) put(rs.fortifications, clone(o));
  }
  for (const id of sel.intelLevels ?? []) {
    const o = source.intelLevels.find((x) => x.id === id);
    if (o) put(rs.intelLevels, clone(o));
  }
  for (const id of sel.tempEffects ?? []) {
    const o = source.tempEffects?.find((x) => x.id === id);
    if (o) put((rs.tempEffects ??= []), clone(o));
  }
  for (const id of sel.modifiers ?? []) {
    const m = source.modifiers.find((x) => x.id === id);
    if (!m) continue;
    put(rs.modifiers, clone(m));
    // Правило может ссылаться на то, чего в наборе нет: приказ, класс цели, категорию условий.
    for (const w of m.when) {
      const vals = Array.isArray(w.value) ? w.value.map(String) : [String(w.value)];
      const f = w.field.replace(/^enemy\./, '');
      const missing =
        (f === 'order' && vals.some((v) => !rs.orders.some((o) => o.id === v))) ||
        (w.field === 'targetClass' && vals.some((v) => !rs.targetClasses.some((c) => c.id === v))) ||
        (w.field.startsWith('cond.') && !rs.conditions.some((c) => c.id === w.field.slice(5))) ||
        (w.field === 'range' && vals.some((v) => !rs.rangeBands.some((b) => b.id === v)));
      if (missing) notes.add(`Правило «${m.name}» ссылается на то, чего нет в наборе (приказ, класс цели, дистанция или условие) — проверьте его условия.`);
    }
  }
  rs.updatedAt = new Date().toISOString();
  return { ruleset: rs, added, replaced, notes: [...notes] };
}

// ------------------------------------------------------------------ сопоставление типов

/** Типы, которые встречаются в составе подразделения. */
export function usedTypeIds(root: UnitNode): Id[] {
  const ids = new Set<Id>();
  walkUnits(root, (n) => n.composition.forEach((c) => ids.add(c.typeId)));
  return [...ids];
}

/**
 * Предложить соответствие типов при переходе на набор to: тот же id, иначе тип с тем же названием,
 * иначе — null (сопоставить вручную, добавить тип в набор или убрать из состава).
 */
export function suggestTypeMap(ids: Id[], from: Ruleset | undefined, to: Ruleset): Record<Id, Id | null> {
  const out: Record<Id, Id | null> = {};
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');
  for (const id of ids) {
    if (to.componentTypes.some((t) => t.id === id)) {
      out[id] = id;
      continue;
    }
    const name = from?.componentTypes.find((t) => t.id === id)?.name;
    const same = name ? to.componentTypes.find((t) => norm(t.name) === norm(name)) : undefined;
    out[id] = same?.id ?? null;
  }
  return out;
}

/** Заменить типы в составе по соответствию (null — убрать); одинаковые после замены — складываются. */
export function remapTypes(root: UnitNode, map: Record<Id, Id | null>): void {
  walkUnits(root, (n) => {
    const merged = new Map<Id, (typeof n.composition)[number]>();
    for (const c of n.composition) {
      const to = c.typeId in map ? map[c.typeId] : c.typeId;
      if (!to) continue;
      const prev = merged.get(to);
      if (prev) {
        prev.authorized += c.authorized;
        prev.current += c.current;
        if (c.recoverable) prev.recoverable = (prev.recoverable ?? 0) + c.recoverable;
      } else merged.set(to, { ...c, typeId: to });
    }
    n.composition = [...merged.values()];
  });
}
