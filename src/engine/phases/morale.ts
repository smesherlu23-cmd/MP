// Мораль, слаженность и снятие подавления в конце хода.

import { EngineContext, clamp, e, lerp, round1 } from '../context';
import type { Factor, SideId } from '../types';

// ------------------------------------------------------------------ мораль

export function phaseMorale(E: EngineContext) {
  const { k, f } = E;
  const sideLoss: Record<SideId, number> = { A: 0, B: 0 };
  const sideValue: Record<SideId, number> = { A: 0, B: 0 };
  for (const el of E.b.elements) {
    if (el.status === 'pending') continue;
    sideLoss[el.side] += el.turnValueLost;
    sideValue[el.side] += el.startValue;
  }
  const lossRate = (side: SideId) => sideLoss[side] / Math.max(1e-9, sideValue[side]);

  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const lossPct = (el.turnValueLost / Math.max(1e-9, el.startValue)) * 100;
    const persPct = (el.turnPersonnelLost / Math.max(1, el.startPersonnel)) * 100;
    if (f.morale) {
      const factors: Factor[] = [];
      let neg = 0;
      const addNeg = (label: string, v: number) => {
        if (v <= 0) return;
        neg += v;
        factors.push({ label, value: -round1(v), kind: 'add' });
      };
      const w = clamp(k.moraleValueWeight, 0, 1);
      const moraleLossPct = persPct * (1 - w) + lossPct * w;
      addNeg(`Потери за ход: люди ${persPct.toFixed(1)}%, боевая ценность ${lossPct.toFixed(1)}%`, moraleLossPct * k.moralePerLossPct);
      if (f.suppression) addNeg(`Подавление ${Math.round(el.suppression)}%`, el.suppression * k.moraleSuppression);
      if (f.fatigue && el.fatigue > k.moraleFatigueThreshold) addNeg(`Изнурение (усталость ${Math.round(el.fatigue)}%)`, k.moraleHighFatigue);
      if (f.ammo && el.ammo <= 0) addNeg('Нет боезапаса', k.moraleNoAmmo);
      let negMult = 1;
      if (neg > 0) {
        const mf: Factor[] | undefined = E.logging ? [] : undefined;
        negMult = E.mult(el, 'moraleLoss', {}, mf);
        if (mf) for (const x of mf) factors.push({ ...x, label: `Потери морали — ${x.label}` });
        if (f.cohesion) {
          const cm = lerp(k.moraleLowCohesionMult, 1, el.cohesion / 100);
          if (Math.abs(cm - 1) > 1e-6) {
            negMult *= cm;
            factors.push({ label: `Потери морали — слаженность ${Math.round(el.cohesion)}%`, value: cm, kind: 'mult' });
          }
        }
      }
      let pos = 0;
      if (!el.underFireThisTurn && el.morale < el.startMorale) {
        const r = Math.min(el.startMorale - el.morale, k.moraleRecovery * E.mult(el, 'recovery'));
        if (r > 0) {
          pos += r;
          factors.push({ label: 'Передышка (не под огнём)', value: round1(r), kind: 'add' });
        }
      }
      const enemy = E.enemyOf(el.side);
      if (el.firedThisTurn && lossRate(enemy) > 0 && lossRate(enemy) > lossRate(el.side) * 1.5) {
        pos += k.moraleSuccess;
        factors.push({ label: 'Противник несёт большие потери', value: k.moraleSuccess, kind: 'add' });
      }
      let negTotal = neg * negMult;
      if (k.moraleMaxLossPerTurn > 0 && negTotal > k.moraleMaxLossPerTurn) {
        factors.push({ label: `Ограничение потерь морали за ход`, value: k.moraleMaxLossPerTurn, kind: 'base' });
        negTotal = k.moraleMaxLossPerTurn;
      }
      const delta = -negTotal + pos;
      const before = el.morale;
      el.morale = clamp(el.morale + delta, 0, 100);
      if (Math.abs(delta) >= 0.5) {
        E.log({
          phase: 'morale',
          level: Math.abs(delta) >= 5 ? 1 : 2,
          side: el.side,
          severity: delta < 0 ? 'bad' : 'good',
          refs: [el.id],
          text: `Мораль ${e(el)}: ${Math.round(before)} → ${Math.round(el.morale)} (${delta > 0 ? '+' : ''}${delta.toFixed(1)}).`,
          factors,
          data: { morale: [Math.round(before), Math.round(el.morale)] },
        });
      }
    }
    if (f.cohesion) {
      let d = -lossPct * k.cohesionPerLossPct;
      if (f.comms && E.comms(el) < 0.5) d -= k.cohesionLowComms;
      const bh = E.behavior(el);
      if (bh === 'reserve' || bh === 'consolidate') d += k.cohesionRecovery * E.mult(el, 'recovery');
      const before = el.cohesion;
      el.cohesion = clamp(el.cohesion + d, 0, 100);
      if (Math.abs(d) >= 1) E.log({ phase: 'morale', level: 2, side: el.side, refs: [el.id], text: `Слаженность ${e(el)}: ${Math.round(before)} → ${Math.round(el.cohesion)}%.` });
    }
    if (f.suppression && el.suppression > 0) {
      el.suppression = Math.max(0, el.suppression - k.suppressionRecovery * E.mult(el, 'recovery'));
    }
  }
}
