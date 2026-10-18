// Снимок хода для графиков и окончание боя.

import { type EngineContext, lerp } from '../context';
import { computeResult } from '../outcome';
import type { Battle, ElementState, SideId, SideSnapshot } from '../types';
import { SIDES, elementsOfNode } from './common';
import { eventTurn } from './events';

// ------------------------------------------------------------------ снимок и окончание

export function combatEffectiveness(E: EngineContext, el: ElementState): number {
  if (el.status === 'destroyed') return 0;
  const k = E.k;
  const f = E.f;
  let ce = E.value(el);
  if (f.morale) ce *= lerp(k.ceMoraleMin, 1, el.morale / 100);
  if (f.cohesion) ce *= lerp(k.ceCohesionMin, 1, el.cohesion / 100);
  if (f.fatigue) ce *= 1 - (el.fatigue / 100) * k.ceFatiguePenalty;
  if (f.ammo) ce *= el.ammo >= k.lowAmmoThreshold ? 1 : lerp(k.noAmmoFire, 1, el.ammo / Math.max(1, k.lowAmmoThreshold));
  return ce;
}

export function snapshot(E: EngineContext) {
  const sides = {} as Record<SideId, SideSnapshot>;
  for (const side of SIDES) {
    // Не подошедшие подкрепления на графиках не видны — их подход заметен как рост сил.
    const els = E.sideElements(side).filter((x) => x.status !== 'pending');
    let vehicles = 0;
    for (const el of els) for (const c of el.comps) if (E.type(c.typeId).kind === 'vehicle') vehicles += c.current;
    const active = els.filter((x) => x.status === 'active');
    const val = active.reduce((a, x) => a + E.value(x), 0);
    sides[side] = {
      personnel: els.reduce((a, x) => a + E.personnel(x), 0),
      vehicles,
      value: els.reduce((a, x) => a + E.value(x), 0),
      ce: els.reduce((a, x) => a + combatEffectiveness(E, x), 0),
      morale: val > 0 ? active.reduce((a, x) => a + x.morale * E.value(x), 0) / val : 0,
      active: active.length,
    };
  }
  const secs = E.b.sectors;
  E.b.history.push({ turn: E.b.turn, band: secs ? secs[0].bandIndex : E.b.bandIndex, ...(secs ? { bands: Object.fromEntries(secs.map((x) => [x.id, x.bandIndex])) } : {}), sides });
}

/** Сторона ждёт подкреплений по плану (их ход ещё не наступил). */
function awaitingReinforcements(b: Battle, side: SideId): boolean {
  return (b.scenario.events ?? []).some((ev) => {
    if (ev.kind !== 'arrive' || ev.side !== side || !ev.nodeId) return false;
    const t = eventTurn(b, ev);
    return t !== undefined && t > b.turn && elementsOfNode(b, side, ev.nodeId).some((x) => x.status === 'pending');
  });
}

export function checkEnd(E: EngineContext) {
  const { b, k } = E;
  // Пока по плану ждут подкреплений, сторона не выбыла, а бой не «затих».
  const out = (side: SideId) => !E.sideElements(side).some((x) => E.fighting(x)) && !awaitingReinforcements(b, side);
  const outA = out('A');
  const outB = out('B');
  if (outA || outB) {
    const reason = outA && outB ? 'Обе стороны вышли из боя' : `${b.sides[outA ? 'A' : 'B'].name}: сил на позициях не осталось`;
    finish(E, reason);
    return;
  }
  if (b.turn >= b.scenario.maxTurns) {
    finish(E, 'Достигнут лимит ходов');
    return;
  }
  const losses = b.elements.reduce((a, x) => a + x.turnValueLost, 0);
  const attacking = b.elements.some((x) => E.engaged(x) && E.behavior(x) === 'attack');
  const waiting = awaitingReinforcements(b, 'A') || awaitingReinforcements(b, 'B');
  b.quietTurns = losses <= 0 && !attacking && !waiting ? b.quietTurns + 1 : 0;
  if (k.stalemateTurns > 0 && b.quietTurns >= k.stalemateTurns) finish(E, `Бой затих: ${b.quietTurns} ход. без потерь и без атак`);
}

export function finish(E: EngineContext, reason: string) {
  const b = E.b;
  if (b.finished) return;
  b.finished = true;
  b.endReason = reason;
  b.result = computeResult(E);
  E.log({ phase: 'end', level: 0, severity: 'info', text: `Бой окончен на ${b.turn}-м ходу. ${reason}. Итог: ${b.result.headline}.` });
  E.commit();
}
