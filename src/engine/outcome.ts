// Итоги боя: потери, боеспособность, организация, снабжение, выполнение задач и исход.

import { EngineContext, lerp } from './context';
import { newObjective } from './defaults';
import { OBJECTIVE_SHORT } from './labels';
import type {
  Behavior,
  BattleResult,
  ElementState,
  EquipmentStats,
  FormationSummary,
  Objective,
  ObjectiveResult,
  SideId,
  SideResult,
  UnitSummary,
} from './types';

const SIDES: SideId[] = ['A', 'B'];

/** Задачи по умолчанию — из преобладающего приказа стороны. */
export function defaultObjectives(E: EngineContext, side: SideId, maxTurns: number): Objective[] {
  const weight = new Map<Behavior, number>();
  for (const el of E.sideElements(side)) {
    const bh = E.behavior(el);
    weight.set(bh, (weight.get(bh) ?? 0) + E.value(el));
  }
  weight.delete('reserve');
  const main = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'defend';
  switch (main) {
    case 'attack':
      return [newObjective('take', 0, 2), newObjective('preserve', 40, 1)];
    case 'recon':
      return [newObjective('recon', 60, 2), newObjective('preserve', 20, 1)];
    case 'retreat':
    case 'rout':
      return [newObjective('preserve', 30, 2), newObjective('noRout', 0, 1)];
    default:
      return [newObjective('hold', Math.max(1, Math.round(maxTurns * 0.75)), 2), newObjective('inflict', 20, 1)];
  }
}

function fightingValue(E: EngineContext, els: ElementState[]) {
  return els.filter((x) => E.fighting(x)).reduce((a, x) => a + E.value(x), 0);
}

function startValue(els: ElementState[]) {
  return els.reduce((a, x) => a + x.startValue, 0);
}

function lossValuePct(E: EngineContext, els: ElementState[]) {
  const sv = startValue(els);
  if (sv <= 0) return 0;
  const now = els.reduce((a, x) => a + E.value(x), 0);
  return Math.max(0, (1 - now / sv) * 100);
}

function holdingAtEnd(E: EngineContext, side: SideId) {
  const els = E.sideElements(side).filter((x) => x.status !== 'pending');
  return fightingValue(E, els) >= startValue(els) * E.k.holdMinShare && startValue(els) > 0;
}

/** Силы стороны, участвующие в бою: не подошедшие подкрепления в задачах не считаются. */
const present = (E: EngineContext, side: SideId) => E.sideElements(side).filter((x) => x.status !== 'pending');

function scoreObjective(E: EngineContext, side: SideId, o: Objective): ObjectiveResult {
  const b = E.b;
  const enemy = E.enemyOf(side);
  const own = present(E, side);
  const foe = present(E, enemy);
  const label = o.label?.trim() || OBJECTIVE_SHORT[o.type](o.value);
  let score = 0;
  let explanation = '';
  switch (o.type) {
    case 'hold': {
      const need = Math.max(1, o.value);
      const lost = b.sides[side].lostHoldTurn;
      const held = lost ? lost - 1 : b.turn;
      const enemyOut = !foe.some((x) => E.fighting(x) && E.behavior(x) === 'attack') && foe.every((x) => !E.fighting(x));
      if (!lost && (held >= need || enemyOut)) {
        score = 1;
        explanation = enemyOut ? 'Позиция удержана: атакующий выбыл из боя.' : `Позиция удерживалась ${held} ход. из ${need}.`;
      } else {
        score = Math.min(1, held / need) * (lost ? 0.6 : 1);
        explanation = lost
          ? `Позиция оставлена на ${lost}-м ходу, до этого удерживалась ${held} ход. из ${need}; оставленная позиция засчитывается не больше чем на 60%.`
          : `Бой закончился раньше: удерживалась ${held} из ${need} ход.`;
      }
      break;
    }
    case 'take': {
      const foeStart = startValue(foe);
      const foeLeft = fightingValue(E, foe);
      const ownHolds = holdingAtEnd(E, side);
      if (foeLeft <= 0 && ownHolds) {
        score = 1;
        explanation = 'Противник выбит с позиции, позиция занята.';
      } else {
        const removed = foeStart > 0 ? 1 - foeLeft / foeStart : 0;
        score = Math.max(0, Math.min(0.7, removed * 0.7)) * (ownHolds ? 1 : 0.5);
        explanation = `На позиции осталось ${Math.round((foeLeft / Math.max(1e-9, foeStart)) * 100)}% сил противника${ownHolds ? '' : '; собственные силы не способны её занять'}.`;
      }
      break;
    }
    case 'inflict': {
      const pct = lossValuePct(E, foe);
      score = o.value > 0 ? Math.min(1, pct / o.value) : 1;
      explanation = `Потери противника — ${pct.toFixed(1)}% боевой ценности (цель ${o.value}%).`;
      break;
    }
    case 'preserve': {
      const pct = lossValuePct(E, own);
      score = pct <= o.value ? 1 : Math.max(0, 1 - (pct - o.value) / Math.max(10, o.value));
      explanation = `Свои потери — ${pct.toFixed(1)}% боевой ценности (допустимо ${o.value}%).`;
      break;
    }
    case 'recon': {
      const total = startValue(foe);
      const seen = foe.filter((x) => x.everSpotted).reduce((a, x) => a + x.startValue, 0);
      const pct = total > 0 ? (seen / total) * 100 : 0;
      score = o.value > 0 ? Math.min(1, pct / o.value) : 1;
      explanation = `Обнаружено ${pct.toFixed(0)}% сил противника (цель ${o.value}%).`;
      break;
    }
    case 'noRout': {
      const total = startValue(own);
      const bad = own.filter((x) => x.status === 'routed' || x.status === 'destroyed' || E.behavior(x) === 'rout').reduce((a, x) => a + x.startValue, 0);
      const share = total > 0 ? bad / total : 0;
      score = Math.max(0, 1 - share * 2);
      explanation = share > 0 ? `Бежало или уничтожено ${Math.round(share * 100)}% сил.` : 'Бегства не допущено.';
      break;
    }
  }
  return { objective: o, label, score: Math.max(0, Math.min(1, score)), explanation };
}

function summarize(E: EngineContext, els: ElementState[]): UnitSummary {
  const k = E.k;
  const personnel = { authorized: 0, start: 0, current: 0, kia: 0, wia: 0, mia: 0, losses: 0, lossPct: 0 };
  const equipment = new Map<string, EquipmentStats>();
  let ceNow = 0;
  let ceStart = 0;
  let valueNow = 0;
  let valueStart = 0;
  let orgNum = 0;
  let moraleNum = 0;
  let wActive = 0;
  let ammo = 0;
  let fuel = 0;
  let fuelW = 0;
  let equip = 0;
  const status = { active: 0, pending: 0, withdrawn: 0, routed: 0, destroyed: 0, retreating: 0, routing: 0 };
  for (const el of els) {
    // Не подошедшее подкрепление в бою не участвовало — только счётчик.
    if (el.status === 'pending') {
      status.pending++;
      continue;
    }
    personnel.authorized += el.authorizedPersonnel;
    personnel.start += el.startPersonnel;
    for (const c of el.comps) {
      const t = E.type(c.typeId);
      personnel.kia += c.kia;
      personnel.wia += c.wia;
      personnel.mia += c.mia;
      if (t.kind !== 'personnel') {
        const q =
          equipment.get(t.id) ??
          ({ typeId: t.id, name: t.name, kind: t.kind, authorized: 0, start: 0, current: 0, destroyed: 0, damaged: 0, abandoned: 0, losses: 0, lossPct: 0 } as EquipmentStats);
        q.authorized += c.authorized;
        q.start += c.start;
        q.current += c.current;
        q.destroyed += c.destroyed;
        q.damaged += c.damaged;
        q.abandoned += c.abandoned;
        equipment.set(t.id, q);
      }
    }
    const v = E.value(el);
    valueNow += v;
    valueStart += el.startValue;
    const startCe = el.startValue * (E.f.morale ? lerp(k.ceMoraleMin, 1, el.startMorale / 100) : 1);
    ceStart += startCe;
    const ceEl = (() => {
      if (el.status === 'destroyed') return 0;
      let ce = v;
      if (E.f.morale) ce *= lerp(k.ceMoraleMin, 1, el.morale / 100);
      if (E.f.cohesion) ce *= lerp(k.ceCohesionMin, 1, el.cohesion / 100);
      if (E.f.fatigue) ce *= 1 - (el.fatigue / 100) * k.ceFatiguePenalty;
      if (E.f.ammo) ce *= el.ammo >= k.lowAmmoThreshold ? 1 : lerp(k.noAmmoFire, 1, el.ammo / Math.max(1, k.lowAmmoThreshold));
      if (el.status === 'routed') ce *= 0.5;
      return ce;
    })();
    ceNow += ceEl;
    const statusF = el.status === 'destroyed' ? 0 : el.status === 'routed' ? 0.3 : el.status === 'withdrawn' ? 0.9 : 1;
    const fo = E.formationOf(el);
    const org = (E.f.cohesion ? el.cohesion / 100 : 1) * (E.f.comms ? Math.max(0.2, E.comms(el)) : 1) * (fo.hqLost ? 0.7 : 1) * statusF;
    orgNum += org * el.startValue;
    if (el.status !== 'destroyed') {
      moraleNum += el.morale * Math.max(v, 1e-6);
      wActive += Math.max(v, 1e-6);
      ammo += el.ammo * Math.max(v, 1e-6);
      equip += el.equipment * Math.max(v, 1e-6);
      if (el.comps.some((c) => E.type(c.typeId).kind === 'vehicle' && c.current > 0)) {
        fuel += el.fuel * Math.max(v, 1e-6);
        fuelW += Math.max(v, 1e-6);
      }
    }
    if (el.status === 'active') {
      const bh = E.behavior(el);
      if (bh === 'retreat') status.retreating++;
      else if (bh === 'rout') status.routing++;
      else status.active++;
    } else status[el.status]++;
  }
  personnel.losses = personnel.kia + personnel.wia + personnel.mia;
  personnel.current = Math.max(0, personnel.start - personnel.losses);
  personnel.lossPct = personnel.start > 0 ? (personnel.losses / personnel.start) * 100 : 0;
  const eq = [...equipment.values()].map((q) => {
    q.losses = q.destroyed + q.damaged + q.abandoned;
    q.lossPct = q.start > 0 ? (q.losses / q.start) * 100 : 0;
    return q;
  });
  return {
    personnel,
    equipment: eq,
    combatEffectiveness: ceStart > 0 ? (ceNow / ceStart) * 100 : 0,
    strength: valueStart > 0 ? (valueNow / valueStart) * 100 : 0,
    organization: valueStart > 0 ? (orgNum / valueStart) * 100 : 0,
    morale: wActive > 0 ? moraleNum / wActive : 0,
    supply: { ammo: wActive > 0 ? ammo / wActive : 0, fuel: fuelW > 0 ? fuel / fuelW : 100, equipment: wActive > 0 ? equip / wActive : 0 },
    status,
  };
}

export function computeResult(E: EngineContext): BattleResult {
  const b = E.b;
  const sides = {} as Record<SideId, SideResult>;
  for (const side of SIDES) {
    const els = E.sideElements(side);
    const objectives = b.sides[side].objectives.map((o) => scoreObjective(E, side, o));
    const wsum = objectives.reduce((a, o) => a + Math.max(0, o.objective.weight), 0);
    const score = wsum > 0 ? objectives.reduce((a, o) => a + o.score * Math.max(0, o.objective.weight), 0) / wsum : 0;
    const formations: FormationSummary[] = [];
    const walk = (fid: string, depth: number) => {
      const f = E.formations.get(fid)!;
      const ids = new Set<string>([fid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
          ids.add(x.id);
          grew = true;
        }
      }
      formations.push({ ...summarize(E, els.filter((x) => ids.has(x.formationId))), formationId: fid, name: f.name, depth });
      for (const ch of b.formations.filter((x) => x.parentId === fid)) walk(ch.id, depth + 1);
    };
    for (const f of b.formations.filter((x) => x.side === side && !x.parentId)) walk(f.id, 0);
    const foe = present(E, E.enemyOf(side));
    const foeTotal = startValue(foe);
    sides[side] = {
      ...summarize(E, els),
      side,
      name: b.sides[side].name,
      score,
      objectives,
      formations,
      valueLossPct: lossValuePct(E, els),
      enemySpottedPct: foeTotal > 0 ? (foe.filter((x) => x.everSpotted).reduce((a, x) => a + x.startValue, 0) / foeTotal) * 100 : 0,
    };
  }
  const diff = sides.A.score - sides.B.score;
  const levels = [...b.ruleset.outcomeLevels].sort((x, y) => y.minDiff - x.minDiff);
  const level = levels.find((l) => Math.abs(diff) >= l.minDiff) ?? levels[levels.length - 1];
  const isDraw = !level || level.minDiff <= 0;
  const winner: SideId | null = isDraw ? null : diff > 0 ? 'A' : 'B';
  const headline = winner ? `${level.name} стороны «${b.sides[winner].name}»` : (level?.name ?? 'Ничья');
  const keyEvents = b.log.filter((x) => x.level === 0 && x.phase !== 'turn' && x.phase !== 'setup' && x.phase !== 'end').map((x) => `Ход ${x.turn}: ${x.text}`);
  return {
    turns: b.turn,
    endReason: b.endReason ?? '',
    outcomeId: isDraw ? (level?.id ?? 'draw') : level.id,
    outcomeName: level?.name ?? 'Ничья',
    winner,
    scoreDiff: diff,
    headline,
    sides,
    keyEvents,
  };
}

/**
 * Коротко — что решило исход: главная выполненная задача победителя и главный недобор проигравшего.
 * Если победитель потерял больше, об этом сказано прямо: исход решают задачи, а не только потери.
 */
export function explainResult(r: BattleResult): string {
  const p = (v: number) => `${Math.round(v * 100)}%`;
  const A = r.sides.A;
  const B = r.sides.B;
  if (!r.winner) {
    if (!A.objectives.length && !B.objectives.length) return 'У сторон нет задач — исход не определён.';
    return `Задачи выполнены примерно поровну: «${A.name}» — ${p(A.score)}, «${B.name}» — ${p(B.score)}.`;
  }
  const win = r.sides[r.winner];
  const lose = r.sides[r.winner === 'A' ? 'B' : 'A'];
  const by = (list: ObjectiveResult[], f: (o: ObjectiveResult) => number) => [...list].sort((x, y) => f(y) - f(x))[0];
  const best = by(win.objectives, (o) => Math.max(0, o.objective.weight) * o.score);
  const worst = by(lose.objectives, (o) => Math.max(0, o.objective.weight) * (1 - o.score));
  // «Позиция удерживалась 12 ход. из 12.» → «позиция удерживалась 12 ход. из 12»
  const line = (side: SideResult, o: ObjectiveResult) => {
    const why = o.explanation ? `, ${o.explanation.charAt(0).toLowerCase()}${o.explanation.slice(1).replace(/\.$/, '')}` : '';
    return `«${side.name}»: «${o.label.replace(/\.$/, '')}» — ${p(o.score)}${why}.`;
  };
  const parts: string[] = ['Решило.'];
  if (best) parts.push(line(win, best));
  if (worst && worst.score < 1) parts.push(line(lose, worst));
  else if (lose.objectives.length) parts.push(`«${lose.name}» выполнили задачи на ${p(lose.score)}.`);
  let text = parts.join(' ');
  if (win.valueLossPct > lose.valueLossPct + 5)
    text += ` Потери у «${win.name}» больше (${Math.round(win.valueLossPct)}% против ${Math.round(lose.valueLossPct)}% боевой ценности), но исход решают задачи сторон.`;
  return text;
}

/** Итог «на текущий момент» для незавершённого боя (не меняет состояние). */
export function provisionalResult(E: EngineContext): BattleResult {
  return computeResult(E);
}
