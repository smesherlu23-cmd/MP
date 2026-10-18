// Итоги боя — в силы сторон: потери, раненые, техника в ремонте, мораль, усталость, боезапас.
// Записываются в конкретные подразделения сил, участвовавшие в бою; шаблонов это не касается.

import { applyBattleToForces, battleForceIds, plural, type Battle } from '../engine';
import { confirmDialog, fmtDate, historyStep, toastUndoable, touchBattle, updateForce, useApp } from './store';

/** Силы, в которые можно записать итоги этого боя. */
export function battleForces(b: Battle) {
  const forces = useApp.getState().forces;
  return battleForceIds(b, forces).map((id) => forces[id]);
}

export async function applyResultsToForces(b: Battle) {
  const forces = useApp.getState().forces;
  if (b.appliedToForces && !(await confirmDialog('Итоги уже записаны', `Итоги этого боя записаны в силы ${fmtDate(b.appliedToForces)}. Записать ещё раз? Потери вычтутся повторно.`, 'Записать ещё раз', true)))
    return;
  const { updated, changes } = applyBattleToForces(b, forces);
  if (!updated.length) return;
  historyStep(`итоги боя «${b.name}» в силах`);
  for (const f of updated) updateForce(f.id, (d) => Object.assign(d, f));
  b.appliedToForces = new Date().toISOString();
  touchBattle(b.id);
  const lines = changes.map((c) => `${c.name}: −${c.personnel} чел.${c.equipment ? `, техника −${c.equipment}` : ''}`);
  toastUndoable(`Итоги записаны в силы (${changes.length} ${plural(changes.length, 'подразделение', 'подразделения', 'подразделений')}): ${lines.join('; ')}.`);
}
