// Перенос результатов боя обратно в подразделения (для кампаний): потери, раненые,
// техника в ремонте, мораль, усталость, снабжение.

import { clone, copyFormation, type Battle, type ElementDef, type ElementState, type FormationDef } from '../engine';
import { addFormation, toast, updateFormation, updateScenario, useApp } from './store';

function applyState(e: ElementDef, st: ElementState, b: Battle) {
  const types = new Map(b.ruleset.componentTypes.map((t) => [t.id, t]));
  for (const c of e.composition) {
    const s = st.comps.find((x) => x.typeId === c.typeId);
    if (!s) continue;
    const t = types.get(c.typeId);
    c.current = s.current;
    // Раненые возвращаются позже, повреждённая техника — после ремонта
    c.recoverable = (c.recoverable ?? 0) + (t?.kind === 'personnel' ? s.wia : s.damaged);
  }
  e.morale = Math.round(st.morale);
  e.cohesion = Math.round(st.cohesion);
  e.fatigue = Math.round(st.fatigue);
  e.ammo = Math.round(st.ammo);
  e.fuel = Math.round(st.fuel);
  e.equipment = Math.round(st.equipment);
  e.vehicleCondition = Math.round(st.vehicleCondition);
  e.readiness = Math.round(st.readiness);
}

/** Копия подразделения сценария с состоянием после боя (идентификаторы сохраняются). */
export function postBattleFormation(def: FormationDef, b: Battle): FormationDef {
  const out = clone(def);
  const byDef = new Map(b.elements.map((x) => [x.defId, x]));
  const walk = (f: FormationDef) => {
    for (const e of f.elements) {
      const st = byDef.get(e.id);
      if (st) applyState(e, st, b);
    }
    f.subunits.forEach(walk);
  };
  walk(out);
  return out;
}

function topDefs(b: Battle): FormationDef[] {
  return b.scenario.sides.flatMap((s) => s.formations);
}

export function saveResultsAsNew(b: Battle) {
  let n = 0;
  for (const def of topDefs(b)) {
    const f = copyFormation(postBattleFormation(def, b));
    const strip = (x: FormationDef) => {
      delete x.sourceId;
      x.elements.forEach((e) => delete e.sourceId);
      x.subunits.forEach(strip);
    };
    strip(f);
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
  for (const def of topDefs(b)) {
    const src = def.sourceId ? lib[def.sourceId] : undefined;
    if (!src) {
      skipped++;
      continue;
    }
    const post = postBattleFormation(def, b);
    // элементы копии ссылаются на элементы библиотеки через sourceId
    const bySource = new Map<string, ElementDef>();
    const collect = (f: FormationDef) => {
      f.elements.forEach((e) => e.sourceId && bySource.set(e.sourceId, e));
      f.subunits.forEach(collect);
    };
    collect(post);
    updateFormation(src.id, (d) => {
      const walk = (f: FormationDef) => {
        for (const e of f.elements) {
          const p = bySource.get(e.id);
          if (!p) continue;
          e.composition = clone(p.composition);
          for (const k of ['morale', 'cohesion', 'fatigue', 'ammo', 'fuel', 'equipment', 'vehicleCondition', 'readiness'] as const) e[k] = p[k];
        }
        f.subunits.forEach(walk);
      };
      walk(d);
    });
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
  updateScenario(sc.id, (d) => {
    for (const side of d.sides) {
      side.formations = side.formations.map((f) => {
        const def = topDefs(b).find((x) => x.id === f.id);
        return def ? postBattleFormation(def, b) : f;
      });
    }
  });
  toast('Подразделения сценария обновлены состоянием после боя.', 'good');
}
