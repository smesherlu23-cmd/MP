// Проверка сценария и подразделений на ошибки до начала боя.

import { EVENT_KIND_LABELS } from './labels';
import type { Id, Ruleset, Scenario, SideDef, UnitNode } from './types';
import { sideUnits, walkUnits } from './units';

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

export function validateUnit(root: UnitNode, rs: Ruleset, path = ''): Issue[] {
  const issues: Issue[] = [];
  const types = new Set(rs.componentTypes.map((t) => t.id));
  const orders = new Set(rs.orders.map((o) => o.id));
  const walk = (n: UnitNode, where: string) => {
    const here = where ? `${where} / ${n.name}` : n.name;
    if (n.order && !orders.has(n.order)) issues.push({ level: 'warning', text: `${here}: приказ «${n.order}» отсутствует в наборе правил.` });
    if (!n.composition.length && !n.children.length) issues.push({ level: 'warning', text: `${here}: нет ни состава, ни подчинённых — в бою не участвует.` });
    for (const c of n.composition) {
      if (!types.has(c.typeId)) issues.push({ level: 'error', text: `${here}: тип «${c.typeId}» отсутствует в наборе правил «${rs.name}».` });
      else if (c.current > c.authorized) issues.push({ level: 'warning', text: `${here}: в строю больше штата.` });
    }
    for (const ch of n.children) walk(ch, here);
  };
  walk(root, path);
  return issues;
}

export function validateScenario(sc: Scenario, rs: Ruleset | undefined): Issue[] {
  if (!rs) return [{ level: 'error', text: 'Не найден набор правил сценария.' }];
  const issues: Issue[] = [];
  if (!rs.rangeBands.length) issues.push({ level: 'error', text: 'В наборе правил нет ни одной дистанции.' });
  if (!rs.targetClasses.length) issues.push({ level: 'error', text: 'В наборе правил нет ни одного класса целей.' });
  if (!rs.rangeBands.some((b) => b.id === sc.startBand)) issues.push({ level: 'warning', text: 'Начальная дистанция не найдена — бой начнётся с самой дальней.' });
  for (const cat of rs.conditions) {
    if (!cat.options.some((o) => o.id === sc.conditions[cat.id])) issues.push({ level: 'warning', text: `Не выбрано условие «${cat.name}».` });
  }
  for (const side of sc.sides) {
    if (!side.formations.length) issues.push({ level: 'error', text: `У стороны «${side.name}» нет подразделений.` });
    else if (!sideUnits(side).length) issues.push({ level: 'error', text: `У стороны «${side.name}» все подразделения исключены из боя.` });
    for (const f of sideUnits(side)) issues.push(...validateUnit(f, rs, side.name));
  }
  // Участки: у каждого — силы обеих сторон, иначе боя там не будет.
  const sectors = sc.sectors ?? [];
  if (sectors.length) {
    const ids = new Set(sectors.map((x) => x.id));
    for (const sec of sectors) if (sec.startBand && !rs.rangeBands.some((b) => b.id === sec.startBand)) issues.push({ level: 'warning', text: `Участок «${sec.name}»: начальная дистанция не найдена — как в сценарии.` });
    for (const sd of sc.sides) {
      for (const [, sid] of Object.entries(sd.sectorOf ?? {})) if (!ids.has(sid)) issues.push({ level: 'warning', text: `У стороны «${sd.name}» подразделение назначено на удалённый участок — оно будет на первом.` });
      const used = new Set(nodeSectors(sd, sectors[0].id).values());
      for (const sec of sectors) if (!used.has(sec.id)) issues.push({ level: 'warning', text: `На участке «${sec.name}» нет сил стороны «${sd.name}».` });
    }
  }
  // Огневая поддержка: тип из каталога, единиц и ударов больше нуля.
  for (const sd of sc.sides)
    for (const a of sd.support ?? []) {
      const t = rs.componentTypes.find((x) => x.id === a.typeId);
      if (!t) issues.push({ level: 'error', text: `Огневая поддержка «${a.name}» (${sd.name}): тип не найден в наборе правил.` });
      else if (!Object.values(t.firepower).some((row) => Object.values(row).some((v) => v > 0))) issues.push({ level: 'warning', text: `Огневая поддержка «${a.name}» (${sd.name}): у типа «${t.name}» нет огневой мощи.` });
      if (!(a.count > 0) || !(a.missions > 0)) issues.push({ level: 'warning', text: `Огневая поддержка «${a.name}» (${sd.name}): нужно хотя бы одно средство и один удар.` });
    }
  // План боя: события должны ссылаться на существующие подразделения, приказы и условия.
  const nodes = new Map<string, Set<string>>(sc.sides.map((sd) => [sd.id, new Set<string>()]));
  for (const sd of sc.sides) for (const f of sideUnits(sd)) walkUnits(f, (n) => void nodes.get(sd.id)!.add(n.id));
  const enemyOf = (side?: string) => (side === 'A' ? 'B' : 'A');
  for (const ev of sc.events ?? []) {
    const at = `План боя, ${ev.trigger ? 'по условию' : `ход ${ev.turn}`}: «${EVENT_KIND_LABELS[ev.kind] ?? ev.kind}»`;
    if (ev.turn < 1) issues.push({ level: 'warning', text: `${at} — ход должен быть не меньше 1.` });
    if (ev.turn > sc.maxTurns) issues.push({ level: 'warning', text: `${at} — позже лимита ходов (${sc.maxTurns}), не наступит.` });
    if (ev.trigger) {
      const tr = ev.trigger;
      if (tr.nodeId && !nodes.get(tr.side)?.has(tr.nodeId)) issues.push({ level: 'warning', text: `${at} — подразделение в условии удалено из сценария или не участвует в бою.` });
      if (tr.metric === 'band' && !rs.rangeBands.some((b) => b.id === tr.value)) issues.push({ level: 'warning', text: `${at} — дистанция в условии не выбрана.` });
    }
    if (ev.kind === 'strike') {
      const sd = sc.sides.find((x) => x.id === ev.side);
      if (!sd?.support?.some((a) => a.id === ev.assetId)) issues.push({ level: 'warning', text: `${at} — не выбрано средство огневой поддержки стороны.` });
      if (ev.targetNodeId && !nodes.get(enemyOf(ev.side))?.has(ev.targetNodeId)) issues.push({ level: 'warning', text: `${at} — цель удалена из сценария или не участвует в бою.` });
    }
    if (ev.kind === 'effect') {
      if (!rs.tempEffects?.some((x) => x.id === ev.effectId)) issues.push({ level: 'warning', text: `${at} — эффект не выбран или отсутствует в наборе правил.` });
      if (ev.nodeId && (!ev.side || !nodes.get(ev.side)?.has(ev.nodeId))) issues.push({ level: 'warning', text: `${at} — подразделение удалено из сценария или не участвует в бою.` });
    }
    if (ev.kind === 'arrive' || ev.kind === 'order') {
      if (!ev.side || !ev.nodeId || !nodes.get(ev.side)?.has(ev.nodeId)) issues.push({ level: 'warning', text: `${at} — подразделение не выбрано, удалено из сценария или не участвует в бою; событие не сработает.` });
    }
    if (ev.kind === 'order' && !rs.orders.some((o) => o.id === ev.orderId)) issues.push({ level: 'warning', text: `${at} — приказ не выбран или отсутствует в наборе правил.` });
    if (ev.kind === 'conditions' && !Object.entries(ev.conditions ?? {}).some(([c, o]) => rs.conditions.find((x) => x.id === c)?.options.some((x) => x.id === o)))
      issues.push({ level: 'warning', text: `${at} — не выбрано, какие условия меняются.` });
  }
  return issues;
}

/** Участки подразделений стороны: id узла с составом → участок (с наследованием от старших). */
export function nodeSectors(sd: SideDef, fallback: Id): Map<Id, Id> {
  const out = new Map<Id, Id>();
  const walk = (n: UnitNode, sec: Id) => {
    const own = sd.sectorOf?.[n.id] || sec;
    if (n.composition.length) out.set(n.id, own);
    for (const c of n.children) walk(c, own);
  };
  for (const f of sideUnits(sd)) walk(f, fallback);
  return out;
}
