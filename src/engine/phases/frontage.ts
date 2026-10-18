// Ширина фронта: в огневой контакт одновременно вступает не больше сил, чем позволяет фронт.
// Без этого каждый боец стреляет в полную силу, и численность решает «по квадрату» (Ланчестер):
// втрое большая сила уничтожает противника, почти не неся потерь. На деле перевес даёт глубину —
// резерв, смену уставших, охват флангов, — но стреляет в каждый момент только первая линия.

import type { EngineContext } from '../context';
import type { ElementState, Id, SideId } from '../types';

export interface Frontage {
  /** Множитель прямого огня стороны на участке (1 — все в контакте). */
  factor: number;
  /** Доля сил в первой линии, % (для подсказки). */
  engaged: number;
  /** Что ограничило: охват (по силам противника) или ширина фронта. */
  by: 'overlap' | 'width' | null;
}

const key = (el: ElementState) => el.sector ?? '';

/** Множитель за прямой огонь эшелона (второй эшелон и тыл и так стреляют слабее и фронта не занимают). */
function echelonWeight(E: EngineContext, el: ElementState): number {
  return el.echelon === 'support' ? E.k.fireSupport : el.echelon === 'rear' ? E.k.fireRear : 1;
}

/** Есть ли у типа прямой огонь хоть по кому-то (грузовик, тягач фронта не занимают). */
const armed = (E: EngineContext, typeId: string) => {
  const t = E.type(typeId);
  return !t.indirect && Object.values(t.firepower).some((row) => Object.values(row).some((v) => v > 0));
};

/**
 * Места в первой линии, которые нужны силам стороны на участках (прямой огонь, с учётом эшелона):
 * бойцы и расчёты — по числу людей, боевая машина — по экипажу, но не меньше «машины по фронту».
 * Огневая мощь места не прибавляет: фронт ограничивает число огневых позиций, а не их силу.
 */
function demand(E: EngineContext, side: SideId): Map<string, number> {
  const out = new Map<string, number>();
  const perVehicle = E.k.vehicleFrontage ?? 4;
  for (const el of E.sideElements(side)) {
    if (!E.engaged(el)) continue;
    let men = 0;
    for (const c of el.comps) {
      if (c.current <= 0 || !armed(E, c.typeId)) continue;
      const t = E.type(c.typeId);
      men += t.kind === 'personnel' ? c.current : t.kind === 'vehicle' ? c.current * Math.max(t.crew, perVehicle) : c.current * t.crew;
    }
    if (men <= 0) continue;
    out.set(key(el), (out.get(key(el)) ?? 0) + men * echelonWeight(E, el));
  }
  return out;
}

/** Ширина фронта участка (или всего боя), м; 0 — не задана. */
function widthOf(E: EngineContext, sectorId: Id): number {
  if (!E.b.sectors) return E.b.scenario.frontWidth ?? 0;
  return E.sectors.get(sectorId)?.width ?? 0;
}

/**
 * Ширина фронта для стороны: по участкам — множитель прямого огня. Силы сверх охвата (больше, чем
 * «охват» × силы противника) или сверх ширины фронта стреляют с весом «вклад сил сверх охвата».
 */
export function frontage(E: EngineContext, side: SideId): Map<string, Frontage> {
  const { k } = E;
  const out = new Map<string, Frontage>();
  const overlap = k.frontageOverlap ?? 0;
  const own = demand(E, side);
  const foe = demand(E, E.enemyOf(side));
  for (const [sec, d] of own) {
    let x = 1;
    let by: Frontage['by'] = null;
    const f = foe.get(sec);
    if (overlap > 0 && f && f > 0) {
      const r = d / (overlap * f);
      if (r > x) {
        x = r;
        by = 'overlap';
      }
    }
    const width = widthOf(E, sec);
    if (width > 0 && k.frontDensity > 0) {
      const r = d / ((width / 100) * k.frontDensity);
      if (r > x) {
        x = r;
        by = 'width';
      }
    }
    const factor = x <= 1 ? 1 : (1 + (x - 1) * Math.max(0, Math.min(1, k.frontageExcess ?? 0))) / x;
    out.set(sec, { factor, engaged: Math.min(100, 100 / x), by });
  }
  return out;
}

export const frontageKey = key;
