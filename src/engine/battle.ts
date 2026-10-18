// Пошаговый расчёт боя: создание боя и ход. Фазы хода — в phases/*; все числа берутся из набора правил.

import { EngineContext, clamp, s } from './context';
import { clone, defaultCommandLevel, normalizeRuleset, SCHEMA_VERSION } from './defaults';
import { scenarioInTurns } from './duration';
import { plural } from './labels';
import { defaultObjectives } from './outcome';
import { Rng } from './rng';
import type { Battle, CompState, ElementState, FormationState, Id, Ruleset, Scenario, SideId, SideState, UnitNode } from './types';
import { limitComposition, migrateUnit, resolveChild, ROOT_RESOLVED, withoutExcluded, type Resolved } from './units';
import { phaseChecks } from './phases/checks';
import { SIDES, elementsOfNode } from './phases/common';
import { phaseDetection } from './phases/detection';
import { checkEnd, finish, snapshot } from './phases/end';
import { phaseEvents } from './phases/events';
import { phaseFire, phaseStrikes } from './phases/fire';
import { phaseInitiative } from './phases/initiative';
import { phaseMorale } from './phases/morale';
import { phaseMovement } from './phases/movement';
import { phaseOrders } from './phases/orders';
import { phaseFatigue, phaseSupply } from './phases/upkeep';

export { elementsOfNode } from './phases/common';
export { arrivalTurn, eventTurn, triggerMet, triggerText } from './phases/events';
export { shooterMult } from './phases/fire';
export { holding } from './phases/checks';
export { combatEffectiveness, finish } from './phases/end';

export interface CreateOptions {
  seed?: string;
  silent?: boolean;
  name?: string;
  id?: string;
  /** Не копировать сценарий и правила (для массового моделирования: входные данные только читаются). */
  shareInputs?: boolean;
  /** Повтор сохранённого боя: механики, которых нет в его снимке правил, выключены. */
  compat?: boolean;
}

// ================================================================== создание боя

export function createBattle(scenario: Scenario, ruleset: Ruleset, opts: CreateOptions = {}): Battle {
  const rs = opts.shareInputs ? ruleset : normalizeRuleset(clone(ruleset), opts.compat);
  // ГМ задаёт длительность в часах; бой идёт ходами — в бою сценарий хранится уже в ходах.
  const inTurns = scenarioInTurns(scenario, rs);
  const sc = opts.shareInputs ? inTurns : clone(inTurns);
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
    bandIndex: Math.max(
      0,
      rs.rangeBands.findIndex((x) => x.id === sc.startBand),
    ),
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

  // Участки: у каждого своя дистанция; без участков — одна общая (bandIndex боя).
  const bandIdx = (id: Id | undefined) => {
    const i = rs.rangeBands.findIndex((x) => x.id === id);
    return i >= 0 ? i : b.bandIndex;
  };
  if (sc.sectors?.length) {
    b.sectors = sc.sectors.map((sec) => ({
      id: sec.id,
      name: sec.name,
      bandIndex: bandIdx(sec.startBand),
      closingProgress: 0,
      conditions: { ...(sec.conditions ?? {}) },
      fortification: { ...(sec.fortification ?? {}) },
      ...(sec.width ? { width: sec.width } : {}),
    }));
  }
  const sectorIds = new Set((b.sectors ?? []).map((x) => x.id));
  // Огневая поддержка сторон (вне поля боя).
  for (const sd of sc.sides)
    for (const a of sd.support ?? []) if (a.count > 0 && a.missions > 0) (b.support ??= []).push({ ...a, side: sd.id, left: Math.floor(a.missions) });

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
    // Командир есть у каждого формирования — у подразделения целиком и у каждого звена с подчинёнными.
    // Его компетентность в начале боя задаётся в сценарии (0 — без командира), иначе обычная;
    // по ходу боя её меняет ГМ (setFormation / editElement). В конструкторе командира нет.
    const startCmd = defaultCommandLevel(rs);
    const maxCmd = Math.max(1, rs.commandLevels.length);
    const cmd = (node: UnitNode) => {
      const set = sd.commanders?.[node.id];
      if (set === undefined || set === null) return startCmd;
      return set <= 0 ? 0 : clamp(Math.round(set), 1, maxCmd);
    };
    /**
     * Узел с подчинёнными (и любой корень) становится формированием — звеном управления.
     * Узел с собственным составом становится элементом — тем, что стреляет и несёт потери.
     */
    // «Стоять насмерть» задаётся в сценарии у подразделения и действует на всех его подчинённых.
    const holdIds = new Set(sd.holdFast ?? []);
    const addNode = (node: UnitNode, parentF: FormationState | null, parentRes: Resolved, parentSector: Id | undefined, parentHold = false) => {
      const res = resolveChild(node, parentRes);
      const hold = parentHold || holdIds.has(node.id);
      const own = sd.sectorOf?.[node.id];
      const sector = own && sectorIds.has(own) ? own : parentSector;
      const order = res.order && orderIds.has(res.order) ? res.order : (parentF?.orderId ?? defaultOrder);
      const isGroup = node.children.length > 0 || !parentF;
      let f = parentF!;
      if (isGroup) {
        f = {
          id: `f${++fCount}`,
          defId: node.id,
          name: node.name,
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
        const withKids = isGroup && node.children.length > 0;
        const el = makeElement(
          node,
          withKids ? `${node.name} (${node.isHQ ? 'управление' : 'свой состав'})` : node.name,
          f,
          `e${++eCount}`,
          rs,
          typeIds,
          res,
          order,
          warnings,
        );
        if (b.sectors) el.sector = sector ?? b.sectors[0].id;
        if (hold) el.holdFast = true;
        if (!withKids) {
          // Связь и снабжение у подразделения без подчинённых (своего командира у него нет — им командует формирование).
          el.comms = node.comms;
          el.supply = node.supply;
        }
        b.elements.push(el);
      } else if (!node.children.length) {
        warnings.push(`подразделение «${node.name}» без состава и подчинённых — в бою не участвует.`);
      }
      for (const ch of node.children) addNode(ch, f, res, sector, hold);
    };
    // Части, исключённые из этого боя (в сценарии), не создаются вовсе; при неполном составе — только выделенные.
    for (const f of sd.formations) {
      const u = withoutExcluded(migrateUnit(f), sd.excluded, sd.partial);
      if (u) addNode(u, null, ROOT_RESOLVED, undefined);
    }
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
    // У события с условием ход наступления определяется по ходу боя.
    if (ev.spread && ev.spread > 0 && !ev.trigger) {
      const off = Math.floor(E.rng.next() * (2 * ev.spread + 1)) - ev.spread;
      (b.eventTurns ??= {})[ev.id] = Math.max(1, ev.turn + off);
    }
  }
  // Удача и исполнение сторон в этом бою: внезапность, слаженность действий, ошибки, везение.
  if (E.k.sideLuck > 0) {
    for (const side of SIDES) b.sides[side].luck = clamp(Math.exp(E.rng.normal(0, E.k.sideLuck)), 0.5, 2);
    E.log({
      phase: 'setup',
      level: 2,
      text: `Удача и исполнение сторон в этом бою: ${SIDES.map((x) => `${s(x)} ×${b.sides[x].luck!.toFixed(2)}`).join(', ')}.`,
    });
  }

  // Вводная запись журнала
  const condText = rs.conditions.map((cat) => `${cat.name.toLowerCase()}: ${cat.options.find((o) => o.id === b.conditions[cat.id])?.name ?? '—'}`).join(', ');
  E.log({ phase: 'setup', level: 0, text: `Бой «${b.name}». Условия — ${condText}. Начальная дистанция: ${E.band?.name ?? '—'}.` });
  if (b.sectors) {
    const text = b.sectors
      .map((sec) => {
        const own = rs.conditions
          .filter((cat) => sec.conditions[cat.id])
          .map((cat) => cat.options.find((o) => o.id === sec.conditions[cat.id])?.name.toLowerCase());
        const n = b.elements.filter((x) => x.sector === sec.id).length;
        return `${sec.name} — ${rs.rangeBands[sec.bandIndex]?.name.toLowerCase() ?? '—'}${own.length ? `, ${own.join(', ')}` : ''} (${n} ${plural(n, 'элемент', 'элемента', 'элементов')})`;
      })
      .join('; ');
    E.log({ phase: 'setup', level: 0, text: `Участки боя: ${text}.` });
  }
  if (b.support?.length)
    E.log({
      phase: 'setup',
      level: 0,
      text: `Огневая поддержка: ${b.support.map((a) => `${b.sides[a.side].name} — «${a.name}» (${a.count} × ${rs.componentTypes.find((t) => t.id === a.typeId)?.name ?? a.typeId}, ударов: ${a.left})`).join('; ')}.`,
    });
  const partial = partialNotes(sc, rs);
  if (partial.length) E.log({ phase: 'setup', level: 0, text: `В бою не весь состав: ${partial.join('; ')}.` });
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
      E.log({
        phase: 'setup',
        level: 0,
        side,
        text: `${s(side)}: из них подойдут позже (подкрепления) — ${later.length} ${plural(later.length, 'элемент', 'элемента', 'элементов')}, ${later.reduce((a, x) => a + x.startPersonnel, 0)} чел.`,
      });
  }
  if (sc.events?.length)
    E.log({ phase: 'setup', level: 0, text: `План боя: ${sc.events.length} ${plural(sc.events.length, 'событие', 'события', 'событий')} по ходам.` });
  for (const w of warnings) E.log({ phase: 'setup', level: 0, severity: 'bad', text: `Внимание: ${w}` });
  if (!b.elements.some((x) => x.side === 'A') || !b.elements.some((x) => x.side === 'B')) {
    E.log({ phase: 'setup', level: 0, severity: 'critical', text: 'У одной из сторон нет сил — бой невозможен.' });
  }
  snapshot(E);
  E.commit();
  return b;
}

/** Узлы с неполным составом в этом бою — для вводной записи журнала: «стрелок 3 из 7». */
function partialNotes(sc: Scenario, rs: Ruleset): string[] {
  const out: string[] = [];
  const count = (list: UnitNode['composition'], typeId: Id) => list.filter((c) => c.typeId === typeId).reduce((a, c) => a + Math.max(0, c.current), 0);
  for (const sd of sc.sides) {
    const partial = sd.partial;
    if (!partial) continue;
    const ex = new Set(sd.excluded ?? []);
    const visit = (n: UnitNode) => {
      if (ex.has(n.id)) return;
      const lim = partial[n.id];
      if (lim) {
        const used = limitComposition(n.composition, lim);
        const parts = Object.keys(lim).flatMap((typeId) => {
          const cur = count(n.composition, typeId);
          const take = count(used, typeId);
          return take < cur ? [`${rs.componentTypes.find((t) => t.id === typeId)?.name ?? typeId} ${take} из ${cur}`] : [];
        });
        if (parts.length) out.push(`${sd.name}, «${n.name}» — ${parts.join(', ')}`);
      }
      n.children.forEach(visit);
    };
    sd.formations.forEach(visit);
  }
  return out;
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
    comps.push({
      typeId: c.typeId,
      authorized: Math.max(cur, Math.floor(c.authorized)),
      start: cur,
      current: cur,
      destroyed: 0,
      damaged: 0,
      abandoned: 0,
      kia: 0,
      wia: 0,
      mia: 0,
    });
  }
  const maxExp = Math.max(1, rs.experienceLevels.length);
  const st = res.state;
  return {
    id,
    defId: d.id,
    name,
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
  const bandText = b.sectors
    ? b.sectors.map((sec) => `${sec.name}: ${b.ruleset.rangeBands[sec.bandIndex]?.name.toLowerCase() ?? '—'}`).join(', ')
    : (E.band?.name ?? '—');
  E.log({ phase: 'turn', level: 0, text: `Ход ${b.turn} · ${fmtTime(t0)} · ${bandText}` });

  phaseEvents(E);
  phaseOrders(E);
  phaseDetection(E);
  phaseStrikes(E);
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

export function runToEnd(b: Battle, maxSteps = 1000): void {
  let n = 0;
  while (!b.finished && n++ < maxSteps) stepTurn(b);
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}
