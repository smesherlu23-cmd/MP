// Дерево подразделений: создание, наследование параметров, шаблоны, перемещение, сводка, проверка.
// Подразделение любого уровня — один и тот же узел UnitNode, глубина не ограничена.

import type { ComponentKind, ComponentEntry, Echelon, Id, Ruleset, SideDef, StateKey, UnitNode, UnitState } from './types';
import { STATE_KEYS } from './types';

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

/** Значения корня по умолчанию: всё, что не задано ниже, наследуется отсюда. */
export const ROOT_STATE: UnitState = {
  experience: 2,
  morale: 75,
  cohesion: 75,
  readiness: 90,
  ammo: 100,
  fuel: 100,
  equipment: 100,
  fatigue: 10,
  vehicleCondition: 90,
};
export const ROOT_COMMS = 80;
export const ROOT_SUPPLY = 80;

export const STATE_LABELS: Record<StateKey, string> = {
  experience: 'Опыт',
  morale: 'Мораль',
  cohesion: 'Слаженность',
  readiness: 'Готовность',
  ammo: 'Боезапас',
  fuel: 'Топливо',
  equipment: 'Снаряжение',
  fatigue: 'Усталость',
  vehicleCondition: 'Состояние техники',
};

export function newUnit(name = 'Новое подразделение', patch: Partial<UnitNode> = {}): UnitNode {
  return {
    id: uid('u'),
    name,
    level: '',
    composition: [],
    children: [],
    commanderName: '',
    commandLevel: null,
    order: null,
    echelon: null,
    comms: null,
    supply: null,
    state: {},
    attackMod: 100,
    defenseMod: 100,
    isHQ: false,
    holdFast: false,
    tags: [],
    ...patch,
  };
}

/**
 * Новое самостоятельное подразделение. Незаданные параметры корня берутся из значений по умолчанию,
 * поэтому такое подразделение можно и вести в бой самостоятельно, и вставлять в другие — тогда оно наследует их параметры.
 */
export function newRootUnit(name = 'Новое подразделение', patch: Partial<UnitNode> = {}): UnitNode {
  return newUnit(name, { level: 'батальон', commandLevel: 3, ...patch });
}

// ------------------------------------------------------------------ обход и поиск

export function walkUnits(root: UnitNode, fn: (node: UnitNode, parent: UnitNode | null, depth: number) => void, parent: UnitNode | null = null, depth = 0) {
  fn(root, parent, depth);
  for (const ch of root.children) walkUnits(ch, fn, root, depth + 1);
}

export function allUnits(root: UnitNode): UnitNode[] {
  const out: UnitNode[] = [];
  walkUnits(root, (n) => out.push(n));
  return out;
}

export function findUnit(roots: UnitNode | UnitNode[], id: Id): UnitNode | null {
  for (const r of Array.isArray(roots) ? roots : [roots]) {
    if (r.id === id) return r;
    const f = findUnit(r.children, id);
    if (f) return f;
  }
  return null;
}

/** Старший узел (null — корень или не найден). */
export function findParent(roots: UnitNode | UnitNode[], id: Id): UnitNode | null {
  for (const r of Array.isArray(roots) ? roots : [roots]) {
    if (r.children.some((c) => c.id === id)) return r;
    const p = findParent(r.children, id);
    if (p) return p;
  }
  return null;
}

/** Цепочка от корня до узла включительно. */
export function pathTo(roots: UnitNode | UnitNode[], id: Id): UnitNode[] {
  for (const r of Array.isArray(roots) ? roots : [roots]) {
    if (r.id === id) return [r];
    const p = pathTo(r.children, id);
    if (p.length) return [r, ...p];
  }
  return [];
}

export function isDescendant(node: UnitNode, id: Id): boolean {
  return node.children.some((c) => c.id === id || isDescendant(c, id));
}

// ------------------------------------------------------------------ наследование

export interface Resolved {
  state: UnitState;
  comms: number;
  supply: number;
  order: Id | null;
  echelon: Echelon;
}

export const ROOT_RESOLVED: Resolved = { state: ROOT_STATE, comms: ROOT_COMMS, supply: ROOT_SUPPLY, order: null, echelon: 'front' };

export function resolveChild(node: UnitNode, parent: Resolved): Resolved {
  const state = { ...parent.state };
  for (const k of STATE_KEYS) {
    const v = node.state[k];
    if (typeof v === 'number' && Number.isFinite(v)) state[k] = v;
  }
  return {
    state,
    comms: node.comms ?? parent.comms,
    supply: node.supply ?? parent.supply,
    order: node.order ?? parent.order,
    echelon: node.echelon ?? parent.echelon,
  };
}

/** Действующие значения для каждого узла дерева (с учётом наследования). */
export function resolveTree(root: UnitNode, base: Resolved = ROOT_RESOLVED): Map<Id, Resolved> {
  const out = new Map<Id, Resolved>();
  const go = (n: UnitNode, p: Resolved) => {
    const r = resolveChild(n, p);
    out.set(n.id, r);
    for (const c of n.children) go(c, r);
  };
  go(root, base);
  return out;
}

/** Действующие значения конкретного узла. */
export function resolveUnit(root: UnitNode, id: Id): Resolved | null {
  const path = pathTo(root, id);
  if (!path.length) return null;
  let r = ROOT_RESOLVED;
  for (const n of path) r = resolveChild(n, r);
  return r;
}

// ------------------------------------------------------------------ копирование и шаблоны

export function cloneDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Копия поддерева с новыми идентификаторами (связи с шаблонами внутри сохраняются). */
export function cloneUnit(node: UnitNode): UnitNode {
  const c = cloneDeep(node);
  walkUnits(c, (n) => (n.id = uid('u')));
  return c;
}

/**
 * Часть подразделения как самостоятельное: копия поддерева узла nodeId с новыми идентификаторами
 * (связи частей с их шаблонами сохраняются). Что часть наследовала от старших — приказ, эшелон,
 * связь, снабжение, состояние, — записывается в неё явно, чтобы в бою она была такой же, как в составе.
 * В название добавляется старшее подразделение («2-я рота · 1-й батальон»).
 */
export function extractPart(root: UnitNode, nodeId: Id): UnitNode | null {
  const path = pathTo(root, nodeId);
  if (path.length < 2) return null;
  let parent = ROOT_RESOLVED;
  for (const n of path.slice(0, -1)) parent = resolveChild(n, parent);
  const c = cloneUnit(path[path.length - 1]);
  c.order ??= parent.order;
  if (c.echelon === null && parent.echelon !== 'front') c.echelon = parent.echelon;
  if (c.comms === null && parent.comms !== ROOT_COMMS) c.comms = parent.comms;
  if (c.supply === null && parent.supply !== ROOT_SUPPLY) c.supply = parent.supply;
  for (const k of STATE_KEYS) if (c.state[k] === undefined && parent.state[k] !== ROOT_STATE[k]) c.state[k] = parent.state[k];
  c.name = `${c.name} · ${path[path.length - 2].name}`;
  delete c.attachedFrom;
  delete c.rulesetId;
  delete c.updatedAt;
  return c;
}

/** Подразделение без исключённых из боя частей (вместе с их подчинёнными). null — исключено целиком. */
export function withoutExcluded(root: UnitNode, excluded?: Iterable<Id>): UnitNode | null {
  const ex = new Set(excluded ?? []);
  if (!ex.size) return root;
  if (ex.has(root.id)) return null;
  const prune = (n: UnitNode): UnitNode => ({ ...n, children: n.children.filter((c) => !ex.has(c.id)).map(prune) });
  return prune(root);
}

/** Подразделения стороны сценария так, как они вступают в бой: без исключённых частей. */
export function sideUnits(side: Pick<SideDef, 'formations' | 'excluded'>): UnitNode[] {
  return side.formations.map((f) => withoutExcluded(f, side.excluded)).filter((f): f is UnitNode => !!f);
}

/** Отпечаток «устройства» подразделения: всё, что переносится из шаблона в копии. Названия и состояние не входят. */
export function unitHash(node: UnitNode): string {
  const proj = (n: UnitNode): unknown => [
    n.level,
    n.composition.map((c) => [c.typeId, c.authorized]),
    n.commandLevel,
    n.order,
    n.echelon,
    n.isHQ,
    n.holdFast,
    n.attackMod,
    n.defenseMod,
    [...n.tags].sort(),
    n.children.map(proj),
  ];
  const str = JSON.stringify(proj(node));
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Вставить подразделение библиотеки как копию: копия помнит шаблон и узлы шаблона,
 * чтобы позже её можно было обновить. Состояние корня шаблона переносится явно.
 */
export function instantiate(template: UnitNode, opts: { attachedFrom?: string; name?: string } = {}): UnitNode {
  const c = cloneDeep(template);
  walkUnits(c, (n) => {
    n.srcNodeId = n.id;
    n.id = uid('u');
  });
  c.templateId = template.id;
  c.templateHash = unitHash(template);
  delete c.rulesetId;
  delete c.updatedAt;
  if (opts.attachedFrom !== undefined) c.attachedFrom = opts.attachedFrom;
  if (opts.name) c.name = opts.name;
  return c;
}

/** Шаблон изменился после вставки или последнего обновления копии. */
export function isOutdated(copy: UnitNode, template: UnitNode | undefined): boolean {
  if (!copy.templateId || !template) return false;
  const now = unitHash(template);
  if (copy.templateHash) return copy.templateHash !== now;
  return unitHash(copy) !== now;
}

/**
 * Обновить копию по шаблону. Устройство (уровни, штатный состав, приказы, флаги, подчинённые) берётся из шаблона;
 * названия, текущая численность, потери и состояние копии сохраняются. Узлы, добавленные в копию вручную, остаются.
 */
export function updateFromTemplate(copy: UnitNode, template: UnitNode): UnitNode {
  const mergeNode = (cur: UnitNode | null, tpl: UnitNode, isRoot: boolean): UnitNode => {
    const base: UnitNode = cur ? cloneDeep(cur) : { ...cloneDeep(tpl), children: [], id: uid('u'), srcNodeId: tpl.id };
    if (!cur) delete base.rulesetId;
    base.level = tpl.level;
    base.commandLevel = tpl.commandLevel;
    base.order = isRoot && cur ? cur.order ?? tpl.order : tpl.order;
    base.echelon = isRoot && cur ? cur.echelon ?? tpl.echelon : tpl.echelon;
    base.isHQ = tpl.isHQ;
    base.holdFast = tpl.holdFast;
    base.attackMod = tpl.attackMod;
    base.defenseMod = tpl.defenseMod;
    base.tags = [...tpl.tags];
    if (!isRoot) {
      // Вложенные копии других шаблонов: связь берём из шаблона.
      base.templateId = tpl.templateId;
      base.templateHash = tpl.templateHash;
    }
    // Штатный состав — из шаблона; текущая численность — из копии.
    base.composition = tpl.composition.map((tc) => {
      const old = cur?.composition.find((c) => c.typeId === tc.typeId);
      if (!old) return { ...tc };
      const full = old.current >= old.authorized;
      return { typeId: tc.typeId, authorized: tc.authorized, current: full ? tc.authorized : Math.min(old.current, tc.authorized), recoverable: old.recoverable };
    });
    // Подчинённые: сопоставление по узлу шаблона.
    const curChildren = cur?.children ?? [];
    const used = new Set<Id>();
    const tplIds = new Set(tpl.children.map((t) => t.id));
    const matches = tpl.children.map((tch) => {
      const m = curChildren.find((c) => !used.has(c.id) && c.srcNodeId === tch.id);
      if (m) used.add(m.id);
      return m ?? null;
    });
    // Запасной путь — по порядку: копия, вставленная внутри другого шаблона, ссылается на его узлы.
    const foreign = curChildren.filter((c) => !used.has(c.id) && c.srcNodeId && !tplIds.has(c.srcNodeId));
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]) continue;
      const m = foreign.find((c) => !used.has(c.id) && c.level === tpl.children[i].level);
      if (m) {
        used.add(m.id);
        matches[i] = m;
      }
    }
    const kids: UnitNode[] = tpl.children.map((tch, i) => mergeNode(matches[i], tch, false));
    // Добавленные в копию вручную (без связи с шаблоном) — сохраняются.
    for (const c of curChildren) if (!c.srcNodeId && !used.has(c.id)) kids.push(c);
    base.children = kids;
    return base;
  };
  const out = mergeNode(copy, template, true);
  out.templateId = template.id;
  out.templateHash = unitHash(template);
  return out;
}

/** Следующее название при размножении: «1-й взвод» → «2-й взвод», «Взвод» → «Взвод 2». */
export function nextName(name: string, k: number): string {
  const m = /^(\d+)(.*)$/.exec(name.trim());
  if (m) return `${Number(m[1]) + k}${m[2]}`;
  const t = /^(.*?)(\s+)(\d+)$/.exec(name.trim());
  if (t) return `${t[1]}${t[2]}${Number(t[3]) + k}`;
  return `${name} ${k + 1}`;
}

// ------------------------------------------------------------------ изменения дерева (на месте, для черновиков immer)

export function removeUnit(roots: UnitNode[], id: Id): UnitNode | null {
  const i = roots.findIndex((r) => r.id === id);
  if (i >= 0) return roots.splice(i, 1)[0];
  for (const r of roots) {
    const x = removeUnit(r.children, id);
    if (x) return x;
  }
  return null;
}

export type DropPos = 'before' | 'after' | 'inside';

/** Можно ли переместить узел: нельзя в самого себя и в своих подчинённых. */
export function canMove(roots: UnitNode[], id: Id, targetId: Id): boolean {
  if (id === targetId) return false;
  const node = findUnit(roots, id);
  return !!node && !isDescendant(node, targetId);
}

/** Переместить узел относительно другого. roots — список корней (дерево или подразделения стороны). */
export function moveUnit(roots: UnitNode[], id: Id, targetId: Id, pos: DropPos, keepRoot = false): boolean {
  if (!canMove(roots, id, targetId)) return false;
  if (keepRoot && roots.length === 1 && roots[0].id === id) return false;
  const node = removeUnit(roots, id);
  if (!node) return false;
  insertUnit(roots, node, targetId, pos);
  return true;
}

export function insertUnit(roots: UnitNode[], node: UnitNode, targetId: Id, pos: DropPos) {
  if (pos === 'inside') {
    const t = findUnit(roots, targetId);
    if (t) t.children.push(node);
    return;
  }
  const parent = findParent(roots, targetId);
  const list = parent ? parent.children : roots;
  const i = list.findIndex((x) => x.id === targetId);
  list.splice(pos === 'before' ? i : i + 1, 0, node);
}

// ------------------------------------------------------------------ перенос старых данных

/** Привести данные к текущему формату (в том числе старые «формирование + элементы»). */
export function migrateUnit(raw: unknown, isRoot = true): UnitNode {
  const x = raw as Record<string, any>;
  if (Array.isArray(x.elements) || Array.isArray(x.subunits)) return migrateLegacyFormation(x, isRoot);
  const n = newUnit(x.name ?? 'Подразделение', {});
  Object.assign(n, x);
  n.id = x.id ?? n.id;
  n.composition = Array.isArray(x.composition) ? x.composition : [];
  n.children = Array.isArray(x.children) ? x.children.map((c: unknown) => migrateUnit(c, false)) : [];
  n.state = x.state && typeof x.state === 'object' ? x.state : {};
  n.tags = Array.isArray(x.tags) ? x.tags : [];
  n.level = x.level ?? '';
  n.commanderName = x.commanderName ?? '';
  n.attackMod = x.attackMod ?? 100;
  n.defenseMod = x.defenseMod ?? 100;
  return n;
}

function migrateLegacyElement(e: Record<string, any>): UnitNode {
  const state: Partial<UnitState> = {};
  for (const k of STATE_KEYS) if (typeof e[k] === 'number') state[k] = e[k];
  return newUnit(e.name ?? 'Элемент', {
    id: e.id,
    srcNodeId: e.sourceId,
    level: e.role ?? '',
    composition: Array.isArray(e.composition) ? e.composition : [],
    order: e.order ?? null,
    echelon: e.echelon ?? null,
    state,
    attackMod: e.attackMod ?? 100,
    defenseMod: e.defenseMod ?? 100,
    isHQ: !!e.isHQ,
    holdFast: !!e.holdFast,
    tags: Array.isArray(e.tags) ? e.tags : [],
    notes: e.notes,
  });
}

function migrateLegacyFormation(f: Record<string, any>, isRoot: boolean): UnitNode {
  const n = newUnit(f.name ?? 'Подразделение', {
    id: f.id,
    level: f.kind ?? '',
    commanderName: f.commanderName ?? '',
    commandLevel: typeof f.commandLevel === 'number' ? f.commandLevel : null,
    comms: f.comms ?? null,
    supply: f.supply ?? null,
    order: f.order ?? null,
    tags: Array.isArray(f.tags) ? f.tags : [],
    notes: f.notes,
    rulesetId: f.rulesetId,
    updatedAt: f.updatedAt,
    children: [...(f.elements ?? []).map(migrateLegacyElement), ...(f.subunits ?? []).map((s: Record<string, any>) => migrateLegacyFormation(s, false))],
  });
  if (isRoot && f.sourceId) n.templateId = f.sourceId;
  else if (f.sourceId) n.srcNodeId = f.sourceId;
  return n;
}

// ------------------------------------------------------------------ сводка

export interface UnitSummaryDef {
  persAuth: number;
  persCur: number;
  recoverable: number;
  equip: { id: string; name: string; kind: ComponentKind; auth: number; cur: number; rec: number }[];
  value: number;
  valueAuth: number;
  fire: Record<string, Record<string, number>>;
  /** Подразделений с собственным составом (сражаются как отдельные элементы). */
  combatUnits: number;
  morale: number;
}

/** Сводка по поддеревьям (с учётом наследования морали). */
export function summarizeUnits(roots: UnitNode[], rs: Ruleset, bases?: Map<Id, Resolved>): UnitSummaryDef {
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const out: UnitSummaryDef = { persAuth: 0, persCur: 0, recoverable: 0, equip: [], value: 0, valueAuth: 0, fire: {}, combatUnits: 0, morale: 0 };
  const eq = new Map<string, UnitSummaryDef['equip'][number]>();
  let mw = 0;
  for (const root of roots) {
    const res = bases ?? resolveTree(root);
    walkUnits(root, (n) => {
      if (!n.composition.length) return;
      out.combatUnits++;
      const r = res.get(n.id);
      let v = 0;
      for (const c of n.composition) {
        const t = types.get(c.typeId);
        if (!t) continue;
        const crew = t.kind === 'personnel' ? 1 : t.crew;
        out.persAuth += c.authorized * crew;
        out.persCur += c.current * crew;
        if (t.kind === 'personnel') out.recoverable += c.recoverable ?? 0;
        out.value += c.current * t.value;
        out.valueAuth += c.authorized * t.value;
        v += c.current * t.value;
        if (t.kind !== 'personnel') {
          const q = eq.get(t.id) ?? { id: t.id, name: t.name, kind: t.kind, auth: 0, cur: 0, rec: 0 };
          q.auth += c.authorized;
          q.cur += c.current;
          q.rec += c.recoverable ?? 0;
          eq.set(t.id, q);
        }
        for (const cls of rs.targetClasses)
          for (const b of rs.rangeBands) {
            out.fire[cls.id] ??= {};
            out.fire[cls.id][b.id] = (out.fire[cls.id][b.id] ?? 0) + (t.firepower[cls.id]?.[b.id] ?? 0) * c.current * ((n.attackMod ?? 100) / 100);
          }
      }
      if (r) {
        out.morale += r.state.morale * v;
        mw += v;
      }
    });
  }
  out.morale = mw > 0 ? out.morale / mw : 0;
  out.equip = [...eq.values()];
  return out;
}

/** Людей в составе одного узла (без подчинённых). */
export function ownPersonnel(n: UnitNode, rs: Ruleset): { cur: number; auth: number } {
  let cur = 0;
  let auth = 0;
  for (const c of n.composition) {
    const t = rs.componentTypes.find((x) => x.id === c.typeId);
    if (!t) continue;
    const crew = t.kind === 'personnel' ? 1 : t.crew;
    cur += c.current * crew;
    auth += c.authorized * crew;
  }
  return { cur, auth };
}

export function countComponents(entries: ComponentEntry[]): number {
  return entries.reduce((a, c) => a + c.current, 0);
}
