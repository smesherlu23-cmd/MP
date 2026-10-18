// Человекочитаемые названия для журнала, отчётов и интерфейса.

import type { Behavior, ComponentKind, ConditionOp, Echelon, ElementStatus, ObjectiveType, ScenarioEventKind, StatKey } from './types';

export const STAT_LABELS: Record<StatKey, string> = {
  fire: 'Огонь',
  protection: 'Защищённость',
  detection: 'Обнаружение',
  concealment: 'Скрытность',
  movement: 'Подвижность',
  fatigue: 'Утомляемость',
  moraleLoss: 'Потери морали',
  panic: 'Склонность к панике/отходу',
  suppression: 'Восприимчивость к подавлению',
  ammoUse: 'Расход боезапаса',
  lethality: 'Летальность огня',
  initiative: 'Инициатива',
  recovery: 'Восстановление',
};

export const STAT_HINTS: Record<StatKey, string> = {
  fire: 'Исходящий огонь элемента.',
  protection: 'Делитель входящего урона (больше — меньше потерь).',
  detection: 'Способность обнаруживать противника.',
  concealment: 'Делитель шанса быть обнаруженным.',
  movement: 'Скорость сближения/отхода.',
  fatigue: 'Множитель накопления усталости.',
  moraleLoss: 'Множитель потерь морали.',
  panic: 'Множитель шансов паники и отхода.',
  suppression: 'Множитель получаемого подавления.',
  ammoUse: 'Множитель расхода боезапаса.',
  lethality: 'Доля воздействия, превращающаяся в потери.',
  initiative: 'Множитель инициативы стороны.',
  recovery: 'Множитель восстановления (подавление, мораль, слаженность).',
};

export const BEHAVIOR_LABELS: Record<Behavior, string> = {
  attack: 'Атака (сближается с противником)',
  defend: 'Оборона (держит позицию)',
  ambush: 'Засада (первый залп усилен)',
  recon: 'Разведка (наблюдает, избегает огня)',
  consolidate: 'Закрепление (укрепляет позицию, отдыхает)',
  retreat: 'Отступление (организованно выходит из боя)',
  rout: 'Паническое бегство (выходит из боя с потерями)',
  reserve: 'Резерв (не участвует, пока не введён)',
};

export const ECHELON_LABELS: Record<Echelon, string> = {
  front: 'Первый эшелон',
  support: 'Второй эшелон / поддержка',
  rear: 'Тыл',
};

export const KIND_LABELS: Record<ComponentKind, string> = {
  personnel: 'Личный состав',
  weapon: 'Вооружение (расчёт)',
  vehicle: 'Техника',
};

export const STATUS_LABELS: Record<ElementStatus, string> = {
  active: 'В бою',
  pending: 'Ещё не подошёл',
  withdrawn: 'Вышел из боя',
  routed: 'Бежал',
  destroyed: 'Уничтожен',
};

export const OBJECTIVE_LABELS: Record<ObjectiveType, string> = {
  hold: 'Удержать позицию',
  take: 'Захватить позицию',
  inflict: 'Нанести потери не менее',
  preserve: 'Свои потери не более',
  recon: 'Разведать силы противника',
  noRout: 'Не допустить бегства',
};

export const OBJECTIVE_SHORT: Record<ObjectiveType, (v: number) => string> = {
  hold: (v) => `Удержать позицию ${v} ход.`,
  take: () => 'Захватить позицию',
  inflict: (v) => `Нанести потери ≥ ${v}%`,
  preserve: (v) => `Свои потери ≤ ${v}%`,
  recon: (v) => `Разведать ≥ ${v}% сил противника`,
  noRout: () => 'Не допустить бегства',
};

export const OBJECTIVE_HAS_VALUE: Record<ObjectiveType, boolean> = {
  hold: true,
  take: false,
  inflict: true,
  preserve: true,
  recon: true,
  noRout: false,
};

export const OP_LABELS: Record<ConditionOp, string> = {
  eq: '=',
  neq: '≠',
  in: 'одно из',
  nin: 'ни одно из',
  has: 'есть',
  not_has: 'нет',
  gte: '≥',
  lte: '≤',
};

/** Поля, доступные в условиях пользовательских модификаторов (кроме cond.<категория>). */
export const MODIFIER_FIELDS: { field: string; label: string; kind: 'order' | 'behavior' | 'tag' | 'kind' | 'number' | 'side' | 'echelon' | 'range' | 'class' | 'fort' | 'intel' }[] = [
  { field: 'range', label: 'Дистанция', kind: 'range' },
  { field: 'turn', label: 'Номер хода', kind: 'number' },
  { field: 'order', label: 'Приказ (свой)', kind: 'order' },
  { field: 'behavior', label: 'Поведение (своё)', kind: 'behavior' },
  { field: 'tag', label: 'Тег (свой)', kind: 'tag' },
  { field: 'kind', label: 'Состав (свой)', kind: 'kind' },
  { field: 'experience', label: 'Опыт (свой)', kind: 'number' },
  { field: 'side', label: 'Сторона', kind: 'side' },
  { field: 'echelon', label: 'Эшелон (свой)', kind: 'echelon' },
  { field: 'fortification', label: 'Укрепления (своей стороны)', kind: 'fort' },
  { field: 'intel', label: 'Разведданные (своей стороны)', kind: 'intel' },
  { field: 'targetClass', label: 'Класс цели', kind: 'class' },
  { field: 'enemy.tag', label: 'Тег противника', kind: 'tag' },
  { field: 'enemy.kind', label: 'Состав противника', kind: 'kind' },
  { field: 'enemy.order', label: 'Приказ противника', kind: 'order' },
  { field: 'enemy.behavior', label: 'Поведение противника', kind: 'behavior' },
  { field: 'enemy.echelon', label: 'Эшелон противника', kind: 'echelon' },
];

export const SIDE_IDS = ['A', 'B'] as const;

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtPct(v: number, digits = 0): string {
  return `${v.toFixed(digits)}%`;
}

export function fmtMult(v: number): string {
  return `×${v.toFixed(2).replace(/\.?0+$/, '')}`;
}

export const EVENT_KIND_LABELS: Record<ScenarioEventKind, string> = {
  arrive: 'Подход подкреплений',
  order: 'Смена приказа',
  conditions: 'Смена условий',
};
