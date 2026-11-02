// Варианты сценария для массового моделирования: перебор одного параметра — «как исход зависит от X».

import { COEFFICIENTS } from './coefficients';
import { clone } from './defaults';
import { fmtDuration, hoursFor, scenarioHours, scenarioTurns, turnsFor } from './duration';
import type { Id, Ruleset, Scenario, SideId, StateKey, UnitNode } from './types';
import { findUnit, STATE_LABELS, walkUnits } from './units';

export type SweepKind =
  | 'coefficient'
  | 'rule'
  | 'commander'
  | 'intel'
  | 'fortification'
  | 'condition'
  | 'startBand'
  | 'duration'
  | 'order'
  | 'state'
  | 'strength'
  | 'attack'
  | 'defense'
  | 'holdFast'
  | 'sector'
  | 'eventTurn'
  | 'eventChance'
  | 'supportCount';

export interface SweepParam {
  kind: SweepKind;
  side?: SideId;
  /** Узел стороны (командир, приказ). */
  nodeId?: Id;
  /** Категория условий. */
  category?: Id;
  /** Событие плана. */
  eventId?: Id;
  /** Диапазон значений (ходы, часы, проценты, значение коэффициента) и шаг (не задан — 1). */
  from?: number;
  to?: number;
  step?: number;
  /** Средство огневой поддержки. */
  assetId?: Id;
  /** Коэффициент набора правил. */
  key?: string;
  /** Своё правило набора. */
  ruleId?: Id;
  /** Показатель состояния подразделения. */
  stateKey?: StateKey;
  /** Условия и укрепления: только этот участок (не задано — всё поле, и участки со своими значениями тоже). */
  sectorId?: Id;
}

/** Больше вариантов в одном переборе не бывает. */
export const MAX_VARIANTS = 30;

/** Значения от from до to с шагом step (не больше MAX_VARIANTS). */
export function sweepRange(from: number, to: number, step: number): number[] {
  const st = Math.abs(step) > 1e-9 ? Math.abs(step) : 1;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: number[] = [];
  for (let i = 0; out.length < MAX_VARIANTS; i++) {
    const v = Math.round((lo + i * st) * 1e6) / 1e6;
    if (v > hi + 1e-9) break;
    out.push(v);
  }
  return out;
}

export const SWEEP_LABELS: Record<SweepKind, string> = {
  coefficient: 'Коэффициент набора правил',
  rule: 'Своё правило: вкл / выкл',
  commander: 'Командир формирования',
  intel: 'Разведданные стороны',
  fortification: 'Укрепления стороны',
  condition: 'Условие боя',
  startBand: 'Начальная дистанция',
  duration: 'Длительность боя',
  order: 'Приказ подразделения',
  state: 'Состояние подразделения',
  strength: 'Численность подразделения',
  attack: 'Атака подразделения',
  defense: 'Защита подразделения',
  holdFast: '«Стоять насмерть»',
  sector: 'Участок подразделения',
  eventTurn: 'Ход события плана',
  eventChance: 'Вероятность события плана',
  supportCount: 'Ударов огневой поддержки',
};

/** Параметры перебора: сторона, подразделение, событие, участок, диапазон. */
export const SWEEP_NEEDS: Record<SweepKind, { side?: boolean; node?: 'formation' | 'any'; event?: boolean; range?: boolean; sector?: boolean }> = {
  coefficient: { range: true },
  rule: {},
  commander: { side: true, node: 'formation' },
  intel: { side: true },
  fortification: { side: true, sector: true },
  condition: { sector: true },
  startBand: {},
  duration: { range: true },
  order: { side: true, node: 'any' },
  state: { side: true, node: 'any', range: true },
  strength: { side: true, node: 'any', range: true },
  attack: { side: true, node: 'any', range: true },
  defense: { side: true, node: 'any', range: true },
  holdFast: { side: true, node: 'any' },
  sector: { side: true, node: 'any' },
  eventTurn: { event: true, range: true },
  eventChance: { event: true, range: true },
  supportCount: { side: true },
};

/** Диапазон перебора по умолчанию: от, до, шаг. */
export function sweepDefaults(sc: Scenario, rs: Ruleset, p: SweepParam): { from: number; to: number; step: number } {
  switch (p.kind) {
    case 'coefficient': {
      const m = COEFFICIENTS.find((x) => x.key === p.key);
      const v = rs.coefficients[p.key ?? ''] ?? m?.default ?? 1;
      const step = m?.step ?? (v >= 10 ? 5 : 0.1);
      return {
        from: Math.max(m?.min ?? 0, round6(v - step * 4)),
        to: m?.max !== undefined ? Math.min(m.max, round6(v + step * 4)) : round6(v + step * 4),
        step,
      };
    }
    case 'duration': {
      const h = scenarioHours(sc, rs);
      return { from: Math.max(0.5, h / 2), to: h * 2, step: h >= 4 ? 1 : 0.5 };
    }
    case 'state':
      return p.stateKey === 'experience' ? { from: 1, to: Math.max(1, rs.experienceLevels.length), step: 1 } : { from: 0, to: 100, step: 20 };
    case 'strength':
      return { from: 50, to: 150, step: 10 };
    case 'attack':
    case 'defense':
      return { from: 60, to: 140, step: 10 };
    case 'eventTurn':
      return { from: 1, to: Math.min(scenarioTurns(sc, rs), 12), step: 1 };
    case 'eventChance':
      return { from: 0, to: 100, step: 25 };
    case 'supportCount':
      return { from: 0, to: 6, step: 1 };
    default:
      return { from: 0, to: 0, step: 1 };
  }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** Число без лишних нулей, с запятой: 1,25 · 100. */
const nf = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

export interface Variant {
  label: string;
  scenario: Scenario;
  /** Свой набор правил варианта (коэффициент, правило); не задан — набор сценария. */
  ruleset?: Ruleset;
}

const nodeIn = (sc: Scenario, side: SideId, id: Id): UnitNode | null => {
  const sd = sc.sides.find((x) => x.id === side);
  if (!sd) return null;
  for (const f of sd.formations) {
    const n = findUnit(f, id);
    if (n) return n;
  }
  return null;
};

/**
 * Варианты сценария (собранного для боя — с деревьями сил на сторонах), отличающиеся одним параметром.
 * Пусто — параметр задан не полностью.
 */
export function sweepVariants(sc: Scenario, rs: Ruleset, p: SweepParam): Variant[] {
  const out: Variant[] = [];
  const make = (label: string, fn: (d: Scenario) => void) => {
    const d = clone(sc);
    fn(d);
    out.push({ label, scenario: d });
  };
  const makeRs = (label: string, fn: (r: Ruleset) => void) => {
    const r = clone(rs);
    fn(r);
    out.push({ label, scenario: sc, ruleset: r });
  };
  const side = (d: Scenario) => d.sides.find((x) => x.id === p.side)!;
  const def = sweepDefaults(sc, rs, p);
  const values = () => sweepRange(p.from ?? def.from, p.to ?? def.to, p.step ?? def.step);
  const node = (d: Scenario) => nodeIn(d, p.side!, p.nodeId!)!;
  const hasNode = !!p.side && !!p.nodeId && !!nodeIn(sc, p.side, p.nodeId);
  const sec = p.sectorId ? sc.sectors?.find((x) => x.id === p.sectorId) : undefined;
  if (p.sectorId && !sec) return [];
  switch (p.kind) {
    case 'coefficient': {
      if (!p.key) return [];
      for (const v of values())
        makeRs(nf(v), (r) => {
          r.coefficients[p.key!] = v;
        });
      break;
    }
    case 'rule': {
      const m = rs.modifiers.find((x) => x.id === p.ruleId);
      if (!m) return [];
      makeRs('выключено', (r) => void (r.modifiers.find((x) => x.id === m.id)!.enabled = false));
      makeRs('включено', (r) => void (r.modifiers.find((x) => x.id === m.id)!.enabled = true));
      break;
    }
    case 'duration':
      for (const h of values()) {
        if (h <= 0) continue;
        make(fmtDuration(h), (d) => {
          d.hours = h;
          d.maxTurns = turnsFor(h, rs);
        });
      }
      break;
    case 'state': {
      if (!hasNode || !p.stateKey) return [];
      const lv = p.stateKey === 'experience';
      for (const v of values()) {
        const x = lv ? Math.max(1, Math.min(rs.experienceLevels.length, Math.round(v))) : Math.max(0, Math.min(100, v));
        if (lv && out.some((o) => o.label === rs.experienceLevels[x - 1]?.name)) continue;
        make(lv ? (rs.experienceLevels[x - 1]?.name ?? String(x)) : `${STATE_LABELS[p.stateKey].toLowerCase()} ${nf(x)}%`, (d) => {
          node(d).state[p.stateKey!] = x;
          // Подчинённые со своим значением тоже получают перебираемое — иначе у них ничего не меняется.
          walkUnits(node(d), (u) => void (u.state[p.stateKey!] !== undefined && (u.state[p.stateKey!] = x)));
        });
      }
      break;
    }
    case 'strength':
      if (!hasNode) return [];
      for (const v of values()) {
        if (v < 0) continue;
        make(`${nf(v)}% состава`, (d) =>
          walkUnits(node(d), (u) => {
            for (const c of u.composition) {
              c.current = Math.max(0, Math.round((c.current * v) / 100));
              c.authorized = Math.max(c.authorized, c.current);
            }
          }),
        );
      }
      break;
    case 'attack':
    case 'defense':
      if (!hasNode) return [];
      for (const v of values()) {
        if (v < 0) continue;
        make(`${nf(v)}%`, (d) => {
          if (p.kind === 'attack') node(d).attackMod = v;
          else node(d).defenseMod = Math.max(1, v);
        });
      }
      break;
    case 'holdFast':
      if (!hasNode) return [];
      make('нет', (d) => {
        side(d).holdFast = (side(d).holdFast ?? []).filter((x) => x !== p.nodeId);
        node(d).holdFast = false;
      });
      make('стоять насмерть', (d) => {
        side(d).holdFast = [...new Set([...(side(d).holdFast ?? []), p.nodeId!])];
      });
      break;
    case 'sector':
      if (!hasNode || (sc.sectors?.length ?? 0) < 2) return [];
      for (const x of sc.sectors!) make(x.name, (d) => void ((side(d).sectorOf ??= {})[p.nodeId!] = x.id));
      break;
    case 'eventChance': {
      const ev = sc.events?.find((x) => x.id === p.eventId);
      if (!ev) return [];
      for (const v of values()) {
        const c = Math.max(0, Math.min(100, Math.round(v)));
        if (out.some((o) => o.label === `${c}%`)) continue;
        make(`${c}%`, (d) => void (d.events!.find((x) => x.id === ev.id)!.chance = c));
      }
      break;
    }
    case 'commander':
      if (!p.side || !p.nodeId) return [];
      make('без командира', (d) => void ((side(d).commanders ??= {})[p.nodeId!] = 0));
      rs.commandLevels.forEach((l, i) => make(l.name, (d) => void ((side(d).commanders ??= {})[p.nodeId!] = i + 1)));
      break;
    case 'intel':
      if (!p.side) return [];
      for (const o of rs.intelLevels) make(o.name, (d) => void (side(d).intel = o.id));
      break;
    case 'fortification':
      if (!p.side) return [];
      for (const o of rs.fortifications)
        make(o.name, (d) => {
          const s2 = p.side!;
          if (sec) {
            const x = d.sectors!.find((y) => y.id === sec.id)!;
            (x.fortification ??= {})[s2] = o.id;
            return;
          }
          side(d).fortification = o.id;
          // Всё поле — и участки, где у стороны были свои укрепления.
          for (const x of d.sectors ?? []) if (x.fortification) delete x.fortification[s2];
        });
      break;
    case 'condition': {
      const cat = rs.conditions.find((x) => x.id === p.category);
      if (!cat) return [];
      for (const o of cat.options)
        make(o.name, (d) => {
          if (sec) {
            (d.sectors!.find((y) => y.id === sec.id)!.conditions ??= {})[cat.id] = o.id;
            return;
          }
          d.conditions[cat.id] = o.id;
          // Всё поле — и участки со своим вариантом этой категории.
          for (const x of d.sectors ?? []) if (x.conditions) delete x.conditions[cat.id];
        });
      break;
    }
    case 'startBand':
      for (const band of rs.rangeBands)
        make(band.name, (d) => {
          d.startBand = band.id;
          for (const sec of d.sectors ?? []) sec.startBand = band.id;
        });
      break;
    case 'order':
      if (!p.side || !p.nodeId || !nodeIn(sc, p.side, p.nodeId)) return [];
      for (const o of rs.orders) {
        if (o.behavior === 'rout') continue;
        make(o.name, (d) => void (nodeIn(d, p.side!, p.nodeId!)!.order = o.id));
      }
      break;
    case 'eventTurn': {
      const ev = sc.events?.find((x) => x.id === p.eventId);
      if (!ev) return [];
      const from = Math.max(1, Math.round(p.from ?? 1));
      const to = Math.min(Math.max(from, Math.round(p.to ?? scenarioTurns(sc, rs))), from + 29);
      // Ход и время от начала боя: «ход 8 (+1 ч 45 мин)».
      for (let t = from; t <= to; t++)
        make(`ход ${t} (${t > 1 ? `+${fmtDuration(hoursFor(t - 1, rs))}` : 'начало'})`, (d) => void (d.events!.find((x) => x.id === ev.id)!.turn = t));
      make('без события', (d) => void (d.events = d.events!.filter((x) => x.id !== ev.id)));
      break;
    }
    case 'supportCount': {
      if (!p.side || !p.assetId) return [];
      const a = sc.sides.find((x) => x.id === p.side)?.support?.find((x) => x.id === p.assetId);
      if (!a) return [];
      const max = Math.min(20, Math.max(1, Math.round(p.to ?? a.missions)));
      for (let n = 0; n <= max; n++) make(`${n}`, (d) => void (side(d).support!.find((x) => x.id === a.id)!.missions = n));
      break;
    }
  }
  return out;
}
