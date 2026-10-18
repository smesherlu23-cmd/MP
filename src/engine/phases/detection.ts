// Обнаружение противника.

import { type EngineContext, clamp, e, s } from '../context';
import type { ElementState, Factor } from '../types';
import { SIDES } from './common';

// ------------------------------------------------------------------ обнаружение

function echelonConceal(E: EngineContext, el: ElementState): number {
  if (el.echelon === 'support') return E.k.concealSupport;
  if (el.echelon === 'rear') return E.k.concealRear;
  return 1;
}

export function phaseDetection(E: EngineContext) {
  const { b, k } = E;
  if (!E.f.detection) {
    for (const el of b.elements) {
      el.spotted = el.status === 'active';
      if (el.spotted) el.everSpotted = true;
    }
    return;
  }
  for (const side of SIDES) {
    const allObservers = E.sideElements(side).filter((o) => o.status === 'active' && E.behavior(o) !== 'reserve' && E.behavior(o) !== 'rout');
    for (const t of E.sideElements(E.enemyOf(side))) {
      if (t.status !== 'active') {
        t.spotted = false;
        continue;
      }
      // Наблюдать можно только на своём участке.
      const observers = b.sectors ? allObservers.filter((o) => o.sector === t.sector) : allObservers;
      const band = E.bandOf(t);
      const base = band?.detection ?? 0.5;
      const conceal = Math.max(0.05, (E.mult(t, 'concealment') * echelonConceal(E, t)) / (t.firedLastTurn ? k.firingReveal : 1));
      const scores: { p: number; w: number; o: ElementState }[] = [];
      for (const o of observers) {
        const det = E.mult(o, 'detection', { enemy: t });
        const p = clamp((base * det) / conceal + (t.spottedLastTurn ? k.spottedPersistence : 0), k.detectMin, k.detectMax);
        const w = E.isRecon(o) ? k.reconObserverWeight : k.observerWeight;
        scores.push({ p, w, o });
      }
      scores.sort((x, y) => y.p * y.w - x.p * x.w);
      let miss = 1;
      for (const sc of scores.slice(0, 3)) miss *= 1 - clamp(sc.p * sc.w, 0, 1);
      const chance = scores.length ? clamp(1 - miss, 0, k.detectMax) : 0;
      const was = t.spotted;
      t.spotted = E.rng.chance(chance);
      if (t.spotted) t.everSpotted = true;
      if (E.logging) {
        const best = scores[0];
        const factors: Factor[] = [{ label: `Дистанция «${band?.name}»`, value: base, kind: 'base' }];
        if (best) {
          const f: Factor[] = [];
          E.mult(best.o, 'detection', { enemy: t }, f);
          factors.push({ label: `Лучший наблюдатель: ${best.o.name}`, value: best.p, kind: 'chance' }, ...f);
        }
        const cf: Factor[] = [];
        E.mult(t, 'concealment', {}, cf);
        for (const x of cf) factors.push({ ...x, label: `Скрытность цели — ${x.label}` });
        if (t.echelon !== 'front') factors.push({ label: `Скрытность цели — эшелон`, value: echelonConceal(E, t), kind: 'mult' });
        if (t.firedLastTurn) factors.push({ label: 'Цель стреляла в прошлом ходу', value: k.firingReveal, kind: 'mult' });
        if (t.spottedLastTurn) factors.push({ label: 'Цель была обнаружена ранее', value: k.spottedPersistence, kind: 'add' });
        factors.push({ label: 'Итоговый шанс (до 3 наблюдателей)', value: chance, kind: 'chance' });
        E.log({
          phase: 'detection',
          level: 2,
          side,
          severity: t.spotted ? 'good' : 'info',
          refs: [t.id],
          text: t.spotted
            ? `${s(side)}: ${was ? 'наблюдение продолжается' : 'обнаружен противник'} — ${e(t)} (шанс ${Math.round(chance * 100)}%).`
            : `${s(side)}: ${was ? 'контакт потерян' : 'противник не обнаружен'} — ${e(t)} (шанс ${Math.round(chance * 100)}%).`,
          factors,
        });
      }
    }
  }
}
