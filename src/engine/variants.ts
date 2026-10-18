// Варианты сценария для массового моделирования: перебор одного параметра — «как исход зависит от X».

import { clone } from './defaults';
import { fmtDuration, hoursFor, scenarioTurns } from './duration';
import type { Id, Ruleset, Scenario, SideId, UnitNode } from './types';
import { findUnit } from './units';

export type SweepKind = 'commander' | 'intel' | 'fortification' | 'condition' | 'startBand' | 'order' | 'eventTurn' | 'supportCount';

export interface SweepParam {
  kind: SweepKind;
  side?: SideId;
  /** Узел стороны (командир, приказ). */
  nodeId?: Id;
  /** Категория условий. */
  category?: Id;
  /** Событие плана и диапазон ходов. */
  eventId?: Id;
  from?: number;
  to?: number;
  /** Средство огневой поддержки. */
  assetId?: Id;
}

export const SWEEP_LABELS: Record<SweepKind, string> = {
  commander: 'Командир формирования',
  intel: 'Разведданные стороны',
  fortification: 'Укрепления стороны',
  condition: 'Условие боя',
  startBand: 'Начальная дистанция',
  order: 'Приказ подразделения',
  eventTurn: 'Ход события плана',
  supportCount: 'Ударов огневой поддержки',
};

export interface Variant {
  label: string;
  scenario: Scenario;
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
  const side = (d: Scenario) => d.sides.find((x) => x.id === p.side)!;
  switch (p.kind) {
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
      for (const o of rs.fortifications) make(o.name, (d) => void (side(d).fortification = o.id));
      break;
    case 'condition': {
      const cat = rs.conditions.find((x) => x.id === p.category);
      if (!cat) return [];
      for (const o of cat.options) make(o.name, (d) => void (d.conditions[cat.id] = o.id));
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
