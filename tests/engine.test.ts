import { describe, expect, it } from 'vitest';
import {
  applyIntervention,
  clone,
  canMove,
  createBattle,
  defaultCommandLevel,
  displayNames,
  applyBattleToForces,
  extractForces,
  forceFromTemplate,
  forceRefIssues,
  partOf,
  resolveScenario,
  toTemplate,
  newId,
  extractPart,
  explainResult,
  formatReport,
  formatSideReport,
  lastBattleAction,
  rewindBattle,
  undoBattleAction,
  walkUnits,
  withoutExcluded,
  sideUnits,
  summarizeUnits,
  makeDemoBattalion,
  makeDemoScenario,
  makeLinearRuleset,
  makeLinearScenario,
  makeUniversalRuleset,
  instantiate,
  isOutdated,
  migrateUnit,
  moveUnit,
  newRootUnit,
  newUnit,
  nextName,
  resolveUnit,
  unitHash,
  updateFromTemplate,
  newScenario,
  replayBattle,
  restoreBattleLog,
  Rng,
  runMany,
  runToEnd,
  stepTurn,
  trimBattleForStorage,
  validateScenario,
  EngineContext,
  DEFAULT_PAUSE,
  forecast,
  stepUntilEvent,
  restForce,
  replenishForce,
  recoverableOf,
  sweepVariants,
  transferFromRuleset,
  suggestTypeMap,
  remapTypes,
  makeBlankRuleset,
  frontage,
  orderChance,
  recalibrateRuleset,
  limitComposition,
  transferUnit,
  returnUnit,
  findUnit,
  relinkScenario,
  locateNode,
  scenarioInTurns,
  scenarioToHours,
  turnsFor,
  type Battle,
  type UnitNode,
  type Ruleset,
  type Scenario,
} from '../src/engine';

// Сравнение боёв без случайных идентификаторов задач по умолчанию (они создаются заново при каждом создании боя).
const strip = (b: Battle) =>
  JSON.stringify({ el: b.elements, hist: b.history, res: b.result ? { ...b.result, keyEvents: [] } : null, rng: b.rng }).replace(/"obj-[a-z0-9]+"/g, '"obj"');

const rifles = (n: number, cur = n) => [{ typeId: 'rifleman', authorized: n, current: cur }];

function infantry(name: string, n: number, order = 'attack', patch: Partial<UnitNode> = {}): UnitNode {
  return newRootUnit(name, {
    order,
    children: [newUnit(`${name} — группа`, { composition: rifles(n) })],
    ...patch,
  });
}

function duel(rs: Ruleset, a: UnitNode, b: UnitNode, patch: Partial<Scenario> = {}): Scenario {
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

  it('бой хранится без подробного журнала и восстанавливает его повтором', () => {
    const a = createBattle(sc, rs, { seed: 'TRIM' });
    stepTurn(a);
    stepTurn(a);
    applyIntervention(a, { type: 'setOrder', payload: { elementIds: a.elements.filter((x) => x.side === 'B').map((x) => x.id), orderId: 'attack' } });
    stepTurn(a);
    const full = JSON.stringify(a.log);
    const stored: Battle = JSON.parse(JSON.stringify(trimBattleForStorage(a)));
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(a).length / 2);
    expect(stored.log.some((e) => e.level === 2 || e.factors)).toBe(false);
    expect(stored.log.some((e) => e.hadFactors)).toBe(true);
    // Продолжение сохранённого боя идёт так же, как непрерывного, и журнал восстанавливается целиком.
    stepTurn(a);
    stepTurn(stored);
    expect(strip(stored)).toEqual(strip(a));
    // повторное сохранение продолженного боя снова убирает подробности
    expect(trimBattleForStorage(stored).log.some((e) => e.level === 2 || e.factors)).toBe(false);
    expect(restoreBattleLog(stored)).toBe(true);
    expect(stored.logTrimmed).toBe(false);
    expect(JSON.stringify(stored.log.slice(1))).toEqual(JSON.stringify(a.log.slice(1)));
    expect(full.length).toBeGreaterThan(0);
    // Если сохранённый журнал не совпадает с повтором (другая версия программы), он не подменяется.
    const other: Battle = JSON.parse(JSON.stringify(trimBattleForStorage(a)));
    other.log[other.log.length - 1].text += ' (изменено)';
    expect(restoreBattleLog(other)).toBe(false);
    expect(other.logTrimmed).toBe(true);
  });

  it('повторяющиеся имена различаются по старшим формированиям', () => {
    const company = (name: string) => newUnit(name, { children: ['1-й взвод', '2-й взвод'].map((p) => newUnit(p, { composition: rifles(20) })) });
    const bn = (name: string) => newUnit(name, { children: [company('1-я рота'), company('2-я рота')] });
    const a = newRootUnit('Полк', { order: 'attack', children: [bn('1-й батальон'), bn('2-й батальон')] });
    const b = createBattle(duel(rs, a, infantry('Противник', 40)), rs, { seed: 'NAMES' });
    const names = displayNames(b);
    const labels = b.elements.filter((x) => x.side === 'A').map((x) => names.el.get(x.id));
    expect(new Set(labels).size).toBe(8);
    expect(labels).toContain('1-й взвод · 2-я рота · 1-й батальон');
    expect(names.el.get(b.elements.find((x) => x.side === 'B')!.id)).toBe('Противник — группа');
    expect(formatReport(b, { includeLog: true, logLevel: 2 })).not.toContain('[[');
  });

  it('компетентность командира — в бою: в начале обычная, ГМ меняет её по обстановке', () => {
    const a = infantry('Синие', 60, 'attack', { commandLevel: 5 });
    const b0 = createBattle(duel(rs, a, infantry('Красные', 60, 'defend')), rs, { seed: 'CMD' });
    const f = b0.formations.find((x) => x.side === 'A' && !x.parentId)!;
    expect(f.commandLevel).toBe(defaultCommandLevel(rs));
    expect(rs.commandLevels[f.commandLevel - 1].name).toBe('Обычный');
    // командир есть у каждого формирования, что бы ни стояло в шаблоне; «без командира» — решение сценария
    const tplNo = createBattle(duel(rs, infantry('Синие', 60, 'attack', { commandLevel: null }), infantry('Красные', 60)), rs, { seed: 'CMD' });
    expect(tplNo.formations.find((x) => x.side === 'A' && !x.parentId)!.commandLevel).toBe(defaultCommandLevel(rs));
    expect(tplNo.elements.every((x) => x.ownCommandLevel === 0)).toBe(true);
    const scNo = duel(rs, infantry('Синие', 60, 'attack'), infantry('Красные', 60));
    scNo.sides[0].commanders = { [scNo.sides[0].formations[0].id]: 0 };
    const noCmd = createBattle(scNo, rs, { seed: 'CMD' });
    expect(noCmd.formations.find((x) => x.side === 'A' && !x.parentId)!.commandLevel).toBe(0);
    // ГМ: удачное решение на одном ходу, ошибка — на другом; всё воспроизводится повтором
    stepTurn(b0);
    applyIntervention(b0, { type: 'setFormation', payload: { formationId: f.id, commandLevel: 5 } });
    stepTurn(b0);
    applyIntervention(b0, { type: 'setFormation', payload: { formationId: f.id, commandLevel: 1 } });
    stepTurn(b0);
    expect(b0.log.some((e) => e.phase === 'gm' && e.text.includes('Выдающийся'))).toBe(true);
    expect(b0.log.some((e) => e.phase === 'gm' && e.text.includes('Некомпетентный'))).toBe(true);
    const el = b0.elements.find((x) => x.side === 'A')!;
    applyIntervention(b0, { type: 'editElement', payload: { elementId: el.id, patch: { ownCommandLevel: 4 } } });
    expect(el.ownCommandLevel).toBe(4);
    stepTurn(b0);
    const r = replayBattle(b0, { withInterventions: true });
    expect(strip(r)).toEqual(strip(b0));

    // стартовая компетентность — из сценария (для боя и прогонов), не из шаблона
    const sc2 = duel(rs, infantry('Синие', 60, 'attack'), infantry('Красные', 60, 'defend'));
    sc2.sides[0].commanders = { [sc2.sides[0].formations[0].id]: 5 };
    const b2 = createBattle(sc2, rs, { seed: 'CMD2' });
    expect(b2.formations.find((x) => x.side === 'A' && !x.parentId)!.commandLevel).toBe(5);
    expect(b2.formations.find((x) => x.side === 'B' && !x.parentId)!.commandLevel).toBe(defaultCommandLevel(rs));
    const plain = runMany(duel(rs, infantry('Синие', 60, 'attack'), infantry('Красные', 60, 'defend')), rs, 40, 'CMDMC');
    const brilliant = runMany(sc2, rs, 40, 'CMDMC');
    expect(brilliant.winA).toBeGreaterThanOrEqual(plain.winA);
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

  it('откат: отменяется последний ход или решение ГМ, состояние — как при повторе', () => {
    const a = createBattle(sc, rs, { seed: 'UNDO' });
    for (let i = 0; i < 3; i++) stepTurn(a);
    const at3 = strip(clone(a));
    const blue = a.elements.filter((x) => x.side === 'A').map((x) => x.id);
    applyIntervention(a, { type: 'setOrder', payload: { elementIds: blue, orderId: 'defend' } });
    stepTurn(a);
    stepTurn(a);
    expect(lastBattleAction(a)).toEqual({ kind: 'turn', turn: 5 });
    const u = undoBattleAction(a)!;
    expect(u.id).toBe(a.id);
    expect(u.turn).toBe(4);
    expect(u.interventions).toHaveLength(1);
    // К ходу 3: решение ГМ, сделанное после хода 3, остаётся; отмена его возвращает бой к состоянию до решения.
    const r3 = rewindBattle(a, 3)!;
    expect(lastBattleAction(r3)).toMatchObject({ kind: 'intervention', label: 'смена приказа' });
    const r3b = undoBattleAction(r3)!;
    expect(r3b.interventions).toHaveLength(0);
    expect(strip(r3b)).toEqual(at3);
    // Бой, повтор которого разошёлся (сохранён другой версией), не откатывается.
    const bad = clone(a);
    bad.log.find((e) => e.phase === 'turn' && e.turn === 1)!.text = 'другая версия';
    expect(rewindBattle(bad, 2)).toBeNull();
  });

  it('итог объясняет, что решило исход', () => {
    let seen = 0;
    for (const seed of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']) {
      const b = createBattle(sc, rs, { seed });
      runToEnd(b);
      const r = b.result!;
      const text = explainResult(r);
      if (r.winner) {
        seen++;
        expect(text).toContain('Решило.');
        expect(text).toContain(`«${r.sides[r.winner].name}»`);
      } else expect(text).toContain('примерно поровну');
      expect(formatReport(b)).toContain(text);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('малые группы (2–3 бойца): потери целые, численность не уходит в минус', () => {
    const s = duel(rs, infantry('Дозор', 3), infantry('Секрет', 2, 'defend'), { startBand: 'close', hours: 7.5 });
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
      newRootUnit(name, {
        order,
        children: Array.from({ length: 12 }, (_, i) =>
          newUnit(`${name} ${i + 1}`, {
            composition: [
              { typeId: 'rifleman', authorized: 250, current: 250 },
              { typeId: 'mg', authorized: 9, current: 9 },
            ],
          }),
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
    const base = duel(rs, a, d, { hours: 2.5 });
    const fortified = clone(base);
    fortified.sides[1].fortification = 'fortified';
    const m1 = runMany(base, rs, 60, 'f').metrics.find((m) => m.key === 'B.personnelLossPct')!.stats.mean;
    const m2 = runMany(fortified, rs, 60, 'f').metrics.find((m) => m.key === 'B.personnelLossPct')!.stats.mean;
    expect(m2).toBeLessThan(m1);
  });

  it('зеркальный бой примерно равновесен', () => {
    const s = duel(rs, infantry('Левые', 100, 'defend'), infantry('Правые', 100, 'defend'), { hours: 3 });
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
    const d = newRootUnit('Оборона', {
      order: 'defend',
      children: [newUnit('Застава', { composition: rifles(5) }), newUnit('Резерв', { order: 'reserve', echelon: 'rear', composition: rifles(30) })],
    });
    const s = duel(rs, infantry('Атака', 150), d, { startBand: 'close', hours: 6.25 });
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
      newRootUnit(name, {
        order,
        children: [
          newUnit('Батальон мушкетёров', { composition: [{ typeId: 'musketeer', authorized: 600, current: 560 }] }),
          newUnit('Эскадрон гусар', { echelon: 'support', composition: [{ typeId: 'hussar', authorized: 120, current: 110 }] }),
          newUnit('Батарея', { echelon: 'support', composition: [{ typeId: 'fieldgun', authorized: 8, current: 8 }] }),
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

  it('пример боя у переправы: без замечаний, исход не предрешён', () => {
    const lr = makeLinearRuleset();
    const sc = makeLinearScenario();
    expect(validateScenario(sc, lr)).toHaveLength(0);
    const r = runMany(sc, lr, 60, 'lin');
    expect(r.winA).toBeGreaterThan(15);
    expect(r.winB).toBeGreaterThan(15);
  });

  it('проверка сценария находит неизвестные типы, а бой их пропускает с предупреждением', () => {
    const f = infantry('Чужие', 10);
    f.children[0].composition.push({ typeId: 'laser', authorized: 1, current: 1 });
    const s = duel(rs, f, infantry('Свои', 10, 'defend'));
    expect(validateScenario(s, rs).some((x) => x.level === 'error' && x.text.includes('laser'))).toBe(true);
    const b = createBattle(s, rs, { seed: 'V' });
    expect(b.log.some((x) => x.text.includes('laser'))).toBe(true);
  });

  it('копия подразделения получает новые идентификаторы и ссылку на шаблон', () => {
    const f = makeDemoScenario().sides[0].formations[0];
    const c = instantiate(f);
    expect(c.id).not.toBe(f.id);
    expect(c.templateId).toBe(f.id);
    expect(c.children[0].srcNodeId).toBe(f.children[0].id);
    expect(isOutdated(c, f)).toBe(false);
  });

  it('узел с подчинёнными и своим составом: формирование и отдельный элемент', () => {
    const root = newRootUnit('Батальон', {
      order: 'defend',
      composition: rifles(10),
      isHQ: true,
      children: [newUnit('Рота', { composition: rifles(50) }), newUnit('Группа', { children: [newUnit('Отделение', { composition: rifles(8) })] })],
    });
    const sc = duel(rs, root, infantry('Противник', 60, 'attack'));
    const b = createBattle(sc, rs, { seed: 'tree' });
    const own = b.formations.filter((f) => f.side === 'A');
    expect(own.map((f) => f.name)).toEqual(['Батальон', 'Группа']);
    const els = b.elements.filter((x) => x.side === 'A');
    expect(els.map((x) => x.name)).toEqual(['Батальон (управление)', 'Рота', 'Отделение']);
    expect(els[2].formationId).toBe(own[1].id);
    expect(own[1].parentId).toBe(own[0].id);
  });

  it('параметры наследуются от старшего и переопределяются на любом уровне', () => {
    const root = newRootUnit('Полк', {
      state: { morale: 60, experience: 3 },
      supply: 40,
      children: [
        newUnit('Батальон', { state: { morale: 90 }, children: [newUnit('Рота', { composition: rifles(50) })] }),
        newUnit('Рота 2', { composition: rifles(50), state: { experience: 1 } }),
      ],
    });
    const r1 = resolveUnit(root, root.children[0].children[0].id)!;
    expect(r1.state.morale).toBe(90);
    expect(r1.state.experience).toBe(3);
    expect(r1.supply).toBe(40);
    const r2 = resolveUnit(root, root.children[1].id)!;
    expect(r2.state.morale).toBe(60);
    expect(r2.state.experience).toBe(1);
    const sc = duel(rs, root, infantry('Противник', 60));
    const b = createBattle(sc, rs, { seed: 'inh' });
    const roty = b.elements.filter((x) => x.side === 'A');
    expect(roty.map((x) => x.morale)).toEqual([90, 60]);
    expect(roty.map((x) => x.experience)).toEqual([3, 1]);
  });

  it('обновление копии из шаблона: устройство из шаблона, потери и названия копии сохраняются', () => {
    const tpl = newRootUnit('Взвод', { level: 'взвод', composition: rifles(30), children: [newUnit('Отделение', { composition: rifles(10) })] });
    const copy = instantiate(tpl, { name: '1-й взвод' });
    copy.composition[0].current = 22; // потери
    copy.children[0].name = '1-е отделение';
    copy.children.push(newUnit('Снайперская пара', { composition: rifles(2) })); // добавлено вручную
    expect(isOutdated(copy, tpl)).toBe(false);
    // Шаблон меняется: больше людей, новый пулемёт, ещё одно отделение
    tpl.composition = [
      { typeId: 'rifleman', authorized: 32, current: 32 },
      { typeId: 'mg', authorized: 2, current: 2 },
    ];
    tpl.children.push(newUnit('Отделение', { composition: rifles(10) }));
    expect(isOutdated(copy, tpl)).toBe(true);
    const upd = updateFromTemplate(copy, tpl);
    expect(isOutdated(upd, tpl)).toBe(false);
    expect(upd.name).toBe('1-й взвод');
    expect(upd.composition).toEqual([
      { typeId: 'rifleman', authorized: 32, current: 22, recoverable: undefined },
      { typeId: 'mg', authorized: 2, current: 2 },
    ]);
    expect(upd.children.map((c) => c.name)).toEqual(['1-е отделение', 'Отделение', 'Снайперская пара']);
    expect(upd.children[0].id).toBe(copy.children[0].id);
  });

  it('вложенные шаблоны: рота из взводов обновляется по цепочке', () => {
    const vzvod = newRootUnit('Взвод', { level: 'взвод', composition: rifles(30) });
    const rota = newRootUnit('Рота', { level: 'рота', children: [instantiate(vzvod, { name: '1-й взвод' }), instantiate(vzvod, { name: '2-й взвод' })] });
    const bn = newRootUnit('Батальон', { children: [instantiate(rota, { name: '1-я рота' })] });
    vzvod.composition = rifles(35);
    expect(isOutdated(rota.children[0], vzvod)).toBe(true);
    rota.children = rota.children.map((c) => updateFromTemplate(c, vzvod));
    expect(isOutdated(bn.children[0], rota)).toBe(true);
    bn.children[0] = updateFromTemplate(bn.children[0], rota);
    expect(bn.children[0].children.map((c) => [c.name, c.composition[0].authorized])).toEqual([
      ['1-й взвод', 35],
      ['2-й взвод', 35],
    ]);
    expect(isOutdated(bn.children[0].children[0], vzvod)).toBe(false);
    expect(unitHash(bn.children[0])).toBe(unitHash(rota));
  });

  it('перемещение и придание: нельзя переместить в своих подчинённых', () => {
    const tank = newRootUnit('Танковая рота', { composition: [{ typeId: 'tank', authorized: 10, current: 10 }] });
    const bn = newRootUnit('Батальон', { children: [newUnit('1-я рота', { composition: rifles(80) }), newUnit('2-я рота', { composition: rifles(80) })] });
    const roots = [bn, tank];
    expect(moveUnit(roots, tank.id, bn.id, 'inside')).toBe(true);
    expect(roots.length).toBe(1);
    expect(bn.children.map((c) => c.name)).toEqual(['1-я рота', '2-я рота', 'Танковая рота']);
    expect(canMove(roots, bn.id, bn.children[0].id)).toBe(false);
    expect(moveUnit(roots, bn.children[2].id, bn.children[0].id, 'before')).toBe(true);
    expect(bn.children.map((c) => c.name)).toEqual(['Танковая рота', '1-я рота', '2-я рота']);
  });

  it('размножение: следующие номера в названиях', () => {
    expect(nextName('1-й взвод', 1)).toBe('2-й взвод');
    expect(nextName('Отделение 3', 2)).toBe('Отделение 5');
    expect(nextName('Дозор', 1)).toBe('Дозор 2');
  });

  it('старый формат «формирование + элементы» переносится без потери данных', () => {
    const legacy = {
      id: 'old-bn',
      name: 'Старый батальон',
      kind: 'батальон',
      commanderName: 'майор',
      commandLevel: 4,
      comms: 70,
      supply: 60,
      order: 'attack',
      elements: [
        {
          id: 'old-e1',
          name: 'Рота',
          role: 'рота',
          echelon: 'front',
          order: null,
          composition: rifles(90, 80),
          experience: 3,
          morale: 65,
          cohesion: 70,
          readiness: 90,
          ammo: 100,
          fuel: 100,
          equipment: 100,
          fatigue: 5,
          vehicleCondition: 90,
          attackMod: 100,
          defenseMod: 100,
          isHQ: false,
          holdFast: false,
          tags: [],
        },
      ],
      subunits: [
        {
          id: 'old-sub',
          name: 'Группа',
          kind: 'группа',
          commanderName: '',
          commandLevel: 3,
          comms: null,
          supply: null,
          order: null,
          elements: [],
          subunits: [],
          tags: [],
        },
      ],
      tags: [],
    };
    const u = migrateUnit(legacy);
    expect(u.level).toBe('батальон');
    expect(u.comms).toBe(70);
    expect(u.children.map((c) => c.name)).toEqual(['Рота', 'Группа']);
    expect(u.children[0].state.morale).toBe(65);
    expect(u.children[0].composition[0].current).toBe(80);
    const sc = duel(rs, legacy as unknown as UnitNode, infantry('Противник', 50));
    const b = createBattle(sc, rs, { seed: 'legacy' });
    expect(b.elements.find((x) => x.name === 'Рота')?.morale).toBe(65);
  });
});

describe('план боя и донесения', () => {
  const rs = makeUniversalRuleset();
  const nodeId = (sc: Scenario, side: 0 | 1, name: string) => {
    let id = '';
    for (const f of sc.sides[side].formations) walkUnits(f, (n) => void (n.name.includes(name) && (id = n.id)));
    return id;
  };

  it('подкрепление вне боя до своего хода, затем вступает; без него — «не подошло»', () => {
    const sc = makeDemoScenario();
    const tank = nodeId(sc, 0, 'Танковая');
    sc.events = [{ id: 'e1', kind: 'arrive', turn: 4, side: 'A', nodeId: tank }];
    const b = createBattle(sc, rs, { seed: 'EV' });
    const tanks = b.elements.filter((x) => x.defId === tank);
    expect(tanks.length).toBeGreaterThan(0);
    expect(tanks.every((x) => x.status === 'pending')).toBe(true);
    for (let i = 0; i < 3; i++) stepTurn(b);
    expect(tanks.every((x) => x.status === 'pending' && x.firedThisTurn === false)).toBe(true);
    expect(tanks.every((x) => x.comps.every((c) => c.current === c.start))).toBe(true);
    stepTurn(b);
    expect(tanks.every((x) => x.status === 'active')).toBe(true);
    expect(b.log.some((e) => e.phase === 'plan' && e.turn === 4 && e.text.includes('Подходят подкрепления'))).toBe(true);

    sc.events = [{ id: 'e1', kind: 'arrive', turn: 2, chance: 0, side: 'A', nodeId: tank }];
    const c = createBattle(sc, rs, { seed: 'EV' });
    runToEnd(c);
    expect(c.elements.filter((x) => x.defId === tank).every((x) => x.status === 'pending')).toBe(true);
    expect(c.log.some((e) => e.phase === 'plan' && e.text.includes('не подошло'))).toBe(true);
    // Не подошедшие в итогах не воюют и не теряют: только счётчик.
    expect(c.result!.sides.A.status.pending).toBeGreaterThan(0);
  });

  it('смена приказа и условий по плану, разброс в пределах, прогоны воспроизводимы', () => {
    const sc = makeDemoScenario();
    const third = nodeId(sc, 0, '3-я мотострелковая');
    sc.events = [
      { id: 'o', kind: 'order', turn: 3, side: 'A', nodeId: third, orderId: 'attack' },
      { id: 'c', kind: 'conditions', turn: 5, spread: 2, conditions: { time: 'night' } },
    ];
    expect(validateScenario(sc, rs)).toHaveLength(0);
    for (const seed of ['S1', 'S2', 'S3', 'S4']) {
      const b = createBattle(sc, rs, { seed });
      const t = b.eventTurns!.c;
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(7);
      for (let i = 0; i < 3; i++) stepTurn(b);
      expect(b.elements.filter((x) => x.defId === third).every((x) => x.orderId === 'attack')).toBe(true);
      while (b.turn < t && !b.finished) stepTurn(b);
      if (!b.finished) expect(b.conditions.time).toBe('night');
    }
    const r1 = runMany(sc, rs, 40, 'plan');
    const r2 = runMany(sc, rs, 40, 'plan');
    expect(r1.winA).toBe(r2.winA);
    // Событие на удалённое подразделение — замечание в проверке сценария.
    sc.events.push({ id: 'x', kind: 'arrive', turn: 2, side: 'B', nodeId: 'нет-такого' });
    expect(validateScenario(sc, rs).some((x) => x.text.includes('План боя'))).toBe(true);
  });

  it('донесение стороны: свои цифры точно, противник — диапазоном, без решений ГМ', () => {
    const sc = makeDemoScenario();
    const b = createBattle(sc, rs, { seed: 'REP' });
    stepTurn(b);
    applyIntervention(b, { type: 'setConditions', payload: { conditions: { weather: 'fog' } } });
    runToEnd(b);
    const r = b.result!;
    const text = formatSideReport(b, 'A');
    expect(text).toContain(`потери ${r.sides.A.personnel.losses.toLocaleString('ru-RU')}`);
    expect(text).not.toContain('ГМ:');
    const m = /Потери: (?:около (\d+)|(\d+)–(\d+)) чел\./.exec(text);
    if (m) {
      const lo = Number(m[1] ?? m[2]);
      const hi = Number(m[1] ?? m[3]);
      const truth = r.sides.B.personnel.losses;
      expect(lo).toBeLessThanOrEqual(Math.max(truth, 5));
      expect(hi).toBeGreaterThanOrEqual(Math.min(truth, hi));
    } else expect(text).toContain('Сведений почти нет');
    expect(formatSideReport(b, 'A')).toBe(text);
  });
});

describe('стороны: несколько подразделений и части', () => {
  const rs = makeUniversalRuleset();

  it('часть подразделения воюет самостоятельно, с унаследованными приказом и состоянием', () => {
    const bn = makeDemoBattalion();
    const co = bn.children.find((c) => c.name.includes('2-я'))!;
    const part = extractPart(bn, co.id)!;
    expect(part.id).not.toBe(co.id);
    expect(part.name).toContain(bn.name);
    expect(part.order).toBe(bn.order);
    expect(part.templateId).toBe(co.templateId);
    expect(extractPart(bn, bn.id)).toBeNull();
    // На сторону — целиком, часть и ещё подразделение: все в одном бою.
    const sc = makeDemoScenario();
    sc.sides[0].formations.push(part, instantiate(makeDemoBattalion()));
    expect(validateScenario(sc, rs).filter((x) => x.level === 'error')).toHaveLength(0);
    const b = createBattle(sc, rs, { seed: 'MULTI' });
    const roots = b.formations.filter((f) => f.side === 'A' && !f.parentId);
    expect(roots).toHaveLength(3);
    runToEnd(b);
    expect(b.finished).toBe(true);
  });

  it('исключённые части не вступают в бой и не считаются в сводках', () => {
    const sc = makeDemoScenario();
    const bn = sc.sides[0].formations[0];
    const third = bn.children.find((c) => c.name.includes('3-я'))!;
    const tank = bn.children.find((c) => c.name.includes('Танковая'))!;
    const full = createBattle(sc, rs, { seed: 'EX' });
    sc.sides[0].excluded = [third.id, tank.id];
    const b = createBattle(sc, rs, { seed: 'EX' });
    expect(b.elements.filter((x) => x.side === 'A')).toHaveLength(full.elements.filter((x) => x.side === 'A').length - 2);
    expect(b.elements.some((x) => x.defId === third.id || x.defId === tank.id)).toBe(false);
    const pruned = withoutExcluded(bn, sc.sides[0].excluded)!;
    expect(pruned.children).toHaveLength(bn.children.length - 2);
    expect(bn.children).toHaveLength(7); // сам сценарий не меняется
    expect(summarizeUnits(sideUnits(sc.sides[0]), rs).persCur).toBeLessThan(summarizeUnits(sc.sides[0].formations, rs).persCur);
    // Исключить всё — ошибка проверки сценария.
    sc.sides[0].excluded = [bn.id];
    expect(validateScenario(sc, rs).some((x) => x.level === 'error' && x.text.includes('исключены'))).toBe(true);
  });
});

describe('шаблоны и силы', () => {
  const rs = makeUniversalRuleset();
  const split = (src = makeDemoScenario()) => {
    const { scenario, forces } = extractForces(src, new Set(), () => newId('u'));
    return { scenario, forces: Object.fromEntries(forces.map((f) => [f.id, f])) as Record<string, UnitNode> };
  };

  it('сценарий на ссылках к силам даёт тот же бой, что и с копиями', () => {
    const src = makeDemoScenario();
    const { scenario, forces } = split(src);
    expect(scenario.sides.every((sd) => sd.units?.length === 1 && sd.formations.length === 0)).toBe(true);
    // Приказы переехали из подразделений в сценарий.
    expect(Object.values(scenario.sides[0].orders ?? {})).toContain('reserve');
    walkUnits(Object.values(forces)[0], (n) => expect(n.order).toBeNull());
    const a = createBattle(src, rs, { seed: 'F' });
    const b = createBattle(resolveScenario(scenario, forces), rs, { seed: 'F' });
    runToEnd(a);
    runToEnd(b);
    expect(strip(b)).toEqual(strip(a));
  });

  it('итоги боя ложатся на силы, шаблон не меняется; следующий бой — с потерями', () => {
    const { scenario, forces } = split();
    const tplBefore = JSON.stringify(makeDemoBattalion());
    const b = createBattle(resolveScenario(scenario, forces), rs, { seed: 'F2' });
    runToEnd(b);
    const { updated, changes } = applyBattleToForces(b, forces);
    expect(updated).toHaveLength(2);
    expect(changes.find((c) => c.forceId === scenario.sides[0].units![0].forceId)!.personnel).toBe(b.result!.sides.A.personnel.losses);
    const next = { ...forces, ...Object.fromEntries(updated.map((f) => [f.id, f])) };
    const b2 = createBattle(resolveScenario(scenario, next), rs, { seed: 'F3' });
    const start = (x: Battle) => x.elements.filter((e) => e.side === 'A').reduce((s, e) => s + e.startPersonnel, 0);
    // Экипажи потерянной техники уходят вместе с ней — численность падает не меньше, чем на потери людей.
    expect(start(b2)).toBeLessThanOrEqual(start(b) - b.result!.sides.A.personnel.losses);
    expect(start(b2)).toBeLessThan(start(b));
    expect(JSON.stringify(makeDemoBattalion())).toBe(tplBefore);
  });

  it('часть сил: те же идентификаторы, наследованное записано; дубли и удалённое — ошибки', () => {
    const { scenario, forces } = split();
    const force = Object.values(forces)[0];
    const co = force.children.find((c) => c.name.includes('2-я'))!;
    const part = partOf(force, co.id)!;
    expect(part.id).toBe(co.id);
    expect(part.name).toContain(force.name);
    expect(forceRefIssues(scenario, forces)).toHaveLength(0);
    scenario.sides[1].units!.push({ forceId: force.id, nodeId: co.id });
    expect(forceRefIssues(scenario, forces).some((x) => x.level === 'error' && x.text.includes('дважды'))).toBe(true);
    scenario.sides[1].units!.pop();
    scenario.sides[1].units!.push({ forceId: 'нет-такого' });
    expect(forceRefIssues(scenario, forces).some((x) => x.text.includes('удалено'))).toBe(true);
  });

  it('шаблон — только устройство и штат; силы по шаблону — полный штат и связь с шаблоном', () => {
    const bn = makeDemoBattalion();
    const tpl = toTemplate(bn);
    walkUnits(tpl, (n) => {
      expect(n.order).toBeNull();
      expect(n.state).toEqual({});
      n.composition.forEach((c) => expect(c.current).toBe(c.authorized));
    });
    const f = forceFromTemplate({ ...tpl, rulesetId: rs.id }, { faction: 'Синие' });
    expect(f.templateId).toBe(tpl.id);
    expect(f.faction).toBe('Синие');
    expect(f.rulesetId).toBe(rs.id);
    expect(f.id).not.toBe(tpl.id);
  });
});

describe('участки, удары, эффекты, условия плана', () => {
  const rs = makeUniversalRuleset();
  const twoSectors = () => {
    const a = infantry('Синие', 100, 'attack', {
      children: [newUnit('Левая рота', { composition: rifles(50) }), newUnit('Правая рота', { composition: rifles(50) })],
    });
    const b = infantry('Красные', 100, 'defend', {
      children: [newUnit('Левый взвод', { composition: rifles(50) }), newUnit('Правый взвод', { composition: rifles(50) })],
    });
    const sc = duel(rs, a, b);
    sc.sectors = [
      { id: 'L', name: 'Левый' },
      { id: 'R', name: 'Правый', startBand: 'long' },
    ];
    sc.sides[0].sectorOf = { [a.children[1].id]: 'R' };
    sc.sides[1].sectorOf = { [b.children[1].id]: 'R' };
    return { sc, a, b };
  };

  it('без новых механик бой тот же, что и раньше: участки и поддержка не создаются', () => {
    const sc = makeDemoScenario();
    delete sc.sides[0].support;
    const b = createBattle(sc, rs, { seed: 'S0' });
    expect(b.sectors).toBeUndefined();
    expect(b.support).toBeUndefined();
    expect(b.elements.every((x) => x.sector === undefined)).toBe(true);
  });

  it('участки: своя дистанция, прямой огонь — только по своему участку', () => {
    const { sc } = twoSectors();
    const b = createBattle(sc, rs, { seed: 'S1' });
    expect(b.sectors!.map((x) => b.ruleset.rangeBands[x.bandIndex].id)).toEqual(['medium', 'long']);
    const left = b.elements.filter((x) => x.sector === 'L').map((x) => x.id);
    const right = b.elements.filter((x) => x.sector === 'R').map((x) => x.id);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    for (let i = 0; i < 3; i++) stepTurn(b);
    // Огонь в журнале: стрелок и цели — на одном участке.
    for (const e of b.log.filter((x) => x.phase === 'losses' && x.refs?.length)) {
      const [target, ...shooters] = e.refs!;
      const side = left.includes(target) ? left : right;
      for (const sh of shooters) expect(side).toContain(sh);
    }
    applyIntervention(b, { type: 'setBand', payload: { sector: 'R', bandIndex: 2 } });
    expect(b.sectors!.map((x) => x.bandIndex)).toEqual([b.sectors![0].bandIndex, 2]);
  });

  it('огневая поддержка: удар по вызову — в начале следующего хода, вызовы считаются, отмена возвращает', () => {
    const { sc, b: red } = twoSectors();
    sc.sides[0].support = [{ id: 'art', name: 'Батарея', typeId: 'gun', count: 6, missions: 2 }];
    const b = createBattle(sc, rs, { seed: 'S2' });
    stepTurn(b);
    const target = b.formations.find((f) => f.side === 'B' && f.defId === red.id)!;
    applyIntervention(b, { type: 'strike', payload: { side: 'A', assetId: 'art', formationId: target.id } });
    expect(b.support![0].left).toBe(1);
    applyIntervention(b, { type: 'strike', payload: { side: 'A', assetId: 'art' } });
    applyIntervention(b, { type: 'strike', payload: { side: 'A', assetId: 'art' } });
    expect(b.support![0].left).toBe(0);
    expect(b.strikes).toHaveLength(2);
    applyIntervention(b, { type: 'cancelStrike', payload: { strikeId: b.strikes![1].id } });
    expect(b.support![0].left).toBe(1);
    stepTurn(b);
    expect(b.strikes![0].done).toBe(true);
    const hit = b.log.filter((e) => e.turn === 2 && e.phase === 'losses' && e.factors?.some((f) => f.label.includes('огневая поддержка')));
    expect(hit.length).toBeGreaterThan(0);
    // Повтор с решениями ГМ — тот же бой.
    const r = replayBattle(b, { withInterventions: true });
    expect(strip(r)).toEqual(strip(b));
  });

  it('временный эффект действует только в свои ходы и на свою сторону', () => {
    const { sc } = twoSectors();
    const b = createBattle(sc, rs, { seed: 'S3' });
    const el = b.elements.find((x) => x.side === 'B')!;
    const enemy = b.elements.find((x) => x.side === 'A')!;
    const base = new EngineContext(b).mult(el, 'concealment');
    applyIntervention(b, { type: 'addEffect', payload: { side: 'B', name: 'Дым', effects: { concealment: 2 }, turns: 2 } });
    expect(b.effects![0]).toMatchObject({ from: 1, until: 2 });
    b.turn = 1;
    expect(new EngineContext(b).mult(el, 'concealment')).toBeCloseTo(base * 2);
    expect(new EngineContext(b).mult(enemy, 'concealment')).toBeCloseTo(new EngineContext({ ...b, effects: [] }).mult(enemy, 'concealment'));
    b.turn = 3;
    expect(new EngineContext(b).mult(el, 'concealment')).toBeCloseTo(base);
  });

  it('событие по условию наступает, когда условие выполнено (с задержкой); без условия — не наступает', () => {
    const { sc, b: red } = twoSectors();
    sc.events = [
      { id: 'ev', kind: 'order', turn: 1, side: 'B', nodeId: red.id, orderId: 'retreat', trigger: { metric: 'losses', side: 'B', value: 2 }, delay: 1 },
    ];
    const b = createBattle(sc, rs, { seed: 'S4' });
    let fired = 0;
    while (!b.finished && !fired) {
      stepTurn(b);
      fired = b.log.filter((e) => e.phase === 'plan' && e.text.includes('Отступление')).length;
    }
    expect(fired).toBe(1);
    const at = b.eventTurns!.ev;
    expect(b.log.some((e) => e.phase === 'plan' && e.turn === at - 1 && e.text.includes('через 1 ход'))).toBe(true);
    // Условие недостижимо — событие не наступает.
    sc.events[0].trigger = { metric: 'losses', side: 'B', value: 100 };
    const c = createBattle(sc, rs, { seed: 'S4' });
    runToEnd(c);
    expect(c.log.some((e) => e.phase === 'plan')).toBe(false);
  });

  it('правило по состоянию: «мораль ≤ 40 → огонь ×0» действует сразу, как мораль упала', () => {
    const r = clone(rs);
    r.modifiers.push({ id: 'low', name: 'Сломлены', enabled: true, when: [{ field: 'morale', op: 'lte', value: 40 }], effects: { fire: 0 } });
    const b = createBattle(duel(r, infantry('А', 50), infantry('Б', 50, 'defend')), r, { seed: 'S5' });
    const E = new EngineContext(b);
    const el = b.elements[0];
    expect(E.mult(el, 'fire')).toBeGreaterThan(0);
    el.morale = 30;
    expect(E.mult(el, 'fire')).toBe(0);
  });

  it('ход до события останавливается на важном; прогноз не меняет бой и воспроизводим', () => {
    const b = createBattle(makeDemoScenario(), rs, { seed: 'S6' });
    const { steps, reasons } = stepUntilEvent(b, DEFAULT_PAUSE);
    expect(steps).toBeGreaterThan(0);
    expect(reasons.length > 0 || b.finished).toBe(true);
    const before = JSON.stringify(b);
    const f1 = forecast(b, 20, 'P');
    const f2 = forecast(b, 20, 'P');
    expect(JSON.stringify(b)).toBe(before);
    expect(f1.runs.map((x) => x.outcomeId + x.turns)).toEqual(f2.runs.map((x) => x.outcomeId + x.turns));
    expect(f1.winA + f1.winB + f1.draw).toBeCloseTo(100);
    expect(f1.runs.every((x) => x.turns >= b.turn)).toBe(true);
  });
});

describe('силы между боями, варианты прогонов, перенос между наборами', () => {
  const rs = makeUniversalRuleset();

  it('итоги боя — в боевой путь; отдых возвращает раненых, пополнение — до штата', () => {
    const { scenario, forces } = extractForces(makeDemoScenario(), new Set(), () => newId('u'));
    const map = Object.fromEntries(forces.map((f) => [f.id, f])) as Record<string, UnitNode>;
    const b = createBattle(resolveScenario(scenario, map), rs, { seed: 'R1' });
    runToEnd(b);
    const { updated } = applyBattleToForces(b, map);
    const f = updated[0];
    expect(f.history?.[0]).toMatchObject({ kind: 'battle', battleId: b.id });
    const rec = recoverableOf(f, rs);
    expect(rec.personnel).toBeGreaterThan(0);
    const r = restForce(f, 10, rs);
    expect(r.personnel).toBeGreaterThan(0);
    expect(recoverableOf(r.force, rs).personnel).toBeLessThan(rec.personnel);
    expect(r.force.history!.at(-1)!.kind).toBe('rest');
    const full = replenishForce(r.force, rs, { personnel: true, equipment: true });
    walkUnits(full.force, (n) => n.composition.forEach((c) => expect(c.current).toBe(c.authorized)));
  });

  it('перебор параметра: по варианту на значение', () => {
    const sc = makeDemoScenario();
    expect(sweepVariants(sc, rs, { kind: 'intel', side: 'A' })).toHaveLength(rs.intelLevels.length);
    const v = sweepVariants(sc, rs, { kind: 'commander', side: 'A', nodeId: sc.sides[0].formations[0].id });
    expect(v).toHaveLength(rs.commandLevels.length + 1);
    expect(v[0].scenario.sides[0].commanders![sc.sides[0].formations[0].id]).toBe(0);
    expect(sc.sides[0].commanders?.[sc.sides[0].formations[0].id]).toBeUndefined();
  });

  it('перенос типов в набор другой эпохи: классы целей добавляются, дистанции — по порядку; типы сопоставляются', () => {
    const lin = makeLinearRuleset();
    const res = transferFromRuleset(lin, rs, { componentTypes: ['tank'], tempEffects: ['flares'] });
    const tank = res.ruleset.componentTypes.find((t) => t.id === 'tank')!;
    expect(res.ruleset.targetClasses.some((c) => c.id === 'armor')).toBe(true);
    expect(Object.keys(tank.firepower.armor)).toEqual(lin.rangeBands.map((b) => b.id));
    expect(tank.firepower.armor.melee).toBe(rs.componentTypes.find((t) => t.id === 'tank')!.firepower.armor.close);
    expect(res.notes.length).toBeGreaterThan(0);
    expect(res.ruleset.tempEffects.some((x) => x.id === 'flares')).toBe(true);

    const blank = makeBlankRuleset();
    blank.componentTypes.push({ ...rs.componentTypes[0], id: 'my-rifle' });
    const unit = newRootUnit('Рота', { composition: [...rifles(10), { typeId: 'mg', authorized: 2, current: 2 }] });
    const m = suggestTypeMap(['rifleman', 'mg'], rs, blank);
    expect(m).toEqual({ rifleman: 'my-rifle', mg: null });
    remapTypes(unit, m);
    expect(unit.composition).toEqual([{ typeId: 'my-rifle', authorized: 10, current: 10 }]);
  });
});

describe('ширина фронта, удача стороны, доведение приказов', () => {
  const rs = makeUniversalRuleset();
  const ctx = (b: Battle) => new EngineContext(b);

  it('ширина фронта: сверх охвата огонь слабее, грузовики фронта не занимают, без охвата — как раньше', () => {
    const b = createBattle(duel(rs, infantry('Много', 300), infantry('Мало', 100, 'defend')), rs, { seed: 'F1' });
    const big = frontage(ctx(b), 'A').get('')!;
    expect(big.by).toBe('overlap');
    expect(big.factor).toBeLessThan(1);
    // 300 против 100 при охвате 1.5: в первой линии половина; остальные дают 25% огня.
    expect(big.engaged).toBeCloseTo(50);
    expect(big.factor).toBeCloseTo((1 + 1 * rs.coefficients.frontageExcess) / 2);
    expect(frontage(ctx(b), 'B').get('')!.factor).toBe(1);

    // Грузовики и тягачи огня не ведут — места в первой линии не занимают.
    const trucks = infantry('С грузовиками', 100, 'attack', {
      children: [newUnit('Рота', { composition: [...rifles(100), { typeId: 'truck', authorized: 40, current: 40 }] })],
    });
    const t = createBattle(duel(rs, trucks, infantry('Б', 100, 'defend')), rs, { seed: 'F2' });
    expect(frontage(ctx(t), 'A').get('')!.factor).toBe(1);

    // Ширина фронта: 200 м при плотности 20 мест на 100 м — в контакте не больше 40.
    const w = createBattle(duel(rs, infantry('А', 100), infantry('Б', 100, 'defend'), { frontWidth: 200 }), rs, { seed: 'F3' });
    const fw = frontage(ctx(w), 'A').get('')!;
    expect(fw.by).toBe('width');
    expect(fw.engaged).toBeCloseTo(40);

    const off = clone(rs);
    off.coefficients.frontageOverlap = 0;
    const o = createBattle(duel(off, infantry('Много', 300), infantry('Мало', 100, 'defend')), off, { seed: 'F1' });
    expect(frontage(ctx(o), 'A').get('')!.factor).toBe(1);
  });

  it('удача стороны: выпадает в начале боя каждой стороне, входит в огонь; при 0 её нет', () => {
    const b = createBattle(duel(rs, infantry('А', 50), infantry('Б', 50, 'defend')), rs, { seed: 'L1' });
    for (const side of ['A', 'B'] as const) {
      expect(b.sides[side].luck).toBeGreaterThanOrEqual(0.5);
      expect(b.sides[side].luck).toBeLessThanOrEqual(2);
    }
    expect(b.sides.A.luck).not.toBe(b.sides.B.luck);
    expect(b.log.some((e) => e.phase === 'setup' && e.text.includes('Удача'))).toBe(true);
    const off = clone(rs);
    off.coefficients.sideLuck = 0;
    const c = createBattle(duel(off, infantry('А', 50), infantry('Б', 50, 'defend')), off, { seed: 'L1' });
    expect(c.sides.A.luck).toBeUndefined();
  });

  it('приказ ГМ доходит не сразу: шанс от связи и командира; без механики — сразу; повтор тот же', () => {
    const sc = makeDemoScenario();
    const b = createBattle(sc, rs, { seed: 'O1' });
    stepTurn(b);
    const el = b.elements.find((x) => x.name.startsWith('1-я мотострелковая'))!;
    const was = el.orderId;
    applyIntervention(b, { type: 'setOrder', payload: { elementIds: [el.id], orderId: 'defend' } });
    expect(el.orderId).toBe(was);
    expect(el.pendingOrder).toEqual({ orderId: 'defend', since: b.turn });
    const chance = orderChance(ctx(b), el);
    expect(chance).toBeGreaterThan(0.05);
    expect(chance).toBeLessThanOrEqual(1);
    // Хуже связь — дольше доходит.
    const f = b.formations.find((x) => x.id === el.formationId)!;
    const comms = f.comms;
    f.comms = 10;
    expect(orderChance(ctx(b), el)).toBeLessThan(chance);
    f.comms = comms;
    let turns = 0;
    while (el.pendingOrder && turns++ < 30 && !b.finished) stepTurn(b);
    expect(el.pendingOrder).toBeUndefined();
    if (el.status === 'active') expect(el.orderId).toBe('defend');
    expect(b.log.some((e) => e.phase === 'orders' && e.text.includes('дошёл'))).toBe(true);
    // Повтор с вмешательствами — тот же бой.
    expect(strip(replayBattle(b, { withInterventions: true }))).toBe(strip(b));

    const off = clone(rs);
    off.features.orderDelay = false;
    const c = createBattle(sc, off, { seed: 'O1' });
    const el2 = c.elements.find((x) => x.name === el.name)!;
    applyIntervention(c, { type: 'setOrder', payload: { elementIds: [el2.id], orderId: 'defend' } });
    expect(el2.orderId).toBe('defend');
    expect(el2.pendingOrder).toBeUndefined();
  });

  it('бой прежней версии (в снимке правил нет новых ключей) повторяется по прежним правилам', () => {
    const sc = makeDemoScenario();
    const old = clone(rs);
    for (const key of ['frontageOverlap', 'frontageExcess', 'vehicleFrontage', 'frontDensity', 'sideLuck', 'orderSpeed', 'orderCommsMin', 'orderNoCommander'])
      delete old.coefficients[key];
    delete (old.features as Partial<typeof old.features>).orderDelay;
    Object.assign(old.coefficients, { moralePerLossPct: 1.2, retreatLossPct: 50 });
    const b = createBattle(sc, rs, { seed: 'C1' });
    b.ruleset = clone(old);
    const r = replayBattle(b, { toEnd: true });
    expect(r.sides.A.luck).toBeUndefined();
    expect(r.log.some((e) => e.factors?.some((f) => f.label.startsWith('Ширина фронта')))).toBe(false);
    // Тот же бой, что с явно выключенными механиками.
    const manual = clone(rs);
    Object.assign(manual.coefficients, { frontageOverlap: 0, sideLuck: 0, moralePerLossPct: 1.2, retreatLossPct: 50 });
    manual.features.orderDelay = false;
    const m = createBattle(sc, manual, { seed: 'C1' });
    runToEnd(m);
    expect(strip(r)).toBe(strip(m));
  });

  it('калибровка переводит на новые значения только то, что в наборе не меняли', () => {
    const r = clone(rs);
    Object.assign(r.coefficients, { moralePerLossPct: 1.2, retreatLossPct: 45 });
    expect(recalibrateRuleset(r)).toEqual(['moralePerLossPct']);
    expect(r.coefficients.moralePerLossPct).toBe(1.5);
    expect(r.coefficients.retreatLossPct).toBe(45);
    expect(recalibrateRuleset(r)).toEqual([]);
  });
});

describe('неполный состав в бою (малые операции)', () => {
  const rs = makeUniversalRuleset();
  const squad = () => newRootUnit('Отделение', { composition: [...rifles(9), { typeId: 'mg', authorized: 1, current: 1 }], state: { morale: 80 } });

  it('из состава в бой идёт только выделенное: по типам, вплоть до одного; остальное не меняется', () => {
    const comp = squad().composition;
    expect(limitComposition(comp, { rifleman: 3, mg: 0 })).toEqual([{ typeId: 'rifleman', authorized: 3, current: 3 }]);
    expect(limitComposition(comp, { rifleman: 1 })).toEqual([{ typeId: 'rifleman', authorized: 1, current: 1 }, comp[1]]);
    // Не меньше, чем в строю, — весь состав как есть.
    expect(limitComposition(comp, { rifleman: 20 })).toBe(comp);
    const u = squad();
    expect(withoutExcluded(u, [], { [u.id]: { rifleman: 0, mg: 0 } })).toBeNull();
    // Из батареи не выделено никого — её в бою нет; само подразделение не меняется.
    const bn = makeDemoBattalion();
    const bat = bn.children.find((c) => c.name.includes('Миномётная'))!;
    const pruned = withoutExcluded(bn, [], { [bat.id]: { mortar: 0, truck: 0 } })!;
    expect(pruned.children.some((c) => c.id === bat.id)).toBe(false);
    expect(bn.children.some((c) => c.id === bat.id)).toBe(true);
  });

  it('бой идёт с выделенными, итоги ложатся на всё подразделение сил; состояние — на долю участвовавших', () => {
    const own = squad();
    const sc = duel(rs, own, infantry('Дозор', 3, 'defend'));
    sc.sides[0].partial = { [own.id]: { rifleman: 3, mg: 0 } };
    expect(summarizeUnits(sideUnits(sc.sides[0]), rs).persCur).toBe(3);
    const { scenario, forces } = extractForces(sc, new Set(), () => newId('u'));
    const map = Object.fromEntries(forces.map((f) => [f.id, f])) as Record<string, UnitNode>;
    const b = createBattle(resolveScenario(scenario, map), rs, { seed: 'P1' });
    const el = b.elements.find((x) => x.side === 'A')!;
    expect(el.startPersonnel).toBe(3);
    expect(el.comps.map((c) => c.typeId)).toEqual(['rifleman']);
    expect(b.log.some((e) => e.phase === 'setup' && e.text.includes('Стрелок 3 из 9'))).toBe(true);
    runToEnd(b);
    const lost = el.comps[0].start - el.comps[0].current;
    const f = applyBattleToForces(b, map).updated.find((x) => x.id === own.id)!;
    expect(f.composition.find((c) => c.typeId === 'rifleman')!.current).toBe(9 - lost);
    expect(f.composition.find((c) => c.typeId === 'mg')!.current).toBe(1);
    // Доля участвовавших — по людям с расчётами: 3 стрелка из 9 стрелков и расчёта пулемёта.
    const crew = rs.componentTypes.find((t) => t.id === 'mg')!.crew;
    expect(f.state.morale).toBe(Math.round(80 + (el.morale - 80) * (3 / (9 + crew))));
  });

  it('импорт сценария с занятыми идентификаторами: неполный состав следует за новыми', () => {
    const own = squad();
    const sc = duel(rs, own, infantry('Б', 3, 'defend'));
    sc.sides[0].partial = { [own.id]: { rifleman: 2 } };
    const { scenario, forces } = extractForces(sc, new Set([own.id]), () => newId('u'));
    const newIdOf = forces[0].id;
    expect(newIdOf).not.toBe(own.id);
    expect(scenario.sides[0].partial).toEqual({ [newIdOf]: { rifleman: 2 } });
  });
});

describe('часы боя, «стоять насмерть» в сценарии, передача частей', () => {
  const rs = makeUniversalRuleset();
  const split = (src = makeDemoScenario()) => {
    const { scenario, forces } = extractForces(src, new Set(), () => newId('u'));
    return { scenario, forces: Object.fromEntries(forces.map((f) => [f.id, f])) as Record<string, UnitNode> };
  };

  it('длительность в часах: ходов — по длине хода набора правил; «удержать позицию» — тоже в часах', () => {
    const sc = makeDemoScenario();
    expect(sc.hours).toBe(4);
    const b = createBattle(sc, rs, { seed: 'H1' });
    expect(b.scenario.maxTurns).toBe(16);
    expect(b.scenario.hours).toBeUndefined();
    expect(b.scenario.sides[1].objectives.find((o) => o.type === 'hold')!.value).toBe(12);
    // Ход вдвое длиннее — ходов вдвое меньше, время то же.
    const slow = { ...clone(rs), turnMinutes: 30 };
    expect(createBattle(sc, slow, { seed: 'H1' }).scenario.maxTurns).toBe(8);
    expect(turnsFor(4, slow)).toBe(8);
    // Сценарий прежней версии (в ходах) переводится на часы без изменения расчёта.
    const old = { ...clone(sc), maxTurns: 10 };
    delete old.hours;
    old.sides[1].objectives = [{ ...old.sides[1].objectives[0], value: 6 }];
    const conv = scenarioToHours(old, rs);
    expect(conv.hours).toBe(2.5);
    expect(conv.sides[1].objectives[0].value).toBe(1.5);
    expect(scenarioInTurns(conv, rs).maxTurns).toBe(10);
    expect(scenarioInTurns(conv, rs).sides[1].objectives[0].value).toBe(6);
    // Повтор боя — по снимку в ходах, так же.
    runToEnd(b);
    expect(strip(replayBattle(b, { toEnd: true }))).toBe(strip(b));
  });

  it('«стоять насмерть» задаётся в сценарии и действует на подчинённых; из старых копий — переносится', () => {
    const sc = makeDemoScenario();
    const def = sc.sides[1].formations[0];
    sc.sides[1].holdFast = [def.id];
    const b = createBattle(sc, rs, { seed: 'HF' });
    expect(b.elements.filter((x) => x.side === 'B').every((x) => x.holdFast)).toBe(true);
    expect(b.elements.filter((x) => x.side === 'A').some((x) => x.holdFast)).toBe(false);
    // Старый сценарий с отметкой у подразделения: при переводе на силы отметка — в сценарии, у сил её нет.
    const old = makeDemoScenario();
    const p1 = old.sides[1].formations[0].children.find((c) => c.name === '1-й взвод')!;
    p1.holdFast = true;
    const { scenario, forces } = split(old);
    expect(scenario.sides[1].holdFast).toEqual([p1.id]);
    walkUnits(forces[old.sides[1].formations[0].id], (n) => expect(n.holdFast).toBe(false));
    const c = createBattle(resolveScenario(scenario, forces), rs, { seed: 'HF' });
    expect(c.elements.find((x) => x.defId === p1.id)!.holdFast).toBe(true);
  });

  it('передача части в другое подразделение и возврат на место; ссылки сценария следуют за частью', () => {
    const { scenario, forces } = split();
    const bn = Object.values(forces).find((f) => f.name.includes('батальон'))!;
    const def = Object.values(forces).find((f) => f.id !== bn.id)!;
    const tank = bn.children.find((c) => c.name.includes('Танковая'))!;
    const at = bn.children.indexOf(tank);
    // Танковую роту — обороне.
    const p = transferUnit(forces, tank.id, def.id);
    if (typeof p === 'string') throw new Error(p);
    const after = { ...forces, ...(p as Record<string, UnitNode>) };
    expect(findUnit(after[bn.id], tank.id)).toBeNull();
    const moved = findUnit(after[def.id], tank.id)!;
    expect(moved.transfer).toMatchObject({ forceId: bn.id, parentId: bn.id, index: at, fromName: bn.name });
    expect(typeof transferUnit(after, def.id, findUnit(after[def.id], tank.id)!.id)).toBe('string');
    // Сценарий, где танковая рота была отдельной частью стороны, ссылается на новое место.
    const sc2 = clone(scenario);
    sc2.sides[0].units = [{ forceId: bn.id, nodeId: tank.id }];
    const re = relinkScenario(sc2, after)!;
    expect(re.sides[0].units).toEqual([{ forceId: def.id, nodeId: tank.id }]);
    // Возврат: на прежнее место у прежнего старшего.
    const r = returnUnit(after, tank.id);
    if (typeof r === 'string') throw new Error(r);
    const back = { ...after, ...(r as Record<string, UnitNode>) };
    expect(back[bn.id].children[at].id).toBe(tank.id);
    expect(back[bn.id].children[at].transfer).toBeUndefined();
    expect(findUnit(back[def.id], tank.id)).toBeNull();
    expect(relinkScenario(re, back)!.sides[0].units).toEqual([{ forceId: bn.id, nodeId: tank.id }]);
    expect(returnUnit(back, tank.id)).toContain('никуда не передавалось');
  });

  it('силы целиком: переданы — больше не самостоятельны; возврат — снова отдельные силы', () => {
    const { forces } = split();
    const [a, b] = Object.values(forces);
    const p = transferUnit(forces, a.id, b.id) as Record<string, UnitNode | null>;
    expect(p[a.id]).toBeNull();
    const after: Record<string, UnitNode> = {};
    for (const [id, f] of Object.entries({ ...forces, ...p })) if (f) after[id] = f;
    expect(after[a.id]).toBeUndefined();
    expect(locateNode(after, a.id)!.force.id).toBe(b.id);
    const r = returnUnit(after, a.id) as Record<string, UnitNode | null>;
    expect(r[a.id]!.id).toBe(a.id);
    expect(r[a.id]!.transfer).toBeUndefined();
    expect(findUnit(r[b.id]!, a.id)).toBeNull();
  });
});
