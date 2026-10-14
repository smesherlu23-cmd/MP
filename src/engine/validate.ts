// Проверка сценария и подразделений на ошибки до начала боя.

import type { Ruleset, Scenario, UnitNode } from './types';

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
    for (const f of side.formations) issues.push(...validateUnit(f, rs, side.name));
  }
  return issues;
}
