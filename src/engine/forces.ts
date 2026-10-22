// Силы и шаблоны. Шаблон — «чертёж»: устройство и штат, без приказов и состояния. Силы — конкретные
// подразделения, созданные по шаблонам: у них своё состояние и свои потери. Сценарий ссылается на силы
// (целиком или на часть), приказы задаёт сам; деревья для боя собираются из сил (resolveScenario),
// итоги боя записываются обратно в силы (applyBattleToForces) — шаблонов это не касается.

import { COEFFICIENT_DEFAULTS } from './coefficients';
import { plural } from './labels';
import { STATE_KEYS } from './types';
import type {
  Battle,
  ComponentEntry,
  ComponentType,
  ElementState,
  ForceRecord,
  Id,
  Ruleset,
  Scenario,
  SideDef,
  SideUnitRef,
  StateKey,
  UnitNode,
  UnitState,
} from './types';
import {
  cloneDeep,
  findParent,
  findUnit,
  instantiate,
  pathTo,
  removeUnit,
  type Resolved,
  resolveChild,
  ROOT_COMMS,
  ROOT_RESOLVED,
  ROOT_STATE,
  ROOT_SUPPLY,
  unitHash,
  walkUnits,
} from './units';
import type { Issue } from './validate';

/** Убрать из дерева всё, что относится к конкретным силам или бою: приказы, состояние, некомплект. */
function stripInPlace(root: UnitNode) {
  walkUnits(root, (n) => {
    n.order = null;
    // «Стоять насмерть» — решение на бой, оно задаётся в сценарии.
    n.holdFast = false;
    n.state = {};
    n.comms = null;
    n.supply = null;
    n.composition = n.composition.map((c) => ({ typeId: c.typeId, authorized: c.authorized, current: c.authorized }));
  });
  delete root.faction;
  delete root.history;
}

/** Шаблон из подразделения: копия только с устройством и штатом (идентификаторы те же). */
export function toTemplate(node: UnitNode): UnitNode {
  const t = cloneDeep(node);
  stripInPlace(t);
  return t;
}

/** Новые силы по шаблону: полный штат, состояние по умолчанию, связь с шаблоном для обновлений. */
export function forceFromTemplate(tpl: UnitNode, opts: { name?: string; faction?: string } = {}): UnitNode {
  const f = instantiate(tpl, { name: opts.name });
  stripInPlace(f);
  if (tpl.rulesetId) f.rulesetId = tpl.rulesetId;
  if (opts.faction) f.faction = opts.faction;
  return f;
}

/**
 * Часть сил для боя: поддерево узла с теми же идентификаторами (чтобы итоги боя легли на свои узлы).
 * Что часть наследовала от старших — эшелон, связь, снабжение, состояние, — записывается в неё явно.
 */
export function partOf(root: UnitNode, nodeId: Id): UnitNode | null {
  const path = pathTo(root, nodeId);
  if (!path.length) return null;
  if (path.length === 1) return cloneDeep(root);
  let parent = ROOT_RESOLVED;
  for (const n of path.slice(0, -1)) parent = resolveChild(n, parent);
  const c = cloneDeep(path[path.length - 1]);
  if (c.echelon === null && parent.echelon !== 'front') c.echelon = parent.echelon;
  if (c.comms === null && parent.comms !== ROOT_COMMS) c.comms = parent.comms;
  if (c.supply === null && parent.supply !== ROOT_SUPPLY) c.supply = parent.supply;
  for (const k of STATE_KEYS) if (c.state[k] === undefined && parent.state[k] !== ROOT_STATE[k]) c.state[k] = parent.state[k];
  c.name = `${c.name} · ${path[path.length - 2].name}`;
  delete c.attachedFrom;
  return c;
}

/** Деревья стороны для боя: силы (или их части) с приказами сценария; приданные — внутри своих. */
export function resolveSide(sd: SideDef, forces: Record<Id, UnitNode>): UnitNode[] {
  if (!sd.units) return sd.formations;
  const roots: UnitNode[] = [];
  const attached: { ref: SideUnitRef; node: UnitNode }[] = [];
  for (const ref of sd.units) {
    const force = forces[ref.forceId];
    if (!force) continue;
    const node = partOf(force, ref.nodeId ?? force.id);
    if (!node) continue;
    // Приказы — только из сценария: у сил и шаблонов их нет.
    walkUnits(node, (n) => void (n.order = sd.orders?.[n.id] ?? null));
    delete node.faction;
    if (ref.attachTo) attached.push({ ref, node });
    else roots.push(node);
  }
  for (const { ref, node } of attached) {
    let target: UnitNode | null = null;
    for (const r of roots) walkUnits(r, (n) => void (n.id === ref.attachTo && (target = n)));
    if (target) {
      node.attachedFrom = node.attachedFrom ?? '';
      (target as UnitNode).children.push(node);
    } else roots.push(node);
  }
  return roots;
}

/** Сценарий, готовый к бою: стороны собраны из сил. Сценарий без ссылок на силы возвращается как есть. */
export function resolveScenario(sc: Scenario, forces: Record<Id, UnitNode>): Scenario {
  if (!sc.sides.some((sd) => sd.units)) return sc;
  return { ...sc, sides: sc.sides.map((sd) => ({ ...sd, formations: resolveSide(sd, forces) })) as Scenario['sides'] };
}

/** Силы, которые использует сценарий (id сил). */
export function scenarioForceIds(sc: Scenario): Set<Id> {
  return new Set(sc.sides.flatMap((sd) => (sd.units ?? []).map((u) => u.forceId)));
}

/** Замечания к ссылкам на силы: удалённые силы и части, одно и то же подразделение дважды. */
export function forceRefIssues(sc: Scenario, forces: Record<Id, UnitNode>): Issue[] {
  const issues: Issue[] = [];
  const used = new Map<Id, { side: string; nodeId: Id }[]>();
  for (const sd of sc.sides)
    for (const ref of sd.units ?? []) {
      const f = forces[ref.forceId];
      if (!f) {
        issues.push({ level: 'error', text: `${sd.name}: подразделение сил удалено — уберите его со стороны.` });
        continue;
      }
      const nodeId = ref.nodeId ?? f.id;
      if (!pathTo(f, nodeId).length) {
        issues.push({ level: 'error', text: `${sd.name}: часть «${f.name}» больше не существует — уберите её со стороны.` });
        continue;
      }
      if (f.rulesetId && f.rulesetId !== sc.rulesetId) issues.push({ level: 'warning', text: `${sd.name}: «${f.name}» составлено по другому набору правил.` });
      const list = used.get(f.id) ?? [];
      for (const u of list) {
        // Одно и то же или вложенное друг в друга — силы задвоятся.
        const overlap = u.nodeId === nodeId || pathTo(f, nodeId).some((n) => n.id === u.nodeId) || pathTo(f, u.nodeId).some((n) => n.id === nodeId);
        if (overlap)
          issues.push({
            level: 'error',
            text: `«${f.name}» участвует в бою дважды (${u.side} и ${sd.name}) — одно подразделение не может быть в двух местах.`,
          });
      }
      list.push({ side: sd.name, nodeId });
      used.set(f.id, list);
    }
  return issues;
}

/**
 * Перевод старого сценария (копии подразделений внутри сторон) на силы: каждая копия становится
 * подразделением сил, сторона — ссылками на них, приказы узлов — приказами сценария. Если
 * идентификаторы копии уже заняты (сценарий-дубликат), копия получает новые, и ссылки сценария
 * (командиры, исключённые части, события плана) переводятся на них.
 */
export function extractForces(sc: Scenario, taken: Set<Id>, newId: () => Id): { scenario: Scenario; forces: UnitNode[] } {
  const out = cloneDeep(sc);
  const forces: UnitNode[] = [];
  out.sides.forEach((sd) => {
    if (sd.units) return;
    const remap = new Map<Id, Id>();
    const units: SideUnitRef[] = [];
    const orders: Record<Id, Id> = { ...(sd.orders ?? {}) };
    const hold = new Set<Id>();
    for (const copy of sd.formations) {
      const force = cloneDeep(copy);
      let clash = false;
      walkUnits(force, (n) => void (taken.has(n.id) && (clash = true)));
      if (clash)
        walkUnits(force, (n) => {
          const id = newId();
          remap.set(n.id, id);
          n.id = id;
        });
      walkUnits(force, (n) => {
        taken.add(n.id);
        if (n.order) orders[n.id] = n.order;
        n.order = null;
        // «Стоять насмерть» — решение на бой: из подразделения — в сценарий.
        if (n.holdFast) hold.add(n.id);
        n.holdFast = false;
      });
      force.rulesetId = sc.rulesetId;
      force.faction = sd.name;
      delete force.attachedFrom;
      forces.push(force);
      units.push({ forceId: force.id });
    }
    const map = (id: Id) => remap.get(id) ?? id;
    if (remap.size) {
      if (sd.commanders) sd.commanders = Object.fromEntries(Object.entries(sd.commanders).map(([k, v]) => [map(k), v]));
      if (sd.excluded) sd.excluded = sd.excluded.map(map);
      if (sd.partial) sd.partial = Object.fromEntries(Object.entries(sd.partial).map(([k, v]) => [map(k), v]));
      if (sd.holdFast) sd.holdFast = sd.holdFast.map(map);
      if (sd.sectorOf) sd.sectorOf = Object.fromEntries(Object.entries(sd.sectorOf).map(([k, v]) => [map(k), v]));
      for (const ev of out.events ?? []) {
        if (ev.side === sd.id && ev.nodeId) ev.nodeId = map(ev.nodeId);
        // Цель удара — на стороне противника; условие — на своей стороне.
        if (ev.side && ev.side !== sd.id && ev.targetNodeId) ev.targetNodeId = map(ev.targetNodeId);
        if (ev.trigger?.side === sd.id && ev.trigger.nodeId) ev.trigger.nodeId = map(ev.trigger.nodeId);
      }
    }
    sd.units = units;
    sd.orders = orders;
    const holdAll = new Set([...(sd.holdFast ?? []), ...hold]);
    if (holdAll.size) sd.holdFast = [...holdAll];
    sd.formations = [];
  });
  return { scenario: out, forces };
}

/**
 * Силы, участвовавшие в бою (id). Для боёв до появления сил — по корням сторон, если такие силы есть.
 * Часть, переданная после боя в другое подразделение, — в тех силах, где она сейчас.
 */
export function battleForceIds(b: Battle, forces: Record<Id, UnitNode>): Id[] {
  const ids = new Set<Id>();
  for (const sd of b.scenario.sides) {
    if (sd.units) sd.units.forEach((u) => ids.add(u.forceId));
    else sd.formations.forEach((f) => forces[f.id] && ids.add(f.id));
  }
  const defIds = new Set(b.elements.map((e) => e.defId));
  for (const f of Object.values(forces)) {
    if (ids.has(f.id)) continue;
    let hit = false;
    walkUnits(f, (n) => void (defIds.has(n.id) && (hit = true)));
    if (hit) ids.add(f.id);
  }
  return [...ids].filter((id) => forces[id]);
}

export interface ForceChange {
  forceId: Id;
  name: string;
  /** Потери людей (убитые, раненые, пропавшие) и техники. */
  personnel: number;
  equipment: number;
}

/**
 * Записать итоги боя в силы: потери вычитаются из текущей численности (раненые и повреждённая
 * техника — в «раненые / в ремонте»), состояние (мораль, усталость, боезапас…) — как в конце боя.
 * Если в бою был не весь состав узла, состояние меняется на долю участвовавших: оставшиеся в бою не были.
 * Возвращает новые версии сил и сводку изменений; шаблоны не затрагиваются.
 */
export function applyBattleToForces(b: Battle, forces: Record<Id, UnitNode>): { updated: UnitNode[]; changes: ForceChange[] } {
  const types = new Map<Id, ComponentType>(b.ruleset.componentTypes.map((t) => [t.id, t]));
  const byNode = new Map<Id, ElementState>(b.elements.map((e) => [e.defId, e]));
  const updated: UnitNode[] = [];
  const changes: ForceChange[] = [];
  const at = new Date().toISOString();
  const maxExp = Math.max(1, b.ruleset.experienceLevels.length);
  const every = Math.max(0, Math.round(coef(b.ruleset, 'expGainBattles')));
  const partial = new Set(b.scenario.sides.flatMap((sd) => Object.keys(sd.partial ?? {})));
  const men = (typeId: Id, n: number) => {
    const t = types.get(typeId);
    return t?.kind === 'personnel' ? n : n * (t?.crew ?? 0);
  };
  for (const id of battleForceIds(b, forces)) {
    const f = cloneDeep(forces[id]);
    let personnel = 0;
    let equipment = 0;
    let side: ElementState['side'] | undefined;
    // Состояние узлов до боя (с наследованием) — для узлов, где в бою был не весь состав.
    const before = new Map<Id, UnitState>();
    if (partial.size) {
      const visit = (n: UnitNode, parent: Resolved) => {
        const r = resolveChild(n, parent);
        before.set(n.id, r.state);
        for (const c of n.children) visit(c, r);
      };
      visit(f, ROOT_RESOLVED);
    }
    walkUnits(f, (n) => {
      const el = byNode.get(n.id);
      if (!el || el.status === 'pending') return;
      side ??= el.side;
      // Доля участвовавших (по людям, включая экипажи) — до вычета потерь.
      let share = 1;
      if (partial.has(n.id)) {
        const all = n.composition.reduce((a, c) => a + men(c.typeId, Math.max(0, c.current)), 0);
        const took = el.comps.reduce((a, c) => a + men(c.typeId, c.start), 0);
        if (all > 0) share = Math.min(1, took / all);
      }
      for (const c of n.composition) {
        const s = el.comps.find((x) => x.typeId === c.typeId);
        if (!s) continue;
        const t = types.get(c.typeId);
        // Люди — как в итогах боя: убитые, раненые и пропавшие, включая экипажи техники.
        personnel += s.kia + s.wia + s.mia;
        const lost = Math.max(0, s.start - s.current);
        if (!lost) continue;
        c.current = Math.max(0, c.current - lost);
        const back = t?.kind === 'personnel' ? s.wia : s.damaged;
        if (back) c.recoverable = (c.recoverable ?? 0) + back;
        if (t?.kind !== 'personnel') equipment += lost;
      }
      for (const k of STATE_KEYS) {
        const was = before.get(n.id)?.[k];
        n.state[k] = Math.round(share >= 1 || was === undefined ? el[k] : was + (el[k] - was) * share);
      }
    });
    const r = b.result;
    const outcome = r ? (!r.winner || r.winner === side ? r.outcomeName : `${r.outcomeName} противника`) : undefined;
    addRecord(f, { at, kind: 'battle', title: b.name, battleId: b.id, outcome, personnel: -personnel, equipment: -equipment });
    // Опыт растёт после каждых N боёв (если включено в наборе правил).
    if (every > 0) {
      const battles = (f.history ?? []).filter((x) => x.kind === 'battle').length;
      if (battles % every === 0) {
        let raised = false;
        walkUnits(f, (n) => {
          const v = n === f ? (n.state.experience ?? ROOT_STATE.experience) : n.state.experience;
          if (v === undefined || v >= maxExp) return;
          n.state.experience = v + 1;
          raised = true;
        });
        if (raised) addRecord(f, { at, kind: 'battle', title: 'Опыт повышен', note: `после ${battles} ${plural(battles, 'боя', 'боёв', 'боёв')}` });
      }
    }
    f.updatedAt = at;
    updated.push(f);
    changes.push({ forceId: id, name: f.name, personnel, equipment });
  }
  return { updated, changes };
}

const coef = (rs: Ruleset | undefined, key: string) => rs?.coefficients?.[key] ?? COEFFICIENT_DEFAULTS[key] ?? 0;

/** Запись в боевой путь сил (последние 300). */
export function addRecord(f: UnitNode, r: ForceRecord) {
  f.history = [...(f.history ?? []), r].slice(-300);
}

/** Сколько раненых и повреждённой техники ждут возвращения в строй. */
export function recoverableOf(f: UnitNode, rs: Ruleset | undefined): { personnel: number; equipment: number } {
  const kinds = new Map((rs?.componentTypes ?? []).map((t) => [t.id, t.kind]));
  let personnel = 0;
  let equipment = 0;
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const v = c.recoverable ?? 0;
      if (kinds.get(c.typeId) === 'personnel') personnel += v;
      else equipment += v;
    }
  });
  return { personnel, equipment };
}

const kindsOf = (rs: Ruleset | undefined) => new Map((rs?.componentTypes ?? []).map((t) => [t.id, t.kind]));

/** Хуже ли значение показателя, чем норма (усталость — чем больше, тем хуже). */
const worseThanNorm = (k: StateKey, v: number) => (k === 'fatigue' ? v > ROOT_STATE[k] : v < ROOT_STATE[k]);

/** Что восстанавливает отдых: состояние бойцов, которые сейчас в строю (боезапас и топливо — отдельным пополнением). */
export const REST_PARTS = [
  { id: 'spirit', label: 'Мораль и усталость', keys: ['morale', 'fatigue'] },
  { id: 'order', label: 'Слаженность и готовность', keys: ['cohesion', 'readiness'] },
  { id: 'gear', label: 'Снаряжение', keys: ['equipment'] },
] as const satisfies readonly { id: string; label: string; keys: readonly StateKey[] }[];
export type RestPart = (typeof REST_PARTS)[number]['id'];
export const REST_PART_IDS: RestPart[] = REST_PARTS.map((x) => x.id);

/**
 * Отдых: показатели бойцов, которые сейчас в строю, приближаются к норме на pct% разницы (100% — до нормы).
 * Раненые не возвращаются, техника не ремонтируется, людей не прибавляется — это «Лечить», «Чинить» и «Пополнить».
 * Что лучше нормы — не трогается; опыт — тоже. Возвращает изменённую копию.
 */
export function restForce(src: UnitNode, pct: number, parts: RestPart[] = REST_PART_IDS, at = new Date().toISOString()) {
  const f = cloneDeep(src);
  const share = Math.max(0, Math.min(100, pct)) / 100;
  const keys = REST_PARTS.filter((x) => parts.includes(x.id)).flatMap((x) => x.keys as readonly StateKey[]);
  let changed = false;
  walkUnits(f, (n) => {
    for (const k of keys) {
      const v = n.state[k];
      if (typeof v !== 'number' || !worseThanNorm(k, v)) continue;
      const next = Math.round(v + (ROOT_STATE[k] - v) * share);
      if (next === v) continue;
      n.state[k] = next;
      changed = true;
    }
  });
  if (changed) {
    f.updatedAt = at;
    const what = REST_PARTS.filter((x) => parts.includes(x.id)).map((x) => x.label.toLowerCase());
    addRecord(f, { at, kind: 'rest', title: `Отдых ${Math.round(share * 100)}%`, note: what.length < REST_PARTS.length ? what.join(', ') : undefined });
  }
  return { force: f, changed };
}

/** Что можно сделать с силами между боями — без пересчёта: есть ли что восстанавливать отдыхом, сколько вернётся после лечения и ремонта, сколько не хватает до штата. */
export function betweenNeeds(f: UnitNode, rs: Ruleset | undefined) {
  const kinds = kindsOf(rs);
  const restKeys = REST_PARTS.flatMap((x) => x.keys as readonly StateKey[]);
  const out = { rest: false, heal: 0, repair: 0, vehicleCondition: false, personnelMissing: 0, equipmentMissing: 0, ammo: false, fuel: false };
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const gap = Math.max(0, c.authorized - c.current);
      const back = Math.min(c.recoverable ?? 0, gap);
      if (kinds.get(c.typeId) === 'personnel') {
        out.heal += back;
        out.personnelMissing += gap;
      } else {
        out.repair += back;
        out.equipmentMissing += gap;
      }
    }
    for (const k of restKeys) {
      const v = n.state[k];
      if (typeof v === 'number' && worseThanNorm(k, v)) out.rest = true;
    }
    const vc = n.state.vehicleCondition;
    if (typeof vc === 'number' && worseThanNorm('vehicleCondition', vc)) out.vehicleCondition = true;
    for (const k of ['ammo', 'fuel'] as const) {
      const v = n.state[k];
      if (typeof v === 'number' && v < 100) out[k] = true;
    }
  });
  return out;
}

/** Что пополняется отдельно от отдыха: боезапас и топливо. */
export type SupplyKey = 'ammo' | 'fuel';
export const SUPPLY_LABEL: Record<SupplyKey, { name: string; done: string }> = {
  ammo: { name: 'Боезапас', done: 'Боезапас пополнен' },
  fuel: { name: 'Топливо', done: 'Топливо пополнено' },
};

/**
 * Пополнить боезапас или топливо до level% (100 — полностью): у кого меньше — поднимается до этого уровня,
 * у кого больше — не трогается. Возвращает изменённую копию.
 */
export function resupplyForce(src: UnitNode, key: SupplyKey, level: number, at = new Date().toISOString()) {
  const f = cloneDeep(src);
  const to = Math.max(0, Math.min(100, Math.round(level)));
  let changed = false;
  walkUnits(f, (n) => {
    const v = n.state[key];
    if (typeof v !== 'number' || v >= to) return;
    n.state[key] = to;
    changed = true;
  });
  if (changed) {
    f.updatedAt = at;
    addRecord(f, { at, kind: 'supply', title: `${SUPPLY_LABEL[key].done} до ${to}%` });
  }
  return { force: f, changed };
}

/** Вернуть в строй раненых (не сверх штата — остальные ждут). Возвращает изменённую копию и сколько вернулось. */
export function healForce(src: UnitNode, rs: Ruleset | undefined, at = new Date().toISOString()) {
  return returnRecoverable(src, rs, 'personnel', at);
}

/**
 * Отремонтировать технику и вооружение: повреждённое возвращается в строй (не сверх штата), состояние
 * техники — к норме. Возвращает изменённую копию и сколько единиц вернулось.
 */
export function repairForce(src: UnitNode, rs: Ruleset | undefined, at = new Date().toISOString()) {
  return returnRecoverable(src, rs, 'equipment', at);
}

function returnRecoverable(src: UnitNode, rs: Ruleset | undefined, what: 'personnel' | 'equipment', at: string) {
  const f = cloneDeep(src);
  const kinds = kindsOf(rs);
  let count = 0;
  let condition = false;
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      if ((kinds.get(c.typeId) === 'personnel') !== (what === 'personnel')) continue;
      const rec = c.recoverable ?? 0;
      const back = Math.min(rec, Math.max(0, c.authorized - c.current));
      if (back <= 0) continue;
      c.current += back;
      c.recoverable = rec - back;
      if (!c.recoverable) delete c.recoverable;
      count += back;
    }
    const v = n.state.vehicleCondition;
    if (what === 'equipment' && typeof v === 'number' && worseThanNorm('vehicleCondition', v)) {
      n.state.vehicleCondition = ROOT_STATE.vehicleCondition;
      condition = true;
    }
  });
  const changed = count > 0 || condition;
  if (changed) {
    f.updatedAt = at;
    addRecord(
      f,
      what === 'personnel'
        ? { at, kind: 'heal', title: 'Лечение раненых', personnel: count }
        : { at, kind: 'repair', title: 'Ремонт техники', equipment: count || undefined, note: count ? undefined : 'состояние техники — в норме' },
    );
  }
  return { force: f, count, changed };
}

/** Пополнение до штата из резерва: людей и/или техники и вооружения. Возвращает изменённую копию и сколько пришло. */
export function replenishForce(src: UnitNode, rs: Ruleset | undefined, what: { personnel: boolean; equipment: boolean }, note?: string) {
  const f = cloneDeep(src);
  const kinds = kindsOf(rs);
  let personnel = 0;
  let equipment = 0;
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const isPers = kinds.get(c.typeId) === 'personnel';
      if (isPers ? !what.personnel : !what.equipment) continue;
      const add = Math.max(0, c.authorized - c.current);
      if (!add) continue;
      c.current = c.authorized;
      if (isPers) personnel += add;
      else equipment += add;
    }
  });
  f.updatedAt = new Date().toISOString();
  addRecord(f, { at: f.updatedAt, kind: 'replenish', title: 'Пополнение до штата', personnel, equipment, note });
  return { force: f, personnel, equipment };
}

/** Численность сил по типам: в строю, по штату, вне строя (раненые, ремонт). */
export function strengthByType(f: UnitNode): Map<Id, { current: number; authorized: number; recoverable: number }> {
  const out = new Map<Id, { current: number; authorized: number; recoverable: number }>();
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const x = out.get(c.typeId) ?? { current: 0, authorized: 0, recoverable: 0 };
      x.current += c.current;
      x.authorized += c.authorized;
      x.recoverable += c.recoverable ?? 0;
      out.set(c.typeId, x);
    }
  });
  return out;
}

/**
 * Пополнение из другого подразделения: по каждому типу передаётся amounts[тип] (не больше, чем недостаёт
 * до штата и чем есть в строю у донора). Недостающее заполняется по порядку дерева; у донора люди и техника
 * берутся оттуда, где их больше. Обоим — запись в боевой путь. Возвращает изменённые копии.
 */
export function transferStrength(target: UnitNode, donor: UnitNode, rs: Ruleset | undefined, amounts: Record<Id, number>, at = new Date().toISOString()) {
  const t = cloneDeep(target);
  const d = cloneDeep(donor);
  const kinds = kindsOf(rs);
  const entries = (root: UnitNode, typeId: Id) => {
    const list: ComponentEntry[] = [];
    walkUnits(root, (n) => n.composition.forEach((c) => c.typeId === typeId && list.push(c)));
    return list;
  };
  let personnel = 0;
  let equipment = 0;
  for (const [typeId, want] of Object.entries(amounts)) {
    const need = entries(t, typeId);
    const have = entries(d, typeId);
    const deficit = need.reduce((a, c) => a + Math.max(0, c.authorized - c.current), 0);
    const avail = have.reduce((a, c) => a + c.current, 0);
    const count = Math.max(0, Math.min(Math.round(want), deficit, avail));
    if (!count) continue;
    if (kinds.get(typeId) === 'personnel') personnel += count;
    else equipment += count;
    let left = count;
    for (const c of need) {
      const add = Math.min(left, Math.max(0, c.authorized - c.current));
      c.current += add;
      left -= add;
    }
    for (let k = 0; k < count; k++) {
      const c = have.reduce((a, b) => (b.current > a.current ? b : a));
      c.current -= 1;
    }
  }
  const changed = personnel > 0 || equipment > 0;
  if (changed) {
    t.updatedAt = at;
    d.updatedAt = at;
    addRecord(t, { at, kind: 'transfer', title: `Пополнение из «${donor.name}»`, personnel, equipment: equipment || undefined });
    addRecord(d, { at, kind: 'transfer', title: `Передано в «${target.name}»`, personnel: -personnel || undefined, equipment: -equipment || undefined });
  }
  return { target: t, donor: d, personnel, equipment, changed };
}

/**
 * Полное восстановление: раненые и отремонтированная техника возвращаются, недостающее пополняется
 * до штата, состояние (мораль, слаженность, готовность, усталость, боезапас, топливо, снаряжение,
 * техника) — к норме; что лучше нормы и опыт — сохраняются. Возвращает изменённую копию и что изменилось.
 */
export function restoreForce(src: UnitNode, rs: Ruleset | undefined, at = new Date().toISOString()) {
  const f = cloneDeep(src);
  const kinds = kindsOf(rs);
  let personnel = 0;
  let equipment = 0;
  let state = false;
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const add = Math.max(0, c.authorized - c.current);
      if (add) {
        c.current = c.authorized;
        if (kinds.get(c.typeId) === 'personnel') personnel += add;
        else equipment += add;
      }
      if (c.recoverable) {
        delete c.recoverable;
        state = true;
      }
    }
    // Свои значения хуже нормы (их оставляют бои) снимаются: подразделение снова в норме.
    for (const k of STATE_KEYS) {
      const v = n.state[k];
      if (k === 'experience' || typeof v !== 'number' || (!worseThanNorm(k, v) && v !== ROOT_STATE[k])) continue;
      if (v !== ROOT_STATE[k]) state = true;
      delete n.state[k];
    }
  });
  const changed = personnel > 0 || equipment > 0 || state;
  if (changed) {
    f.updatedAt = at;
    addRecord(f, { at, kind: 'restore', title: 'Полное восстановление', personnel, equipment });
  }
  return { force: f, personnel, equipment, changed };
}

/** Сводка боеготовности сил: численность, раненые и ремонт, средние показатели состояния. */
export interface ForceCondition {
  /** Люди (с экипажами): в строю, по штату. */
  persCur: number;
  persAuth: number;
  /** Техника и вооружение: в строю, по штату. */
  equipCur: number;
  equipAuth: number;
  /** Ждут возвращения: раненые (чел.) и техника в ремонте (ед.). */
  wounded: number;
  repair: number;
  /** Средние по составу (с учётом численности) показатели состояния. */
  state: UnitState;
  /** Готовы / потрёпаны / обескровлены. */
  level: 'ready' | 'worn' | 'depleted';
  /** Что не так — коротко, для подсказки. */
  issues: string[];
}

export function forceCondition(root: UnitNode, rs: Ruleset | undefined): ForceCondition {
  const types = new Map((rs?.componentTypes ?? []).map((t) => [t.id, t]));
  let persCur = 0;
  let persAuth = 0;
  let equipCur = 0;
  let equipAuth = 0;
  let wounded = 0;
  let repair = 0;
  const sum: Record<string, number> = {};
  let weight = 0;
  const visit = (n: UnitNode, parent: Resolved) => {
    const r = resolveChild(n, parent);
    let own = 0;
    for (const c of n.composition) {
      const t = types.get(c.typeId);
      if (!t) continue;
      const crew = t.kind === 'personnel' ? 1 : t.crew;
      persCur += Math.max(0, c.current) * crew;
      persAuth += c.authorized * crew;
      own += Math.max(0, c.current) * Math.max(1, crew);
      if (t.kind === 'personnel') wounded += c.recoverable ?? 0;
      else {
        equipCur += Math.max(0, c.current);
        equipAuth += c.authorized;
        repair += c.recoverable ?? 0;
      }
    }
    if (own > 0) {
      for (const k of STATE_KEYS) sum[k] = (sum[k] ?? 0) + r.state[k] * own;
      weight += own;
    }
    for (const ch of n.children) visit(ch, r);
  };
  visit(root, ROOT_RESOLVED);
  const base = resolveChild(root, ROOT_RESOLVED).state;
  const state = { ...base };
  if (weight > 0) for (const k of STATE_KEYS) state[k] = Math.round(sum[k] / weight);
  const strength = persAuth > 0 ? persCur / persAuth : 1;
  const issues: string[] = [];
  if (strength < 0.9) issues.push(`некомплект ${Math.round((1 - strength) * 100)}%`);
  if (equipAuth > 0 && equipCur / equipAuth < 0.9) issues.push(`техники не хватает: ${equipAuth - equipCur} ед.`);
  if (wounded) issues.push(`раненых: ${wounded}`);
  if (repair) issues.push(`в ремонте: ${repair} ед.`);
  if (state.morale < ROOT_STATE.morale - 5) issues.push(`мораль ${state.morale}`);
  if (state.fatigue > ROOT_STATE.fatigue + 10) issues.push(`усталость ${state.fatigue}`);
  if (state.ammo < 90) issues.push(`боезапас ${state.ammo}%`);
  if (state.fuel < 90) issues.push(`топливо ${state.fuel}%`);
  if (state.cohesion < ROOT_STATE.cohesion - 10) issues.push(`слаженность ${state.cohesion}`);
  const level: ForceCondition['level'] = strength < 0.7 || state.morale < 40 || state.ammo < 35 ? 'depleted' : issues.length ? 'worn' : 'ready';
  return { persCur, persAuth, equipCur, equipAuth, wounded, repair, state, level, issues };
}

/** Новый отпечаток копий после очистки шаблонов: актуальные копии остаются актуальными. */
export function rehashCopies(copies: UnitNode[], before: Map<Id, string>, templates: Record<Id, UnitNode>) {
  for (const root of copies)
    walkUnits(root, (n) => {
      const t = n.templateId ? templates[n.templateId] : undefined;
      if (t && n.templateHash && n.templateHash === before.get(t.id)) n.templateHash = unitHash(t);
    });
}

// ------------------------------------------------------------------ передача частей между подразделениями

/** Где сейчас узел: в каких силах (null — нигде). */
export function locateNode(forces: Record<Id, UnitNode>, nodeId: Id): { force: UnitNode; node: UnitNode } | null {
  for (const f of Object.values(forces)) {
    const node = findUnit(f, nodeId);
    if (node) return { force: f, node };
  }
  return null;
}

/** Изменённые силы: новая версия; null — силы больше не самостоятельны (переданы целиком в другие). */
export type ForcesPatch = Record<Id, UnitNode | null>;

/** «2-я рота · 1-й мотострелковый батальон» — откуда передана часть. */
function placeName(force: UnitNode, parent: UnitNode | null): string {
  if (!parent) return force.name;
  return parent.id === force.id ? force.name : `${parent.name} · ${force.name}`;
}

/**
 * Временно передать часть сил (или силы целиком) в другое подразделение: узел со всеми подчинёнными
 * переносится под target и помнит, откуда он (вернуть — returnUnit). Идентификаторы узлов не меняются.
 * Повторная передача не меняет исходного места. Ошибка — строка.
 */
export function transferUnit(forces: Record<Id, UnitNode>, nodeId: Id, targetId: Id, at = new Date().toISOString()): ForcesPatch | string {
  const from = locateNode(forces, nodeId);
  const to = locateNode(forces, targetId);
  if (!from || !to) return 'Подразделение не найдено.';
  if (findUnit(from.node, targetId)) return 'Нельзя передать подразделение в его же подчинённое.';
  const isRoot = from.force.id === nodeId;
  const parent = isRoot ? null : findParent(from.force, nodeId);
  if (parent?.id === targetId) return 'Подразделение уже подчинено этому.';
  const out: ForcesPatch = {};
  const src = cloneDeep(from.force);
  const dst = to.force.id === from.force.id ? src : cloneDeep(to.force);
  let moved: UnitNode;
  let index = 0;
  if (isRoot) {
    moved = src;
    out[src.id] = null;
  } else {
    const p = findParent(src, nodeId)!;
    index = p.children.findIndex((c) => c.id === nodeId);
    moved = p.children.splice(index, 1)[0];
    out[src.id] = src;
  }
  moved.transfer ??= { forceId: from.force.id, parentId: parent?.id ?? null, index, fromName: placeName(from.force, parent), at };
  findUnit(dst, targetId)!.children.push(moved);
  out[dst.id] = dst;
  return out;
}

/**
 * Вернуть переданную часть на место: под прежнего старшего (где бы он сейчас ни был) или снова
 * самостоятельными силами. Если прежнего старшего уже нет — в прежние силы, если нет и их — отдельными силами.
 */
export function returnUnit(forces: Record<Id, UnitNode>, nodeId: Id): ForcesPatch | string {
  const here = locateNode(forces, nodeId);
  if (!here) return 'Подразделение не найдено.';
  const t = here.node.transfer;
  if (!t) return 'Подразделение никуда не передавалось — возвращать некуда.';
  if (here.force.id === nodeId) return 'Это самостоятельные силы.';
  const out: ForcesPatch = {};
  const cur = cloneDeep(here.force);
  const moved = removeUnit(cur.children, nodeId)!;
  delete moved.transfer;
  out[cur.id] = cur;
  const now = (id: Id) => (id in out ? out[id] : forces[id]) ?? null;
  const all = (): Record<Id, UnitNode> => {
    const m: Record<Id, UnitNode> = {};
    for (const id of new Set([...Object.keys(forces), ...Object.keys(out)])) {
      const f = now(id);
      if (f) m[id] = f;
    }
    return m;
  };
  const home = t.parentId !== null ? (locateNode(all(), t.parentId) ?? (now(t.forceId) ? { force: now(t.forceId)!, node: now(t.forceId)! } : null)) : null;
  if (!home || forces[moved.id]) {
    // Снова самостоятельные силы (или прежнего места больше нет).
    out[moved.id] = moved;
    return out;
  }
  const host = home.force.id in out ? out[home.force.id]! : cloneDeep(home.force);
  const parent = findUnit(host, home.node.id)!;
  parent.children.splice(Math.min(t.index, parent.children.length), 0, moved);
  out[host.id] = host;
  return out;
}

/** Ссылки сценария на силы — туда, где части сейчас (после передачи или возврата). null — ничего не изменилось. */
export function relinkScenario(sc: Scenario, forces: Record<Id, UnitNode>): Scenario | null {
  let changed = false;
  const sides = sc.sides.map((sd) => {
    if (!sd.units) return sd;
    const units = sd.units.map((u) => {
      const id = u.nodeId ?? u.forceId;
      const f = forces[u.forceId];
      if (f && findUnit(f, id)) return u;
      const at = locateNode(forces, id);
      if (!at) return u;
      changed = true;
      const ref: SideUnitRef = { ...u, forceId: at.force.id };
      if (id === at.force.id) delete ref.nodeId;
      else ref.nodeId = id;
      return ref;
    });
    return { ...sd, units };
  });
  return changed ? { ...sc, sides: sides as Scenario['sides'] } : null;
}
