// Массовое моделирование: N прогонов одного сценария с сидами «база#1», «база#2», …
// Любой прогон можно открыть как полноценный бой по его сиду.

import { createBattle, runToEnd } from './battle';
import { clone, normalizeRuleset } from './defaults';
import type { Battle, Id, Ruleset, Scenario, SideId } from './types';

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
    endReason: r.endReason,
    sides,
  };
}

export function runOne(scenario: Scenario, ruleset: Ruleset, seed: string, index = 0): RunSummary {
  const b = createBattle(scenario, ruleset, { seed, silent: true, shareInputs: true });
  runToEnd(b);
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

export function aggregate(runs: RunSummary[], ruleset: Ruleset, sideNames: Record<SideId, string>, baseSeed: string, ms = 0): MonteCarloResult {
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
  const add = (key: string, label: string, unit: string, side: SideId | null, values: number[]) => metrics.push({ key, label, unit, side, stats: stats(values), values });
  add('turns', 'Длительность боя', 'ход.', null, runs.map((r) => r.turns));
  for (const side of ['A', 'B'] as SideId[]) {
    const pick = (f: (s: RunSideSummary) => number) => runs.map((r) => f(r.sides[side]));
    add(`${side}.personnelLoss`, 'Потери личного состава', 'чел.', side, pick((s) => s.personnelLoss));
    add(`${side}.personnelLossPct`, 'Потери личного состава', '%', side, pick((s) => s.personnelLossPct));
    add(`${side}.kia`, '  в т.ч. убитыми', 'чел.', side, pick((s) => s.kia));
    const typeIds = new Set<string>();
    for (const r of runs) for (const id of Object.keys(r.sides[side].equipmentLoss)) typeIds.add(id);
    for (const id of typeIds) {
      const t = ruleset.componentTypes.find((x) => x.id === id);
      add(`${side}.eq.${id}`, `Потери: ${t?.name ?? id}`, 'ед.', side, pick((s) => s.equipmentLoss[id] ?? 0));
    }
    add(`${side}.valueLossPct`, 'Потеря боевой ценности', '%', side, pick((s) => s.valueLossPct));
    add(`${side}.ce`, 'Остаточная боеспособность', '%', side, pick((s) => s.ce));
    add(`${side}.organization`, 'Организация', '%', side, pick((s) => s.organization));
    add(`${side}.morale`, 'Мораль в конце', '', side, pick((s) => s.morale));
    add(`${side}.ammo`, 'Боезапас в конце', '%', side, pick((s) => s.ammo));
    add(`${side}.score`, 'Выполнение задач', '%', side, pick((s) => s.score));
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
  };
}

/** Синхронный вариант (для тестов и командной строки). */
export function runMany(scenario: Scenario, rulesetIn: Ruleset, n: number, baseSeed: string): MonteCarloResult {
  const t0 = Date.now();
  const ruleset = normalizeRuleset(clone(rulesetIn));
  const runs: RunSummary[] = [];
  for (let i = 0; i < n; i++) runs.push(runOne(scenario, ruleset, runSeed(baseSeed, i), i));
  const names = { A: scenario.sides[0].name, B: scenario.sides[1].name };
  return aggregate(runs, ruleset, names, baseSeed, Date.now() - t0);
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
  let lastYield = Date.now();
  for (let i = 0; i < n; i++) {
    if (isCancelled?.()) break;
    runs.push(runOne(scenario, ruleset, runSeed(baseSeed, i), i));
    if (Date.now() - lastYield > 30) {
      onProgress?.(i + 1, n);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  onProgress?.(runs.length, n);
  const names = { A: scenario.sides[0].name, B: scenario.sides[1].name };
  return aggregate(runs, ruleset, names, baseSeed, Date.now() - t0);
}
