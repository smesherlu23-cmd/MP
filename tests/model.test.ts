// Модель боя после разбора 2026-11: длина хода, правила на противника для морали, подставленность,
// резерв под огнём, отходящие, опыт, танки, расчёты, подавление; обновление данных прежних версий.
// Сиды фиксированы — результат повторяем; границы — с запасом.

import { describe, expect, it } from 'vitest';
import {
  clone,
  COEFFICIENT_DEFAULTS,
  createBattle,
  forecast,
  forecastRun,
  makeUniversalRuleset,
  newRootUnit,
  newScenario,
  newUnit,
  normalizeRuleset,
  recalibrateRuleset,
  ruleIssues,
  runMany,
  runSeed,
  runToEnd,
  stepTurn,
  upgradeExampleData,
  type CustomModifier,
  type Ruleset,
  type Scenario,
  type UnitNode,
} from '../src/engine';

const base = () => makeUniversalRuleset();

/** Рота из частей: стрелки и пулемёты (один на 30 человек), плюс отдельные части с тяжёлым оружием. */
function company(name: string, n: number, order: string, opts: { parts?: number; extra?: { typeId: string; n: number }[]; exp?: number } = {}): UnitNode {
  const parts = opts.parts ?? 3;
  const mgTotal = Math.round(n / 30);
  const children: UnitNode[] = [];
  for (let i = 0; i < parts; i++) {
    const rif = Math.round(n / parts);
    const mg = Math.floor(mgTotal / parts) + (i < mgTotal % parts ? 1 : 0);
    const comp = [{ typeId: 'rifleman', authorized: rif, current: rif }];
    if (mg) comp.push({ typeId: 'mg', authorized: mg, current: mg });
    children.push(newUnit(`${name} ${i + 1}`, { composition: comp }));
  }
  for (const x of opts.extra ?? []) children.push(newUnit(`${name} ${x.typeId}`, { composition: [{ typeId: x.typeId, authorized: x.n, current: x.n }] }));
  return newRootUnit(name, { order, children, ...(opts.exp ? { state: { experience: opts.exp } } : {}) });
}

function duel(rs: Ruleset, a: UnitNode, b: UnitNode, fort = 'hasty', hours = 4): Scenario {
  const sc = newScenario(rs, 'Тест', 'T');
  sc.sides[0].formations = [a];
  sc.sides[1].formations = [b];
  sc.sides[1].fortification = fort;
  sc.startBand = 'medium';
  sc.hours = hours;
  return sc;
}

const tanks = () => newRootUnit('Танки', { order: 'attack', children: [newUnit('Т', { composition: [{ typeId: 'tank', authorized: 10, current: 10 }] })] });
const lost = (b: ReturnType<typeof createBattle>, name: string) =>
  b.elements.filter((x) => x.name.startsWith(name)).reduce((s, el) => s + el.comps.reduce((a, c) => a + c.kia + c.wia + c.mia, 0), 0);

describe('длина хода', () => {
  it('исход почти не зависит от длины хода (темпы пересчитываются)', () => {
    const win: number[] = [];
    for (const tm of [5, 15, 60]) {
      const rs = base();
      rs.turnMinutes = tm;
      win.push(runMany(duel(rs, company('A', 180, 'attack'), company('B', 90, 'defend')), rs, 80, `T${tm}`).winA);
    }
    expect(Math.max(...win) - Math.min(...win)).toBeLessThan(25);
    expect(Math.min(...win)).toBeGreaterThan(30);
  });

  it('эталон 0 — пересчёта нет (как в прежних версиях)', () => {
    const rs = base();
    rs.turnMinutes = 60;
    rs.coefficients.turnRefMinutes = 0;
    const b = createBattle(duel(rs, company('A', 90, 'defend'), company('B', 90, 'defend')), rs, { seed: 'Z' });
    stepTurn(b);
    expect(b.log.some((e) => e.factors?.some((f) => f.label === 'Длина хода'))).toBe(false);
  });

  it('набор прежней версии: эталон — его собственная длина хода', () => {
    const rs = base();
    rs.turnMinutes = 30;
    delete rs.coefficients.turnRefMinutes;
    expect(normalizeRuleset(clone(rs)).coefficients.turnRefMinutes).toBe(30);
    expect(normalizeRuleset(clone(rs), true).coefficients.turnRefMinutes).toBe(0);
  });
});

describe('правила на противника и опыт', () => {
  it('правило «противник — техника» влияет на мораль', () => {
    const win = (on: number) => {
      const rs = base();
      rs.coefficients.moraleEnemyRules = on;
      rs.modifiers = rs.modifiers.filter((m) => m.id !== 'mod-tank-fear');
      rs.modifiers.push({ id: 'x', name: 'тест', enabled: true, when: [{ field: 'enemy.kind', op: 'has', value: 'vehicle' }], effects: { moraleLoss: 3 } });
      return runMany(duel(rs, tanks(), company('B', 90, 'defend')), rs, 80, 'R').winA;
    };
    const off = win(0);
    const on = win(1);
    expect(on, `${off} → ${on}`).toBeGreaterThan(off + 10);
  });

  it('танки против пехоты без ПТ-средств, как правило, побеждают', () => {
    const rs = base();
    expect(runMany(duel(rs, tanks(), company('B', 90, 'defend')), rs, 80, 'R').winA).toBeGreaterThan(55);
  });

  it('опыт весит меньше двукратного перевеса', () => {
    const rs = base();
    const vet = runMany(duel(rs, company('A', 90, 'defend', { exp: 4 }), company('B', 90, 'defend', { exp: 1 }), 'none'), rs, 80, 'E1');
    expect(vet.winA).toBeGreaterThan(50);
    expect(vet.winA).toBeLessThan(92);
    const rec = runMany(duel(rs, company('A', 180, 'attack', { exp: 1 }), company('B', 90, 'defend', { exp: 4 })), rs, 80, 'E2');
    expect(rec.winA).toBeGreaterThan(8);
  });

  it('предупреждение: условие на противника в правиле, где оно не действует', () => {
    const rs = base();
    const m: CustomModifier = { id: 'y', name: 'y', enabled: true, when: [{ field: 'enemy.tag', op: 'has', value: 'танк' }], effects: { movement: 1.2 } };
    expect(ruleIssues(rs, m).some((x) => x.includes('не действует для'))).toBe(true);
    const ok: CustomModifier = { ...m, effects: { moraleLoss: 1.2 } };
    expect(ruleIssues(rs, ok).some((x) => x.includes('не действует для'))).toBe(false);
  });
});

describe('подставленность, резерв, отходящие', () => {
  it('одиночный КП в тылу теряет немного', () => {
    let loss = 0;
    for (let i = 0; i < 30; i++) {
      const rs = base();
      const B = newRootUnit('B', {
        order: 'defend',
        children: [newUnit('КП', { echelon: 'rear', composition: [{ typeId: 'rifleman', authorized: 10, current: 10 }] })],
      });
      const b = createBattle(duel(rs, company('A', 90, 'defend'), B, 'none'), rs, { seed: `k${i}`, silent: true });
      for (let t = 0; t < 4; t++) stepTurn(b);
      loss += lost(b, 'КП');
    }
    // 10 человек × 4 хода × 30 боёв: меньше 2% за ход.
    expect(loss / (10 * 4 * 30)).toBeLessThan(0.02);
  });

  it('резерв под огнём миномётов несёт потери', () => {
    const run = (v: number) => {
      let loss = 0;
      for (let i = 0; i < 30; i++) {
        const rs = base();
        rs.coefficients.reserveIndirectExposure = v;
        const R = newRootUnit('R', { order: 'reserve', children: [newUnit('Резерв', { composition: [{ typeId: 'rifleman', authorized: 90, current: 90 }] })] });
        const sc = duel(rs, company('A', 90, 'defend', { extra: [{ typeId: 'mortar', n: 6 }] }), company('B', 90, 'defend'), 'none', 2);
        sc.sides[1].formations.push(R);
        const b = createBattle(sc, rs, { seed: `r${i}`, silent: true });
        for (let t = 0; t < 4; t++) stepTurn(b);
        loss += lost(b, 'Резерв');
      }
      return loss;
    };
    expect(run(0)).toBe(0);
    expect(run(0.6)).toBeGreaterThan(0);
  });

  it('отходящие и бегущие могут быть уничтожены', () => {
    const run = (on: number) => {
      let destroyed = 0;
      for (let i = 0; i < 30; i++) {
        const rs = base();
        rs.coefficients.destroyRetreating = on;
        const b = createBattle(duel(rs, company('A', 270, 'attack', { extra: [{ typeId: 'mortar', n: 6 }] }), company('B', 90, 'defend')), rs, {
          seed: `d${i}`,
          silent: true,
        });
        runToEnd(b);
        destroyed += b.elements.filter((el) => el.side === 'B' && el.status === 'destroyed').length;
      }
      return destroyed;
    };
    expect(run(1)).toBeGreaterThan(run(0));
  });
});

describe('расчёты и подавление', () => {
  it('расчёты миномётов теряют людей, а не только оружие', () => {
    let crew = 0;
    for (let i = 0; i < 30; i++) {
      const rs = base();
      const B = newRootUnit('B', { order: 'defend', children: [newUnit('Мин', { composition: [{ typeId: 'mortar', authorized: 8, current: 8 }] })] });
      const b = createBattle(duel(rs, company('A', 90, 'defend'), B, 'none'), rs, { seed: `c${i}`, silent: true });
      for (let t = 0; t < 4; t++) stepTurn(b);
      crew += b.log.filter((e) => /расчёт/i.test(e.text)).length;
      crew += lost(b, 'Мин');
    }
    expect(crew).toBeGreaterThan(0);
  });

  it('подавление обороны под атакой держится между ходами', () => {
    const avg = (rs: Ruleset) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 20; i++) {
        const b = createBattle(duel(rs, company('A', 180, 'attack'), company('B', 90, 'defend')), rs, { seed: `s${i}`, silent: true });
        while (!b.finished) {
          stepTurn(b);
          for (const el of b.elements)
            if (el.side === 'B' && el.status === 'active') {
              sum += el.suppression;
              n++;
            }
        }
      }
      return sum / n;
    };
    const was = base();
    Object.assign(was.coefficients, { suppressionScale: 120, suppressionRecovery: 15 });
    const now = avg(base());
    expect(now).toBeGreaterThan(5);
    expect(now).toBeGreaterThan(avg(was) * 2);
  });

  it('удача сторон по умолчанию — ±25%', () => {
    expect(COEFFICIENT_DEFAULTS.sideLuck).toBe(0.25);
  });
});

describe('обновление данных прежних версий', () => {
  it('калибровка версии 3 — только для наборов, ещё не обновлённых до неё', () => {
    const r = base();
    Object.assign(r.coefficients, { sideLuck: 0.2, suppressionScale: 120, suppressionRecovery: 15, moralePerLossPct: 1.2 });
    expect(recalibrateRuleset(r, 2).sort()).toEqual(['sideLuck', 'suppressionRecovery', 'suppressionScale']);
    expect(r.coefficients.moralePerLossPct).toBe(1.2);
    const r3 = base();
    r3.coefficients.sideLuck = 0.2;
    expect(recalibrateRuleset(r3, 3)).toEqual([]);
  });

  it('данные примера, которые ГМ не менял, обновляются; изменённые — нет', () => {
    const r = base();
    const tank = r.componentTypes.find((t) => t.id === 'tank')!;
    tank.firepower.inf = { long: 0.2, medium: 0.35, close: 0.45 };
    tank.tags = tank.tags.filter((t) => t !== 'танк' && t !== 'ПТ');
    r.modifiers = r.modifiers.filter((m) => m.id !== 'mod-tank-fear').map((m) => ({ ...m, byShare: undefined }));
    delete r.coefficients.turnRefMinutes;
    const notes = upgradeExampleData(r);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(tank.firepower.inf.close).toBeCloseTo(0.9);
    expect(tank.tags).toContain('танк');
    expect(r.modifiers.some((m) => m.id === 'mod-tank-fear')).toBe(true);
    expect(r.modifiers.find((m) => m.id === 'mod-nv')?.byShare).toBe(true);
    expect(r.coefficients.turnRefMinutes).toBe(r.turnMinutes);
    // ГМ поменял огонь танка — не трогаем.
    const g = base();
    const gt = g.componentTypes.find((t) => t.id === 'tank')!;
    gt.firepower.inf = { long: 0.3, medium: 0.35, close: 0.45 };
    upgradeExampleData(g);
    expect(gt.firepower.inf.long).toBe(0.3);
  });
});

describe('прогноз по частям', () => {
  it('прогоны по номерам совпадают с прогнозом целиком (фоновый расчёт даёт тот же результат)', () => {
    const rs = base();
    const b = createBattle(duel(rs, company('A', 180, 'attack'), company('B', 90, 'defend')), rs, { seed: 'F' });
    stepTurn(b);
    const whole = forecast(b, 6, 'S').runs;
    const parts = [3, 0, 5, 1, 4, 2].map((i) => forecastRun(b, 'S', i)).sort((x, y) => x.index - y.index);
    expect(parts).toEqual(whole);
    expect(runSeed('S', 0)).toBe('S#1');
  });
});
