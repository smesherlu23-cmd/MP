// Вмешательства ГМ между ходами. Каждое записывается в бой, поэтому бой можно воспроизвести
// с тем же сидом и теми же решениями ГМ. Вмешательства не тратят случайные числа.

import { createBattle, finish, stepTurn } from './battle';
import { EngineContext, clamp, e, fm } from './context';
import type { Battle, ElementState, Intervention, InterventionType } from './types';

export interface ElementPatch {
  morale?: number;
  cohesion?: number;
  readiness?: number;
  ammo?: number;
  fuel?: number;
  equipment?: number;
  fatigue?: number;
  vehicleCondition?: number;
  suppression?: number;
  experience?: number;
  attackMod?: number;
  defenseMod?: number;
  echelon?: ElementState['echelon'];
  holdFast?: boolean;
  comps?: { typeId: string; current: number }[];
}

const PATCH_LABELS: Record<string, string> = {
  morale: 'мораль',
  cohesion: 'слаженность',
  readiness: 'готовность',
  ammo: 'боезапас',
  fuel: 'топливо',
  equipment: 'снаряжение',
  fatigue: 'усталость',
  vehicleCondition: 'техсостояние',
  suppression: 'подавление',
  experience: 'опыт',
  attackMod: 'атака',
  defenseMod: 'защита',
  echelon: 'эшелон',
  holdFast: '«стоять насмерть»',
};

export function applyIntervention(b: Battle, iv: { type: InterventionType; payload: Record<string, unknown>; note?: string }, record = true): void {
  if (b.finished && iv.type !== 'endBattle') return;
  const E = new EngineContext(b);
  const p = iv.payload as Record<string, any>;
  const note = iv.note ? ` (${iv.note})` : '';
  switch (iv.type) {
    case 'setOrder': {
      const order = E.orders.get(p.orderId);
      if (!order) return;
      const ids: string[] = p.elementIds ?? [];
      for (const id of ids) {
        const el = E.elements.get(id);
        if (!el || el.status !== 'active') continue;
        el.orderId = order.id;
        if (order.behavior !== 'retreat' && order.behavior !== 'rout') el.exitTurns = 0;
      }
      const names = ids.length > 3 ? `${ids.length} элементов` : ids.map((id) => e(id)).join(', ');
      E.log({ phase: 'gm', level: 0, refs: ids, text: `ГМ: приказ «${order.name}» для ${names}${note}.` });
      break;
    }
    case 'setFormation': {
      const f = E.formations.get(p.formationId);
      if (!f) return;
      const changes: string[] = [];
      if (typeof p.comms === 'number') {
        f.comms = clamp(p.comms, 0, 100);
        changes.push(`связь ${f.comms}%`);
      }
      if (typeof p.supply === 'number') {
        f.supply = clamp(p.supply, 0, 100);
        changes.push(`снабжение ${f.supply}%`);
      }
      if (typeof p.commandLevel === 'number') {
        f.commandLevel = clamp(Math.round(p.commandLevel), 1, Math.max(1, b.ruleset.commandLevels.length));
        changes.push(`командир: ${b.ruleset.commandLevels[f.commandLevel - 1]?.name ?? f.commandLevel}`);
      }
      if (typeof p.orderId === 'string' && E.orders.get(p.orderId)) {
        f.orderId = p.orderId;
        changes.push(`приказ «${E.orders.get(p.orderId)!.name}» всем элементам`);
        const ids = new Set([f.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
            ids.add(x.id);
            grew = true;
          }
        }
        for (const el of b.elements) if (ids.has(el.formationId) && el.status === 'active') {
          el.orderId = p.orderId;
          el.exitTurns = 0;
        }
      }
      E.log({ phase: 'gm', level: 0, side: f.side, text: `ГМ: ${fm(f)} — ${changes.join(', ') || 'без изменений'}${note}.` });
      break;
    }
    case 'editElement': {
      const el = E.elements.get(p.elementId);
      if (!el) return;
      const patch = (p.patch ?? {}) as ElementPatch;
      const changes: string[] = [];
      for (const [key, val] of Object.entries(patch)) {
        if (key === 'comps' || val === undefined) continue;
        if (key === 'echelon' || key === 'holdFast') (el as any)[key] = val;
        else if (key === 'experience') el.experience = clamp(Math.round(Number(val)), 1, Math.max(1, b.ruleset.experienceLevels.length));
        else if (key === 'attackMod' || key === 'defenseMod') (el as any)[key] = Math.max(key === 'defenseMod' ? 1 : 0, Number(val));
        else (el as any)[key] = clamp(Number(val), 0, 100);
        changes.push(`${PATCH_LABELS[key] ?? key}: ${typeof val === 'boolean' ? (val ? 'да' : 'нет') : val}`);
      }
      for (const c of patch.comps ?? []) {
        const st = el.comps.find((x) => x.typeId === c.typeId);
        if (!st) continue;
        const next = Math.max(0, Math.floor(c.current));
        if (next === st.current) continue;
        changes.push(`${E.type(c.typeId).name}: ${st.current} → ${next}`);
        if (next > st.current) {
          // Пополнение: увеличиваем и начальную численность, чтобы потери считались честно.
          st.start += next - st.current;
          st.authorized = Math.max(st.authorized, st.start);
        } else {
          st.mia += E.type(c.typeId).kind === 'personnel' ? st.current - next : 0;
          if (E.type(c.typeId).kind !== 'personnel') st.abandoned += st.current - next;
        }
        st.current = next;
      }
      if (patch.comps?.length) {
        const v = E.value(el);
        if (v > el.startValue) el.startValue = v;
        el.startPersonnel = Math.max(el.startPersonnel, E.personnel(el));
      }
      E.log({ phase: 'gm', level: 0, side: el.side, refs: [el.id], text: `ГМ изменил ${e(el)}: ${changes.join(', ') || 'без изменений'}${note}.` });
      break;
    }
    case 'resupply': {
      const ids: string[] = p.elementIds ?? [];
      for (const id of ids) {
        const el = E.elements.get(id);
        if (!el || el.status !== 'active') continue;
        if (typeof p.ammo === 'number') el.ammo = clamp(el.ammo + p.ammo, 0, 100);
        if (typeof p.fuel === 'number') el.fuel = clamp(el.fuel + p.fuel, 0, 100);
        if (typeof p.equipment === 'number') el.equipment = clamp(el.equipment + p.equipment, 0, 100);
      }
      const what = [p.ammo ? `боезапас +${p.ammo}%` : '', p.fuel ? `топливо +${p.fuel}%` : '', p.equipment ? `снаряжение +${p.equipment}%` : ''].filter(Boolean).join(', ');
      E.log({ phase: 'gm', level: 0, refs: ids, text: `ГМ: снабжение (${what}) для ${ids.length > 3 ? `${ids.length} элементов` : ids.map((id) => e(id)).join(', ')}${note}.` });
      break;
    }
    case 'setConditions': {
      const cond = (p.conditions ?? {}) as Record<string, string>;
      const changes: string[] = [];
      for (const [cat, opt] of Object.entries(cond)) {
        const c = b.ruleset.conditions.find((x) => x.id === cat);
        const o = c?.options.find((x) => x.id === opt);
        if (!c || !o || b.conditions[cat] === opt) continue;
        b.conditions[cat] = opt;
        changes.push(`${c.name.toLowerCase()}: ${o.name}`);
      }
      if (changes.length) {
        E.refreshConditions();
        E.log({ phase: 'gm', level: 0, text: `ГМ: условия изменились — ${changes.join(', ')}${note}.` });
      }
      break;
    }
    case 'setBand': {
      const i = clamp(Math.round(Number(p.bandIndex)), 0, b.ruleset.rangeBands.length - 1);
      b.bandIndex = i;
      b.closingProgress = 0;
      E.log({ phase: 'gm', level: 0, text: `ГМ: дистанция установлена — «${b.ruleset.rangeBands[i].name}»${note}.` });
      break;
    }
    case 'endBattle': {
      if (record) b.interventions.push({ turn: b.turn, type: iv.type, payload: iv.payload, note: iv.note });
      finish(E, (p.reason as string) || 'Бой остановлен ГМ');
      return;
    }
  }
  if (record) b.interventions.push({ turn: b.turn, type: iv.type, payload: iv.payload, note: iv.note });
  b.updatedAt = new Date().toISOString();
}

/**
 * Воспроизвести бой: тот же сценарий и правила (снимок в бою), тот же или новый сид,
 * те же вмешательства ГМ. Возвращает новый бой, доведённый до того же хода.
 */
export function replayBattle(src: Battle, opts: { seed?: string; withInterventions?: boolean; toEnd?: boolean } = {}): Battle {
  const seed = opts.seed ?? src.seed;
  const b = createBattle(src.scenario, src.ruleset, { seed, name: src.name, id: `${src.scenarioId}-${seed}-${Date.now().toString(36)}` });
  const ivs: Intervention[] = opts.withInterventions ? src.interventions : [];
  const target = opts.toEnd ? Infinity : src.turn;
  let guard = 0;
  while (!b.finished && guard++ < 1000) {
    for (const iv of ivs.filter((x) => x.turn === b.turn)) applyIntervention(b, iv, true);
    if (b.finished || b.turn >= target) break;
    stepTurn(b);
  }
  return b;
}
