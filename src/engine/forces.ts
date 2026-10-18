// Силы и шаблоны. Шаблон — «чертёж»: устройство и штат, без приказов и состояния. Силы — конкретные
// подразделения, созданные по шаблонам: у них своё состояние и свои потери. Сценарий ссылается на силы
// (целиком или на часть), приказы задаёт сам; деревья для боя собираются из сил (resolveScenario),
// итоги боя записываются обратно в силы (applyBattleToForces) — шаблонов это не касается.

import { COEFFICIENT_DEFAULTS } from './coefficients';
import { plural } from './labels';
import { STATE_KEYS } from './types';
import type { Battle, ComponentType, ElementState, ForceRecord, Id, Ruleset, Scenario, SideDef, SideUnitRef, UnitNode, UnitState } from './types';
import { cloneDeep, instantiate, pathTo, type Resolved, resolveChild, ROOT_COMMS, ROOT_RESOLVED, ROOT_STATE, ROOT_SUPPLY, unitHash, walkUnits } from './units';
import type { Issue } from './validate';

/** Убрать из дерева всё, что относится к конкретным силам или бою: приказы, состояние, некомплект. */
function stripInPlace(root: UnitNode) {
  walkUnits(root, (n) => {
    n.order = null;
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
    sd.formations = [];
  });
  return { scenario: out, forces };
}

/** Силы, участвовавшие в бою (id). Для боёв до появления сил — по корням сторон, если такие силы есть. */
export function battleForceIds(b: Battle, forces: Record<Id, UnitNode>): Id[] {
  const ids = new Set<Id>();
  for (const sd of b.scenario.sides) {
    if (sd.units) sd.units.forEach((u) => ids.add(u.forceId));
    else sd.formations.forEach((f) => forces[f.id] && ids.add(f.id));
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

/**
 * Отдых сил N дней: раненые возвращаются в строй, повреждённая техника ремонтируется (не сверх штата),
 * мораль, слаженность, готовность, усталость, боезапас, топливо, снаряжение приближаются к норме.
 * Темпы — в наборе правил («Между боями»). Возвращает изменённую копию.
 */
export function restForce(src: UnitNode, days: number, rs: Ruleset | undefined): { force: UnitNode; personnel: number; equipment: number } {
  const f = cloneDeep(src);
  const kinds = new Map((rs?.componentTypes ?? []).map((t) => [t.id, t.kind]));
  const d = Math.max(0, days);
  const share = (key: string) => Math.min(1, (d * coef(rs, key)) / 100);
  const wounded = share('restWoundedPerDay');
  const repair = share('restRepairPerDay');
  const recover = share('restRecoverPerDay');
  let personnel = 0;
  let equipment = 0;
  walkUnits(f, (n) => {
    for (const c of n.composition) {
      const rec = c.recoverable ?? 0;
      if (rec <= 0) continue;
      const isPers = kinds.get(c.typeId) === 'personnel';
      const back = Math.min(Math.round(rec * (isPers ? wounded : repair)), Math.max(0, c.authorized - c.current));
      if (back <= 0) continue;
      c.current += back;
      c.recoverable = rec - back;
      if (!c.recoverable) delete c.recoverable;
      if (isPers) personnel += back;
      else equipment += back;
    }
    // Состояние: заданные значения приближаются к норме; наследуемые и опыт не трогаются.
    for (const k of STATE_KEYS) {
      if (k === 'experience') continue;
      const v = n.state[k];
      if (typeof v !== 'number') continue;
      const norm = ROOT_STATE[k];
      n.state[k] = Math.round(v + (norm - v) * recover);
    }
  });
  f.updatedAt = new Date().toISOString();
  addRecord(f, {
    at: f.updatedAt,
    kind: 'rest',
    title: `Отдых ${d} ${plural(d, 'день', 'дня', 'дней')}`,
    personnel,
    equipment,
    note: personnel || equipment ? undefined : 'в строй никто не вернулся',
  });
  return { force: f, personnel, equipment };
}

/** Пополнение до штата: людей и/или техники и вооружения. Возвращает изменённую копию и сколько пришло. */
export function replenishForce(src: UnitNode, rs: Ruleset | undefined, what: { personnel: boolean; equipment: boolean }, note?: string) {
  const f = cloneDeep(src);
  const kinds = new Map((rs?.componentTypes ?? []).map((t) => [t.id, t.kind]));
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

/** Новый отпечаток копий после очистки шаблонов: актуальные копии остаются актуальными. */
export function rehashCopies(copies: UnitNode[], before: Map<Id, string>, templates: Record<Id, UnitNode>) {
  for (const root of copies)
    walkUnits(root, (n) => {
      const t = n.templateId ? templates[n.templateId] : undefined;
      if (t && n.templateHash && n.templateHash === before.get(t.id)) n.templateHash = unitHash(t);
    });
}
