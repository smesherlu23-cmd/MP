// Контекст расчёта: быстрый доступ к справочникам, система модификаторов и общие формулы.

import { COMPAT_NEUTRAL } from './coefficients';
import { Rng } from './rng';
import { STAT_KEYS } from './types';
import type {
  ActiveEffect,
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
  RangeBand,
  Ruleset,
  SectorState,
  Severity,
  SideId,
  StatKey,
  TargetClass,
} from './types';

export interface StatCx {
  enemy?: ElementState;
  targetClass?: Id;
}

/** Поля условий, зависящие от состояния элемента: такие правила не кэшируются. */
const STATE_FIELDS = new Set([
  'morale',
  'cohesion',
  'suppression',
  'fatigue',
  'ammo',
  'losses',
  'sideLosses',
  'readiness',
  'fuel',
  'equipment',
  'vehicleCondition',
  'comms',
  'supply',
  'commandLevel',
  'holdFast',
  'spotted',
]);

/** Поля условий своих правил, которые проверяются и для ударов огневой поддержки. */
const SUPPORT_FIELDS = new Set(['tag', 'kind', 'side', 'turn', 'intel', 'sideLosses']);

/** Подкрепление, которое ещё не подошло (вне боя и в итогах не учитывается); переброска между участками — не оно. */
export const notArrived = (el: ElementState) => el.status === 'pending' && !el.transit;
const fieldBase = (f: string) => (f.startsWith('enemy.') ? f.slice(6) : f);

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
  /** Правила с условиями на состояние (мораль, потери…): считаются при каждом обращении. */
  private dynamicList: CustomModifier[];
  private plainMods: CustomModifier[];
  private selectedConditions: { label: string; opt: OptionDef }[] = [];
  /** Условия по участкам (если у участка свои — местность и т.п.). */
  private sectorConditions = new Map<Id, { label: string; opt: OptionDef }[]>();
  readonly sectors = new Map<Id, SectorState>();
  private bySide: Record<SideId, ElementState[]>;
  private sideLossCache: Partial<Record<SideId, number>> = {};

  constructor(readonly b: Battle) {
    this.rs = b.ruleset;
    // Снимок правил старого боя может не знать новых коэффициентов — для него новые механики выключены.
    this.k = { ...COMPAT_NEUTRAL, ...b.ruleset.coefficients };
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
    const dynamic = (m: CustomModifier) => m.when.some((w) => STATE_FIELDS.has(fieldBase(w.field)));
    this.dynamicList = this.rs.modifiers.filter((m) => m.enabled && !this.contextualMods.has(m.id) && dynamic(m));
    this.plainMods = this.rs.modifiers.filter((m) => m.enabled && !this.contextualMods.has(m.id) && !dynamic(m));
    for (const sec of b.sectors ?? []) this.sectors.set(sec.id, sec);
    this.refreshConditions();
    this.bySide = { A: b.elements.filter((x) => x.side === 'A'), B: b.elements.filter((x) => x.side === 'B') };
  }

  /** Пересчитать выбранные условия (после вмешательства ГМ). */
  refreshConditions() {
    const pick = (over?: Record<Id, Id>) => {
      const out: { label: string; opt: OptionDef }[] = [];
      for (const cat of this.rs.conditions) {
        const opt = cat.options.find((o) => o.id === (over?.[cat.id] || this.b.conditions[cat.id]));
        if (opt) out.push({ label: `${cat.name}: ${opt.name}`, opt });
      }
      return out;
    };
    this.selectedConditions = pick();
    this.sectorConditions.clear();
    for (const sec of this.b.sectors ?? []) if (Object.values(sec.conditions ?? {}).some(Boolean)) this.sectorConditions.set(sec.id, pick(sec.conditions));
  }

  /** Условия, действующие на элемент: общие или своего участка. */
  conditionsOf(el: ElementState) {
    return (el.sector && this.sectorConditions.get(el.sector)) || this.selectedConditions;
  }

  /** Вариант условия категории для элемента (с учётом участка). */
  conditionOf(el: ElementState | undefined, cat: Id): Id | undefined {
    const sec = el && this.sectorOf(el);
    return sec?.conditions?.[cat] || this.b.conditions[cat];
  }

  /** Участок элемента; null — участков нет. */
  sectorOf(el: ElementState): SectorState | null {
    if (!this.b.sectors?.length) return null;
    return (el.sector && this.sectors.get(el.sector)) || this.b.sectors[0];
  }

  /** Дистанция, на которой ведёт бой элемент (на его участке). */
  bandOf(el: ElementState): RangeBand {
    const sec = this.sectorOf(el);
    return sec ? this.rs.rangeBands[sec.bandIndex] : this.band;
  }

  /** Укрепления стороны элемента на его участке. */
  fortificationOf(el: ElementState): Id {
    return this.sectorOf(el)?.fortification?.[el.side] || this.b.sides[el.side].fortification;
  }

  /** Временные эффекты, действующие на элемент в текущем ходу. */
  effectsOf(el: ElementState): ActiveEffect[] {
    const list = this.b.effects;
    if (!list?.length) return [];
    const turn = this.b.turn;
    const out: ActiveEffect[] = [];
    for (const ef of list) {
      if (ef.side !== el.side || turn < ef.from || turn > ef.until) continue;
      if (ef.elementIds && !ef.elementIds.includes(el.id)) continue;
      if (ef.formationId && !this.chain(el).some((f) => f.id === ef.formationId)) continue;
      out.push(ef);
    }
    return out;
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
      this.sideLossCache = {};
      return;
    }
    this.baseCache.delete(el.id);
    this.tagCache.delete(el.id);
    this.kindCache.delete(el.id);
    this.sideLossCache = {};
  }

  /** Потери личного состава стороны, % от начальной численности (без не подошедших подкреплений). */
  sideLossPct(side: SideId): number {
    let v = this.sideLossCache[side];
    if (v === undefined) {
      let start = 0;
      let now = 0;
      for (const el of this.bySide[side]) {
        if (notArrived(el)) continue;
        start += el.startPersonnel;
        now += this.personnel(el);
      }
      v = start > 0 ? (1 - now / start) * 100 : 0;
      this.sideLossCache[side] = v;
    }
    return v;
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

  /**
   * Доля боевой ценности элемента у типов, подходящих под условия правила на свои теги и состав (для правил
   * «по доле»). Нет таких условий — 1.
   */
  shareOf(el: ElementState, mod: CustomModifier): number {
    const conds = mod.when.filter((c) => (c.field === 'tag' || c.field === 'kind') && c.op !== 'not_has' && c.op !== 'nin' && c.op !== 'neq');
    if (!conds.length) return 1;
    let all = 0;
    let part = 0;
    for (const c of el.comps) {
      if (c.current <= 0) continue;
      const t = this.type(c.typeId);
      const v = c.current * t.value;
      all += v;
      const tags = el.ownTags?.length ? [...t.tags, ...el.ownTags] : t.tags;
      const ok = (x: ModifierCondition) => testValue(x, x.field === 'tag' ? tags : [t.kind]);
      if (mod.any ? conds.some(ok) : conds.every(ok)) part += v;
    }
    return all > 0 ? part / all : 0;
  }

  /** Множитель правила для элемента: целиком или по доле подходящих типов. */
  private ruleValue(mod: CustomModifier, v: number, el: ElementState): number {
    return mod.byShare ? 1 + (v - 1) * this.shareOf(el, mod) : v;
  }

  /** Свои множители типов состава: тип → доля его боевой ценности в элементе. */
  typeShares(el: ElementState): { type: ComponentType; share: number }[] {
    let all = 0;
    for (const c of el.comps) if (c.current > 0) all += c.current * this.type(c.typeId).value;
    if (all <= 0) return [];
    const out: { type: ComponentType; share: number }[] = [];
    for (const c of el.comps) {
      const t = this.type(c.typeId);
      if (c.current > 0 && t.effects && Object.keys(t.effects).length) out.push({ type: t, share: (c.current * t.value) / all });
    }
    return out;
  }

  /** Теги элемента — теги типов его состава (тех, что ещё в строю); у боёв прежних версий — и теги подразделения. */
  tags(el: ElementState): string[] {
    let t = this.tagCache.get(el.id);
    if (!t) {
      const set = new Set(el.ownTags ?? []);
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

  /** Уровень командира элемента: свой или формирования (0 — нет или штаб потерян). */
  commandLevelOf(el: ElementState): number {
    if (el.ownCommandLevel) return el.ownCommandLevel;
    const f = this.formationOf(el);
    return f && !f.hqLost ? f.commandLevel : 0;
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
      if (level) out.push({ level, weight: w, name: el.name });
      w *= this.k.commandChainWeight;
    }
    for (const f of this.chain(el)) {
      if (w < 0.01) break;
      if (!f.commandLevel) continue;
      const level = this.rs.commandLevels[f.commandLevel - 1];
      if (level && !f.hqLost) out.push({ level, weight: w, name: f.name });
      w *= this.k.commandChainWeight;
    }
    return out;
  }

  // ------------------------------------------------------------ модификаторы

  private fieldValue(field: string, el: ElementState | undefined, cx: StatCx): string | number | string[] | undefined {
    if (field.startsWith('cond.')) return this.conditionOf(el, field.slice(5));
    if (field === 'range') return (el ? this.bandOf(el) : this.band)?.id;
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
        return this.fortificationOf(el);
      case 'intel':
        return this.b.sides[el.side].intel;
      case 'sector':
        return this.sectorOf(el)?.id;
      case 'morale':
      case 'cohesion':
      case 'suppression':
      case 'fatigue':
      case 'ammo':
      case 'readiness':
      case 'fuel':
      case 'equipment':
      case 'vehicleCondition':
        return el[field];
      case 'comms':
        return Math.round(this.comms(el) * 100);
      case 'supply':
        return Math.round(this.supply(el) * 100);
      case 'commandLevel':
        return this.commandLevelOf(el);
      case 'hq':
        return el.isHQ ? 'yes' : 'no';
      case 'holdFast':
        return el.holdFast ? 'yes' : 'no';
      case 'spotted':
        return el.spotted ? 'yes' : 'no';
      case 'losses':
        return el.startValue > 0 ? (1 - this.value(el) / el.startValue) * 100 : 0;
      case 'sideLosses':
        return this.sideLossPct(el.side);
    }
    return undefined;
  }

  /** Выполнены ли условия: все (any — хотя бы одно). Без условий — всегда. */
  matches(conds: ModifierCondition[], el: ElementState, cx: StatCx, any = false): boolean {
    if (!conds.length) return true;
    if (any) {
      for (const c of conds) if (this.test(c, el, cx)) return true;
      return false;
    }
    for (const c of conds) if (!this.test(c, el, cx)) return false;
    return true;
  }

  /** Сработает ли правило для элемента (с учётом «все / любое из»). */
  ruleMatches(mod: CustomModifier, el: ElementState, cx: StatCx = {}): boolean {
    return this.matches(mod.when, el, cx, !!mod.any);
  }

  private test(c: ModifierCondition, el: ElementState, cx: StatCx): boolean {
    const v = this.fieldValue(c.field, el, cx);
    if (v === undefined) return false;
    return testValue(c, v);
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
    let base = arr[STAT_INDEX[stat]];
    for (const mod of this.dynamicList) {
      const v = mod.effects[stat];
      if (v !== undefined && Number.isFinite(v) && this.ruleMatches(mod, el)) base *= this.ruleValue(mod, v, el);
    }
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
    for (const c of this.conditionsOf(el)) apply(c.opt.effects);
    const side = this.b.sides[el.side];
    const bh = order.behavior;
    if (bh === 'defend' || bh === 'ambush' || bh === 'consolidate' || bh === 'reserve') {
      const fortId = this.fortificationOf(el);
      const fort = this.rs.fortifications.find((x) => x.id === fortId);
      if (fort) apply(fort.effects);
    }
    const intel = this.rs.intelLevels.find((x) => x.id === side.intel);
    if (intel) apply(intel.effects);
    for (const ef of this.effectsOf(el)) apply(ef.effects);
    for (const x of this.typeShares(el)) apply(x.type.effects!, x.share);
    for (const mod of this.plainMods) if (this.ruleMatches(mod, el)) apply(mod.effects, mod.byShare ? this.shareOf(el, mod) : 1);
    return arr;
  }

  /** Только часть множителя от правил, зависящих от противника/класса цели. */
  contextual(el: ElementState, stat: StatKey, cx: StatCx): number {
    let m = 1;
    for (const mod of this.contextualList) {
      const v = mod.effects[stat];
      if (v !== undefined && this.ruleMatches(mod, el, cx)) m *= this.ruleValue(mod, v, el);
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
      for (const c of this.conditionsOf(el)) add(c.label, c.opt.effects[stat]);
      const side = this.b.sides[el.side];
      const bh = this.behavior(el);
      if (bh === 'defend' || bh === 'ambush' || bh === 'consolidate' || bh === 'reserve') {
        const fortId = this.fortificationOf(el);
        const fort = this.rs.fortifications.find((x) => x.id === fortId);
        if (fort) add(`Укрепления: ${fort.name}`, fort.effects[stat]);
      }
      const intel = this.rs.intelLevels.find((x) => x.id === side.intel);
      if (intel) add(`Разведданные: ${intel.name}`, intel.effects[stat]);
      for (const ef of this.effectsOf(el)) add(`Эффект «${ef.name}» (до ${ef.until}-го хода)`, ef.effects[stat]);
      for (const x of this.typeShares(el)) {
        const v = x.type.effects![stat];
        if (v !== undefined) add(`Тип «${x.type.name}» (${Math.round(x.share * 100)}% ценности)`, 1 + (v - 1) * x.share);
      }
    }
    for (const mod of this.rs.modifiers) {
      if (!mod.enabled || mod.effects[stat] === undefined) continue;
      const contextual = this.contextualMods.has(mod.id);
      if (contextualOnly === true && !contextual) continue;
      if (contextualOnly === false && contextual) continue;
      if (!this.ruleMatches(mod, el, cx)) continue;
      if (mod.byShare) {
        const sh = this.shareOf(el, mod);
        add(`Правило «${mod.name}» (по доле ${Math.round(sh * 100)}%)`, 1 + (mod.effects[stat]! - 1) * sh);
      } else add(`Правило «${mod.name}»`, mod.effects[stat]);
    }
    return m;
  }

  /**
   * Множитель огня средства огневой поддержки (удара): условия боя — на участке цели, временные эффекты на
   * всю сторону и свои правила на огонь, условия которых имеют смысл для средства вне поля боя (условия боя,
   * теги и состав, сторона, ход, разведданные, потери стороны). Средство считается элементом из count единиц своего типа.
   */
  supportMult(side: SideId, type: ComponentType, count: number, sector: Id | undefined, out?: Factor[]): number {
    const el = {
      id: `support:${side}:${type.id}:${sector ?? ''}`,
      side,
      sector,
      comps: [{ typeId: type.id, authorized: count, start: count, current: count, destroyed: 0, damaged: 0, abandoned: 0, kia: 0, wia: 0, mia: 0 }],
    } as unknown as ElementState;
    let m = 1;
    const add = (label: string, v: number | undefined) => {
      if (v === undefined || v === 1 || !Number.isFinite(v)) return;
      m *= v;
      out?.push({ label, value: v, kind: 'mult' });
    };
    for (const c of this.conditionsOf(el)) add(c.label, c.opt.effects.fire);
    const turn = this.b.turn;
    for (const ef of this.b.effects ?? [])
      if (ef.side === side && !ef.formationId && !ef.elementIds && turn >= ef.from && turn <= ef.until) add(`Эффект «${ef.name}»`, ef.effects.fire);
    for (const mod of this.rs.modifiers) {
      const v = mod.effects.fire;
      if (!mod.enabled || v === undefined || !mod.when.every((c) => SUPPORT_FIELDS.has(c.field) || c.field.startsWith('cond.'))) continue;
      if (this.ruleMatches(mod, el)) add(`Правило «${mod.name}»`, this.ruleValue(mod, v, el));
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
      factors: entry.factors?.length ? entry.factors : undefined,
      level: entry.level ?? 1,
      ...(entry.data ? { data: entry.data } : {}),
    });
  }

  get logging(): boolean {
    return !this.b.silent;
  }
}

const STAT_INDEX = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i])) as Record<StatKey, number>;

/** Проверка условия по значению поля (строка, число или список — теги, состав). */
export function testValue(c: ModifierCondition, v: string | number | string[]): boolean {
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

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
export const round1 = (v: number) => Math.round(v * 10) / 10;

export const e = (el: ElementState | Id) => `[[e:${typeof el === 'string' ? el : el.id}]]`;
export const fm = (f: FormationState | Id) => `[[f:${typeof f === 'string' ? f : f.id}]]`;
export const s = (side: SideId) => `[[s:${side}]]`;
