// Длительность боя: ГМ задаёт её в часах, расчёт идёт ходами. Ходов = часы × 60 ÷ минут на ход набора
// правил — при другой длине хода число ходов подстраивается само. «Удержать позицию» — тоже в часах.

import type { Ruleset, Scenario } from './types';

/** Больше ходов в одном бою не бывает (повтор и откат боя рассчитаны на это). */
export const MAX_TURNS = 1000;

type Rs = Pick<Ruleset, 'turnMinutes'>;
const minutes = (rs: Rs) => Math.max(1, rs.turnMinutes || 1);

/** Ходов на заданное время боя (не меньше одного). */
export function turnsFor(hours: number, rs: Rs): number {
  return Math.min(MAX_TURNS, Math.max(1, Math.round((hours * 60) / minutes(rs))));
}

/** Часов на заданное число ходов. */
export function hoursFor(turns: number, rs: Rs): number {
  return (turns * minutes(rs)) / 60;
}

/** Самая долгая длительность боя при этой длине хода, ч. */
export const maxHours = (rs: Rs) => hoursFor(MAX_TURNS, rs);

/** Длительность боя сценария, ч (у сценария прежней версии — по лимиту ходов). */
export function scenarioHours(sc: Pick<Scenario, 'hours' | 'maxTurns'>, rs: Rs): number {
  return sc.hours ?? hoursFor(sc.maxTurns, rs);
}

/** Лимит ходов сценария. */
export function scenarioTurns(sc: Pick<Scenario, 'hours' | 'maxTurns'>, rs: Rs): number {
  return sc.hours !== undefined ? turnsFor(sc.hours, rs) : sc.maxTurns;
}

/** «2 ч 15 мин», «45 мин», «3 ч». */
export function fmtDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h} ч ${m} мин` : h ? `${h} ч` : `${m} мин`;
}

/**
 * Сценарий для расчёта: лимит ходов и «удержать позицию» — из часов в ходы по длине хода набора правил.
 * Исходный сценарий не меняется; у сценария прежней версии (без часов) всё уже в ходах.
 */
export function scenarioInTurns(sc: Scenario, rs: Rs): Scenario {
  if (sc.hours === undefined) return sc;
  const { hours, ...rest } = sc;
  return {
    ...rest,
    maxTurns: turnsFor(hours, rs),
    sides: sc.sides.map((sd) => ({
      ...sd,
      objectives: sd.objectives.map((o) => (o.type === 'hold' ? { ...o, value: turnsFor(o.value, rs) } : o)),
    })) as Scenario['sides'],
  };
}

/** Сценарий прежней версии — на часы: длительность боя и «удержать позицию» (по длине хода его набора правил). */
export function scenarioToHours(sc: Scenario, rs: Rs): Scenario {
  if (sc.hours !== undefined) return sc;
  const h = (turns: number) => Math.round(hoursFor(turns, rs) * 100) / 100;
  return {
    ...sc,
    hours: h(sc.maxTurns),
    sides: sc.sides.map((sd) => ({
      ...sd,
      objectives: sd.objectives.map((o) => (o.type === 'hold' ? { ...o, value: h(o.value) } : o)),
    })) as Scenario['sides'],
  };
}
