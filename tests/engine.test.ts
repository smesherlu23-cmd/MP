import { describe, expect, it } from 'vitest';
import {
  applyIntervention,
  clone,
  copyFormation,
  createBattle,
  formatReport,
  makeDemoScenario,
  makeLinearRuleset,
  makeUniversalRuleset,
  newElement,
  newFormation,
  newScenario,
  replayBattle,
  Rng,
  runMany,
  runToEnd,
  stepTurn,
  validateScenario,
  type Battle,
  type FormationDef,
  type Ruleset,
  type Scenario,
} from '../src/engine';

const strip = (b: Battle) => JSON.stringify({ el: b.elements, hist: b.history, res: b.result ? { ...b.result, keyEvents: [] } : null, rng: b.rng });

function infantry(name: string, n: number, order = 'attack', patch: Partial<FormationDef> = {}): FormationDef {
  return newFormation(name, {
    order,
    elements: [newElement(`${name} — группа`, { composition: [{ typeId: 'rifleman', authorized: n, current: n }] })],
    ...patch,
  });
}

function duel(rs: Ruleset, a: FormationDef, b: FormationDef, patch: Partial<Scenario> = {}): Scenario {
  const sc = newScenario(rs, 'Тест', 'T-1');
  sc.sides[0].formations = [a];
  sc.sides[1].formations = [b];
  sc.startBand = 'medium';
  return { ...sc, ...patch };
}

describe('генератор случайных чисел', () => {
  it('детерминирован и даёт корректный биномиальный разброс', () => {
    const a = Rng.fromSeed('abc');
    const b = Rng.fromSeed('abc');
    const xs = Array.from({ length: 50 }, () => a.next());
    const ys = Array.from({ length: 50 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(Rng.fromSeed('abd').next()).not.toEqual(xs[0]);
    const r = Rng.fromSeed('binom');
    for (const n of [0, 1, 3, 40, 41, 500, 10000]) {
      for (const p of [0, 0.01, 0.3, 0.99, 1]) {
        const k = r.binomial(n, p);
        expect(Number.isInteger(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(n);
      }
    }
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += r.binomial(1000, 0.2);
    expect(sum / 2000).toBeGreaterThan(190);
    expect(sum / 2000).toBeLessThan(210);
  });
});

describe('бой', () => {
  const rs = makeUniversalRuleset();
  const sc = makeDemoScenario();

  it('один и тот же сид даёт тот же бой, разные сиды — разные', () => {
    const a = createBattle(sc, rs, { seed: 'X1' });
    const b = createBattle(sc, rs, { seed: 'X1' });
    const c = createBattle(sc, rs, { seed: 'X2' });
    runToEnd(a);
    runToEnd(b);
    runToEnd(c);
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
    expect(a.finished).toBe(true);
    expect(a.result?.headline).toBeTruthy();
  });

  it('журнал не влияет на расчёт (тихий режим даёт тот же исход)', () => {
    const a = createBattle(sc, rs, { seed: 'Q' });
    const b = createBattle(sc, rs, { seed: 'Q', silent: true });
    runToEnd(a);
    runToEnd(b);
    expect(strip(a)).toEqual(strip(b));
    expect(a.log.length).toBeGreaterThan(20);
    expect(b.log.length).toBe(0);
  });

  it('журнал объясняет изменения: у записей о потерях и морали есть факторы', () => {
    const b = createBattle(sc, rs, { seed: 'LOG' });
    runToEnd(b);
    const losses = b.log.filter((x) => x.phase === 'losses' && x.severity === 'bad');
    const morale = b.log.filter((x) => x.phase === 'morale');
    expect(losses.length).toBeGreaterThan(0);
    expect(losses.every((x) => (x.factors?.length ?? 0) > 0)).toBe(true);
    expect(morale.some((x) => x.factors?.some((f) => f.label.startsWith('Потери за ход')))).toBe(true);
  });

  it('сохранённый посреди боя бой продолжается так же, как непрерывный', () => {
    const a = createBattle(sc, rs, { seed: 'SAVE' });
    for (let i = 0; i < 5; i++) stepTurn(a);
    const saved: Battle = JSON.parse(JSON.stringify(a));
    runToEnd(a);
    runToEnd(saved);
    expect(strip(saved)).toEqual(strip(a));
  });

  it('вмешательства ГМ воспроизводятся при повторе', () => {
    const a = createBattle(sc, rs, { seed: 'GM' });
    stepTurn(a);
    stepTurn(a);
    const blue = a.elements.filter((x) => x.side === 'A').map((x) => x.id);
    applyIntervention(a, { type: 'setOrder', payload: { elementIds: blue, orderId: 'defend' } });
    applyIntervention(a, { type: 'setConditions', payload: { conditions: { weather: 'fog' } } });
    stepTurn(a);
    stepTurn(a);
    const r = replayBattle(a, { withInterventions: true });
    expect(r.turn).toBe(a.turn);
    expect(strip(r)).toEqual(strip(a));
    expect(r.conditions.weather).toBe('fog');
  });

  it('малые группы (2–3 бойца): потери целые, численность не уходит в минус', () => {
    const s = duel(rs, infantry('Дозор', 3), infantry('Секрет', 2, 'defend'), { startBand: 'close', maxTurns: 30 });
    for (let i = 0; i < 30; i++) {
      const b = createBattle(s, rs, { seed: `small-${i}`, silent: true });
      runToEnd(b);
      for (const el of b.elements) {
        for (const c of el.comps) {
          expect(c.current).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(c.current)).toBe(true);
          expect(c.kia + c.wia + c.mia).toBeLessThanOrEqual(c.start);
        }
      }
      const r = b.result!;
      expect(r.sides.A.personnel.losses).toBeLessThanOrEqual(3);
      expect(r.sides.B.personnel.losses).toBeLessThanOrEqual(2);
    }
  });

  it('тысячи бойцов считаются быстро и без переполнений', () => {
    const big = (name: string, order: string) =>
      newFormation(name, {
        order,
        elements: Array.from({ length: 12 }, (_, i) =>
          newElement(`${name} ${i + 1}`, { composition: [{ typeId: 'rifleman', authorized: 250, current: 250 }, { typeId: 'mg', authorized: 9, current: 9 }] }),
        ),
      });
    const s = duel(rs, big('Полк А', 'attack'), big('Полк Б', 'defend'));
    const t0 = Date.now();
    const b = createBattle(s, rs, { seed: 'big', silent: true });
    runToEnd(b);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(b.result!.sides.A.personnel.start).toBe(12 * (250 + 27));
    expect(b.result!.sides.A.personnel.losses).toBeGreaterThan(0);
  });

  it('выключенные механики не влияют на состояние', () => {
    const r2 = clone(rs);
    r2.features.fatigue = false;
    r2.features.ammo = false;
    r2.features.detection = false;
    const b = createBattle(sc, r2, { seed: 'F', silent: true });
    const fatigue0 = b.elements.map((x) => x.fatigue);
    const ammo0 = b.elements.map((x) => x.ammo);
    runToEnd(b);
    expect(b.elements.map((x) => x.fatigue)).toEqual(fatigue0);
    expect(b.elements.map((x) => x.ammo)).toEqual(ammo0);
  });

  it('пользовательское правило меняет исход («огонь ×0» — противник без потерь)', () => {
    const r2 = clone(rs);
    r2.modifiers.push({ id: 'blind', name: 'Слепота', enabled: true, when: [{ field: 'side', op: 'eq', value: 'A' }], effects: { fire: 0 } });
    const b = createBattle(sc, r2, { seed: 'M', silent: true });
    runToEnd(b);
    expect(b.result!.sides.B.personnel.losses).toBe(0);
  });

  it('укрепления снижают потери обороняющихся (по 60 прогонам)', () => {
    const a = infantry('Атака', 120);
    const d = infantry('Оборона', 60, 'defend');
    const base = duel(rs, a, d, { maxTurns: 10 });
    const fortified = clone(base);
    fortified.sides[1].fortification = 'fortified';
    const m1 = runMany(base, rs, 60, 'f').metrics.find((m) => m.key === 'B.personnelLossPct')!.stats.mean;
    const m2 = runMany(fortified, rs, 60, 'f').metrics.find((m) => m.key === 'B.personnelLossPct')!.stats.mean;
    expect(m2).toBeLessThan(m1);
  });

  it('зеркальный бой примерно равновесен', () => {
    const s = duel(rs, infantry('Левые', 100, 'defend'), infantry('Правые', 100, 'defend'), { maxTurns: 12 });
    const r = runMany(s, rs, 200, 'mirror');
    expect(Math.abs(r.winA - r.winB)).toBeLessThan(20);
    expect(r.winA + r.winB + r.draw).toBeCloseTo(100, 5);
  });

  it('массовое моделирование воспроизводимо и считает распределения', () => {
    const r1 = runMany(sc, rs, 30, 'base');
    const r2 = runMany(sc, rs, 30, 'base');
    expect(r1.runs.map((x) => x.headline)).toEqual(r2.runs.map((x) => x.headline));
    const m = r1.metrics.find((x) => x.key === 'A.personnelLoss')!;
    expect(m.stats.min).toBeLessThanOrEqual(m.stats.median);
    expect(m.stats.median).toBeLessThanOrEqual(m.stats.max);
    // Прогон №5 можно открыть как полноценный бой по сиду и получить тот же итог
    const run = r1.runs[4];
    const b = createBattle(sc, rs, { seed: run.seed });
    runToEnd(b);
    expect(b.result!.headline).toBe(run.headline);
    expect(b.result!.sides.A.personnel.losses).toBe(run.sides.A.personnelLoss);
  });

  it('резерв вводится в бой, когда первая линия выбыла', () => {
    const d = newFormation('Оборона', {
      order: 'defend',
      elements: [
        newElement('Застава', { composition: [{ typeId: 'rifleman', authorized: 5, current: 5 }] }),
        newElement('Резерв', { order: 'reserve', echelon: 'rear', composition: [{ typeId: 'rifleman', authorized: 30, current: 30 }] }),
      ],
    });
    const s = duel(rs, infantry('Атака', 150), d, { startBand: 'close', maxTurns: 25 });
    let committed = 0;
    for (let i = 0; i < 10; i++) {
      const b = createBattle(s, rs, { seed: `res-${i}` });
      runToEnd(b);
      if (b.log.some((x) => x.text.includes('вводится в бой'))) committed++;
    }
    expect(committed).toBeGreaterThan(0);
  });

  it('отчёт человекочитаем и без служебных ссылок', () => {
    const b = createBattle(sc, rs, { seed: 'R' });
    runToEnd(b);
    const text = formatReport(b, { includeLog: true });
    expect(text).toContain('ИТОГ:');
    expect(text).toContain('Личный состав');
    expect(text).not.toMatch(/\[\[e:/);
  });

  it('набор правил другой эпохи работает', () => {
    const lr = makeLinearRuleset();
    const line = (name: string, order: string) =>
      newFormation(name, {
        order,
        elements: [
          newElement('Батальон мушкетёров', { composition: [{ typeId: 'musketeer', authorized: 600, current: 560 }] }),
          newElement('Эскадрон гусар', { echelon: 'support', composition: [{ typeId: 'hussar', authorized: 120, current: 110 }] }),
          newElement('Батарея', { echelon: 'support', composition: [{ typeId: 'fieldgun', authorized: 8, current: 8 }] }),
        ],
      });
    const s = newScenario(lr, 'Линейный бой', 'L');
    s.sides[0].formations = [line('Полк А', 'attack')];
    s.sides[1].formations = [line('Полк Б', 'defend')];
    expect(validateScenario(s, lr).filter((x) => x.level === 'error')).toHaveLength(0);
    const b = createBattle(s, lr, { seed: 'L' });
    runToEnd(b);
    expect(b.finished).toBe(true);
    expect(b.result!.sides.A.personnel.losses + b.result!.sides.B.personnel.losses).toBeGreaterThan(0);
  });

  it('проверка сценария находит неизвестные типы, а бой их пропускает с предупреждением', () => {
    const f = infantry('Чужие', 10);
    f.elements[0].composition.push({ typeId: 'laser', authorized: 1, current: 1 });
    const s = duel(rs, f, infantry('Свои', 10, 'defend'));
    expect(validateScenario(s, rs).some((x) => x.level === 'error' && x.text.includes('laser'))).toBe(true);
    const b = createBattle(s, rs, { seed: 'V' });
    expect(b.log.some((x) => x.text.includes('laser'))).toBe(true);
  });

  it('копия подразделения получает новые идентификаторы и ссылку на оригинал', () => {
    const f = makeDemoScenario().sides[0].formations[0];
    const c = copyFormation(f);
    expect(c.id).not.toBe(f.id);
    expect(c.sourceId).toBe(f.id);
    expect(c.elements[0].sourceId).toBe(f.elements[0].id);
  });
});
