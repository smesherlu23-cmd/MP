// Движение: сближение по участкам, топливо, поломки на марше.

import { type EngineContext, e, round1, s } from '../context';
import type { ElementState, Id, SideId } from '../types';
import { SIDES } from './common';

// ------------------------------------------------------------------ движение

export function phaseMovement(E: EngineContext) {
  const { b, k, f } = E;
  const moved = new Set<Id>();
  // Сближение — на каждом участке своё; без участков — одно на весь бой (дистанция боя).
  const groups: { st: { bandIndex: number; closingProgress: number }; name: string | null; els: (side: SideId) => ElementState[] }[] = b.sectors
    ? b.sectors.map((sec) => ({ st: sec, name: sec.name, els: (side: SideId) => E.sideElements(side).filter((x) => x.sector === sec.id) }))
    : [{ st: b, name: null, els: (side: SideId) => E.sideElements(side) }];
  const last = b.ruleset.rangeBands.length - 1;
  for (const g of groups) {
    const pressure: Record<SideId, number> = { A: 0, B: 0 };
    for (const side of SIDES) {
      const els = g.els(side).filter((x) => E.engaged(x) && E.behavior(x) !== 'retreat' && E.behavior(x) !== 'rout');
      const total = els.reduce((a, x) => a + E.value(x), 0);
      if (total <= 0) continue;
      let push = 0;
      for (const el of els) {
        if (E.behavior(el) !== 'attack') continue;
        moved.add(el.id);
        let m = E.mult(el, 'movement');
        if (f.suppression) m *= 1 - (el.suppression / 100) * k.suppressionMovementPenalty;
        if (f.fuel && el.fuel <= 0) {
          const vv = el.comps.filter((c) => E.type(c.typeId).kind === 'vehicle').reduce((a, c) => a + c.current * E.type(c.typeId).value, 0);
          const share = vv / Math.max(1e-9, E.value(el));
          m *= 1 - share * (1 - k.noFuelMovement);
        }
        push += E.value(el) * m;
      }
      pressure[side] = push / total;
    }
    const lead: SideId = pressure.A >= pressure.B ? 'A' : 'B';
    const p = pressure[lead];
    const where = g.name ? `${g.name}: ` : '';
    if (p >= k.attackPressureMin && g.st.bandIndex < last) {
      const band = b.ruleset.rangeBands[g.st.bandIndex];
      g.st.closingProgress += p / Math.max(0.25, band.turnsToClose);
      if (g.st.closingProgress >= 1) {
        g.st.bandIndex++;
        g.st.closingProgress = 0;
        E.invalidate();
        E.log({
          phase: 'movement',
          level: 0,
          side: lead,
          severity: 'info',
          text: `${where}${s(lead)}: продвижение — дистанция сократилась до «${b.ruleset.rangeBands[g.st.bandIndex].name}».`,
          factors: [{ label: 'Натиск атакующих (доля сил с учётом подвижности и подавления)', value: round1(p * 100) / 100, kind: 'base' }],
        });
      } else {
        E.log({
          phase: 'movement',
          level: 2,
          side: lead,
          text: `${where}${s(lead)}: продвижение (сближение ${Math.round(g.st.closingProgress * 100)}% до следующей дистанции).`,
          factors: [{ label: 'Натиск', value: round1(p * 100) / 100, kind: 'base' }],
        });
      }
    } else if (g.st.bandIndex < last && (pressure.A > 0 || pressure.B > 0)) {
      E.log({
        phase: 'movement',
        level: 1,
        side: lead,
        severity: 'bad',
        text: `${where}${s(lead)}: натиска недостаточно для сближения (${Math.round(p * 100)}% при пороге ${Math.round(k.attackPressureMin * 100)}%).`,
      });
    }
  }
  for (const el of b.elements) if (el.status === 'active' && (E.behavior(el) === 'retreat' || E.behavior(el) === 'rout')) moved.add(el.id);

  // Топливо и поломки
  for (const el of b.elements) {
    if (el.status !== 'active') continue;
    const vehicles = el.comps.filter((c) => c.current > 0 && E.type(c.typeId).kind === 'vehicle');
    if (!vehicles.length) continue;
    const isMoving = moved.has(el.id);
    if (f.fuel) {
      const use = vehicles.reduce((a, c) => a + c.current * E.type(c.typeId).fuelUse, 0) / vehicles.reduce((a, c) => a + c.current, 0);
      el.fuel = Math.max(0, el.fuel - use * (isMoving ? 1 : 0.2));
    }
    if (f.breakdowns && isMoving) {
      const terrain = Math.max(0.2, Math.min(1, E.mult(el, 'movement')));
      const cond = f.vehicleCondition ? el.vehicleCondition / 100 : 1;
      const pBreak = (k.breakdownBase * (1 + 4 * (1 - cond))) / terrain;
      for (const c of vehicles) {
        const n = E.rng.binomial(c.current, pBreak);
        if (n > 0) {
          c.current -= n;
          c.damaged += n;
          E.invalidate(el);
          E.log({
            phase: 'movement',
            level: 1,
            side: el.side,
            severity: 'bad',
            refs: [el.id],
            text: `${e(el)}: поломка на марше — ${E.type(c.typeId).name} ×${n}.`,
            factors: [{ label: 'Шанс поломки на машину', value: pBreak, kind: 'chance' }],
          });
        }
      }
    }
  }
}
