// Вооружение типов: урон мин.–макс., точность по дистанциям, боезапас по видам вооружения, переход с таблицы.

import { describe, expect, it } from 'vitest';
import {
  EngineContext,
  ammoLevel,
  clone,
  convertToWeapons,
  createBattle,
  makeUniversalRuleset,
  newRootUnit,
  newScenario,
  newUnit,
  normalizeRuleset,
  rollDamage,
  stepTurn,
  typeFire,
  weaponTypeMap,
  type Ruleset,
  type UnitNode,
} from '../src/engine';

const unit = (name: string, order: string, comp: { typeId: string; n: number }[]): UnitNode =>
  newRootUnit(name, { order, children: [newUnit(name, { composition: comp.map((c) => ({ typeId: c.typeId, authorized: c.n, current: c.n })) })] });

function battle(rs: Ruleset, a: UnitNode, b: UnitNode, band = 'close', seed = 'W') {
  const sc = newScenario(rs, 'Тест', seed);
  sc.sides[0].formations = [a];
  sc.sides[1].formations = [b];
  sc.startBand = band;
  sc.hours = 4;
  return createBattle(sc, rs, { seed });
}

/** Стрелки с гранатомётом: у гранатомёта свой боезапас и большой расход. */
function withRpg(): Ruleset {
  const rs = makeUniversalRuleset();
  rs.weaponTypes!.push({ id: 'w-rpg', name: 'Гранатомёт', accuracy: { long: 0, medium: 0.5, close: 1 }, ammo: true });
  const rifle = rs.componentTypes.find((t) => t.id === 'rifleman')!;
  rifle.weapons!.push({ weaponType: 'w-rpg', damage: { armor: [0.02, 0.03] }, ammoUse: 40 });
  rs.features.ammo = true;
  rs.coefficients.resupplyAmmo = 0;
  return rs;
}

describe('вооружение', () => {
  it('боезапас по видам: гранатомёт кончился — автоматы стреляют дальше', () => {
    const rs = withRpg();
    const b = battle(rs, unit('Пехота', 'defend', [{ typeId: 'rifleman', n: 30 }]), unit('Танки', 'attack', [{ typeId: 'tank', n: 3 }]));
    for (let i = 0; i < 4 && !b.finished; i++) stepTurn(b);
    const inf = b.elements.find((x) => x.side === 'A')!;
    expect(inf.ammoBy?.['w-rpg']).toBe(0);
    expect(inf.ammoBy?.['w-rifle']).toBeGreaterThan(50);
    // Общий боезапас — средний по видам, не ноль: элемент не считается «без боезапаса».
    const E = new EngineContext(b);
    expect(E.ammo(inf)).toBeGreaterThan(20);
    expect(E.ammo(inf)).toBeLessThan(inf.ammoBy!['w-rifle']);
  });

  it('точность 0 на дистанции — оружие на ней не стреляет; урон — между мин. и макс.', () => {
    const rs = makeUniversalRuleset();
    const wts = weaponTypeMap(rs);
    const rifle = rs.componentTypes.find((t) => t.id === 'rifleman')!;
    expect(typeFire(rs, rifle, 'inf', 'close', wts)).toBeCloseTo(0.1);
    expect(typeFire(rs, rifle, 'inf', 'long', wts)).toBeCloseTo(0.01);
    const w = rifle.weapons![0];
    expect(rollDamage(w, 'inf', 0)).toBeCloseTo(0.08);
    expect(rollDamage(w, 'inf', 1)).toBeCloseTo(0.12);
    wts.get('w-rifle')!.accuracy.long = 0;
    expect(typeFire(rs, rifle, 'inf', 'long', wts)).toBe(0);
  });

  it('у танка два вида вооружения: пушка и пулемёт складываются', () => {
    const rs = makeUniversalRuleset();
    const tank = rs.componentTypes.find((t) => t.id === 'tank')!;
    expect(tank.weapons!.map((w) => w.weaponType)).toEqual(['w-tankgun', 'w-mg']);
    expect(typeFire(rs, tank, 'inf', 'close')).toBeCloseTo(0.4 + 0.5);
  });

  it('набор прежней версии: таблица огневой мощи переводится на вооружение без потери огня на «своей» дистанции', () => {
    const old = makeUniversalRuleset();
    delete old.weaponTypes;
    for (const t of old.componentTypes) {
      // Таблица по дистанциям — из среднего огня вооружения (как было до перехода).
      t.firepower = Object.fromEntries(
        old.targetClasses.map((c) => [c.id, Object.fromEntries(old.rangeBands.map((b) => [b.id, typeFire(makeUniversalRuleset(), t, c.id, b.id)]))]),
      );
      delete t.weapons;
    }
    const legacy = clone(old);
    const n = convertToWeapons(old);
    expect(n).toBe(old.componentTypes.length);
    for (const t of old.componentTypes)
      for (const c of old.targetClasses) {
        const row = legacy.componentTypes.find((x) => x.id === t.id)!.firepower[c.id];
        const best = Math.max(...old.rangeBands.map((b) => row[b.id]));
        const now = Math.max(...old.rangeBands.map((b) => typeFire(old, t, c.id, b.id)));
        expect(now).toBeCloseTo(best, 5);
      }
    // Тип, у которого огонь по дистанциям падает одинаково, сохраняет его точно.
    const rifle = old.componentTypes.find((t) => t.id === 'rifleman')!;
    for (const b of old.rangeBands) expect(typeFire(old, rifle, 'inf', b.id)).toBeCloseTo(legacy.componentTypes[0].firepower.inf[b.id], 2);
  });

  it('бой с типами прежней версии (без вооружения) идёт по таблице и тратит общий боезапас', () => {
    const rs = normalizeRuleset(makeUniversalRuleset());
    for (const t of rs.componentTypes) {
      t.firepower = Object.fromEntries(rs.targetClasses.map((c) => [c.id, Object.fromEntries(rs.rangeBands.map((b) => [b.id, typeFire(rs, t, c.id, b.id)]))]));
      delete t.weapons;
    }
    rs.weaponTypes = [];
    const b = battle(rs, unit('А', 'defend', [{ typeId: 'rifleman', n: 30 }]), unit('Б', 'defend', [{ typeId: 'rifleman', n: 30 }]));
    stepTurn(b);
    stepTurn(b);
    const el = b.elements[0];
    expect(el.ammoBy).toBeUndefined();
    expect(el.ammo).toBeLessThan(100);
    expect(ammoLevel(el, (id) => rs.componentTypes.find((t) => t.id === id), new Map())).toBe(el.ammo);
    expect(b.elements.some((x) => x.comps.some((c) => c.current < c.start))).toBe(true);
  });
});
