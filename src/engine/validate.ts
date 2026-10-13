// Проверка сценария и подразделений на ошибки до начала боя.

import type { FormationDef, Ruleset, Scenario } from './types';

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

export function validateFormation(f: FormationDef, rs: Ruleset, path = ''): Issue[] {
  const issues: Issue[] = [];
  const types = new Set(rs.componentTypes.map((t) => t.id));
  const orders = new Set(rs.orders.map((o) => o.id));
  const where = path ? `${path} / ${f.name}` : f.name;
  if (f.order && !orders.has(f.order)) issues.push({ level: 'warning', text: `${where}: приказ «${f.order}» отсутствует в наборе правил.` });
  for (const e of f.elements) {
    if (!e.composition.length) issues.push({ level: 'warning', text: `${where} / ${e.name}: нет состава — элемент не участвует в бою.` });
    for (const c of e.composition) {
      if (!types.has(c.typeId)) issues.push({ level: 'error', text: `${where} / ${e.name}: тип «${c.typeId}» отсутствует в наборе правил «${rs.name}».` });
      if (c.current > c.authorized) issues.push({ level: 'warning', text: `${where} / ${e.name}: в строю больше штата.` });
    }
    if (e.order && !orders.has(e.order)) issues.push({ level: 'warning', text: `${where} / ${e.name}: приказ «${e.order}» отсутствует в наборе правил.` });
  }
  for (const s of f.subunits) issues.push(...validateFormation(s, rs, where));
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
    for (const f of side.formations) issues.push(...validateFormation(f, rs, side.name));
  }
  return issues;
}
