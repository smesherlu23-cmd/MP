// План боя: события сценария по ходам и по условию (подход, приказ, условия, удар, эффект).

import { type EngineContext, e, fm, notArrived, s } from '../context';
import { plural } from '../labels';
import type { Battle, ElementState, EventTrigger, Id, Scenario, ScenarioEvent } from '../types';
import { elementsOfNode } from './common';

/** Ход, на который по плану подходит не подошедшее ещё подкрепление (null — не по плану). */
export function arrivalTurn(b: Battle, el: ElementState): number | null {
  for (const ev of b.scenario.events ?? [])
    if (ev.kind === 'arrive' && ev.side === el.side && ev.nodeId && elementsOfNode(b, el.side, ev.nodeId).includes(el)) return b.eventTurns?.[ev.id] ?? ev.turn;
  return null;
}

/** Выполнено ли условие события плана (по состоянию на начало хода). */
export function triggerMet(E: EngineContext, tr: EventTrigger): boolean {
  const { b } = E;
  if (tr.metric === 'band') {
    const i = b.ruleset.rangeBands.findIndex((x) => x.id === tr.value);
    if (i < 0) return false;
    if (!b.sectors) return b.bandIndex >= i;
    const els = tr.nodeId ? elementsOfNode(b, tr.side, tr.nodeId) : [];
    const secs = els.length ? [...new Set(els.map((x) => E.sectorOf(x)!))] : b.sectors;
    return secs.some((sec) => sec.bandIndex >= i);
  }
  const els = (tr.nodeId ? elementsOfNode(b, tr.side, tr.nodeId) : E.sideElements(tr.side)).filter((x) => !notArrived(x));
  if (!els.length) return false;
  const v = Number(tr.value) || 0;
  if (tr.metric === 'losses') {
    const start = els.reduce((a, x) => a + x.startPersonnel, 0);
    const now = els.reduce((a, x) => a + E.personnel(x), 0);
    return start > 0 && (1 - now / start) * 100 >= v;
  }
  if (tr.metric === 'out') {
    const start = els.reduce((a, x) => a + x.startValue, 0);
    const gone = els.filter((x) => !E.fighting(x)).reduce((a, x) => a + x.startValue, 0);
    return start > 0 && (gone / start) * 100 >= v;
  }
  // morale: средняя мораль оставшихся в бою (по боевой ценности); если в бою никого — условие выполнено.
  const act = els.filter((x) => E.fighting(x));
  const w = act.reduce((a, x) => a + E.value(x), 0);
  if (w <= 0) return true;
  return act.reduce((a, x) => a + x.morale * E.value(x), 0) / w <= v;
}

/** Ход, на который назначено событие плана; undefined — событие с условием, которое ещё не выполнилось. */
export function eventTurn(b: Battle, ev: ScenarioEvent): number | undefined {
  return b.eventTurns?.[ev.id] ?? (ev.trigger ? undefined : ev.turn);
}

/**
 * Переброска элементов на участок sectorId: travel ходов в пути (вне боя: не стреляют, не несут потерь),
 * в начале хода away + travel — в бою на новом участке; travel 0 — сразу. away — первый ход в пути.
 * Отходящие, бегущие и уже стоящие на этом участке не перебрасываются. Возвращает переброшенных.
 */
export function startTransfer(E: EngineContext, els: ElementState[], sectorId: Id, travel: number, away: number): ElementState[] {
  if (!E.sectors.has(sectorId)) return [];
  const moved: ElementState[] = [];
  for (const el of els) {
    if (el.status !== 'active' || el.transit || el.sector === sectorId) continue;
    const bh = E.behavior(el);
    if (bh === 'retreat' || bh === 'rout') continue;
    if (travel <= 0) el.sector = sectorId;
    else {
      el.status = 'pending';
      el.transit = { to: sectorId, until: away + travel };
      el.spotted = false;
      el.digInTurns = 0;
    }
    E.invalidate(el);
    moved.push(el);
  }
  return moved;
}

/** Переброшенные элементы, чей путь окончен, вступают в бой на новом участке (в начале хода). */
export function arriveTransfers(E: EngineContext) {
  const { b } = E;
  const bySec = new Map<Id, ElementState[]>();
  for (const el of b.elements) {
    if (!el.transit || b.turn < el.transit.until) continue;
    el.status = 'active';
    el.sector = el.transit.to;
    delete el.transit;
    E.invalidate(el);
    const list = bySec.get(el.sector) ?? [];
    list.push(el);
    bySec.set(el.sector, list);
  }
  for (const [sec, els] of bySec)
    E.log({
      phase: 'plan',
      level: 0,
      side: els[0].side,
      refs: els.map((x) => x.id),
      text: `На участок «${E.sectors.get(sec)?.name ?? sec}» прибыли: ${els.length > 3 ? `${els.length} элементов` : els.map((x) => e(x)).join(', ')}.`,
    });
}

/** План боя: события сценария, выпавшие на этот ход (до обнаружения и огня). */
export function phaseEvents(E: EngineContext) {
  const { b, rng } = E;
  arriveTransfers(E);
  for (const ev of b.scenario.events ?? []) {
    if (ev.trigger && b.eventTurns?.[ev.id] === undefined) {
      if (b.turn < ev.turn || !triggerMet(E, ev.trigger)) continue;
      const delay = Math.max(0, Math.round(ev.delay ?? 0));
      (b.eventTurns ??= {})[ev.id] = b.turn + delay;
      if (delay > 0)
        E.log({
          phase: 'plan',
          level: 1,
          side: ev.side,
          text: `Условие плана выполнено (${triggerText(b, ev.trigger)}): «${eventTitle(b, ev)}» — через ${delay} ${plural(delay, 'ход', 'хода', 'ходов')}.`,
        });
    }
    if ((b.eventTurns?.[ev.id] ?? ev.turn) !== b.turn) continue;
    const chance = ev.chance ?? 100;
    const happens = chance >= 100 || rng.chance(Math.max(0, chance) / 100);
    const note = ev.note ? ` (${ev.note})` : '';
    const side = ev.side;
    const els = side && ev.nodeId ? elementsOfNode(b, side, ev.nodeId) : [];
    const who = () => {
      const f = b.formations.find((x) => x.side === side && x.defId === ev.nodeId);
      return f ? fm(f) : els.length ? e(els[0]) : '?';
    };
    if (ev.kind === 'arrive') {
      const late = els.filter((x) => notArrived(x));
      if (!late.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 0, side, severity: 'bad', refs: late.map((x) => x.id), text: `${who()}: подкрепление не подошло${note}.` });
        continue;
      }
      for (const el of late) el.status = 'active';
      E.invalidate();
      const pers = late.reduce((a, x) => a + E.personnel(x), 0);
      E.log({ phase: 'plan', level: 0, side, severity: 'good', refs: late.map((x) => x.id), text: `Подходят подкрепления: ${who()} — ${pers} чел.${note}` });
    } else if (ev.kind === 'order') {
      const order = E.orders.get(ev.orderId ?? '');
      const act = els.filter((x) => x.status === 'active' || x.status === 'pending');
      if (!order || !act.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ${who()} должно было получить приказ «${order.name}», но этого не произошло${note}.` });
        continue;
      }
      for (const el of act) {
        el.orderId = order.id;
        if (order.behavior !== 'retreat' && order.behavior !== 'rout') el.exitTurns = 0;
        E.invalidate(el);
      }
      E.log({ phase: 'plan', level: 0, side, refs: act.map((x) => x.id), text: `По плану: ${who()} — приказ «${order.name}»${note}.` });
    } else if (ev.kind === 'conditions') {
      // На всём поле — общие условия, а на участках со своими условиями эта категория тоже меняется:
      // иначе «наступает ночь» не дошла бы до участка со своей местностью. На одном участке — только там.
      const sec = ev.sectorId ? b.sectors?.find((x) => x.id === ev.sectorId) : undefined;
      if (ev.sectorId && !sec) continue;
      const changes: string[] = [];
      for (const [cat, opt] of Object.entries(ev.conditions ?? {})) {
        const c = b.ruleset.conditions.find((x) => x.id === cat);
        const o = c?.options.find((x) => x.id === opt);
        if (!c || !o) continue;
        if (sec) {
          if ((sec.conditions[cat] || b.conditions[cat]) === opt) continue;
          changes.push(`${c.name.toLowerCase()}: ${o.name}`);
          if (happens) sec.conditions[cat] = opt;
          continue;
        }
        const own = (b.sectors ?? []).filter((x) => x.conditions[cat] && x.conditions[cat] !== opt);
        if (b.conditions[cat] === opt && !own.length) continue;
        changes.push(`${c.name.toLowerCase()}: ${o.name}`);
        if (happens) {
          b.conditions[cat] = opt;
          for (const x of own) delete x.conditions[cat];
        }
      }
      if (!changes.length) continue;
      const where = sec ? ` на участке «${sec.name}»` : '';
      if (!happens) {
        E.log({ phase: 'plan', level: 1, text: `По плану ожидалось${where} — ${changes.join(', ')}, но не случилось${note}.` });
        continue;
      }
      E.refreshConditions();
      E.invalidate();
      E.log({ phase: 'plan', level: 0, text: `Обстановка меняется${where} — ${changes.join(', ')}${note}.` });
    } else if (ev.kind === 'band') {
      const i = b.ruleset.rangeBands.findIndex((x) => x.id === ev.bandId);
      if (i < 0) continue;
      const secs = b.sectors ? (ev.sectorId ? b.sectors.filter((x) => x.id === ev.sectorId) : b.sectors) : null;
      if (secs && !secs.length) continue;
      const name = b.ruleset.rangeBands[i].name;
      const where = secs ? (secs.length === 1 && b.sectors!.length > 1 ? ` на участке «${secs[0].name}»` : ' на всех участках') : '';
      if (!happens) {
        E.log({ phase: 'plan', level: 1, text: `По плану ожидалась дистанция «${name}»${where}, но этого не случилось${note}.` });
        continue;
      }
      if (secs)
        for (const x of secs) {
          x.bandIndex = i;
          x.closingProgress = 0;
        }
      else {
        b.bandIndex = i;
        b.closingProgress = 0;
      }
      E.invalidate();
      E.log({ phase: 'plan', level: 0, text: `По плану: дистанция${where} — «${name}»${note}.` });
    } else if (ev.kind === 'resupply') {
      if (!side) continue;
      const act = (ev.nodeId ? els : E.sideElements(side)).filter((x) => x.status === 'active');
      const what = [ev.ammo ? `боезапас +${ev.ammo}%` : '', ev.fuel ? `топливо +${ev.fuel}%` : '', ev.equipment ? `снаряжение +${ev.equipment}%` : ''].filter(
        Boolean,
      );
      if (!act.length || !what.length) continue;
      const target = ev.nodeId ? who() : s(side);
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ожидался подвоз (${what.join(', ')}) — ${target}, но его не было${note}.` });
        continue;
      }
      for (const el of act) {
        if (ev.ammo) el.ammo = Math.max(0, Math.min(100, el.ammo + ev.ammo));
        if (ev.fuel) el.fuel = Math.max(0, Math.min(100, el.fuel + ev.fuel));
        if (ev.equipment) el.equipment = Math.max(0, Math.min(100, el.equipment + ev.equipment));
        E.invalidate(el);
      }
      E.log({ phase: 'plan', level: 0, side, refs: act.map((x) => x.id), text: `По плану: подвоз (${what.join(', ')}) — ${target}${note}.` });
    } else if (ev.kind === 'command') {
      const f = side && ev.nodeId ? b.formations.find((x) => x.side === side && x.defId === ev.nodeId) : undefined;
      if (!f) continue;
      const changes: string[] = [];
      if (typeof ev.commandLevel === 'number') {
        const lv = Math.max(0, Math.min(Math.max(1, b.ruleset.commandLevels.length), Math.round(ev.commandLevel)));
        changes.push(`командир: ${lv ? (b.ruleset.commandLevels[lv - 1]?.name ?? lv) : 'нет'}`);
        if (happens) f.commandLevel = lv;
      }
      if (typeof ev.comms === 'number') {
        changes.push(`связь ${ev.comms}%`);
        if (happens) f.comms = Math.max(0, Math.min(100, ev.comms));
      }
      if (typeof ev.supply === 'number') {
        changes.push(`снабжение ${ev.supply}%`);
        if (happens) f.supply = Math.max(0, Math.min(100, ev.supply));
      }
      if (!changes.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ожидалось: ${fm(f)} — ${changes.join(', ')}, но этого не случилось${note}.` });
        continue;
      }
      E.invalidate();
      E.log({ phase: 'plan', level: 0, side, text: `По плану: ${fm(f)} — ${changes.join(', ')}${note}.` });
    } else if (ev.kind === 'fortification') {
      if (!side) continue;
      const fort = ev.fortificationId ? b.ruleset.fortifications.find((x) => x.id === ev.fortificationId) : undefined;
      const intel = ev.intelId ? b.ruleset.intelLevels.find((x) => x.id === ev.intelId) : undefined;
      const sec = ev.sectorId ? b.sectors?.find((x) => x.id === ev.sectorId) : undefined;
      if ((!fort && !intel) || (ev.sectorId && !sec)) continue;
      const changes = [fort ? `укрепления: ${fort.name}${sec ? ` (участок «${sec.name}»)` : ''}` : '', intel ? `разведданные: ${intel.name}` : ''].filter(
        Boolean,
      );
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ожидалось для ${s(side)}: ${changes.join(', ')}, но этого не случилось${note}.` });
        continue;
      }
      if (fort) {
        if (sec) sec.fortification[side] = fort.id;
        else {
          b.sides[side].fortification = fort.id;
          // На всём поле: и на участках, где у стороны были свои укрепления.
          for (const x of b.sectors ?? []) delete x.fortification[side];
        }
      }
      if (intel) b.sides[side].intel = intel.id;
      E.invalidate();
      E.log({ phase: 'plan', level: 0, side, text: `По плану: ${s(side)} — ${changes.join(', ')}${note}.` });
    } else if (ev.kind === 'transfer') {
      const sec = ev.sectorId ? b.sectors?.find((x) => x.id === ev.sectorId) : undefined;
      if (!side || !sec || !els.length) continue;
      const travel = Math.max(0, Math.round(ev.turns ?? 1));
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ${who()} должно было перебрасываться на участок «${sec.name}», но этого не случилось${note}.` });
        continue;
      }
      const moved = startTransfer(E, els, sec.id, travel, b.turn);
      if (!moved.length) continue;
      E.log({
        phase: 'plan',
        level: 0,
        side,
        refs: moved.map((x) => x.id),
        text: `По плану: ${who()} перебрасывается на участок «${sec.name}»${travel ? ` — в пути ${travel} ${plural(travel, 'ход', 'хода', 'ходов')}` : ''}${note}.`,
      });
    } else if (ev.kind === 'strike') {
      const asset = b.support?.find((a) => a.side === side && a.id === ev.assetId);
      if (!asset || !side) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ожидался удар «${asset.name}», но его не было${note}.` });
        continue;
      }
      if (asset.left <= 0) {
        E.log({ phase: 'plan', level: 1, side, severity: 'bad', text: `«${asset.name}»: ударов не осталось — удар по плану не нанесён${note}.` });
        continue;
      }
      asset.left--;
      const enemy = E.enemyOf(side);
      const f = ev.targetNodeId ? b.formations.find((x) => x.side === enemy && x.defId === ev.targetNodeId) : undefined;
      const els = ev.targetNodeId && !f ? elementsOfNode(b, enemy, ev.targetNodeId) : [];
      (b.strikes ??= []).push({
        id: `st${b.strikes.length + 1}`,
        side,
        assetId: asset.id,
        ...(f ? { formationId: f.id } : els.length ? { elementIds: els.map((x) => x.id) } : {}),
        turn: b.turn,
        source: 'plan',
      });
    } else if (ev.kind === 'effect') {
      const def = b.ruleset.tempEffects?.find((x) => x.id === ev.effectId);
      if (!def || !side) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ожидалось «${def.name}», но этого не произошло${note}.` });
        continue;
      }
      const f = ev.nodeId ? b.formations.find((x) => x.side === side && x.defId === ev.nodeId) : undefined;
      if (ev.nodeId && !f && !els.length) continue;
      const turns = Math.max(1, Math.round(ev.turns ?? def.turns ?? 1));
      (b.effects ??= []).push({
        id: `fx${b.effects.length + 1}`,
        name: def.name,
        effects: { ...def.effects },
        from: b.turn,
        until: b.turn + turns - 1,
        side,
        ...(f ? { formationId: f.id } : els.length ? { elementIds: els.map((x) => x.id) } : {}),
        source: 'plan',
      });
      E.invalidate();
      E.log({
        phase: 'plan',
        level: 0,
        side,
        refs: els.map((x) => x.id),
        text: `По плану: «${def.name}» — ${ev.nodeId ? who() : s(side)}, ${turns} ${plural(turns, 'ход', 'хода', 'ходов')}${note}.`,
      });
    }
  }
}

/** Название события плана для журнала. */
function eventTitle(b: Battle, ev: ScenarioEvent): string {
  if (ev.kind === 'strike') return `удар «${b.support?.find((a) => a.id === ev.assetId)?.name ?? '?'}»`;
  if (ev.kind === 'effect') return b.ruleset.tempEffects?.find((x) => x.id === ev.effectId)?.name ?? 'эффект';
  if (ev.kind === 'order') return `приказ «${b.ruleset.orders.find((o) => o.id === ev.orderId)?.name ?? '?'}»`;
  if (ev.kind === 'arrive') return 'подход подкреплений';
  if (ev.kind === 'band') return `дистанция «${b.ruleset.rangeBands.find((x) => x.id === ev.bandId)?.name ?? '?'}»`;
  if (ev.kind === 'resupply') return 'подвоз';
  if (ev.kind === 'command') return 'командир и связь';
  if (ev.kind === 'fortification') return 'укрепления и разведданные';
  if (ev.kind === 'transfer') return `переброска на участок «${b.sectors?.find((x) => x.id === ev.sectorId)?.name ?? '?'}»`;
  return 'смена условий';
}

/** Условие события человеческим языком: «потери Синих ≥ 30%». */
export function triggerText(b: Pick<Battle, 'ruleset' | 'sides'> & { scenario?: Scenario }, tr: EventTrigger, nodeName?: string): string {
  const who = nodeName ?? b.sides[tr.side]?.name ?? tr.side;
  switch (tr.metric) {
    case 'losses':
      return `потери ${nodeName ? `«${who}»` : who} ≥ ${tr.value}%`;
    case 'out':
      return `${nodeName ? `у «${who}»` : `у стороны ${who}`} выбыло ≥ ${tr.value}%`;
    case 'morale':
      return `мораль ${nodeName ? `«${who}»` : who} ≤ ${tr.value}`;
    case 'band':
      return `дистанция «${b.ruleset.rangeBands.find((x) => x.id === tr.value)?.name ?? tr.value}» или ближе`;
  }
}
