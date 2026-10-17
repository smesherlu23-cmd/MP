// Контекст расчёта: быстрый доступ к справочникам, система модификаторов и общие формулы.

import { Rng } from './rng';
import { STAT_KEYS } from './types';
import type {
  Battle,
  Behavior,
  ComponentKind,
  CustomModifier,
  ComponentType,
  ElementState,
  Factor,
  FormationState,
  Id,
  LevelDef,
  LogEntry,
  ModifierCondition,
  OptionDef,
  OrderDef,
  Ruleset,
  Severity,
  SideId,
  StatKey,
  TargetClass,
} from './types';

export interface StatCx {
  enemy?: ElementState;
  targetClass?: Id;
}

export class EngineContext {
  readonly rs: Ruleset;
  readonly k: Record<string, number>;
  readonly rng: Rng;
  readonly types = new Map<Id, ComponentType>();
  readonly orders = new Map<Id, OrderDef>();
  readonly classes = new Map<Id, TargetClass>();
  readonly formations = new Map<Id, FormationState>();
  readonly elements = new Map<Id, ElementState>();
  /** Кэш множителей всех характеристик элемента (без правил, зависящих от противника/класса цели). */
  private baseCache = new Map<Id, Float64Array>();
  private tagCache = new Map<Id, string[]>();
  private kindCache = new Map<Id, ComponentKind[]>();
  /** Модификаторы, зависящие от противника или класса цели (их нельзя кэшировать по элементу). */
  private contextualMods: Set<Id>;
  private contextualList: CustomModifier[];
  private plainMods: CustomModifier[];
  private selectedConditions: { label: string; opt: OptionDef }[] = [];
  private bySide: Record<SideId, ElementState[]>;

  constructor(readonly b: Battle) {
    this.rs = b.ruleset;
    this.k = b.ruleset.coefficients;
    this.rng = new Rng([...b.rng] as Battle['rng']);
    for (const t of this.rs.componentTypes) this.types.set(t.id, t);
    for (const o of this.rs.orders) this.orders.set(o.id, o);
    for (const c of this.rs.targetClasses) this.classes.set(c.id, c);
    for (const f of b.formations) this.formations.set(f.id, f);
    for (const e of b.elements) this.elements.set(e.id, e);
    this.contextualMods = new Set(
      this.rs.modifiers.filter((m) => m.when.some((w) => w.field.startsWith('enemy.') || w.field === 'targetClass')).map((m) => m.id),
    );
    this.contextualList = this.rs.modifiers.filter((m) => m.enabled && this.contextualMods.has(m.id));
    this.plainMods = this.rs.modifiers.filter((m) => m.enabled && !this.contextualMods.has(m.id));
    this.refreshConditions();
    this.bySide = { A: b.elements.filter((x) => x.side === 'A'), B: b.elements.filter((x) => x.side === 'B') };
  }

  /** Пересчитать выбранные условия (после вмешательства ГМ). */
  refreshConditions() {
    this.selectedConditions = [];
    for (const cat of this.rs.conditions) {
      const opt = cat.options.find((o) => o.id === this.b.conditions[cat.id]);
      if (opt) this.selectedConditions.push({ label: `${cat.name}: ${opt.name}`, opt });
    }
  }

  get f() {
    return this.rs.features;
  }

  get band() {
    return this.rs.rangeBands[this.b.bandIndex];
  }

  /** Сохранить состояние генератора обратно в бой. */
  commit() {
    this.b.rng = [...this.rng.state] as Battle['rng'];
  }

  invalidate(el?: ElementState) {
    if (!el) {
      this.baseCache.clear();
      this.tagCache.clear();
      this.kindCache.clear();
      return;
    }
    this.baseCache.delete(el.id);
    this.tagCache.delete(el.id);
    this.kindCache.delete(el.id);
  }

  // ------------------------------------------------------------ справочные функции

  type(id: Id): ComponentType {
    return this.types.get(id)!;
  }

  order(el: ElementState): OrderDef {
    return this.orders.get(el.orderId) ?? this.rs.orders[0];
  }

  behavior(el: ElementState): Behavior {
    return this.order(el).behavior;
  }

  /** Элемент в бою и не в резерве. */
  engaged(el: ElementState): boolean {
    return el.status === 'active' && this.behavior(el) !== 'reserve';
  }

  /** Элемент в бою и не выходит из него. */
  fighting(el: ElementState): boolean {
    if (el.status !== 'active') return false;
    const bh = this.behavior(el);
    return bh !== 'retreat' && bh !== 'rout';
  }

  sideElements(side: SideId): ElementState[] {
    return this.bySide[side];
  }

  enemyOf(side: SideId): SideId {
    return side === 'A' ? 'B' : 'A';
  }

  tags(el: ElementState): string[] {
    let t = this.tagCache.get(el.id);
    if (!t) {
      const set = new Set(el.ownTags);
      for (const c of el.comps) if (c.current > 0) for (const tag of this.type(c.typeId).tags) set.add(tag);
      t = [...set];
      this.tagCache.set(el.id, t);
    }
    return t;
  }

  kinds(el: ElementState): ComponentKind[] {
    let k = this.kindCache.get(el.id);
    if (!k) {
      const set = new Set<ComponentKind>();
      for (const c of el.comps) if (c.current > 0) set.add(this.type(c.typeId).kind);
      k = [...set];
      this.kindCache.set(el.id, k);
    }
    return k;
  }

  isRecon(el: ElementState): boolean {
    return this.behavior(el) === 'recon' || (!!this.rs.reconTag && this.tags(el).includes(this.rs.reconTag));
  }

  value(el: ElementState): number {
    let v = 0;
    for (const c of el.comps) v += c.current * this.type(c.typeId).value;
    return v;
  }

  personnel(el: ElementState): number {
    let p = 0;
    for (const c of el.comps) {
      const t = this.type(c.typeId);
      if (t.kind === 'personnel') p += c.current;
      else p += c.start * t.crew - c.kia - c.wia - c.mia;
    }
    return Math.max(0, p - el.scattered);
  }

  size(el: ElementState): number {
    let n = 0;
    for (const c of el.comps) n += c.current;
    return n;
  }

  formationOf(el: ElementState): FormationState {
    return this.formations.get(el.formationId)!;
  }

  /** Цепочка формирований от ближайшего к верхнему. */
  chain(el: ElementState): FormationState[] {
    const out: FormationState[] = [];
    let f: FormationState | undefined = this.formationOf(el);
    while (f) {
      out.push(f);
      f = f.parentId ? this.formations.get(f.parentId) : undefined;
    }
    return out;
  }

  /** Эффективная связь элемента, 0..1. */
  comms(el: ElementState): number {
    if (!this.f.comms) return 1;
    const chain = this.chain(el);
    let c = (el.comms ?? chain[0].comms) / 100;
    for (const f of chain) if (f.hqLost) c *= this.k.hqLossComms;
    return Math.max(0, Math.min(1, c));
  }

  supply(el: ElementState): number {
    return Math.max(0, Math.min(1, (el.supply ?? this.formationOf(el).supply) / 100));
  }

  /** Командиры элемента: свой (если есть), затем командиры старших звеньев с ослабевающим влиянием. */
  commandLevels(el: ElementState): { level: LevelDef; weight: number; name: string }[] {
    if (!this.f.command) return [];
    const out: { level: LevelDef; weight: number; name: string }[] = [];
    let w = 1;
    if (el.ownCommandLevel) {
      const level = this.rs.commandLevels[el.ownCommandLevel - 1];
      if (level) out.push({ level, weight: w, name: el.ownCommanderName || el.name });
      w *= this.k.commandChainWeight;
    }
    for (const f of this.chain(el)) {
      if (w < 0.01) break;
      if (!f.commandLevel) continue;
      const level = this.rs.commandLevels[f.commandLevel - 1];
      if (level && !f.hqLost) out.push({ level, weight: w, name: f.commanderName || f.name });
      w *= this.k.commandChainWeight;
    }
    return out;
  }

  // ------------------------------------------------------------ модификаторы

  private fieldValue(field: string, el: ElementState | undefined, cx: StatCx): string | number | string[] | undefined {
    if (field.startsWith('cond.')) return this.b.conditions[field.slice(5)];
    if (field === 'range') return this.band?.id;
    if (field === 'turn') return this.b.turn;
    if (field === 'targetClass') return cx.targetClass;
    if (field.startsWith('enemy.')) return this.fieldValue(field.slice(6), cx.enemy, {});
    if (!el) return undefined;
    switch (field) {
      case 'order':
        return el.orderId;
      case 'behavior':
        return this.behavior(el);
      case 'tag':
        return this.tags(el);
      case 'kind':
        return this.kinds(el);
      case 'experience':
        return el.experience;
      case 'side':
        return el.side;
      case 'echelon':
        return el.echelon;
      case 'fortification':
        return this.b.sides[el.side].fortification;
      case 'intel':
        return this.b.sides[el.side].intel;
    }
    return undefined;
  }

  matches(conds: ModifierCondition[], el: ElementState, cx: StatCx): boolean {
    for (const c of conds) if (!this.test(c, el, cx)) return false;
    return true;
  }

  private test(c: ModifierCondition, el: ElementState, cx: StatCx): boolean {
    const v = this.fieldValue(c.field, el, cx);
    if (v === undefined) return false;
    const list = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
    const vals = Array.isArray(v) ? v.map(String) : [String(v)];
    switch (c.op) {
      case 'eq':
        return vals.length === 1 && vals[0] === list[0];
      case 'neq':
        return !(vals.length === 1 && vals[0] === list[0]);
      case 'in':
        return vals.some((x) => list.includes(x));
      case 'nin':
        return !vals.some((x) => list.includes(x));
      case 'has':
        return list.every((x) => vals.includes(x));
      case 'not_has':
        return !list.some((x) => vals.includes(x));
      case 'gte':
        return Number(vals[0]) >= Number(list[0]);
      case 'lte':
        return Number(vals[0]) <= Number(list[0]);
    }
    return false;
  }

  /**
   * Итоговый множитель характеристики элемента: приказ × опыт × командиры × условия × укрепления ×
   * разведданные × пользовательские правила. Если передан out — туда пишется разбор по факторам.
   */
  mult(el: ElementState, stat: StatKey, cx: StatCx = {}, out?: Factor[]): number {
    if (out) return this.compute(el, stat, cx, out, null);
    let arr = this.baseCache.get(el.id);
    if (!arr) {
      arr = this.computeAll(el);
      this.baseCache.set(el.id, arr);
    }
    const base = arr[STAT_INDEX[stat]];
    if (!this.contextualList.length || (!cx.enemy && !cx.targetClass)) return base;
    return base * this.contextual(el, stat, cx);
  }

  /** Все характеристики элемента сразу — один проход по источникам модификаторов. */
  private computeAll(el: ElementState): Float64Array {
    const arr = new Float64Array(STAT_KEYS.length).fill(1);
    const apply = (eff: Partial<Record<StatKey, number>>, w = 1) => {
      for (const key in eff) {
        const v = eff[key as StatKey];
        if (v === undefined || !Number.isFinite(v)) continue;
        arr[STAT_INDEX[key as StatKey]] *= w === 1 ? v : 1 + (v - 1) * w;
      }
    };
    const order = this.order(el);
    apply(order.effects);
    const exp = this.rs.experienceLevels[el.experience - 1];
    if (exp) apply(exp.effects);
    for (const c of this.commandLevels(el)) apply(c.level.effects, c.weight);
    for (const c of this.selectedConditions) apply(c.opt.effects);
    const side = this.b.sides[el.side];
    const bh = order.behavior;
    if (bh === 'defend' || bh === 'ambush' || bh === 'consolidate' || bh === 'reserve') {
      const fort = this.rs.fortifications.find((x) => x.id === side.fortification);
      if (fort) apply(fort.effects);
    }
    const intel = this.rs.intelLevels.find((x) => x.id === side.intel);
    if (intel) apply(intel.effects);
    for (const mod of this.plainMods) if (this.matches(mod.when, el, {})) apply(mod.effects);
    return arr;
  }

  /** Только часть множителя от правил, зависящих от противника/класса цели. */
  contextual(el: ElementState, stat: StatKey, cx: StatCx): number {
    let m = 1;
    for (const mod of this.contextualList) {
      const v = mod.effects[stat];
      if (v !== undefined && this.matches(mod.when, el, cx)) m *= v;
    }
    return m;
  }

  /** contextualOnly: true — только зависящие от контекста правила; false — всё, кроме них; null — всё. */
  private compute(el: ElementState, stat: StatKey, cx: StatCx, out: Factor[] | undefined, contextualOnly: boolean | null): number {
    let m = 1;
    const add = (label: string, v: number | undefined) => {
      if (v === undefined || v === 1 || !Number.isFinite(v)) return;
      m *= v;
      out?.push({ label, value: v, kind: 'mult' });
    };
    if (contextualOnly !== true) {
      const order = this.order(el);
      add(`Приказ «${order.name}»`, order.effects[stat]);
      const exp = this.rs.experienceLevels[el.experience - 1];
      if (exp) add(`Опыт: ${exp.name}`, exp.effects[stat]);
      for (const c of this.commandLevels(el)) {
        const v = c.level.effects[stat];
        if (v !== undefined) add(`Командир (${c.name}): ${c.level.name}`, 1 + (v - 1) * c.weight);
      }
      for (const c of this.selectedConditions) add(c.label, c.opt.effects[stat]);
      const side = this.b.sides[el.side];
      const bh = this.behavior(el);
      if (bh === 'defend' || bh === 'ambush' || bh === 'consolidate' || bh === 'reserve') {
        const fort = this.rs.fortifications.find((x) => x.id === side.fortification);
        if (fort) add(`Укрепления: ${fort.name}`, fort.effects[stat]);
      }
      const intel = this.rs.intelLevels.find((x) => x.id === side.intel);
      if (intel) add(`Разведданные: ${intel.name}`, intel.effects[stat]);
    }
    for (const mod of this.rs.modifiers) {
      if (!mod.enabled || mod.effects[stat] === undefined) continue;
      const contextual = this.contextualMods.has(mod.id);
      if (contextualOnly === true && !contextual) continue;
      if (contextualOnly === false && contextual) continue;
      if (this.matches(mod.when, el, cx)) add(`Правило «${mod.name}»`, mod.effects[stat]);
    }
    return m;
  }

  // ------------------------------------------------------------ журнал

  log(entry: {
    phase: LogEntry['phase'];
    text: string;
    severity?: Severity;
    side?: SideId;
    refs?: Id[];
    factors?: Factor[];
    level?: LogEntry['level'];
    data?: LogEntry['data'];
  }) {
    if (this.b.silent) return;
    this.b.log.push({
      turn: this.b.turn,
      phase: entry.phase,
      severity: entry.severity ?? 'info',
      side: entry.side,
      refs: entry.refs,
      text: entry.text,
      factors: entry.factors && entry.factors.length ? entry.factors : undefined,
      level: entry.level ?? 1,
      ...(entry.data ? { data: entry.data } : {}),
    });
  }

  get logging(): boolean {
    return !this.b.silent;
  }
}

const STAT_INDEX = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i])) as Record<StatKey, number>;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
export const round1 = (v: number) => Math.round(v * 10) / 10;

export const e = (el: ElementState | Id) => `[[e:${typeof el === 'string' ? el : el.id}]]`;
export const fm = (f: FormationState | Id) => `[[f:${typeof f === 'string' ? f : f.id}]]`;
export const s = (side: SideId) => `[[s:${side}]]`;
