import { describe, expect, it } from 'vitest';
import {
  applyIntervention,
  clone,
  canMove,
  createBattle,
  defaultCommandLevel,
  displayNames,
  formatReport,
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
  type Battle,
  type UnitNode,
  type Ruleset,
  type Scenario,
} from '../src/engine';

const strip = (b: Battle) => JSON.stringify({ el: b.elements, hist: b.history, res: b.result ? { ...b.result, keyEvents: [] } : null, rng: b.rng });

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
    // без своего командира в шаблоне — без командира в бою
    const noCmd = createBattle(duel(rs, infantry('Синие', 60, 'attack', { commandLevel: null }), infantry('Красные', 60)), rs, { seed: 'CMD' });
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
      newRootUnit(name, {
        order,
        children: Array.from({ length: 12 }, (_, i) =>
          newUnit(`${name} ${i + 1}`, { composition: [{ typeId: 'rifleman', authorized: 250, current: 250 }, { typeId: 'mg', authorized: 9, current: 9 }] }),
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
    const d = newRootUnit('Оборона', {
      order: 'defend',
      children: [newUnit('Застава', { composition: rifles(5) }), newUnit('Резерв', { order: 'reserve', echelon: 'rear', composition: rifles(30) })],
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
      children: [newUnit('Батальон', { state: { morale: 90 }, children: [newUnit('Рота', { composition: rifles(50) })] }), newUnit('Рота 2', { composition: rifles(50), state: { experience: 1 } })],
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
    tpl.composition = [{ typeId: 'rifleman', authorized: 32, current: 32 }, { typeId: 'mg', authorized: 2, current: 2 }];
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
      elements: [{ id: 'old-e1', name: 'Рота', role: 'рота', echelon: 'front', order: null, composition: rifles(90, 80), experience: 3, morale: 65, cohesion: 70, readiness: 90, ammo: 100, fuel: 100, equipment: 100, fatigue: 5, vehicleCondition: 90, attackMod: 100, defenseMod: 100, isHQ: false, holdFast: false, tags: [] }],
      subunits: [{ id: 'old-sub', name: 'Группа', kind: 'группа', commanderName: '', commandLevel: 3, comms: null, supply: null, order: null, elements: [], subunits: [], tags: [] }],
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
