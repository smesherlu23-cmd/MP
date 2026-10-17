// Различимые названия: в большом бою «2-й взвод» встречается десятки раз. Там, где имя
// повторяется в пределах стороны, к нему добавляются старшие формирования — «2-й взвод · 3-я рота»,
// при необходимости «· 1-й батальон» — ровно столько, сколько нужно, чтобы различить.
// Стороны различаются цветом, поэтому одинаковые имена у разных сторон не уточняются.

import type { Battle, Id } from './types';

export interface DisplayNames {
  el: Map<Id, string>;
  f: Map<Id, string>;
}

const cache = new WeakMap<Battle, { n: number; names: DisplayNames }>();

/** Однозначные названия элементов и формирований боя (кешируются для боя). */
export function displayNames(b: Battle): DisplayNames {
  const key = b.elements.length * 1000 + b.formations.length;
  const hit = cache.get(b);
  if (hit && hit.n === key) return hit.names;
  const fById = new Map(b.formations.map((f) => [f.id, f]));
  /** Цепочка старших формирований (ближайшее — первое). */
  const chainOf = (fid: Id | null): string[] => {
    const out: string[] = [];
    for (let f = fid ? fById.get(fid) : undefined; f; f = f.parentId ? fById.get(f.parentId) : undefined) out.push(f.name);
    return out;
  };
  const unique = (items: { id: Id; side: string; name: string; chain: string[] }[]): Map<Id, string> => {
    const out = new Map<Id, string>();
    const byName = new Map<string, typeof items>();
    for (const x of items) byName.set(`${x.side}|${x.name}`, [...(byName.get(`${x.side}|${x.name}`) ?? []), x]);
    for (const group of byName.values()) {
      const name = group[0].name;
      if (group.length === 1) {
        out.set(group[0].id, name);
        continue;
      }
      // Добавляем старших по одному, пока подписи в группе не станут разными (или цепочка не кончится).
      const depth = Math.max(...group.map((x) => x.chain.length));
      let d = 1;
      for (; d <= depth; d++) {
        const labels = group.map((x) => x.chain.slice(0, d).join(' · '));
        if (new Set(labels).size === group.length) break;
      }
      for (const x of group) {
        const ctx = x.chain.slice(0, Math.min(d, x.chain.length)).filter((c) => !name.startsWith(c));
        out.set(x.id, ctx.length ? `${name} · ${ctx.join(' · ')}` : name);
      }
    }
    return out;
  };
  const names: DisplayNames = {
    el: unique(b.elements.map((e) => ({ id: e.id, side: e.side, name: e.name, chain: chainOf(e.formationId) }))),
    f: unique(b.formations.map((f) => ({ id: f.id, side: f.side, name: f.name, chain: chainOf(f.parentId) }))),
  };
  cache.set(b, { n: key, names });
  return names;
}
