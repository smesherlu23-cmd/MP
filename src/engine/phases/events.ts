// План боя: события сценария по ходам и по условию (подход, приказ, условия, удар, эффект).

import { type EngineContext, e, fm, s } from '../context';
import { plural } from '../labels';
import type { Battle, ElementState, EventTrigger, Scenario, ScenarioEvent } from '../types';
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
  const els = (tr.nodeId ? elementsOfNode(b, tr.side, tr.nodeId) : E.sideElements(tr.side)).filter((x) => x.status !== 'pending');
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

/** План боя: события сценария, выпавшие на этот ход (до обнаружения и огня). */
export function phaseEvents(E: EngineContext) {
  const { b, rng } = E;
  for (const ev of b.scenario.events ?? []) {
    if (ev.trigger && b.eventTurns?.[ev.id] === undefined) {
      if (b.turn < ev.turn || !triggerMet(E, ev.trigger)) continue;
      const delay = Math.max(0, Math.round(ev.delay ?? 0));
      (b.eventTurns ??= {})[ev.id] = b.turn + delay;
      if (delay > 0)
        E.log({ phase: 'plan', level: 1, side: ev.side, text: `Условие плана выполнено (${triggerText(b, ev.trigger)}): «${eventTitle(b, ev)}» — через ${delay} ${plural(delay, 'ход', 'хода', 'ходов')}.` });
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
      const late = els.filter((x) => x.status === 'pending');
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
      const changes: string[] = [];
      for (const [cat, opt] of Object.entries(ev.conditions ?? {})) {
        const c = b.ruleset.conditions.find((x) => x.id === cat);
        const o = c?.options.find((x) => x.id === opt);
        if (!c || !o || b.conditions[cat] === opt) continue;
        changes.push(`${c.name.toLowerCase()}: ${o.name}`);
        if (happens) b.conditions[cat] = opt;
      }
      if (!changes.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, text: `По плану ожидалось — ${changes.join(', ')}, но не случилось${note}.` });
        continue;
      }
      E.refreshConditions();
      E.invalidate();
      E.log({ phase: 'plan', level: 0, text: `Обстановка меняется — ${changes.join(', ')}${note}.` });
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
      E.log({ phase: 'plan', level: 0, side, refs: els.map((x) => x.id), text: `По плану: «${def.name}» — ${ev.nodeId ? who() : s(side)}, ${turns} ${plural(turns, 'ход', 'хода', 'ходов')}${note}.` });
    }
  }
}

/** Название события плана для журнала. */
function eventTitle(b: Battle, ev: ScenarioEvent): string {
  if (ev.kind === 'strike') return `удар «${b.support?.find((a) => a.id === ev.assetId)?.name ?? '?'}»`;
  if (ev.kind === 'effect') return b.ruleset.tempEffects?.find((x) => x.id === ev.effectId)?.name ?? 'эффект';
  if (ev.kind === 'order') return `приказ «${b.ruleset.orders.find((o) => o.id === ev.orderId)?.name ?? '?'}»`;
  if (ev.kind === 'arrive') return 'подход подкреплений';
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
