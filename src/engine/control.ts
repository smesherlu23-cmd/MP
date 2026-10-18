// Управление боем для ГМ: ход до важного события и прогноз «что дальше?» с текущего хода.

import { eventTurn, runToEnd, stepTurn } from './battle';
import { EngineContext } from './context';
import { clone } from './defaults';
import { rewindBattle } from './interventions';
import { aggregate, runSeed, summarizeRun, type MonteCarloResult, type RunSummary } from './montecarlo';
import { resolveRefs } from './report';
import { Rng } from './rng';
import type { Battle, SideId } from './types';

// ------------------------------------------------------------------ ход до события

/** Какие события останавливают «ход до события». */
export interface PauseRules {
  rout: boolean;
  retreat: boolean;
  destroyed: boolean;
  hq: boolean;
  broken: boolean;
  reserve: boolean;
  band: boolean;
  arrive: boolean;
  plan: boolean;
  /** Потери стороны за ход, % (0 — не останавливаться). */
  lossPct: number;
}

export const DEFAULT_PAUSE: PauseRules = {
  rout: true,
  retreat: false,
  destroyed: true,
  hq: true,
  broken: true,
  reserve: true,
  band: true,
  arrive: true,
  plan: true,
  lossPct: 10,
};

export const PAUSE_LABELS: Record<Exclude<keyof PauseRules, 'lossPct'>, string> = {
  rout: 'бегство подразделения',
  retreat: 'начало отхода',
  destroyed: 'подразделение уничтожено',
  hq: 'потеря штаба',
  broken: 'формирование сломлено',
  reserve: 'ввод резерва',
  band: 'смена дистанции',
  arrive: 'подход подкреплений',
  plan: 'событие плана боя и удары',
};

interface Before {
  status: Map<string, string>;
  behavior: Map<string, string>;
  hq: Set<string>;
  broken: Set<string>;
  bands: number[];
}

function before(b: Battle): Before {
  const E = new EngineContext(b);
  return {
    status: new Map(b.elements.map((x) => [x.id, x.status])),
    behavior: new Map(b.elements.map((x) => [x.id, E.behavior(x)])),
    hq: new Set(b.formations.filter((f) => f.hqLost).map((f) => f.id)),
    broken: new Set(b.formations.filter((f) => f.broken).map((f) => f.id)),
    bands: b.sectors ? b.sectors.map((x) => x.bandIndex) : [b.bandIndex],
  };
}

/** Что из важного случилось за последний ход (по правилам паузы). */
function happened(b: Battle, was: Before, rules: PauseRules, logFrom: number): string[] {
  const E = new EngineContext(b);
  const out: string[] = [];
  const name = (id: string) => resolveRefs(`[[e:${id}]]`, b);
  const list = (ids: string[], what: string) => {
    if (!ids.length) return;
    out.push(`${ids.length > 3 ? `${ids.slice(0, 3).map(name).join(', ')} и ещё ${ids.length - 3}` : ids.map(name).join(', ')} — ${what}`);
  };
  const changed = (pred: (prevStatus: string, prevBh: string, el: (typeof b.elements)[number]) => boolean) =>
    b.elements.filter((el) => pred(was.status.get(el.id) ?? '', was.behavior.get(el.id) ?? '', el)).map((x) => x.id);
  if (rules.rout) list(changed((_ps, pb, el) => el.status === 'active' && E.behavior(el) === 'rout' && pb !== 'rout'), 'бегство');
  if (rules.retreat) list(changed((_ps, pb, el) => el.status === 'active' && E.behavior(el) === 'retreat' && pb !== 'retreat'), 'отход');
  if (rules.destroyed) list(changed((ps, _pb, el) => el.status === 'destroyed' && ps !== 'destroyed'), 'уничтожено');
  if (rules.arrive) list(changed((ps, _pb, el) => ps === 'pending' && el.status === 'active'), 'подошло');
  if (rules.reserve) list(changed((ps, pb, el) => ps === 'active' && pb === 'reserve' && el.status === 'active' && E.behavior(el) !== 'reserve'), 'введено в бой');
  for (const f of b.formations) {
    if (rules.hq && f.hqLost && !was.hq.has(f.id)) out.push(`${resolveRefs(`[[f:${f.id}]]`, b)} — штаб потерян`);
    if (rules.broken && f.broken && !was.broken.has(f.id)) out.push(`${resolveRefs(`[[f:${f.id}]]`, b)} — формирование сломлено`);
  }
  if (rules.band) {
    const now = b.sectors ? b.sectors.map((x) => x.bandIndex) : [b.bandIndex];
    now.forEach((v, i) => {
      if (v === was.bands[i]) return;
      const band = b.ruleset.rangeBands[v]?.name.toLowerCase() ?? '—';
      out.push(b.sectors ? `${b.sectors[i].name}: дистанция ${band}` : `дистанция ${band}`);
    });
  }
  if (rules.plan)
    for (const e of b.log.slice(logFrom)) if (e.level === 0 && (e.phase === 'plan' || (e.phase === 'fire' && /удар «/.test(e.text)))) out.push(resolveRefs(e.text, b).replace(/\.$/, ''));
  if (rules.lossPct > 0 && b.history.length >= 2) {
    const prev = b.history[b.history.length - 2].sides;
    const cur = b.history[b.history.length - 1].sides;
    for (const side of ['A', 'B'] as SideId[]) {
      const lost = prev[side].personnel - cur[side].personnel;
      const pct = prev[side].personnel > 0 ? (lost / prev[side].personnel) * 100 : 0;
      if (pct >= rules.lossPct) out.push(`${b.sides[side].name}: потери за ход ${Math.round(pct)}%`);
    }
  }
  return out;
}

/**
 * Считать ходы, пока не случится что-то важное (или бой не кончится). Возвращает, сколько ходов
 * сделано и что произошло на последнем.
 */
export function stepUntilEvent(b: Battle, rules: PauseRules, maxSteps = 500): { steps: number; reasons: string[] } {
  let steps = 0;
  while (!b.finished && steps < maxSteps) {
    const was = before(b);
    const from = b.log.length;
    stepTurn(b);
    steps++;
    const reasons = happened(b, was, rules, from);
    if (reasons.length) return { steps, reasons };
  }
  return { steps, reasons: [] };
}

// ------------------------------------------------------------------ прогноз

/** Копия боя для продолжения в тихом режиме: без журнала; сценарий и правила общие (только читаются). */
function continuation(b: Battle, seed: string): Battle {
  const { scenario, ruleset, log: _log, ...rest } = b;
  const c = clone(rest) as Battle;
  c.scenario = scenario;
  c.ruleset = ruleset;
  c.log = [];
  c.silent = true;
  const rng = Rng.fromSeed(seed);
  // Ещё не наступившие события плана с разбросом — заново: ГМ не знает, когда они наступят.
  for (const ev of scenario.events ?? []) {
    if (!ev.spread || ev.trigger) continue;
    const t = eventTurn(b, ev);
    if (t === undefined || t <= b.turn) continue;
    const off = Math.floor(rng.next() * (2 * ev.spread + 1)) - ev.spread;
    (c.eventTurns ??= {})[ev.id] = Math.max(b.turn + 1, ev.turn + off);
  }
  c.rng = [...rng.state] as Battle['rng'];
  return c;
}

/** Прогноз с текущего хода: n продолжений боя с разными случайностями (решения ГМ после — не учитываются). */
export async function forecastAsync(
  b: Battle,
  n: number,
  baseSeed: string,
  onProgress?: (done: number, n: number) => void,
  isCancelled?: () => boolean,
): Promise<MonteCarloResult> {
  const t0 = Date.now();
  const runs: RunSummary[] = [];
  let lastYield = Date.now();
  for (let i = 0; i < n; i++) {
    if (isCancelled?.()) break;
    const c = continuation(b, runSeed(baseSeed, i));
    runToEnd(c);
    runs.push(summarizeRun(c, i));
    if (Date.now() - lastYield > 30) {
      onProgress?.(i + 1, n);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  onProgress?.(runs.length, n);
  return aggregate(runs, b.ruleset, { A: b.sides.A.name, B: b.sides.B.name }, baseSeed, Date.now() - t0);
}

export function forecast(b: Battle, n: number, baseSeed: string): MonteCarloResult {
  const runs: RunSummary[] = [];
  for (let i = 0; i < n; i++) {
    const c = continuation(b, runSeed(baseSeed, i));
    runToEnd(c);
    runs.push(summarizeRun(c, i));
  }
  return aggregate(runs, b.ruleset, { A: b.sides.A.name, B: b.sides.B.name }, baseSeed);
}

/** Тот же бой без решений ГМ, принятых после последнего хода (для сравнения в прогнозе). null — их нет или повтор разошёлся. */
export function withoutCurrentDecisions(b: Battle): Battle | null {
  if (!b.interventions.some((x) => x.turn === b.turn)) return null;
  return rewindBattle(b, b.turn, 0);
}
