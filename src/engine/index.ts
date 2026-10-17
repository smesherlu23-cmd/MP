// Публичный интерфейс движка. Движок не знает об интерфейсе и может работать
// в программе, в тестах и из командной строки (scripts/simulate.ts).

export * from './types';
export * from './rng';
export * from './coefficients';
export * from './labels';
export * from './defaults';
export { EngineContext } from './context';
export { createBattle, stepTurn, runToEnd, combatEffectiveness, shooterMult } from './battle';
export { computeResult, defaultObjectives } from './outcome';
export { applyIntervention, replayBattle, restoreBattleLog, trimBattleForStorage } from './interventions';
export type { ElementPatch } from './interventions';
export { formatReport, formatLog, formatFactor, resolveRefs } from './report';
export * from './montecarlo';
export * from './validate';
export * from './units';
