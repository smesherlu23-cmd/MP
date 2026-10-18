// Снабжение (подвоз боезапаса и топлива, износ, закрепление) и усталость.

import { type EngineContext, clamp, e } from '../context';
import type { Factor } from '../types';

// ------------------------------------------------------------------ снабжение и усталость

export function phaseSupply(E: EngineContext) {
  const { k, f } = E;
  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const sup = E.supply(el);
    const inContact = el.firedThisTurn || el.underFireThisTurn;
    const m = inContact ? k.resupplyInContact : 1;
    if (f.ammo) el.ammo = clamp(el.ammo + k.resupplyAmmo * sup * m, 0, 100);
    if (f.fuel) el.fuel = clamp(el.fuel + k.resupplyFuel * sup * m, 0, 100);
    if (f.equipment && inContact) el.equipment = clamp(el.equipment - k.equipmentWear, 0, 100);
    const bh = E.behavior(el);
    if (bh === 'consolidate') el.digInTurns++;
    else if (bh === 'attack' || bh === 'retreat' || bh === 'rout') el.digInTurns = 0;
  }
}

export function phaseFatigue(E: EngineContext) {
  const { k, f } = E;
  if (!f.fatigue) return;
  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const bh = E.behavior(el);
    let gain = k.fatiguePerTurn * E.mult(el, 'fatigue') * (1 + (f.suppression ? (el.suppression / 100) * k.fatigueSuppressionFactor : 0));
    if (bh === 'reserve' || bh === 'consolidate') gain -= k.fatigueRecovery * E.mult(el, 'recovery');
    const before = el.fatigue;
    el.fatigue = clamp(el.fatigue + gain, 0, 100);
    if (Math.abs(el.fatigue - before) >= 0.5) {
      const ff: Factor[] = [{ label: 'База за ход', value: k.fatiguePerTurn, kind: 'base' }];
      if (E.logging) E.mult(el, 'fatigue', {}, ff);
      E.log({
        phase: 'fatigue',
        level: 2,
        side: el.side,
        refs: [el.id],
        text: `${e(el)}: усталость ${Math.round(before)} → ${Math.round(el.fatigue)}%.`,
        factors: ff,
      });
    }
  }
}
