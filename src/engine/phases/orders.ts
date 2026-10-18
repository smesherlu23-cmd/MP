// Доведение приказов ГМ: приказ доходит до подразделения не сразу. Каждый ход — шанс, что дошёл:
// «доведение приказа» × связь × командир. План боя и автоматические решения (отход, бегство, ввод
// резервов при выбытии первой линии) — без задержки: они уже заложены во время или принимаются на месте.

import { e, type EngineContext, lerp } from '../context';
import type { ElementState } from '../types';

/** Насколько командиры элемента ускоряют доведение приказа (по их влиянию на инициативу). */
function commandQuality(E: EngineContext, el: ElementState): number {
  const levels = E.commandLevels(el);
  if (!levels.length) return E.k.orderNoCommander;
  let q = 1;
  for (const c of levels) q *= 1 + ((c.level.effects.initiative ?? 1) - 1) * c.weight;
  return q;
}

/** Вероятность, что приказ дойдёт до элемента к этому ходу. */
export function orderChance(E: EngineContext, el: ElementState): number {
  const comms = E.f.comms ? lerp(E.k.orderCommsMin, 1, E.comms(el)) : 1;
  return Math.max(0.05, Math.min(1, E.k.orderSpeed * comms * commandQuality(E, el)));
}

/** Применить приказ к элементу. */
export function giveOrder(E: EngineContext, el: ElementState, orderId: string) {
  const order = E.orders.get(orderId);
  if (!order) return;
  el.orderId = order.id;
  if (order.behavior !== 'retreat' && order.behavior !== 'rout') el.exitTurns = 0;
  delete el.pendingOrder;
  E.invalidate(el);
}

export function phaseOrders(E: EngineContext) {
  const { b } = E;
  const arrived = new Map<string, { ids: string[]; late: number }>();
  const waiting: string[] = [];
  for (const el of b.elements) {
    const p = el.pendingOrder;
    if (!p) continue;
    if (el.status !== 'active' || E.behavior(el) === 'rout') {
      delete el.pendingOrder;
      continue;
    }
    if (!E.rng.chance(orderChance(E, el))) {
      waiting.push(el.id);
      continue;
    }
    const late = b.turn - p.since - 1;
    giveOrder(E, el, p.orderId);
    const a = arrived.get(p.orderId) ?? { ids: [], late: 0 };
    a.ids.push(el.id);
    a.late = Math.max(a.late, late);
    arrived.set(p.orderId, a);
  }
  for (const [orderId, a] of arrived) {
    const who = a.ids.length > 3 ? `${a.ids.length} элементам` : a.ids.map((id) => e(id)).join(', ');
    E.log({
      phase: 'orders',
      level: 1,
      refs: a.ids,
      text: `Приказ «${E.orders.get(orderId)?.name ?? orderId}» дошёл: ${who}${a.late > 0 ? ` (с опозданием на ${a.late} ход.)` : ''}.`,
    });
  }
  if (waiting.length)
    E.log({
      phase: 'orders',
      level: 2,
      refs: waiting,
      text: `Приказ ещё не дошёл: ${waiting.length > 3 ? `${waiting.length} элементам` : waiting.map((id) => e(id)).join(', ')} (связь, командир).`,
    });
}
