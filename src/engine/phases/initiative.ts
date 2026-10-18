// Инициатива: какая сторона стреляет первой.

import { type EngineContext, lerp, round1, s } from '../context';
import type { Factor, SideId } from '../types';
import { SIDES } from './common';

// ------------------------------------------------------------------ инициатива

export interface Initiative {
  first: SideId;
  sequential: boolean;
  bonusSide: SideId | null;
}

export function phaseInitiative(E: EngineContext): Initiative {
  const { b, k } = E;
  if (!E.f.initiative) {
    for (const side of SIDES) b.sides[side].initiative = 0;
    return { first: 'A', sequential: false, bonusSide: null };
  }
  const scores: Record<SideId, number> = { A: 0, B: 0 };
  const breakdown: Record<SideId, Factor[]> = { A: [], B: [] };
  for (const side of SIDES) {
    const els = E.sideElements(side).filter((x) => E.engaged(x));
    if (!els.length) {
      scores[side] = 0;
      continue;
    }
    let wsum = 0;
    let msum = 0;
    let csum = 0;
    for (const el of els) {
      const w = Math.max(0.1, E.value(el));
      wsum += w;
      msum += w * E.mult(el, 'initiative');
      csum += w * E.comms(el);
    }
    const m = msum / wsum;
    const comms = E.f.comms ? lerp(k.commsInitiativeMin, 1, csum / wsum) : 1;
    const rnd = E.rng.range(0, k.initiativeRandom);
    scores[side] = 50 * m * comms + rnd;
    if (E.logging) {
      const f: Factor[] = [{ label: 'База', value: 50, kind: 'base' }];
      const ref = els.reduce((a, x) => (E.value(x) > E.value(a) ? x : a), els[0]);
      const detail: Factor[] = [];
      E.mult(ref, 'initiative', {}, detail);
      f.push({ label: 'Средний множитель (опыт, командиры, условия, разведданные)', value: m, kind: 'mult' });
      for (const d of detail) f.push({ ...d, label: `  в т.ч. ${d.label}` });
      if (E.f.comms) f.push({ label: `Связь ${Math.round((csum / wsum) * 100)}%`, value: comms, kind: 'mult' });
      f.push({ label: 'Случайность', value: round1(rnd), kind: 'add' });
      breakdown[side] = f;
    }
  }
  let first: SideId = scores.A >= scores.B ? 'A' : 'B';
  let reason = '';
  for (const side of SIDES) {
    const amb = E.sideElements(side).some((x) => E.engaged(x) && E.behavior(x) === 'ambush' && !x.ambushUsed && !x.spotted);
    const enemyAmb = E.sideElements(E.enemyOf(side)).some((x) => E.engaged(x) && E.behavior(x) === 'ambush' && !x.ambushUsed && !x.spotted);
    if (amb && !enemyAmb) {
      first = side;
      reason = ' — необнаруженная засада открывает огонь первой';
    }
  }
  b.sides.A.initiative = Math.round(scores.A);
  b.sides.B.initiative = Math.round(scores.B);
  const sequential = k.initiativeSequential >= 0.5;
  // В обычном журнале инициатива видна, только когда переходит к другой стороне (или из-за засады).
  const prev = b.lastInitiative;
  b.lastInitiative = first;
  E.log({
    phase: 'initiative',
    level: !prev || prev !== first || reason ? 1 : 2,
    side: first,
    severity: 'info',
    text: `Инициатива: ${s(first)}${reason} (${Math.round(scores[first])} против ${Math.round(scores[E.enemyOf(first)])}). ${
      sequential ? 'Первый огонь — за ними.' : `Их огонь ×${k.initiativeBonus}.`
    }`,
    factors: [...breakdown[first].map((x) => ({ ...x, label: `${b.sides[first].name}: ${x.label}` })), ...breakdown[E.enemyOf(first)].map((x) => ({ ...x, label: `${b.sides[E.enemyOf(first)].name}: ${x.label}` }))],
  });
  return { first, sequential, bonusSide: sequential ? null : first };
}
