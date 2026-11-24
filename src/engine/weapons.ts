// Вооружение типов единиц: урон по классам целей (мин.–макс.), точность по дистанциям, свой боезапас.
// Типы без списка вооружения (наборы и бои прежних версий) стреляют по таблице огневой мощи.

import { newId } from './ids';
import type { ComponentType, ElementState, Id, Ruleset, Weapon, WeaponType } from './types';

/** Тип стреляет по списку вооружения (а не по таблице прежних версий). */
export const usesWeapons = (t: ComponentType): t is ComponentType & { weapons: Weapon[] } => Array.isArray(t.weapons);

export const weaponTypeMap = (rs: Pick<Ruleset, 'weaponTypes'>) => new Map((rs.weaponTypes ?? []).map((w) => [w.id, w]));

/** Точность вида вооружения на дистанции (нет вида или значения — 100%). */
export function accuracyAt(wt: WeaponType | undefined, band: Id): number {
  const v = wt?.accuracy?.[band];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 1;
}

export const meanDamage = (w: Weapon, cls: Id) => {
  const d = w.damage[cls];
  return d ? (Math.max(0, d[0]) + Math.max(0, d[1])) / 2 : 0;
};

export const maxDamage = (w: Weapon, cls: Id) => Math.max(0, ...(w.damage[cls] ?? [0, 0]));

/** Урон за ход при броске u (0..1) между мин. и макс. */
export function rollDamage(w: Weapon, cls: Id, u: number): number {
  const d = w.damage[cls];
  if (!d) return 0;
  const lo = Math.max(0, Math.min(d[0], d[1]));
  const hi = Math.max(0, d[0], d[1]);
  return lo + (hi - lo) * u;
}

/** Ожидаемый огонь одной единицы типа по классу цели на дистанции (для сводок, подсказок и ударов). */
export function typeFire(rs: Pick<Ruleset, 'weaponTypes'>, t: ComponentType, cls: Id, band: Id, wts = weaponTypeMap(rs)): number {
  if (!usesWeapons(t)) return t.firepower?.[cls]?.[band] ?? 0;
  let v = 0;
  for (const w of t.weapons) v += meanDamage(w, cls) * accuracyAt(wts.get(w.weaponType), band);
  return v;
}

/** Есть ли у типа огонь хоть по кому-то. */
export function typeArmed(t: ComponentType): boolean {
  if (usesWeapons(t)) return t.weapons.some((w) => Object.values(w.damage).some((d) => d[0] > 0 || d[1] > 0));
  return Object.values(t.firepower ?? {}).some((row) => Object.values(row).some((v) => v > 0));
}

// ------------------------------------------------------------------ боезапас по видам вооружения

/** Боезапас вида вооружения у элемента, %: свой запас или (пока его не расходовали) общий. */
export const poolAmmo = (el: ElementState, wt: Id) => el.ammoBy?.[wt] ?? el.ammo;

/** Множитель огня при боезапасе (вид без боезапаса — 1; ниже порога — падает до нуля). */
export function weaponAmmoFactor(wt: WeaponType | undefined, ammo: number, lowThreshold: number): number {
  if (wt && !wt.ammo) return 1;
  if (ammo >= lowThreshold) return 1;
  return Math.max(0, Math.min(1, ammo / Math.max(1, lowThreshold)));
}

/** Изменить весь боезапас элемента (подвоз, решение ГМ): общий и каждого вида. */
export function addAmmo(el: ElementState, delta: number) {
  el.ammo = Math.max(0, Math.min(100, el.ammo + delta));
  if (el.ammoBy) for (const k of Object.keys(el.ammoBy)) el.ammoBy[k] = Math.max(0, Math.min(100, el.ammoBy[k] + delta));
}

/** Задать весь боезапас элемента. */
export function setAmmo(el: ElementState, value: number) {
  el.ammo = Math.max(0, Math.min(100, value));
  if (el.ammoBy) for (const k of Object.keys(el.ammoBy)) el.ammoBy[k] = el.ammo;
}

/**
 * Боезапас элемента по видам, %: [вид вооружения или '' — общий] → { запас, вес }. Вес — число стволов в
 * строю. Виды без боезапаса (холодное оружие) не входят.
 */
export function ammoPools(el: ElementState, type: (id: Id) => ComponentType | undefined, wts: Map<Id, WeaponType>): Map<Id, { ammo: number; weight: number }> {
  const out = new Map<Id, { ammo: number; weight: number }>();
  const add = (key: Id, ammo: number, w: number) => {
    const p = out.get(key) ?? { ammo, weight: 0 };
    p.weight += w;
    out.set(key, p);
  };
  for (const c of el.comps) {
    if (c.current <= 0) continue;
    const t = type(c.typeId);
    if (!t) continue;
    if (!usesWeapons(t)) {
      if (typeArmed(t)) add('', el.ammo, c.current);
      continue;
    }
    for (const w of t.weapons) {
      const wt = wts.get(w.weaponType);
      if (wt && !wt.ammo) continue;
      if (!(w.ammoUse > 0)) continue;
      add(w.weaponType, poolAmmo(el, w.weaponType), c.current);
    }
  }
  return out;
}

/** Боезапас элемента в целом, %: у элемента без вооружения по видам — общий; иначе — средний по видам (по числу стволов). */
export function ammoLevel(el: ElementState, type: (id: Id) => ComponentType | undefined, wts: Map<Id, WeaponType>): number {
  if (!el.ammoBy && !el.comps.some((c) => c.current > 0 && type(c.typeId)?.weapons)) return el.ammo;
  const pools = ammoPools(el, type, wts);
  let s = 0;
  let w = 0;
  for (const p of pools.values()) {
    s += p.ammo * p.weight;
    w += p.weight;
  }
  return w > 0 ? s / w : el.ammo;
}

// ------------------------------------------------------------------ переход с таблицы огневой мощи

/**
 * Перевести типы набора с таблицы огневой мощи (класс × дистанция) на вооружение. Для каждого типа — одно
 * вооружение: урон по классу — наибольший по дистанциям (мин. = макс.), влияние дистанции — точность вида
 * вооружения (средняя доля по классам). Типы с одинаковой точностью получают общий вид вооружения.
 * Ожидаемый огонь на «своей» дистанции сохраняется, на остальных — близок к прежнему.
 */
export function convertToWeapons(rs: Ruleset, names: Record<Id, string> = {}): number {
  const bands = rs.rangeBands.map((b) => b.id);
  rs.weaponTypes ??= [];
  let n = 0;
  for (const t of rs.componentTypes) {
    if (usesWeapons(t)) continue;
    const damage: Weapon['damage'] = {};
    const shares: number[][] = [];
    for (const [cls, row] of Object.entries(t.firepower ?? {})) {
      const vals = bands.map((b) => Math.max(0, row?.[b] ?? 0));
      const m = Math.max(0, ...vals);
      if (m <= 0) continue;
      damage[cls] = [m, m];
      shares.push(vals.map((v) => v / m));
    }
    n++;
    if (!shares.length) {
      t.weapons = [];
      t.firepower = {};
      continue;
    }
    const acc = bands.map((_, i) => Math.round((shares.reduce((a, s) => a + s[i], 0) / shares.length) * 100) / 100);
    const accuracy = Object.fromEntries(bands.map((b, i) => [b, acc[i]]));
    const same = rs.weaponTypes.find((w) => bands.every((b) => accuracyAt(w, b) === accuracy[b]) && w.ammo === t.ammoUse > 0);
    const wt = same ?? { id: newId('wpn'), name: names[t.id] ?? `Оружие: ${t.name}`, accuracy, ammo: t.ammoUse > 0 };
    if (!same) rs.weaponTypes.push(wt);
    t.weapons = [{ weaponType: wt.id, damage, ammoUse: t.ammoUse }];
    t.firepower = {};
  }
  return n;
}
