// Тест баланса: правдоподобие исходов и потерь на стандартных боях. Сиды фиксированы — результат
// повторяем; диапазоны — исторически правдоподобные, с запасом. Если правка модели выводит цифры за
// диапазон, это повод перепроверить калибровку, а не просто подвинуть границы.

import { describe, expect, it } from 'vitest';
import {
  createBattle,
  EngineContext,
  makeDemoScenario,
  makeLinearRuleset,
  makeLinearScenario,
  makeUniversalRuleset,
  newRootUnit,
  newScenario,
  newUnit,
  runMany,
  runToEnd,
  stepTurn,
  type MonteCarloResult,
  type Scenario,
  type UnitNode,
} from '../src/engine';

const rs = makeUniversalRuleset();
const mean = (r: MonteCarloResult, key: string) => r.metrics.find((m) => m.key === key)!.stats.mean;

/** Стрелковое подразделение из трёх частей: стрелки и пулемёты (один на 30 человек). */
function rifles(name: string, n: number, order: string): UnitNode {
  const part = Math.round(n / 3);
  const comp = [
    { typeId: 'rifleman', authorized: part, current: part },
    { typeId: 'mg', authorized: Math.round(part / 30), current: Math.round(part / 30) },
  ];
  return newRootUnit(name, { order, children: [1, 2, 3].map((i) => newUnit(`${name} ${i}`, { composition: comp.map((c) => ({ ...c })) })) });
}

function duel(attack: number, defend: number, fortification: string, patch: Partial<Scenario> = {}): Scenario {
  const sc = newScenario(rs, 'Баланс', 'BAL');
  sc.sides[0].formations = [rifles('Атака', attack, attack === defend && fortification === 'none' ? 'defend' : 'attack')];
  sc.sides[1].formations = [rifles('Оборона', defend, 'defend')];
  sc.sides[1].fortification = fortification;
  sc.startBand = 'medium';
  sc.maxTurns = 24;
  return { ...sc, ...patch };
}

describe('баланс', () => {
  it('атака на подготовленную оборону: перевес решает постепенно, атакующий теряет больше', () => {
    const win: number[] = [];
    for (const k of [1, 1.5, 2, 3, 6]) {
      const r = runMany(duel(100 * k, 100, 'prepared'), rs, 100, `A${k}`);
      win.push(r.winA);
      if (k === 1.5 || k === 2) expect(mean(r, 'A.personnelLoss')).toBeGreaterThan(mean(r, 'B.personnelLoss'));
    }
    const [w1, w15, w2, w3, w6] = win;
    expect(w1).toBeLessThanOrEqual(15);
    expect(w15).toBeGreaterThan(w1);
    expect(w2).toBeGreaterThanOrEqual(35);
    expect(w2).toBeLessThanOrEqual(75);
    expect(w3).toBeGreaterThanOrEqual(65);
    expect(w3).toBeLessThanOrEqual(97);
    expect(w6).toBeGreaterThanOrEqual(90);
  }, 120_000);

  it('перестрелка на месте: втрое большая сила не выбивает противника почти без потерь', () => {
    const sc = duel(100, 300, 'none', { maxTurns: 12 });
    sc.sides[0].formations = [rifles('Малая', 100, 'defend')];
    let small = 0;
    let big = 0;
    for (let i = 0; i < 40; i++) {
      const b = createBattle(sc, rs, { seed: `L${i}`, silent: true });
      runToEnd(b);
      small += b.result!.sides.A.personnel.losses;
      big += b.result!.sides.B.personnel.losses;
    }
    const exchange = small / Math.max(1, big);
    expect(exchange).toBeGreaterThan(1.5);
    expect(exchange).toBeLessThan(3.5);
  }, 60_000);

  it('элементы ломаются при правдоподобных потерях (медиана — около трети)', () => {
    const at: number[] = [];
    for (let i = 0; i < 40; i++) {
      const b = createBattle(makeDemoScenario(), rs, { seed: `C${i}`, silent: true });
      let prev = new Map(b.elements.map((x) => [x.id, new EngineContext(b).behavior(x)]));
      while (!b.finished) {
        stepTurn(b);
        const E = new EngineContext(b);
        for (const el of b.elements) {
          const bh = E.behavior(el);
          const was = prev.get(el.id);
          if ((bh === 'retreat' || bh === 'rout') && was !== 'retreat' && was !== 'rout') at.push((1 - E.value(el) / el.startValue) * 100);
        }
        prev = new Map(b.elements.map((x) => [x.id, E.behavior(x)]));
      }
    }
    at.sort((a, b) => a - b);
    expect(at.length).toBeGreaterThan(50);
    const median = at[Math.floor(at.length / 2)];
    expect(median).toBeGreaterThanOrEqual(22);
    expect(median).toBeLessThanOrEqual(40);
  }, 60_000);

  it('пример «атака на высоту 212»: исход не предрешён, потери правдоподобны', () => {
    const r = runMany(makeDemoScenario(), rs, 150, 'D');
    expect(r.winA).toBeGreaterThanOrEqual(35);
    expect(r.winA).toBeLessThanOrEqual(65);
    expect(mean(r, 'A.personnelLossPct')).toBeGreaterThanOrEqual(6);
    expect(mean(r, 'A.personnelLossPct')).toBeLessThanOrEqual(22);
    expect(mean(r, 'B.personnelLossPct')).toBeGreaterThanOrEqual(20);
    expect(mean(r, 'B.personnelLossPct')).toBeLessThanOrEqual(45);
  }, 60_000);

  it('пример «бой у переправы»: штурм удаётся реже, чем срывается', () => {
    const r = runMany(makeLinearScenario(), makeLinearRuleset(), 150, 'D');
    expect(r.winA).toBeGreaterThanOrEqual(12);
    expect(r.winA).toBeLessThanOrEqual(45);
    expect(mean(r, 'A.personnelLossPct')).toBeGreaterThan(10);
  }, 60_000);
});
