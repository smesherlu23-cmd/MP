// Перенос результатов боя обратно в подразделения (для кампаний): потери, раненые,
// техника в ремонте, мораль, усталость, снабжение.

import { STATE_KEYS, cloneDeep, cloneUnit, migrateUnit, walkUnits, type Battle, type ElementState, type UnitNode } from '../engine';
import { addFormation, toast, updateFormation, updateScenario, useApp } from './store';

function applyState(n: UnitNode, st: ElementState, b: Battle) {
  const types = new Map(b.ruleset.componentTypes.map((t) => [t.id, t]));
  for (const c of n.composition) {
    const s = st.comps.find((x) => x.typeId === c.typeId);
    if (!s) continue;
    const t = types.get(c.typeId);
    c.current = s.current;
    // Раненые возвращаются позже, повреждённая техника — после ремонта.
    c.recoverable = (c.recoverable ?? 0) + (t?.kind === 'personnel' ? s.wia : s.damaged);
  }
  for (const k of STATE_KEYS) n.state[k] = Math.round(st[k]);
}

/** Копия подразделения сценария с состоянием после боя (идентификаторы сохраняются). */
export function postBattleUnit(def: UnitNode, b: Battle): UnitNode {
  const out = cloneDeep(migrateUnit(def));
  const byDef = new Map(b.elements.map((x) => [x.defId, x]));
  walkUnits(out, (n) => {
    const st = byDef.get(n.id);
    if (st) applyState(n, st, b);
  });
  return out;
}

function roots(b: Battle): UnitNode[] {
  return b.scenario.sides.flatMap((s) => s.formations.map((f) => migrateUnit(f)));
}

export function saveResultsAsNew(b: Battle) {
  let n = 0;
  for (const def of roots(b)) {
    const f = cloneUnit(postBattleUnit(def, b));
    delete f.templateId;
    delete f.templateHash;
    f.name = `${def.name} (после боя, ход ${b.turn})`;
    f.rulesetId = b.scenario.rulesetId;
    addFormation(f, false);
    n++;
  }
  toast(`В библиотеку добавлено подразделений: ${n}.`, 'good');
}

export function updateLibraryFromBattle(b: Battle) {
  const lib = useApp.getState().formations;
  let updated = 0;
  let skipped = 0;
  for (const def of roots(b)) {
    const src = def.templateId ? lib[def.templateId] : undefined;
    if (!src) {
      skipped++;
      continue;
    }
    // Узлы копии ссылаются на узлы библиотеки через srcNodeId.
    const bySource = new Map<string, UnitNode>();
    walkUnits(postBattleUnit(def, b), (n) => n.srcNodeId && bySource.set(n.srcNodeId, n));
    updateFormation(src.id, (d) =>
      walkUnits(d, (n) => {
        const p = bySource.get(n.id);
        if (!p || !n.composition.length) return;
        n.composition = cloneDeep(p.composition);
        n.state = { ...n.state, ...p.state };
      }),
    );
    updated++;
  }
  if (updated) toast(`Обновлено подразделений в библиотеке: ${updated}${skipped ? ` (без связи с библиотекой: ${skipped})` : ''}.`, 'good');
  else toast('Ни одно подразделение боя не связано с библиотекой — используйте «Сохранить как новые».', 'bad');
}

export function updateScenarioFromBattle(b: Battle) {
  const sc = useApp.getState().scenarios[b.scenarioId];
  if (!sc) {
    toast('Исходный сценарий не найден.', 'bad');
    return;
  }
  const post = roots(b).map((d) => postBattleUnit(d, b));
  updateScenario(sc.id, (d) => {
    for (const side of d.sides) side.formations = side.formations.map((f) => post.find((p) => p.id === f.id) ?? f);
  });
  toast('Подразделения сценария обновлены состоянием после боя.', 'good');
}
