// Массовое моделирование: N прогонов одного сценария с сидами «база#1», «база#2», …
// Любой прогон можно открыть как полноценный бой по его сиду.

import { createBattle, runToEnd } from './battle';
import { EngineContext, notArrived } from './context';
import { clone, normalizeRuleset } from './defaults';
import type { Battle, ElementState, Id, Ruleset, Scenario, SideId } from './types';

export interface RunSideSummary {
  personnelLoss: number;
  personnelLossPct: number;
  kia: number;
  wia: number;
  mia: number;
  valueLossPct: number;
  ce: number;
  organization: number;
  morale: number;
  ammo: number;
  score: number;
  equipmentLoss: Record<Id, number>;
  /** Потери личного состава подразделений верхних уровней, %: формирование или элемент → %. */
  units?: Record<Id, number>;
  /** Выполнение задач стороны, % (по порядку задач). */
  objectives?: number[];
}

/** Подписи формирований и задач сторон (одинаковы во всех прогонах сценария). */
export interface RunMeta {
  units: Record<SideId, { id: Id; name: string; depth: number }[]>;
  objectives: Record<SideId, string[]>;
}

/** Подразделений стороны в разбивке прогонов — не больше. */
const MAX_UNITS = 16;

/**
 * Подразделения стороны для разбивки: подчинённые старшего (формирования и элементы); если старших
 * несколько — и они сами. Потери личного состава, % (не подошедшие подкрепления не считаются).
 */
function unitLosses(b: Battle, side: SideId): { id: Id; name: string; depth: number; lossPct: number }[] {
  const E = new EngineContext(b);
  const roots = b.formations.filter((f) => f.side === side && !f.parentId);
  const sub = (fid: Id) => {
    const ids = new Set([fid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of b.formations)
        if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
          ids.add(x.id);
          grew = true;
        }
    }
    return b.elements.filter((x) => ids.has(x.formationId));
  };
  const out: { id: Id; name: string; depth: number; lossPct: number }[] = [];
  const push = (id: Id, name: string, depth: number, els: ElementState[]) => {
    let start = 0;
    let now = 0;
    for (const el of els) {
      if (notArrived(el)) continue;
      start += el.startPersonnel;
      now += E.personnel(el);
    }
    if (start > 0) out.push({ id, name, depth, lossPct: Math.round((1 - now / start) * 1000) / 10 });
  };
  const many = roots.length > 1;
  for (const r of roots) {
    if (many) push(r.id, r.name, 0, sub(r.id));
    const d = many ? 1 : 0;
    for (const f of b.formations.filter((x) => x.parentId === r.id)) push(f.id, f.name, d, sub(f.id));
    for (const el of b.elements.filter((x) => x.formationId === r.id)) push(el.id, el.name, d, [el]);
  }
  return out.slice(0, MAX_UNITS);
}

export interface RunSummary {
  index: number;
  seed: string;
  outcomeId: Id;
  outcomeName: string;
  winner: SideId | null;
  headline: string;
  diff: number;
  turns: number;
  /** Длительность боя, ч. */
  hours: number;
  endReason: string;
  sides: Record<SideId, RunSideSummary>;
}

export interface Stats {
  mean: number;
  sd: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
}

export interface OutcomeBucket {
  key: string;
  winner: SideId | null;
  outcomeId: Id;
  label: string;
  count: number;
  pct: number;
}

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  side: SideId | null;
  stats: Stats;
  values: number[];
}

export interface MonteCarloResult {
  runs: RunSummary[];
  n: number;
  baseSeed: string;
  winA: number;
  winB: number;
  draw: number;
  outcomes: OutcomeBucket[];
  metrics: MetricRow[];
  sideNames: Record<SideId, string>;
  ms: number;
  /** Подписи формирований и задач (у результатов прежних версий нет). */
  meta?: RunMeta;
}

export function runSeed(baseSeed: string, i: number): string {
  return `${baseSeed}#${i + 1}`;
}

export function summarizeRun(b: Battle, index: number): RunSummary {
  const r = b.result!;
  const sides = {} as Record<SideId, RunSideSummary>;
  for (const side of ['A', 'B'] as SideId[]) {
    const s = r.sides[side];
    const equipmentLoss: Record<Id, number> = {};
    for (const q of s.equipment) equipmentLoss[q.typeId] = q.losses;
    const units: Record<Id, number> = {};
    for (const u of unitLosses(b, side)) units[u.id] = u.lossPct;
    sides[side] = {
      personnelLoss: s.personnel.losses,
      personnelLossPct: s.personnel.lossPct,
      kia: s.personnel.kia,
      wia: s.personnel.wia,
      mia: s.personnel.mia,
      valueLossPct: s.valueLossPct,
      ce: s.combatEffectiveness,
      organization: s.organization,
      morale: s.morale,
      ammo: s.supply.ammo,
      score: s.score * 100,
      equipmentLoss,
      units,
      objectives: s.objectives.map((o) => Math.round(o.score * 1000) / 10),
    };
  }
  return {
    index,
    seed: b.seed,
    outcomeId: r.outcomeId,
    outcomeName: r.outcomeName,
    winner: r.winner,
    headline: r.headline,
    diff: r.scoreDiff,
    turns: r.turns,
    hours: (r.turns * b.ruleset.turnMinutes) / 60,
    endReason: r.endReason,
    sides,
  };
}

/** Подписи формирований и задач по завершённому бою. */
export function runMeta(b: Battle): RunMeta {
  const units = {} as RunMeta['units'];
  const objectives = {} as RunMeta['objectives'];
  for (const side of ['A', 'B'] as SideId[]) {
    const s = b.result!.sides[side];
    units[side] = unitLosses(b, side).map(({ id, name, depth }) => ({ id, name, depth }));
    objectives[side] = s.objectives.map((o) => o.label);
  }
  return { units, objectives };
}

/** Один прогон; meta (если передан) получает подписи формирований и задач. */
export function runOne(scenario: Scenario, ruleset: Ruleset, seed: string, index = 0, meta?: { value?: RunMeta }): RunSummary {
  const b = createBattle(scenario, ruleset, { seed, silent: true, shareInputs: true });
  runToEnd(b);
  if (meta && !meta.value) meta.value = runMeta(b);
  return summarizeRun(b, index);
}

export function stats(values: number[]): Stats {
  if (!values.length) return { mean: 0, sd: 0, min: 0, p10: 0, median: 0, p90: 0, max: 0 };
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  };
  const mean = v.reduce((a, x) => a + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / v.length);
  return { mean, sd, min: v[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: v[v.length - 1] };
}

export function aggregate(runs: RunSummary[], ruleset: Ruleset, sideNames: Record<SideId, string>, baseSeed: string, ms = 0, meta?: RunMeta): MonteCarloResult {
  const n = runs.length;
  const buckets = new Map<string, OutcomeBucket>();
  const levelOrder = [...ruleset.outcomeLevels].sort((a, b) => b.minDiff - a.minDiff);
  for (const r of runs) {
    const key = r.winner ? `${r.winner}:${r.outcomeId}` : 'draw';
    const b = buckets.get(key) ?? {
      key,
      winner: r.winner,
      outcomeId: r.outcomeId,
      label: r.winner ? `${r.outcomeName}: ${sideNames[r.winner]}` : r.outcomeName,
      count: 0,
      pct: 0,
    };
    b.count++;
    buckets.set(key, b);
  }
  const rank = (b: OutcomeBucket) => {
    const li = levelOrder.findIndex((l) => l.id === b.outcomeId);
    if (!b.winner) return 100;
    return b.winner === 'A' ? li : 200 - li;
  };
  const outcomes = [...buckets.values()].map((b) => ({ ...b, pct: n ? (b.count / n) * 100 : 0 })).sort((a, b) => rank(a) - rank(b));

  const metrics: MetricRow[] = [];
  const add = (key: string, label: string, unit: string, side: SideId | null, values: number[]) =>
    metrics.push({ key, label, unit, side, stats: stats(values), values });
  add(
    'turns',
    'Длительность боя',
    'ход.',
    null,
    runs.map((r) => r.turns),
  );
  add(
    'hours',
    'Длительность боя',
    'ч',
    null,
    runs.map((r) => r.hours ?? (r.turns * ruleset.turnMinutes) / 60),
  );
  for (const side of ['A', 'B'] as SideId[]) {
    const pick = (f: (s: RunSideSummary) => number) => runs.map((r) => f(r.sides[side]));
    add(
      `${side}.personnelLoss`,
      'Потери личного состава',
      'чел.',
      side,
      pick((s) => s.personnelLoss),
    );
    add(
      `${side}.personnelLossPct`,
      'Потери личного состава',
      '%',
      side,
      pick((s) => s.personnelLossPct),
    );
    add(
      `${side}.kia`,
      '  в т.ч. убитыми',
      'чел.',
      side,
      pick((s) => s.kia),
    );
    const typeIds = new Set<string>();
    for (const r of runs) for (const id of Object.keys(r.sides[side].equipmentLoss)) typeIds.add(id);
    for (const id of typeIds) {
      const t = ruleset.componentTypes.find((x) => x.id === id);
      add(
        `${side}.eq.${id}`,
        `Потери: ${t?.name ?? id}`,
        'ед.',
        side,
        pick((s) => s.equipmentLoss[id] ?? 0),
      );
    }
    add(
      `${side}.valueLossPct`,
      'Потеря боевой ценности',
      '%',
      side,
      pick((s) => s.valueLossPct),
    );
    add(
      `${side}.ce`,
      'Остаточная боеспособность',
      '%',
      side,
      pick((s) => s.ce),
    );
    add(
      `${side}.organization`,
      'Организация',
      '%',
      side,
      pick((s) => s.organization),
    );
    add(
      `${side}.morale`,
      'Мораль в конце',
      '',
      side,
      pick((s) => s.morale),
    );
    add(
      `${side}.ammo`,
      'Боезапас в конце',
      '%',
      side,
      pick((s) => s.ammo),
    );
    add(
      `${side}.score`,
      'Выполнение задач',
      '%',
      side,
      pick((s) => s.score),
    );
    // Разбивка: задачи (выполнение, %) и формирования (потери личного состава, %).
    meta?.objectives[side].forEach((label, i) =>
      add(
        `${side}.obj.${i}`,
        `Задача: ${label}`,
        '%',
        side,
        pick((s) => s.objectives?.[i] ?? 0),
      ),
    );
    for (const u of meta?.units[side] ?? [])
      add(
        `${side}.unit.${u.id}`,
        `Потери л/с — ${'  '.repeat(u.depth)}${u.name}`,
        '%',
        side,
        pick((s) => s.units?.[u.id] ?? 0),
      );
  }
  return {
    runs,
    n,
    baseSeed,
    winA: n ? (runs.filter((r) => r.winner === 'A').length / n) * 100 : 0,
    winB: n ? (runs.filter((r) => r.winner === 'B').length / n) * 100 : 0,
    draw: n ? (runs.filter((r) => !r.winner).length / n) * 100 : 0,
    outcomes,
    metrics,
    sideNames,
    ms,
    meta,
  };
}

/** Синхронный вариант (для тестов и командной строки). */
export function runMany(scenario: Scenario, rulesetIn: Ruleset, n: number, baseSeed: string): MonteCarloResult {
  const t0 = Date.now();
  const ruleset = normalizeRuleset(clone(rulesetIn));
  const runs: RunSummary[] = [];
  const meta: { value?: RunMeta } = {};
  for (let i = 0; i < n; i++) runs.push(runOne(scenario, ruleset, runSeed(baseSeed, i), i, meta));
  const names = { A: scenario.sides[0].name, B: scenario.sides[1].name };
  return aggregate(runs, ruleset, names, baseSeed, Date.now() - t0, meta.value);
}

/** Асинхронный вариант для интерфейса: считает порциями, не блокируя окно. */
export async function runManyAsync(
  scenario: Scenario,
  rulesetIn: Ruleset,
  n: number,
  baseSeed: string,
  onProgress?: (done: number, n: number) => void,
  isCancelled?: () => boolean,
): Promise<MonteCarloResult> {
  const t0 = Date.now();
  const ruleset = normalizeRuleset(clone(rulesetIn));
  const runs: RunSummary[] = [];
  const meta: { value?: RunMeta } = {};
  let lastYield = Date.now();
  for (let i = 0; i < n; i++) {
    if (isCancelled?.()) break;
    runs.push(runOne(scenario, ruleset, runSeed(baseSeed, i), i, meta));
    if (Date.now() - lastYield > 30) {
      onProgress?.(i + 1, n);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  onProgress?.(runs.length, n);
  const names = { A: scenario.sides[0].name, B: scenario.sides[1].name };
  return aggregate(runs, ruleset, names, baseSeed, Date.now() - t0, meta.value);
}
