// Пошаговый расчёт боя. Каждая фаза хода — отдельная функция; все числа берутся из набора правил.

import { EngineContext, clamp, e, fm, lerp, round1, s } from './context';
import { clone, defaultCommandLevel, normalizeRuleset, SCHEMA_VERSION } from './defaults';
import { plural } from './labels';
import { computeResult, defaultObjectives } from './outcome';
import { Rng } from './rng';
import type {
  Battle,
  Behavior,
  CompState,
  ElementState,
  Factor,
  FormationState,
  Id,
  Ruleset,
  Scenario,
  SideId,
  SideSnapshot,
  SideState,
  UnitNode,
} from './types';
import { migrateUnit, resolveChild, ROOT_RESOLVED, type Resolved } from './units';

export interface CreateOptions {
  seed?: string;
  silent?: boolean;
  name?: string;
  id?: string;
  /** Не копировать сценарий и правила (для массового моделирования: входные данные только читаются). */
  shareInputs?: boolean;
}

const SIDES: SideId[] = ['A', 'B'];

// ================================================================== создание боя

export function createBattle(scenario: Scenario, ruleset: Ruleset, opts: CreateOptions = {}): Battle {
  const rs = opts.shareInputs ? ruleset : normalizeRuleset(clone(ruleset));
  const sc = opts.shareInputs ? scenario : clone(scenario);
  const seed = opts.seed ?? sc.seed ?? 'seed';
  const rng = Rng.fromSeed(seed);
  const b: Battle = {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? `bt-${sc.id}-${seed}`,
    name: opts.name ?? sc.name,
    scenarioId: sc.id,
    scenario: sc,
    ruleset: rs,
    seed,
    rng: rng.state,
    turn: 0,
    bandIndex: Math.max(0, rs.rangeBands.findIndex((x) => x.id === sc.startBand)),
    closingProgress: 0,
    conditions: { ...sc.conditions },
    sides: {} as Record<SideId, SideState>,
    formations: [],
    elements: [],
    log: [],
    history: [],
    interventions: [],
    quietTurns: 0,
    finished: false,
    createdAt: new Date().toISOString(),
    silent: !!opts.silent,
  };

  const warnings: string[] = [];
  const typeIds = new Set(rs.componentTypes.map((t) => t.id));
  const orderIds = new Set(rs.orders.map((o) => o.id));
  const defaultOrder = rs.orders.find((o) => o.behavior === 'defend')?.id ?? rs.orders[0]?.id ?? 'defend';
  let fCount = 0;
  let eCount = 0;

  for (const sd of sc.sides) {
    b.sides[sd.id] = {
      id: sd.id,
      name: sd.name,
      color: sd.color,
      fortification: sd.fortification,
      intel: sd.intel,
      objectives: sd.objectives ?? [],
      lostHoldTurn: 0,
      initiative: 0,
    };
    // В шаблоне — только то, есть ли у подразделения свой командир. Компетентность в начале боя
    // задаётся в сценарии (иначе обычная); по ходу боя её меняет ГМ (setFormation / editElement).
    const startCmd = defaultCommandLevel(rs);
    const maxCmd = Math.max(1, rs.commandLevels.length);
    const cmd = (node: UnitNode) => {
      if (!node.commandLevel) return 0;
      const set = sd.commanders?.[node.id];
      return set ? clamp(Math.round(set), 1, maxCmd) : startCmd;
    };
    /**
     * Узел с подчинёнными (и любой корень) становится формированием — звеном управления.
     * Узел с собственным составом становится элементом — тем, что стреляет и несёт потери.
     */
    const addNode = (node: UnitNode, parentF: FormationState | null, parentRes: Resolved) => {
      const res = resolveChild(node, parentRes);
      const order = res.order && orderIds.has(res.order) ? res.order : (parentF?.orderId ?? defaultOrder);
      const isGroup = node.children.length > 0 || !parentF;
      let f = parentF!;
      if (isGroup) {
        f = {
          id: `f${++fCount}`,
          defId: node.id,
          name: node.name,
          level: node.level,
          side: sd.id,
          parentId: parentF?.id ?? null,
          commanderName: node.commanderName,
          commandLevel: cmd(node),
          comms: clamp(res.comms, 0, 100),
          supply: clamp(res.supply, 0, 100),
          orderId: order,
          hqLost: false,
          broken: false,
        };
        b.formations.push(f);
      }
      if (node.composition.length) {
        const own = isGroup && node.children.length > 0;
        const el = makeElement(node, own ? `${node.name} (${node.isHQ ? 'управление' : 'свой состав'})` : node.name, f, `e${++eCount}`, rs, typeIds, res, order, warnings);
        if (!own) {
          // Свой командир, связь и снабжение у подразделения без подчинённых.
          el.ownCommandLevel = cmd(node);
          el.ownCommanderName = node.commanderName;
          el.comms = node.comms;
          el.supply = node.supply;
        }
        b.elements.push(el);
      } else if (!node.children.length) {
        warnings.push(`подразделение «${node.name}» без состава и подчинённых — в бою не участвует.`);
      }
      for (const ch of node.children) addNode(ch, f, res);
    };
    for (const f of sd.formations) addNode(migrateUnit(f), null, ROOT_RESOLVED);
  }

  let E = new EngineContext(b);
  for (const el of b.elements) {
    el.startValue = E.value(el);
    el.startPersonnel = E.personnel(el);
    el.authorizedPersonnel = el.comps.reduce((a, c) => a + c.authorized * E.type(c.typeId).crew, 0);
  }
  const empty = b.elements.filter((x) => x.startValue <= 0);
  if (empty.length) {
    for (const x of empty) warnings.push(`подразделение «${x.name}» не имеет боевого состава и в бою не участвует.`);
    b.elements = b.elements.filter((x) => x.startValue > 0);
    E = new EngineContext(b);
  }
  for (const side of SIDES) {
    if (!b.sides[side].objectives.length) b.sides[side].objectives = defaultObjectives(E, side, sc.maxTurns);
  }
  // План боя: подкрепления до подхода вне боя; ход события с разбросом выпадает сразу.
  for (const ev of sc.events ?? []) {
    if (ev.kind === 'arrive' && ev.side && ev.nodeId) for (const el of elementsOfNode(b, ev.side, ev.nodeId)) el.status = 'pending';
    if (ev.spread && ev.spread > 0) {
      const off = Math.floor(E.rng.next() * (2 * ev.spread + 1)) - ev.spread;
      (b.eventTurns ??= {})[ev.id] = Math.max(1, ev.turn + off);
    }
  }

  // Вводная запись журнала
  const condText = rs.conditions
    .map((cat) => `${cat.name.toLowerCase()}: ${cat.options.find((o) => o.id === b.conditions[cat.id])?.name ?? '—'}`)
    .join(', ');
  E.log({ phase: 'setup', level: 0, text: `Бой «${b.name}». Условия — ${condText}. Начальная дистанция: ${E.band?.name ?? '—'}.` });
  for (const side of SIDES) {
    const els = E.sideElements(side);
    const pers = els.reduce((a, x) => a + x.startPersonnel, 0);
    const fort = rs.fortifications.find((x) => x.id === b.sides[side].fortification)?.name ?? '—';
    const intel = rs.intelLevels.find((x) => x.id === b.sides[side].intel)?.name ?? '—';
    E.log({
      phase: 'setup',
      level: 0,
      side,
      text: `${s(side)}: ${els.length} ${plural(els.length, 'элемент', 'элемента', 'элементов')}, ${pers} чел. Укрепления: ${fort}. Разведданные: ${intel}.`,
    });
    const later = els.filter((x) => x.status === 'pending');
    if (later.length)
      E.log({ phase: 'setup', level: 0, side, text: `${s(side)}: из них подойдут позже (подкрепления) — ${later.length} ${plural(later.length, 'элемент', 'элемента', 'элементов')}, ${later.reduce((a, x) => a + x.startPersonnel, 0)} чел.` });
  }
  if (sc.events?.length) E.log({ phase: 'setup', level: 0, text: `План боя: ${sc.events.length} ${plural(sc.events.length, 'событие', 'события', 'событий')} по ходам.` });
  for (const w of warnings) E.log({ phase: 'setup', level: 0, severity: 'bad', text: `Внимание: ${w}` });
  if (!b.elements.some((x) => x.side === 'A') || !b.elements.some((x) => x.side === 'B')) {
    E.log({ phase: 'setup', level: 0, severity: 'critical', text: 'У одной из сторон нет сил — бой невозможен.' });
  }
  snapshot(E);
  E.commit();
  return b;
}

function makeElement(
  d: UnitNode,
  name: string,
  f: FormationState,
  id: Id,
  rs: Ruleset,
  typeIds: Set<Id>,
  res: Resolved,
  orderId: Id,
  warnings: string[],
): ElementState {
  const comps: CompState[] = [];
  for (const c of d.composition) {
    if (!typeIds.has(c.typeId)) {
      warnings.push(`у подразделения «${d.name}» тип «${c.typeId}» отсутствует в наборе правил и не учитывается.`);
      continue;
    }
    const cur = Math.max(0, Math.floor(c.current));
    comps.push({ typeId: c.typeId, authorized: Math.max(cur, Math.floor(c.authorized)), start: cur, current: cur, destroyed: 0, damaged: 0, abandoned: 0, kia: 0, wia: 0, mia: 0 });
  }
  const maxExp = Math.max(1, rs.experienceLevels.length);
  const st = res.state;
  return {
    id,
    defId: d.id,
    name,
    level: d.level,
    side: f.side,
    formationId: f.id,
    echelon: res.echelon ?? 'front',
    orderId,
    holdFast: !!d.holdFast,
    isHQ: !!d.isHQ,
    ownTags: [...(d.tags ?? [])],
    comps,
    experience: clamp(Math.round(st.experience || 1), 1, maxExp),
    morale: clamp(st.morale, 0, 100),
    cohesion: clamp(st.cohesion, 0, 100),
    readiness: clamp(st.readiness, 0, 100),
    ammo: clamp(st.ammo, 0, 100),
    fuel: clamp(st.fuel, 0, 100),
    equipment: clamp(st.equipment, 0, 100),
    fatigue: clamp(st.fatigue, 0, 100),
    vehicleCondition: clamp(st.vehicleCondition, 0, 100),
    attackMod: Math.max(0, d.attackMod ?? 100),
    defenseMod: Math.max(1, d.defenseMod ?? 100),
    suppression: 0,
    status: 'active',
    exitTurns: 0,
    digInTurns: 0,
    spotted: false,
    spottedLastTurn: false,
    everSpotted: false,
    firedThisTurn: false,
    firedLastTurn: false,
    underFireThisTurn: false,
    ambushUsed: false,
    startValue: 0,
    startPersonnel: 0,
    authorizedPersonnel: 0,
    scattered: 0,
    turnValueLost: 0,
    turnPersonnelLost: 0,
    startMorale: clamp(st.morale, 0, 100),
    ownCommandLevel: 0,
    comms: null,
    supply: null,
  };
}

// ================================================================== ход

export function stepTurn(b: Battle): void {
  if (b.finished) return;
  if (!b.elements.some((x) => x.side === 'A') || !b.elements.some((x) => x.side === 'B')) {
    const E = new EngineContext(b);
    finish(E, 'У одной из сторон нет сил');
    return;
  }
  b.turn++;
  const E = new EngineContext(b);
  for (const el of b.elements) {
    el.firedLastTurn = el.firedThisTurn;
    el.firedThisTurn = false;
    el.spottedLastTurn = el.spotted;
    el.underFireThisTurn = false;
    el.turnValueLost = 0;
    el.turnPersonnelLost = 0;
  }
  const t0 = (b.turn - 1) * b.ruleset.turnMinutes;
  E.log({ phase: 'turn', level: 0, text: `Ход ${b.turn} · ${fmtTime(t0)} · ${E.band?.name ?? '—'}` });

  phaseEvents(E);
  phaseDetection(E);
  const ini = phaseInitiative(E);
  phaseFire(E, ini);
  phaseMovement(E);
  phaseSupply(E);
  phaseFatigue(E);
  phaseMorale(E);
  phaseChecks(E);
  snapshot(E);
  checkEnd(E);
  E.commit();
  b.updatedAt = new Date().toISOString();
}

/** Элементы узла стороны: самого подразделения и всех его подчинённых. */
export function elementsOfNode(b: Battle, side: SideId, nodeId: Id): ElementState[] {
  const f = b.formations.find((x) => x.side === side && x.defId === nodeId);
  if (!f) return b.elements.filter((x) => x.side === side && x.defId === nodeId);
  const ids = new Set([f.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
  }
  return b.elements.filter((x) => ids.has(x.formationId));
}

/** Ход, на который по плану подходит не подошедшее ещё подкрепление (null — не по плану). */
export function arrivalTurn(b: Battle, el: ElementState): number | null {
  for (const ev of b.scenario.events ?? [])
    if (ev.kind === 'arrive' && ev.side === el.side && ev.nodeId && elementsOfNode(b, el.side, ev.nodeId).includes(el)) return b.eventTurns?.[ev.id] ?? ev.turn;
  return null;
}

/** План боя: события сценария, выпавшие на этот ход (до обнаружения и огня). */
function phaseEvents(E: EngineContext) {
  const { b, rng } = E;
  for (const ev of b.scenario.events ?? []) {
    if ((b.eventTurns?.[ev.id] ?? ev.turn) !== b.turn) continue;
    const chance = ev.chance ?? 100;
    const happens = chance >= 100 || rng.chance(Math.max(0, chance) / 100);
    const note = ev.note ? ` (${ev.note})` : '';
    const side = ev.side;
    const els = side && ev.nodeId ? elementsOfNode(b, side, ev.nodeId) : [];
    const who = () => {
      const f = b.formations.find((x) => x.side === side && x.defId === ev.nodeId);
      return f ? fm(f) : els.length ? e(els[0]) : '?';
    };
    if (ev.kind === 'arrive') {
      const late = els.filter((x) => x.status === 'pending');
      if (!late.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 0, side, severity: 'bad', refs: late.map((x) => x.id), text: `${who()}: подкрепление не подошло${note}.` });
        continue;
      }
      for (const el of late) el.status = 'active';
      E.invalidate();
      const pers = late.reduce((a, x) => a + E.personnel(x), 0);
      E.log({ phase: 'plan', level: 0, side, severity: 'good', refs: late.map((x) => x.id), text: `Подходят подкрепления: ${who()} — ${pers} чел.${note}` });
    } else if (ev.kind === 'order') {
      const order = E.orders.get(ev.orderId ?? '');
      const act = els.filter((x) => x.status === 'active' || x.status === 'pending');
      if (!order || !act.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, side, text: `По плану ${who()} должно было получить приказ «${order.name}», но этого не произошло${note}.` });
        continue;
      }
      for (const el of act) {
        el.orderId = order.id;
        if (order.behavior !== 'retreat' && order.behavior !== 'rout') el.exitTurns = 0;
        E.invalidate(el);
      }
      E.log({ phase: 'plan', level: 0, side, refs: act.map((x) => x.id), text: `По плану: ${who()} — приказ «${order.name}»${note}.` });
    } else if (ev.kind === 'conditions') {
      const changes: string[] = [];
      for (const [cat, opt] of Object.entries(ev.conditions ?? {})) {
        const c = b.ruleset.conditions.find((x) => x.id === cat);
        const o = c?.options.find((x) => x.id === opt);
        if (!c || !o || b.conditions[cat] === opt) continue;
        changes.push(`${c.name.toLowerCase()}: ${o.name}`);
        if (happens) b.conditions[cat] = opt;
      }
      if (!changes.length) continue;
      if (!happens) {
        E.log({ phase: 'plan', level: 1, text: `По плану ожидалось — ${changes.join(', ')}, но не случилось${note}.` });
        continue;
      }
      E.refreshConditions();
      E.invalidate();
      E.log({ phase: 'plan', level: 0, text: `Обстановка меняется — ${changes.join(', ')}${note}.` });
    }
  }
}

export function runToEnd(b: Battle, maxSteps = 1000): void {
  let n = 0;
  while (!b.finished && n++ < maxSteps) stepTurn(b);
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

// ------------------------------------------------------------------ обнаружение

function echelonConceal(E: EngineContext, el: ElementState): number {
  if (el.echelon === 'support') return E.k.concealSupport;
  if (el.echelon === 'rear') return E.k.concealRear;
  return 1;
}

function phaseDetection(E: EngineContext) {
  const { b, k } = E;
  if (!E.f.detection) {
    for (const el of b.elements) {
      el.spotted = el.status === 'active';
      if (el.spotted) el.everSpotted = true;
    }
    return;
  }
  const base = E.band?.detection ?? 0.5;
  for (const side of SIDES) {
    const observers = E.sideElements(side).filter((o) => o.status === 'active' && E.behavior(o) !== 'reserve' && E.behavior(o) !== 'rout');
    for (const t of E.sideElements(E.enemyOf(side))) {
      if (t.status !== 'active') {
        t.spotted = false;
        continue;
      }
      const conceal = Math.max(0.05, E.mult(t, 'concealment') * echelonConceal(E, t) / (t.firedLastTurn ? k.firingReveal : 1));
      const scores: { p: number; w: number; o: ElementState }[] = [];
      for (const o of observers) {
        const det = E.mult(o, 'detection', { enemy: t });
        const p = clamp(base * det / conceal + (t.spottedLastTurn ? k.spottedPersistence : 0), k.detectMin, k.detectMax);
        const w = E.isRecon(o) ? k.reconObserverWeight : k.observerWeight;
        scores.push({ p, w, o });
      }
      scores.sort((x, y) => y.p * y.w - x.p * x.w);
      let miss = 1;
      for (const sc of scores.slice(0, 3)) miss *= 1 - clamp(sc.p * sc.w, 0, 1);
      const chance = scores.length ? clamp(1 - miss, 0, k.detectMax) : 0;
      const was = t.spotted;
      t.spotted = E.rng.chance(chance);
      if (t.spotted) t.everSpotted = true;
      if (E.logging) {
        const best = scores[0];
        const factors: Factor[] = [{ label: `Дистанция «${E.band?.name}»`, value: base, kind: 'base' }];
        if (best) {
          const f: Factor[] = [];
          E.mult(best.o, 'detection', { enemy: t }, f);
          factors.push({ label: `Лучший наблюдатель: ${best.o.name}`, value: best.p, kind: 'chance' }, ...f);
        }
        const cf: Factor[] = [];
        E.mult(t, 'concealment', {}, cf);
        for (const x of cf) factors.push({ ...x, label: `Скрытность цели — ${x.label}` });
        if (t.echelon !== 'front') factors.push({ label: `Скрытность цели — эшелон`, value: echelonConceal(E, t), kind: 'mult' });
        if (t.firedLastTurn) factors.push({ label: 'Цель стреляла в прошлом ходу', value: k.firingReveal, kind: 'mult' });
        if (t.spottedLastTurn) factors.push({ label: 'Цель была обнаружена ранее', value: k.spottedPersistence, kind: 'add' });
        factors.push({ label: 'Итоговый шанс (до 3 наблюдателей)', value: chance, kind: 'chance' });
        E.log({
          phase: 'detection',
          level: 2,
          side,
          severity: t.spotted ? 'good' : 'info',
          refs: [t.id],
          text: t.spotted
            ? `${s(side)}: ${was ? 'наблюдение продолжается' : 'обнаружен противник'} — ${e(t)} (шанс ${Math.round(chance * 100)}%).`
            : `${s(side)}: ${was ? 'контакт потерян' : 'противник не обнаружен'} — ${e(t)} (шанс ${Math.round(chance * 100)}%).`,
          factors,
        });
      }
    }
  }
}

// ------------------------------------------------------------------ инициатива

interface Initiative {
  first: SideId;
  sequential: boolean;
  bonusSide: SideId | null;
}

function phaseInitiative(E: EngineContext): Initiative {
  const { b, k } = E;
  if (!E.f.initiative) {
    for (const side of SIDES) b.sides[side].initiative = 0;
    return { first: 'A', sequential: false, bonusSide: null };
  }
  const scores: Record<SideId, number> = { A: 0, B: 0 };
  const breakdown: Record<SideId, Factor[]> = { A: [], B: [] };
  for (const side of SIDES) {
    const els = E.sideElements(side).filter((x) => E.engaged(x));
    if (!els.length) {
      scores[side] = 0;
      continue;
    }
    let wsum = 0;
    let msum = 0;
    let csum = 0;
    for (const el of els) {
      const w = Math.max(0.1, E.value(el));
      wsum += w;
      msum += w * E.mult(el, 'initiative');
      csum += w * E.comms(el);
    }
    const m = msum / wsum;
    const comms = E.f.comms ? lerp(k.commsInitiativeMin, 1, csum / wsum) : 1;
    const rnd = E.rng.range(0, k.initiativeRandom);
    scores[side] = 50 * m * comms + rnd;
    if (E.logging) {
      const f: Factor[] = [{ label: 'База', value: 50, kind: 'base' }];
      const ref = els.reduce((a, x) => (E.value(x) > E.value(a) ? x : a), els[0]);
      const detail: Factor[] = [];
      E.mult(ref, 'initiative', {}, detail);
      f.push({ label: 'Средний множитель (опыт, командиры, условия, разведданные)', value: m, kind: 'mult' });
      for (const d of detail) f.push({ ...d, label: `  в т.ч. ${d.label}` });
      if (E.f.comms) f.push({ label: `Связь ${Math.round((csum / wsum) * 100)}%`, value: comms, kind: 'mult' });
      f.push({ label: 'Случайность', value: round1(rnd), kind: 'add' });
      breakdown[side] = f;
    }
  }
  let first: SideId = scores.A >= scores.B ? 'A' : 'B';
  let reason = '';
  for (const side of SIDES) {
    const amb = E.sideElements(side).some((x) => E.engaged(x) && E.behavior(x) === 'ambush' && !x.ambushUsed && !x.spotted);
    const enemyAmb = E.sideElements(E.enemyOf(side)).some((x) => E.engaged(x) && E.behavior(x) === 'ambush' && !x.ambushUsed && !x.spotted);
    if (amb && !enemyAmb) {
      first = side;
      reason = ' — необнаруженная засада открывает огонь первой';
    }
  }
  b.sides.A.initiative = Math.round(scores.A);
  b.sides.B.initiative = Math.round(scores.B);
  const sequential = k.initiativeSequential >= 0.5;
  // В обычном журнале инициатива видна, только когда переходит к другой стороне (или из-за засады).
  const prev = b.lastInitiative;
  b.lastInitiative = first;
  E.log({
    phase: 'initiative',
    level: !prev || prev !== first || reason ? 1 : 2,
    side: first,
    severity: 'info',
    text: `Инициатива: ${s(first)}${reason} (${Math.round(scores[first])} против ${Math.round(scores[E.enemyOf(first)])}). ${
      sequential ? 'Первый огонь — за ними.' : `Их огонь ×${k.initiativeBonus}.`
    }`,
    factors: [...breakdown[first].map((x) => ({ ...x, label: `${b.sides[first].name}: ${x.label}` })), ...breakdown[E.enemyOf(first)].map((x) => ({ ...x, label: `${b.sides[E.enemyOf(first)].name}: ${x.label}` }))],
  });
  return { first, sequential, bonusSide: sequential ? null : first };
}

// ------------------------------------------------------------------ огонь

interface Shot {
  shooter: ElementState;
  target: ElementState;
  cls: Id;
  fire: number;
  lethality: number;
  suppressive: number;
}

function phaseFire(E: EngineContext, ini: Initiative) {
  const second = E.enemyOf(ini.first);
  if (ini.sequential) {
    applyShots(E, computeFire(E, ini.first, 1));
    applyShots(E, computeFire(E, second, 1));
  } else {
    const a = computeFire(E, ini.first, ini.bonusSide === ini.first ? E.k.initiativeBonus : 1);
    const b2 = computeFire(E, second, 1);
    applyShots(E, a);
    applyShots(E, b2);
  }
}

/** Множитель огня стрелка (состояние элемента + модификаторы). */
export function shooterMult(E: EngineContext, el: ElementState, out?: Factor[]): number {
  const { k, f } = E;
  let m = E.mult(el, 'fire', {}, out);
  const add = (label: string, v: number) => {
    if (Math.abs(v - 1) < 1e-9) return;
    m *= v;
    out?.push({ label, value: v, kind: 'mult' });
  };
  add(`Атака элемента ${el.attackMod}%`, el.attackMod / 100);
  if (f.cohesion) add(`Слаженность ${Math.round(el.cohesion)}%`, lerp(k.cohesionFireMin, 1, el.cohesion / 100));
  if (f.readiness) add(`Готовность ${Math.round(el.readiness)}%`, lerp(k.readinessFireMin, 1, el.readiness / 100));
  if (f.morale) add(`Мораль ${Math.round(el.morale)}`, lerp(k.moraleFireMin, 1, el.morale / 100));
  if (f.equipment) add(`Снаряжение ${Math.round(el.equipment)}%`, lerp(k.equipmentFireMin, 1, el.equipment / 100));
  if (f.fatigue) add(`Усталость ${Math.round(el.fatigue)}%`, 1 - (el.fatigue / 100) * k.fatigueFirePenalty);
  if (f.suppression) add(`Подавление ${Math.round(el.suppression)}%`, 1 - (el.suppression / 100) * k.suppressionFirePenalty);
  if (f.ammo) add(`Боезапас ${Math.round(el.ammo)}%`, el.ammo >= k.lowAmmoThreshold ? 1 : lerp(k.noAmmoFire, 1, el.ammo / Math.max(1, k.lowAmmoThreshold)));
  if (f.comms) add(`Связь ${Math.round(E.comms(el) * 100)}%`, lerp(k.commsFireMin, 1, E.comms(el)));
  return Math.max(0, m);
}

function exposureOf(E: EngineContext, t: ElementState, indirect: boolean): number {
  const k = E.k;
  let ex: number;
  if (indirect) ex = t.echelon === 'front' ? 1 : t.echelon === 'support' ? k.indirectExposureSupport : k.indirectExposureRear;
  else ex = t.echelon === 'front' ? k.exposureFront : t.echelon === 'support' ? k.exposureSupport : k.exposureRear;
  return ex * E.order(t).exposure;
}

function computeFire(E: EngineContext, side: SideId, bonus: number): Shot[] {
  const { k } = E;
  const band = E.band?.id;
  if (!band) return [];
  const shots: Shot[] = [];
  const targets = E.sideElements(E.enemyOf(side)).filter((t) => t.status === 'active' && E.order(t).exposure > 0 && E.size(t) > 0);
  if (!targets.length) return shots;
  const shooters = E.sideElements(side).filter((x) => E.engaged(x));
  // Присутствие классов целей в каждом элементе противника (вес при выборе цели)
  const presenceOf = new Map<Id, Map<Id, number>>();
  for (const t of targets) {
    const presence = new Map<Id, number>();
    for (const c of t.comps) {
      if (c.current <= 0) continue;
      const tt = E.type(c.typeId);
      presence.set(tt.targetClass, (presence.get(tt.targetClass) ?? 0) + c.current * Math.max(0.1, tt.value));
    }
    presenceOf.set(t.id, presence);
  }
  const maxFpOf = new Map<Id, number>();
  for (const t of E.rs.componentTypes) {
    let m = 0;
    for (const cls of E.rs.targetClasses) m = Math.max(m, t.firepower[cls.id]?.[band] ?? 0);
    maxFpOf.set(t.id, m);
  }

  for (const sh of shooters) {
    const factors: Factor[] | undefined = E.logging ? [] : undefined;
    let sm = shooterMult(E, sh, factors) * bonus;
    if (bonus !== 1) factors?.push({ label: 'Инициатива', value: bonus, kind: 'mult' });
    if (sm <= 0) continue;
    let ambush = false;
    if (E.behavior(sh) === 'ambush' && !sh.ambushUsed && !sh.spotted) {
      sm *= k.ambushFirstVolley;
      ambush = true;
      factors?.push({ label: 'Первый залп из засады', value: k.ambushFirstVolley, kind: 'mult' });
    }
    const rnd = Math.max(0, 1 + k.randomSpread * (E.rng.next() + E.rng.next() - 1));
    factors?.push({ label: 'Случайность', value: rnd, kind: 'mult' });
    sm *= rnd;

    const allocation = new Map<Id, number>();
    let firedAny = false;
    let ammoNum = 0;
    let ammoDen = 0;
    for (const indirect of [false, true]) {
      const comps = sh.comps.filter((c) => c.current > 0 && E.type(c.typeId).indirect === indirect);
      if (!comps.length) continue;
      // Огневая мощь пула по классам целей
      const raw = new Map<Id, number>();
      const supp = new Map<Id, number>();
      for (const c of comps) {
        const t = E.type(c.typeId);
        let cf = 1;
        if (t.kind === 'vehicle' && E.f.vehicleCondition) cf *= lerp(k.vehicleConditionFireMin, 1, sh.vehicleCondition / 100);
        if (!indirect) cf *= sh.echelon === 'support' ? k.fireSupport : sh.echelon === 'rear' ? k.fireRear : 1;
        for (const cls of E.rs.targetClasses) {
          const v = (t.firepower[cls.id]?.[band] ?? 0) * c.current * cf;
          if (v > 0) {
            raw.set(cls.id, (raw.get(cls.id) ?? 0) + v);
            supp.set(cls.id, (supp.get(cls.id) ?? 0) + v * t.suppressive);
          }
        }
        const maxFp = maxFpOf.get(t.id) ?? 0;
        ammoNum += c.current * maxFp * t.ammoUse;
        ammoDen += c.current * maxFp;
      }
      if (!raw.size) continue;
      // Распределение огня по целям
      const cands: { t: ElementState; cls: Id; w: number; vis: number; pursuit: number }[] = [];
      for (const t of targets) {
        const ex = exposureOf(E, t, indirect);
        if (ex <= 0) continue;
        const vis = !E.f.detection || t.spotted ? 1 : indirect ? k.indirectUnspottedMult : k.unspottedFireMult;
        const bh = E.behavior(t);
        const pursuit = bh === 'retreat' ? k.pursuitMult : bh === 'rout' ? k.routPursuitMult : 1;
        for (const [cls, pres] of presenceOf.get(t.id)!) {
          const r = raw.get(cls);
          if (!r) continue;
          cands.push({ t, cls, w: r * Math.sqrt(pres) * ex * vis * pursuit, vis, pursuit });
        }
      }
      const W = cands.reduce((a, c) => a + c.w, 0);
      if (W <= 0) continue;
      firedAny = true;
      for (const c of cands) {
        const share = c.w / W;
        const r = raw.get(c.cls)!;
        const ctxFire = E.contextual(sh, 'fire', { enemy: c.t, targetClass: c.cls });
        const fire = r * share * c.vis * c.pursuit * sm * ctxFire;
        if (fire <= 0) continue;
        const cls = E.classes.get(c.cls);
        const leth = (cls?.lethality ?? 1) * E.mult(sh, 'lethality', { enemy: c.t, targetClass: c.cls }) * k.casualtyScale;
        shots.push({ shooter: sh, target: c.t, cls: c.cls, fire, lethality: leth, suppressive: (supp.get(c.cls) ?? r) / r });
        allocation.set(c.t.id, (allocation.get(c.t.id) ?? 0) + fire);
      }
    }
    if (!firedAny) continue;
    sh.firedThisTurn = true;
    if (ambush) sh.ambushUsed = true;
    if (E.f.ammo && ammoDen > 0) {
      const use = (ammoNum / ammoDen) * E.mult(sh, 'ammoUse') * (E.f.suppression ? 1 - (sh.suppression / 100) * 0.5 : 1);
      sh.ammo = Math.max(0, sh.ammo - use);
    }
    if (E.logging) {
      const total = [...allocation.values()].reduce((a, x) => a + x, 0);
      const list = [...allocation.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([id, v]) => `${e(id)} ${Math.round((v / total) * 100)}%`)
        .join(', ');
      E.log({
        phase: 'fire',
        level: 2,
        side,
        refs: [sh.id, ...allocation.keys()],
        text: `${e(sh)} ведёт ${ambush ? 'огонь из засады' : 'огонь'} по: ${list}. Эффективность ×${(sm / bonus / rnd).toFixed(2)}.`,
        factors,
      });
    }
  }
  return shots;
}

function protectionMult(E: EngineContext, t: ElementState, cls: Id, shooter: ElementState | undefined, out?: Factor[]): number {
  let m = E.mult(t, 'protection', { enemy: shooter, targetClass: cls }, out);
  const add = (label: string, v: number) => {
    if (Math.abs(v - 1) < 1e-9) return;
    m *= v;
    out?.push({ label, value: v, kind: 'mult' });
  };
  add(`Защита элемента ${t.defenseMod}%`, t.defenseMod / 100);
  if (t.digInTurns > 0) add(`Закрепление (${t.digInTurns} ход.)`, 1 + Math.min(E.k.digInMax, t.digInTurns * E.k.digInPerTurn));
  return Math.max(0.05, m);
}

function applyShots(E: EngineContext, shots: Shot[]) {
  const { k, rng } = E;
  const byTarget = new Map<Id, Shot[]>();
  for (const sh of shots) {
    const list = byTarget.get(sh.target.id) ?? [];
    list.push(sh);
    byTarget.set(sh.target.id, list);
  }
  for (const [, list] of byTarget) {
    const t = list[0].target;
    const routing = E.behavior(t) === 'rout';
    const perClass = new Map<Id, { hits: number; supp: number }>();
    const shooters = new Set<Id>();
    for (const sh of list) {
      const eff = sh.fire / protectionMult(E, t, sh.cls, sh.shooter);
      const pc = perClass.get(sh.cls) ?? { hits: 0, supp: 0 };
      pc.hits += eff * sh.lethality;
      pc.supp += eff * sh.suppressive;
      perClass.set(sh.cls, pc);
      shooters.add(sh.shooter.id);
    }
    t.underFireThisTurn = true;
    const sizeBefore = E.size(t);
    const loss = { pers: 0, kia: 0, wia: 0, mia: 0, value: 0, equip: new Map<Id, { destroyed: number; damaged: number; abandoned: number }>() };
    let suppIn = 0;
    for (const [cls, pc] of perClass) {
      suppIn += pc.supp;
      const comps = t.comps.filter((c) => c.current > 0 && E.type(c.typeId).targetClass === cls);
      const N = comps.reduce((a, c) => a + c.current, 0);
      if (N <= 0 || pc.hits <= 0) continue;
      for (const c of comps) {
        const tt = E.type(c.typeId);
        const p = 1 - Math.exp(-pc.hits / (N * Math.max(0.05, tt.protection)));
        const n = rng.binomial(c.current, p);
        if (n <= 0) continue;
        c.current -= n;
        loss.value += n * tt.value;
        if (tt.kind === 'personnel') {
          const [kk, ww, mm] = splitCasualties(E, n, routing);
          c.kia += kk;
          c.wia += ww;
          c.mia += mm;
          loss.pers += n;
          loss.kia += kk;
          loss.wia += ww;
          loss.mia += mm;
        } else {
          const destroyed = rng.binomial(n, k.vehicleDestroyedShare);
          let damaged = n - destroyed;
          let abandoned = 0;
          if (routing) {
            abandoned = damaged;
            damaged = 0;
          }
          c.destroyed += destroyed;
          c.damaged += damaged;
          c.abandoned += abandoned;
          const crewHit = rng.binomial(destroyed * tt.crew, k.crewLossDestroyed) + rng.binomial((damaged + abandoned) * tt.crew, k.crewLossDamaged);
          const [kk, ww, mm] = splitCasualties(E, crewHit, routing);
          c.kia += kk;
          c.wia += ww;
          c.mia += mm;
          loss.pers += crewHit;
          loss.kia += kk;
          loss.wia += ww;
          loss.mia += mm;
          const q = loss.equip.get(c.typeId) ?? { destroyed: 0, damaged: 0, abandoned: 0 };
          q.destroyed += destroyed;
          q.damaged += damaged;
          q.abandoned += abandoned;
          loss.equip.set(c.typeId, q);
        }
      }
    }
    t.turnValueLost += loss.value;
    t.turnPersonnelLost += loss.pers;
    if (loss.value > 0) E.invalidate(t);
    let suppGain = 0;
    const before = t.suppression;
    if (E.f.suppression) {
      const size = Math.max(1, sizeBefore);
      suppGain = Math.min(k.suppressionMaxPerTurn, (suppIn / size) * k.suppressionScale * E.mult(t, 'suppression'));
      t.suppression = clamp(t.suppression + suppGain, 0, 100);
    }
    if (E.logging) {
      const parts: string[] = [];
      if (loss.pers > 0) {
        const kinds = [loss.kia && `убито ${loss.kia}`, loss.wia && `ранено ${loss.wia}`, loss.mia && `пропало ${loss.mia}`].filter(Boolean).join(', ');
        parts.push(`${loss.pers} чел. (${kinds})`);
      }
      for (const [typeId, q] of loss.equip) {
        const sub: string[] = [];
        if (q.destroyed) sub.push(`уничтожено ${q.destroyed}`);
        if (q.damaged) sub.push(`повреждено ${q.damaged}`);
        if (q.abandoned) sub.push(`брошено ${q.abandoned}`);
        parts.push(`${E.type(typeId).name}: ${sub.join(', ')}`);
      }
      const factors: Factor[] = [];
      const mainCls = [...perClass.entries()].sort((a, b2) => b2[1].hits - a[1].hits)[0]?.[0];
      if (mainCls) {
        factors.push({ label: `Воздействие по классу «${E.classes.get(mainCls)?.name ?? mainCls}»`, value: round1(perClass.get(mainCls)!.hits * 100) / 100, kind: 'base' });
        const pf: Factor[] = [];
        protectionMult(E, t, mainCls, undefined, pf);
        for (const x of pf) factors.push({ ...x, label: `Защищённость — ${x.label}` });
      }
      if (E.f.suppression && suppGain > 0) factors.push({ label: `Подавление ${Math.round(before)} → ${Math.round(t.suppression)}%`, value: round1(suppGain), kind: 'add' });
      const who = [...shooters].map((id) => E.elements.get(id)?.name ?? id).join(', ');
      factors.unshift({ label: `Огонь вели: ${who}`, value: shooters.size, kind: 'base' });
      E.log({
        phase: 'losses',
        level: parts.length ? 1 : 2,
        side: t.side,
        severity: parts.length ? 'bad' : 'info',
        refs: [t.id, ...shooters],
        text: parts.length
          ? `${e(t)}: потери — ${parts.join('; ')}.`
          : `${e(t)} под огнём, потерь нет${E.f.suppression ? ` (подавление ${Math.round(t.suppression)}%)` : ''}.`,
        factors,
        data: parts.length
          ? { pers: loss.pers, kia: loss.kia, wia: loss.wia, mia: loss.mia, equip: Object.fromEntries([...loss.equip].map(([id, q]) => [id, q.destroyed + q.damaged + q.abandoned])) }
          : undefined,
      });
    }
  }
}

function splitCasualties(E: EngineContext, n: number, routing: boolean): [number, number, number] {
  if (n <= 0) return [0, 0, 0];
  const k = E.k;
  let ks = Math.max(0, k.killedShare);
  let ws = Math.max(0, k.woundedShare);
  let ms = Math.max(0, k.missingShare);
  if (routing) {
    const rest = Math.max(0, 1 - k.routMissingShare);
    const kw = ks + ws || 1;
    ks = (ks / kw) * rest;
    ws = (ws / kw) * rest;
    ms = k.routMissingShare;
  }
  const sum = ks + ws + ms || 1;
  ks /= sum;
  ws /= sum;
  ms /= sum;
  const kia = E.rng.binomial(n, ks);
  const wia = E.rng.binomial(n - kia, ws + ms > 0 ? ws / (ws + ms) : 0);
  return [kia, wia, n - kia - wia];
}

// ------------------------------------------------------------------ движение

function phaseMovement(E: EngineContext) {
  const { b, k, f } = E;
  const pressure: Record<SideId, number> = { A: 0, B: 0 };
  const moved = new Set<Id>();
  for (const side of SIDES) {
    const els = E.sideElements(side).filter((x) => E.engaged(x) && E.behavior(x) !== 'retreat' && E.behavior(x) !== 'rout');
    const total = els.reduce((a, x) => a + E.value(x), 0);
    if (total <= 0) continue;
    let push = 0;
    for (const el of els) {
      if (E.behavior(el) !== 'attack') continue;
      moved.add(el.id);
      let m = E.mult(el, 'movement');
      if (f.suppression) m *= 1 - (el.suppression / 100) * k.suppressionMovementPenalty;
      if (f.fuel && el.fuel <= 0) {
        const vv = el.comps.filter((c) => E.type(c.typeId).kind === 'vehicle').reduce((a, c) => a + c.current * E.type(c.typeId).value, 0);
        const share = vv / Math.max(1e-9, E.value(el));
        m *= 1 - share * (1 - k.noFuelMovement);
      }
      push += E.value(el) * m;
    }
    pressure[side] = push / total;
  }
  for (const el of b.elements) if (el.status === 'active' && (E.behavior(el) === 'retreat' || E.behavior(el) === 'rout')) moved.add(el.id);

  const lead: SideId = pressure.A >= pressure.B ? 'A' : 'B';
  const p = pressure[lead];
  const last = b.ruleset.rangeBands.length - 1;
  if (p >= k.attackPressureMin && b.bandIndex < last) {
    const band = E.band;
    b.closingProgress += p / Math.max(0.25, band.turnsToClose);
    if (b.closingProgress >= 1) {
      b.bandIndex++;
      b.closingProgress = 0;
      E.invalidate();
      E.log({
        phase: 'movement',
        level: 0,
        side: lead,
        severity: 'info',
        text: `${s(lead)}: продвижение — дистанция сократилась до «${E.band.name}».`,
        factors: [{ label: 'Натиск атакующих (доля сил с учётом подвижности и подавления)', value: round1(p * 100) / 100, kind: 'base' }],
      });
    } else {
      E.log({
        phase: 'movement',
        level: 2,
        side: lead,
        text: `${s(lead)}: продвижение (сближение ${Math.round(b.closingProgress * 100)}% до следующей дистанции).`,
        factors: [{ label: 'Натиск', value: round1(p * 100) / 100, kind: 'base' }],
      });
    }
  } else if (b.bandIndex < last && (pressure.A > 0 || pressure.B > 0)) {
    E.log({
      phase: 'movement',
      level: 1,
      side: lead,
      severity: 'bad',
      text: `${s(lead)}: натиска недостаточно для сближения (${Math.round(p * 100)}% при пороге ${Math.round(k.attackPressureMin * 100)}%).`,
    });
  }

  // Топливо и поломки
  for (const el of b.elements) {
    if (el.status !== 'active') continue;
    const vehicles = el.comps.filter((c) => c.current > 0 && E.type(c.typeId).kind === 'vehicle');
    if (!vehicles.length) continue;
    const isMoving = moved.has(el.id);
    if (f.fuel) {
      const use = vehicles.reduce((a, c) => a + c.current * E.type(c.typeId).fuelUse, 0) / vehicles.reduce((a, c) => a + c.current, 0);
      el.fuel = Math.max(0, el.fuel - use * (isMoving ? 1 : 0.2));
    }
    if (f.breakdowns && isMoving) {
      const terrain = Math.max(0.2, Math.min(1, E.mult(el, 'movement')));
      const cond = f.vehicleCondition ? el.vehicleCondition / 100 : 1;
      const pBreak = (k.breakdownBase * (1 + 4 * (1 - cond))) / terrain;
      for (const c of vehicles) {
        const n = E.rng.binomial(c.current, pBreak);
        if (n > 0) {
          c.current -= n;
          c.damaged += n;
          E.invalidate(el);
          E.log({ phase: 'movement', level: 1, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)}: поломка на марше — ${E.type(c.typeId).name} ×${n}.`, factors: [{ label: 'Шанс поломки на машину', value: pBreak, kind: 'chance' }] });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ снабжение и усталость

function phaseSupply(E: EngineContext) {
  const { k, f } = E;
  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const sup = E.supply(el);
    const inContact = el.firedThisTurn || el.underFireThisTurn;
    const m = inContact ? k.resupplyInContact : 1;
    if (f.ammo) el.ammo = clamp(el.ammo + k.resupplyAmmo * sup * m, 0, 100);
    if (f.fuel) el.fuel = clamp(el.fuel + k.resupplyFuel * sup * m, 0, 100);
    if (f.equipment && inContact) el.equipment = clamp(el.equipment - k.equipmentWear, 0, 100);
    const bh = E.behavior(el);
    if (bh === 'consolidate') el.digInTurns++;
    else if (bh === 'attack' || bh === 'retreat' || bh === 'rout') el.digInTurns = 0;
  }
}

function phaseFatigue(E: EngineContext) {
  const { k, f } = E;
  if (!f.fatigue) return;
  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const bh = E.behavior(el);
    let gain = k.fatiguePerTurn * E.mult(el, 'fatigue') * (1 + (f.suppression ? (el.suppression / 100) * k.fatigueSuppressionFactor : 0));
    if (bh === 'reserve' || bh === 'consolidate') gain -= k.fatigueRecovery * E.mult(el, 'recovery');
    const before = el.fatigue;
    el.fatigue = clamp(el.fatigue + gain, 0, 100);
    if (Math.abs(el.fatigue - before) >= 0.5) {
      const ff: Factor[] = [{ label: 'База за ход', value: k.fatiguePerTurn, kind: 'base' }];
      if (E.logging) E.mult(el, 'fatigue', {}, ff);
      E.log({ phase: 'fatigue', level: 2, side: el.side, refs: [el.id], text: `${e(el)}: усталость ${Math.round(before)} → ${Math.round(el.fatigue)}%.`, factors: ff });
    }
  }
}

// ------------------------------------------------------------------ мораль

function phaseMorale(E: EngineContext) {
  const { k, f } = E;
  const sideLoss: Record<SideId, number> = { A: 0, B: 0 };
  const sideValue: Record<SideId, number> = { A: 0, B: 0 };
  for (const el of E.b.elements) {
    if (el.status === 'pending') continue;
    sideLoss[el.side] += el.turnValueLost;
    sideValue[el.side] += el.startValue;
  }
  const lossRate = (side: SideId) => sideLoss[side] / Math.max(1e-9, sideValue[side]);

  for (const el of E.b.elements) {
    if (el.status !== 'active') continue;
    const lossPct = (el.turnValueLost / Math.max(1e-9, el.startValue)) * 100;
    const persPct = (el.turnPersonnelLost / Math.max(1, el.startPersonnel)) * 100;
    if (f.morale) {
      const factors: Factor[] = [];
      let neg = 0;
      const addNeg = (label: string, v: number) => {
        if (v <= 0) return;
        neg += v;
        factors.push({ label, value: -round1(v), kind: 'add' });
      };
      const w = clamp(k.moraleValueWeight, 0, 1);
      const moraleLossPct = persPct * (1 - w) + lossPct * w;
      addNeg(`Потери за ход: люди ${persPct.toFixed(1)}%, боевая ценность ${lossPct.toFixed(1)}%`, moraleLossPct * k.moralePerLossPct);
      if (f.suppression) addNeg(`Подавление ${Math.round(el.suppression)}%`, el.suppression * k.moraleSuppression);
      if (f.fatigue && el.fatigue > k.moraleFatigueThreshold) addNeg(`Изнурение (усталость ${Math.round(el.fatigue)}%)`, k.moraleHighFatigue);
      if (f.ammo && el.ammo <= 0) addNeg('Нет боезапаса', k.moraleNoAmmo);
      let negMult = 1;
      if (neg > 0) {
        const mf: Factor[] | undefined = E.logging ? [] : undefined;
        negMult = E.mult(el, 'moraleLoss', {}, mf);
        if (mf) for (const x of mf) factors.push({ ...x, label: `Потери морали — ${x.label}` });
        if (f.cohesion) {
          const cm = lerp(k.moraleLowCohesionMult, 1, el.cohesion / 100);
          if (Math.abs(cm - 1) > 1e-6) {
            negMult *= cm;
            factors.push({ label: `Потери морали — слаженность ${Math.round(el.cohesion)}%`, value: cm, kind: 'mult' });
          }
        }
      }
      let pos = 0;
      if (!el.underFireThisTurn && el.morale < el.startMorale) {
        const r = Math.min(el.startMorale - el.morale, k.moraleRecovery * E.mult(el, 'recovery'));
        if (r > 0) {
          pos += r;
          factors.push({ label: 'Передышка (не под огнём)', value: round1(r), kind: 'add' });
        }
      }
      const enemy = E.enemyOf(el.side);
      if (el.firedThisTurn && lossRate(enemy) > 0 && lossRate(enemy) > lossRate(el.side) * 1.5) {
        pos += k.moraleSuccess;
        factors.push({ label: 'Противник несёт большие потери', value: k.moraleSuccess, kind: 'add' });
      }
      let negTotal = neg * negMult;
      if (k.moraleMaxLossPerTurn > 0 && negTotal > k.moraleMaxLossPerTurn) {
        factors.push({ label: `Ограничение потерь морали за ход`, value: k.moraleMaxLossPerTurn, kind: 'base' });
        negTotal = k.moraleMaxLossPerTurn;
      }
      const delta = -negTotal + pos;
      const before = el.morale;
      el.morale = clamp(el.morale + delta, 0, 100);
      if (Math.abs(delta) >= 0.5) {
        E.log({
          phase: 'morale',
          level: Math.abs(delta) >= 5 ? 1 : 2,
          side: el.side,
          severity: delta < 0 ? 'bad' : 'good',
          refs: [el.id],
          text: `Мораль ${e(el)}: ${Math.round(before)} → ${Math.round(el.morale)} (${delta > 0 ? '+' : ''}${delta.toFixed(1)}).`,
          factors,
          data: { morale: [Math.round(before), Math.round(el.morale)] },
        });
      }
    }
    if (f.cohesion) {
      let d = -lossPct * k.cohesionPerLossPct;
      if (f.comms && E.comms(el) < 0.5) d -= k.cohesionLowComms;
      const bh = E.behavior(el);
      if (bh === 'reserve' || bh === 'consolidate') d += k.cohesionRecovery * E.mult(el, 'recovery');
      const before = el.cohesion;
      el.cohesion = clamp(el.cohesion + d, 0, 100);
      if (Math.abs(d) >= 1) E.log({ phase: 'morale', level: 2, side: el.side, refs: [el.id], text: `Слаженность ${e(el)}: ${Math.round(before)} → ${Math.round(el.cohesion)}%.` });
    }
    if (f.suppression && el.suppression > 0) {
      el.suppression = Math.max(0, el.suppression - k.suppressionRecovery * E.mult(el, 'recovery'));
    }
  }
}

// ------------------------------------------------------------------ проверки конца хода

function setOrderByBehavior(E: EngineContext, el: ElementState, behavior: Behavior) {
  const o = E.rs.orders.find((x) => x.behavior === behavior);
  if (o) el.orderId = o.id;
  el.exitTurns = 0;
  E.invalidate(el);
}

function subtreeIds(E: EngineContext, fid: Id): Set<Id> {
  const ids = new Set<Id>([fid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of E.b.formations) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
      ids.add(f.id);
      grew = true;
    }
  }
  return ids;
}

function destroyElement(E: EngineContext, el: ElementState) {
  const left = E.personnel(el);
  el.status = 'destroyed';
  for (const c of el.comps) {
    const t = E.type(c.typeId);
    if (t.kind !== 'personnel') {
      c.abandoned += c.current;
      c.current = 0;
    }
  }
  if (E.k.scatteredAsMissing >= 0.5) {
    for (const c of el.comps) {
      const t = E.type(c.typeId);
      if (t.kind === 'personnel') {
        c.mia += c.current;
        c.current = 0;
      } else {
        const alive = c.start * t.crew - c.kia - c.wia - c.mia;
        c.mia += Math.max(0, alive);
      }
    }
  } else {
    for (const c of el.comps) if (E.type(c.typeId).kind === 'personnel') c.current = 0;
    el.scattered = left;
  }
  E.invalidate(el);
  return left;
}

function phaseChecks(E: EngineContext) {
  const { b, k, f, rng } = E;
  const shocks: { kind: 'rout' | 'hq' | 'break'; el?: ElementState; formation: FormationState }[] = [];

  for (const el of b.elements) {
    if (el.status !== 'active') continue;
    const bh = E.behavior(el);
    // Выход из боя
    if (bh === 'retreat') {
      el.exitTurns++;
      if (el.exitTurns >= k.retreatExitTurns) {
        el.status = 'withdrawn';
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} организованно выходит из боя.` });
      }
      continue;
    }
    if (bh === 'rout') {
      for (const c of el.comps) {
        const t = E.type(c.typeId);
        if (t.kind === 'personnel' || c.current <= 0) continue;
        const n = rng.binomial(c.current, k.routAbandonShare);
        if (n > 0) {
          c.current -= n;
          c.abandoned += n;
          E.log({ phase: 'checks', level: 1, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} бросает при бегстве: ${t.name} ×${n}.` });
        }
      }
      el.exitTurns++;
      if (el.exitTurns >= k.routExitTurns) {
        el.status = 'routed';
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'critical', refs: [el.id], text: `${e(el)} в беспорядке покидает поле боя.` });
      }
      continue;
    }
    // Уничтожение
    const valueNow = E.value(el);
    const pers = E.personnel(el);
    if (valueNow <= el.startValue * k.destroyedThreshold || pers <= 0) {
      const left = destroyElement(E, el);
      E.log({
        phase: 'checks',
        level: 0,
        side: el.side,
        severity: 'critical',
        refs: [el.id],
        text: `${e(el)} перестаёт существовать как боевая единица${left > 0 ? ` (уцелевшие ${left} чел. рассеяны)` : ''}.`,
        factors: [
          { label: 'Сохранилось боевой ценности', value: round1((valueNow / Math.max(1e-9, el.startValue)) * 100), kind: 'base' },
          { label: 'Порог уничтожения, %', value: k.destroyedThreshold * 100, kind: 'base' },
        ],
      });
      if (el.isHQ) shocks.push({ kind: 'hq', el, formation: E.formationOf(el) });
      continue;
    }
    // Паника
    const panicMult = E.mult(el, 'panic');
    if (f.panic && f.morale && el.morale < k.panicMorale && bh !== 'reserve') {
      const chance = clamp(k.panicChance * (1 - el.morale / Math.max(1, k.panicMorale)) * panicMult * (el.holdFast ? 0.5 : 1), 0, 1);
      const roll = rng.next();
      const factors: Factor[] = [
        { label: `Мораль ${Math.round(el.morale)} ниже порога паники ${k.panicMorale}`, value: k.panicChance * (1 - el.morale / Math.max(1, k.panicMorale)), kind: 'chance' },
        { label: 'Склонность к панике (опыт, командир, условия)', value: panicMult, kind: 'mult' },
      ];
      if (el.holdFast) factors.push({ label: '«Стоять насмерть»', value: 0.5, kind: 'mult' });
      factors.push({ label: 'Итоговый шанс', value: chance, kind: 'chance' });
      if (roll < chance) {
        setOrderByBehavior(E, el, 'rout');
        shocks.push({ kind: 'rout', el, formation: E.formationOf(el) });
        E.log({ phase: 'checks', level: 0, side: el.side, severity: 'critical', refs: [el.id], text: `${e(el)}: паника — бегство с позиций!`, factors });
        continue;
      }
      E.log({ phase: 'checks', level: 1, side: el.side, severity: 'info', refs: [el.id], text: `${e(el)} на грани паники, но держится (шанс паники ${Math.round(chance * 100)}%).`, factors });
    }
    // Отступление
    if (f.retreat && !el.holdFast && bh !== 'reserve') {
      const reasons: Factor[] = [];
      let sev = 0;
      if (f.morale && el.morale < k.retreatMorale) {
        const v = (k.retreatMorale - el.morale) / Math.max(1, k.retreatMorale);
        sev = Math.max(sev, v);
        reasons.push({ label: `Мораль ${Math.round(el.morale)} ниже порога ${k.retreatMorale}`, value: round1(v * 100) / 100, kind: 'base' });
      }
      const lossPct = (1 - valueNow / Math.max(1e-9, el.startValue)) * 100;
      if (lossPct > k.retreatLossPct) {
        const v = (lossPct - k.retreatLossPct) / Math.max(1, 100 - k.retreatLossPct) + 0.2;
        sev = Math.max(sev, v);
        reasons.push({ label: `Потери ${Math.round(lossPct)}% больше порога ${k.retreatLossPct}%`, value: round1(v * 100) / 100, kind: 'base' });
      }
      const turnLoss = (el.turnValueLost / Math.max(1e-9, el.startValue)) * 100;
      if (turnLoss > k.retreatShockPct) {
        sev = Math.max(sev, 0.5);
        reasons.push({ label: `Шоковые потери за ход ${Math.round(turnLoss)}%`, value: 0.5, kind: 'base' });
      }
      if (f.ammo && el.ammo <= 0) {
        sev = Math.max(sev, 0.3);
        reasons.push({ label: 'Нет боезапаса', value: 0.3, kind: 'base' });
      }
      if (E.formationOf(el).broken) {
        sev = Math.max(sev, 0.3);
        reasons.push({ label: 'Формирование сломлено', value: 0.3, kind: 'base' });
      }
      if (reasons.length) {
        const comms = E.comms(el);
        const chance = clamp(k.retreatChance * (0.5 + sev) * panicMult, 0, 1);
        reasons.push({ label: 'Склонность к отходу', value: panicMult, kind: 'mult' }, { label: 'Итоговый шанс', value: chance, kind: 'chance' });
        if (rng.next() < chance) {
          setOrderByBehavior(E, el, 'retreat');
          E.log({ phase: 'checks', level: 0, side: el.side, severity: 'bad', refs: [el.id], text: `${e(el)} начинает отход${comms < 0.4 ? ' (без связи — приказ запоздал)' : ''}.`, factors: reasons });
        } else {
          E.log({ phase: 'checks', level: 2, side: el.side, refs: [el.id], text: `${e(el)} держится, несмотря на тяжёлое положение (шанс отхода ${Math.round(chance * 100)}%).`, factors: reasons });
        }
      }
    }
  }

  // Потеря штабов
  for (const sh of shocks.filter((x) => x.kind === 'hq')) {
    if (!sh.formation.hqLost) {
      sh.formation.hqLost = true;
      E.invalidate();
      E.log({ phase: 'checks', level: 0, side: sh.formation.side, severity: 'critical', refs: [sh.el!.id], text: `${fm(sh.formation)}: штаб потерян — связь ×${k.hqLossComms}, влияние командира утрачено.` });
    }
  }
  // Распад формирований
  for (const f2 of b.formations) {
    if (f2.broken) continue;
    const ids = subtreeIds(E, f2.id);
    const els = b.elements.filter((x) => ids.has(x.formationId) && x.status !== 'pending');
    const total = els.reduce((a, x) => a + x.startValue, 0);
    // Распад имеет смысл только для звена из нескольких элементов.
    if (total <= 0 || els.length < 2) continue;
    const gone = els.filter((x) => x.status !== 'active' || ['retreat', 'rout'].includes(E.behavior(x))).reduce((a, x) => a + x.startValue, 0);
    if (gone / total >= k.formationBreakShare) {
      f2.broken = true;
      shocks.push({ kind: 'break', formation: f2 });
      E.log({ phase: 'checks', level: 0, side: f2.side, severity: 'critical', text: `${fm(f2)}: формирование сломлено — ${Math.round((gone / total) * 100)}% сил выбыло или отходит.` });
    }
  }
  // Применение моральных потрясений (после всех проверок — чтобы порядок элементов не влиял)
  if (f.morale) {
    for (const sh of shocks) {
      const ids = subtreeIds(E, sh.formation.id);
      for (const el of b.elements) {
        if (el.status !== 'active' || el === sh.el) continue;
        let hit = 0;
        let label = '';
        if (sh.kind === 'rout') {
          if (ids.has(el.formationId)) {
            hit = k.moraleRoutFormation;
            label = 'бегство соседнего элемента';
          } else if (el.side === sh.formation.side) {
            hit = k.moraleRoutSide;
            label = 'бегство на соседнем участке';
          }
        } else if (ids.has(el.formationId)) {
          hit = sh.kind === 'hq' ? k.moraleHQLoss : k.moraleFormationBreak;
          label = sh.kind === 'hq' ? 'потеря штаба' : 'распад формирования';
        }
        if (hit <= 0) continue;
        const v = hit * E.mult(el, 'moraleLoss');
        el.morale = clamp(el.morale - v, 0, 100);
        E.log({ phase: 'checks', level: 2, side: el.side, severity: 'bad', refs: [el.id], text: `Мораль ${e(el)} −${v.toFixed(1)}: ${label}.` });
      }
    }
  }
  // Автоввод резервов
  if (k.autoCommitReserves >= 0.5) {
    for (const side of SIDES) {
      const els = E.sideElements(side);
      const fighting = els.some((x) => E.fighting(x) && E.behavior(x) !== 'reserve');
      if (fighting) continue;
      for (const el of els.filter((x) => x.status === 'active' && E.behavior(x) === 'reserve')) {
        const fo = E.orders.get(E.formationOf(el).orderId);
        const target = fo && fo.behavior !== 'reserve' ? fo.id : (E.rs.orders.find((o) => o.behavior === 'defend')?.id ?? el.orderId);
        el.orderId = target;
        E.invalidate(el);
        E.log({ phase: 'checks', level: 0, side, severity: 'info', refs: [el.id], text: `Первая линия стороны ${s(side)} выбыла — ${e(el)} вводится в бой (приказ «${E.order(el).name}»).` });
      }
    }
  }
  // Удержание позиций (для задач «удержать/захватить»)
  for (const side of SIDES) {
    const st = b.sides[side];
    if (st.lostHoldTurn) continue;
    if (!holding(E, side)) st.lostHoldTurn = b.turn;
  }
}

/** Сторона удерживает позиции: на месте осталось достаточно сил, не выходящих из боя. */
export function holding(E: EngineContext, side: SideId): boolean {
  const els = E.sideElements(side).filter((x) => x.status !== 'pending');
  const start = els.reduce((a, x) => a + x.startValue, 0);
  const now = els.filter((x) => E.fighting(x)).reduce((a, x) => a + E.value(x), 0);
  return start > 0 && now >= start * E.k.holdMinShare;
}

// ------------------------------------------------------------------ снимок и окончание

export function combatEffectiveness(E: EngineContext, el: ElementState): number {
  if (el.status === 'destroyed') return 0;
  const k = E.k;
  const f = E.f;
  let ce = E.value(el);
  if (f.morale) ce *= lerp(k.ceMoraleMin, 1, el.morale / 100);
  if (f.cohesion) ce *= lerp(k.ceCohesionMin, 1, el.cohesion / 100);
  if (f.fatigue) ce *= 1 - (el.fatigue / 100) * k.ceFatiguePenalty;
  if (f.ammo) ce *= el.ammo >= k.lowAmmoThreshold ? 1 : lerp(k.noAmmoFire, 1, el.ammo / Math.max(1, k.lowAmmoThreshold));
  return ce;
}

function snapshot(E: EngineContext) {
  const sides = {} as Record<SideId, SideSnapshot>;
  for (const side of SIDES) {
    // Не подошедшие подкрепления на графиках не видны — их подход заметен как рост сил.
    const els = E.sideElements(side).filter((x) => x.status !== 'pending');
    let vehicles = 0;
    for (const el of els) for (const c of el.comps) if (E.type(c.typeId).kind === 'vehicle') vehicles += c.current;
    const active = els.filter((x) => x.status === 'active');
    const val = active.reduce((a, x) => a + E.value(x), 0);
    sides[side] = {
      personnel: els.reduce((a, x) => a + E.personnel(x), 0),
      vehicles,
      value: els.reduce((a, x) => a + E.value(x), 0),
      ce: els.reduce((a, x) => a + combatEffectiveness(E, x), 0),
      morale: val > 0 ? active.reduce((a, x) => a + x.morale * E.value(x), 0) / val : 0,
      active: active.length,
    };
  }
  E.b.history.push({ turn: E.b.turn, band: E.b.bandIndex, sides });
}

/** Сторона ждёт подкреплений по плану (их ход ещё не наступил). */
function awaitingReinforcements(b: Battle, side: SideId): boolean {
  return (b.scenario.events ?? []).some(
    (ev) => ev.kind === 'arrive' && ev.side === side && ev.nodeId && (b.eventTurns?.[ev.id] ?? ev.turn) > b.turn && elementsOfNode(b, side, ev.nodeId).some((x) => x.status === 'pending'),
  );
}

function checkEnd(E: EngineContext) {
  const { b, k } = E;
  // Пока по плану ждут подкреплений, сторона не выбыла, а бой не «затих».
  const out = (side: SideId) => !E.sideElements(side).some((x) => E.fighting(x)) && !awaitingReinforcements(b, side);
  const outA = out('A');
  const outB = out('B');
  if (outA || outB) {
    const reason = outA && outB ? 'Обе стороны вышли из боя' : `${b.sides[outA ? 'A' : 'B'].name}: сил на позициях не осталось`;
    finish(E, reason);
    return;
  }
  if (b.turn >= b.scenario.maxTurns) {
    finish(E, 'Достигнут лимит ходов');
    return;
  }
  const losses = b.elements.reduce((a, x) => a + x.turnValueLost, 0);
  const attacking = b.elements.some((x) => E.engaged(x) && E.behavior(x) === 'attack');
  const waiting = awaitingReinforcements(b, 'A') || awaitingReinforcements(b, 'B');
  b.quietTurns = losses <= 0 && !attacking && !waiting ? b.quietTurns + 1 : 0;
  if (k.stalemateTurns > 0 && b.quietTurns >= k.stalemateTurns) finish(E, `Бой затих: ${b.quietTurns} ход. без потерь и без атак`);
}

export function finish(E: EngineContext, reason: string) {
  const b = E.b;
  if (b.finished) return;
  b.finished = true;
  b.endReason = reason;
  b.result = computeResult(E);
  E.log({ phase: 'end', level: 0, severity: 'info', text: `Бой окончен на ${b.turn}-м ходу. ${reason}. Итог: ${b.result.headline}.` });
  E.commit();
}
