// Публичный интерфейс движка. Движок не знает об интерфейсе и может работать
// в программе, в тестах и из командной строки (scripts/simulate.ts).

export * from './types';
export * from './rng';
export * from './coefficients';
export * from './labels';
export * from './defaults';
export { EngineContext } from './context';
export { createBattle, stepTurn, runToEnd, combatEffectiveness, shooterMult, elementsOfNode, arrivalTurn } from './battle';
export { computeResult, defaultObjectives, explainResult } from './outcome';
export { INTERVENTION_LABELS, applyIntervention, lastBattleAction, replayBattle, restoreBattleLog, rewindBattle, trimBattleForStorage, undoBattleAction } from './interventions';
export type { ElementPatch } from './interventions';
export { formatReport, formatSideReport, formatLog, formatFactor, intelError, resolveRefs } from './report';
export * from './montecarlo';
export * from './validate';
export * from './units';
export * from './names';
