// Проверки конца хода: выход из боя, уничтожение, паника, отход, штабы, распад, резервы, удержание.

import { type EngineContext, clamp, e, fm, round1, s } from '../context';
import type { Behavior, ElementState, Factor, FormationState, SideId } from '../types';
import { SIDES, subtreeIds } from './common';

// ------------------------------------------------------------------ проверки конца хода

function setOrderByBehavior(E: EngineContext, el: ElementState, behavior: Behavior) {
  const o = E.rs.orders.find((x) => x.behavior === behavior);
  if (o) el.orderId = o.id;
  el.exitTurns = 0;
  E.invalidate(el);
}


function destroyElement(E: EngineContext, el: ElementState) {
  const left = E.personnel(el);
  el.status = 'destroyed';
  for (const c of el.comps) {
    const t = E.type(c.typeId);
    if (t.kind !== 'personnel') {
      c.abandoned += c.current;
      c.current = 0;
    }
  }
  if (E.k.scatteredAsMissing >= 0.5) {
    for (const c of el.comps) {
      const t = E.type(c.typeId);
      if (t.kind === 'personnel') {
        c.mia += c.current;
        c.current = 0;
      } else {
        const alive = c.start * t.crew - c.kia - c.wia - c.mia;
        c.mia += Math.max(0, alive);
      }
    }
  } else {
    for (const c of el.comps) if (E.type(c.typeId).kind === 'personnel') c.current = 0;
    el.scattered = left;
  }
  E.invalidate(el);
  return left;
}

export function phaseChecks(E: EngineContext) {
  const { b, k, f, rng } = E;
  const shocks: { kind: 'rout' | 'hq' | 'break'; el?: ElementState; formation: FormationState }[] = [];

  for (const el of b.elements) {
    if (el.status !== 'active') continue;
    const bh = E.behavior(el);
    // Выход из боя
    if (bh === 'retreat') {
      el.exitTurns++;
      if (el.exitTurns >= k.retreatExitTurns) {
        el.status = 'withdrawn';
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} организованно выходит из боя.` });
      }
      continue;
    }
    if (bh === 'rout') {
      for (const c of el.comps) {
        const t = E.type(c.typeId);
        if (t.kind === 'personnel' || c.current <= 0) continue;
        const n = rng.binomial(c.current, k.routAbandonShare);
        if (n > 0) {
          c.current -= n;
          c.abandoned += n;
          E.log({ phase: 'checks', level: 1, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} бросает при бегстве: ${t.name} ×${n}.` });
        }
      }
      el.exitTurns++;
      if (el.exitTurns >= k.routExitTurns) {
        el.status = 'routed';
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'critical', refs: [el.id], text: `${e(el)} в беспорядке покидает поле боя.` });
      }
      continue;
    }
    // Уничтожение
    const valueNow = E.value(el);
    const pers = E.personnel(el);
    if (valueNow <= el.startValue * k.destroyedThreshold || pers <= 0) {
      const left = destroyElement(E, el);
      E.log({
        phase: 'checks',
        level: 0,
        side: el.side,
        severity: 'critical',
        refs: [el.id],
        text: `${e(el)} перестаёт существовать как боевая единица${left > 0 ? ` (уцелевшие ${left} чел. рассеяны)` : ''}.`,
        factors: [
          { label: 'Сохранилось боевой ценности', value: round1((valueNow / Math.max(1e-9, el.startValue)) * 100), kind: 'base' },
          { label: 'Порог уничтожения, %', value: k.destroyedThreshold * 100, kind: 'base' },
        ],
      });
      if (el.isHQ) shocks.push({ kind: 'hq', el, formation: E.formationOf(el) });
      continue;
    }
    // Паника
    const panicMult = E.mult(el, 'panic');
    if (f.panic && f.morale && el.morale < k.panicMorale && bh !== 'reserve') {
      const chance = clamp(k.panicChance * (1 - el.morale / Math.max(1, k.panicMorale)) * panicMult * (el.holdFast ? 0.5 : 1), 0, 1);
      const roll = rng.next();
      const factors: Factor[] = [
        { label: `Мораль ${Math.round(el.morale)} ниже порога паники ${k.panicMorale}`, value: k.panicChance * (1 - el.morale / Math.max(1, k.panicMorale)), kind: 'chance' },
        { label: 'Склонность к панике (опыт, командир, условия)', value: panicMult, kind: 'mult' },
      ];
      if (el.holdFast) factors.push({ label: '«Стоять насмерть»', value: 0.5, kind: 'mult' });
      factors.push({ label: 'Итоговый шанс', value: chance, kind: 'chance' });
      if (roll < chance) {
        setOrderByBehavior(E, el, 'rout');
        shocks.push({ kind: 'rout', el, formation: E.formationOf(el) });
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'critical', refs: [el.id], text: `${e(el)}: паника — бегство с позиций!`, factors });
        continue;
      }
      E.log({ phase: 'checks', level: 1, side: el.side, severity: 'info', refs: [el.id], text: `${e(el)} на грани паники, но держится (шанс паники ${Math.round(chance * 100)}%).`, factors });
    }
    // Отступление
    if (f.retreat && !el.holdFast && bh !== 'reserve') {
      const reasons: Factor[] = [];
      let sev = 0;
      if (f.morale && el.morale < k.retreatMorale) {
        const v = (k.retreatMorale - el.morale) / Math.max(1, k.retreatMorale);
        sev = Math.max(sev, v);
        reasons.push({ label: `Мораль ${Math.round(el.morale)} ниже порога ${k.retreatMorale}`, value: round1(v * 100) / 100, kind: 'base' });
      }
      const lossPct = (1 - valueNow / Math.max(1e-9, el.startValue)) * 100;
      if (lossPct > k.retreatLossPct) {
        const v = (lossPct - k.retreatLossPct) / Math.max(1, 100 - k.retreatLossPct) + 0.2;
        sev = Math.max(sev, v);
        reasons.push({ label: `Потери ${Math.round(lossPct)}% больше порога ${k.retreatLossPct}%`, value: round1(v * 100) / 100, kind: 'base' });
      }
      const turnLoss = (el.turnValueLost / Math.max(1e-9, el.startValue)) * 100;
      if (turnLoss > k.retreatShockPct) {
        sev = Math.max(sev, 0.5);
        reasons.push({ label: `Шоковые потери за ход ${Math.round(turnLoss)}%`, value: 0.5, kind: 'base' });
      }
      if (f.ammo && el.ammo <= 0) {
        sev = Math.max(sev, 0.3);
        reasons.push({ label: 'Нет боезапаса', value: 0.3, kind: 'base' });
      }
      if (E.formationOf(el).broken) {
        sev = Math.max(sev, 0.3);
        reasons.push({ label: 'Формирование сломлено', value: 0.3, kind: 'base' });
      }
      if (reasons.length) {
        const comms = E.comms(el);
        const chance = clamp(k.retreatChance * (0.5 + sev) * panicMult, 0, 1);
        reasons.push({ label: 'Склонность к отходу', value: panicMult, kind: 'mult' }, { label: 'Итоговый шанс', value: chance, kind: 'chance' });
        if (rng.next() < chance) {
          setOrderByBehavior(E, el, 'retreat');
          E.log({ phase: 'checks', level: 0, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} начинает отход${comms < 0.4 ? ' (без связи — приказ запоздал)' : ''}.`, factors: reasons });
        } else {
          E.log({ phase: 'checks', level: 2, side: el.side, refs: [el.id], text: `${e(el)} держится, несмотря на тяжёлое положение (шанс отхода ${Math.round(chance * 100)}%).`, factors: reasons });
        }
      }
    }
  }

  // Потеря штабов
  for (const sh of shocks.filter((x) => x.kind === 'hq')) {
    if (!sh.formation.hqLost) {
      sh.formation.hqLost = true;
      E.invalidate();
      E.log({ phase: 'checks', level: 0, side: sh.formation.side, severity: 'critical', refs: [sh.el!.id], text: `${fm(sh.formation)}: штаб потерян — связь ×${k.hqLossComms}, влияние командира утрачено.` });
    }
  }
  // Распад формирований
  for (const f2 of b.formations) {
    if (f2.broken) continue;
    const ids = subtreeIds(E, f2.id);
    const els = b.elements.filter((x) => ids.has(x.formationId) && x.status !== 'pending');
    const total = els.reduce((a, x) => a + x.startValue, 0);
    // Распад имеет смысл только для звена из нескольких элементов.
    if (total <= 0 || els.length < 2) continue;
    const gone = els.filter((x) => x.status !== 'active' || ['retreat', 'rout'].includes(E.behavior(x))).reduce((a, x) => a + x.startValue, 0);
    if (gone / total >= k.formationBreakShare) {
      f2.broken = true;
      shocks.push({ kind: 'break', formation: f2 });
      E.log({ phase: 'checks', level: 0, side: f2.side, severity: 'critical', text: `${fm(f2)}: формирование сломлено — ${Math.round((gone / total) * 100)}% сил выбыло или отходит.` });
    }
  }
  // Применение моральных потрясений (после всех проверок — чтобы порядок элементов не влиял)
  if (f.morale) {
    for (const sh of shocks) {
      const ids = subtreeIds(E, sh.formation.id);
      for (const el of b.elements) {
        if (el.status !== 'active' || el === sh.el) continue;
        let hit = 0;
        let label = '';
        if (sh.kind === 'rout') {
          if (ids.has(el.formationId)) {
            hit = k.moraleRoutFormation;
            label = 'бегство соседнего элемента';
          } else if (el.side === sh.formation.side) {
            hit = k.moraleRoutSide;
            label = 'бегство на соседнем участке';
          }
        } else if (ids.has(el.formationId)) {
          hit = sh.kind === 'hq' ? k.moraleHQLoss : k.moraleFormationBreak;
          label = sh.kind === 'hq' ? 'потеря штаба' : 'распад формирования';
        }
        if (hit <= 0) continue;
        const v = hit * E.mult(el, 'moraleLoss');
        el.morale = clamp(el.morale - v, 0, 100);
        E.log({ phase: 'checks', level: 2, side: el.side, severity: 'bad', refs: [el.id], text: `Мораль ${e(el)} −${v.toFixed(1)}: ${label}.` });
      }
    }
  }
  // Автоввод резервов
  if (k.autoCommitReserves >= 0.5) {
    for (const side of SIDES) {
      const els = E.sideElements(side);
      const fighting = els.some((x) => E.fighting(x) && E.behavior(x) !== 'reserve');
      if (fighting) continue;
      for (const el of els.filter((x) => x.status === 'active' && E.behavior(x) === 'reserve')) {
        const fo = E.orders.get(E.formationOf(el).orderId);
        const target = fo && fo.behavior !== 'reserve' ? fo.id : (E.rs.orders.find((o) => o.behavior === 'defend')?.id ?? el.orderId);
        el.orderId = target;
        E.invalidate(el);
        E.log({ phase: 'checks', level: 0, side, severity: 'info', refs: [el.id], text: `Первая линия стороны ${s(side)} выбыла — ${e(el)} вводится в бой (приказ «${E.order(el).name}»).` });
      }
    }
  }
  // Удержание позиций (для задач «удержать/захватить»)
  for (const side of SIDES) {
    const st = b.sides[side];
    if (st.lostHoldTurn) continue;
    if (!holding(E, side)) st.lostHoldTurn = b.turn;
  }
}

/** Сторона удерживает позиции: на месте осталось достаточно сил, не выходящих из боя. */
export function holding(E: EngineContext, side: SideId): boolean {
  const els = E.sideElements(side).filter((x) => x.status !== 'pending');
  const start = els.reduce((a, x) => a + x.startValue, 0);
  const now = els.filter((x) => E.fighting(x)).reduce((a, x) => a + E.value(x), 0);
  return start > 0 && now >= start * E.k.holdMinShare;
}
