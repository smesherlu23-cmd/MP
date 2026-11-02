// Человекочитаемые названия для журнала, отчётов и интерфейса.

import { fmtDuration } from './duration';
import type {
  Behavior,
  ComponentEntry,
  ComponentKind,
  ConditionOp,
  Echelon,
  ElementStatus,
  Features,
  ObjectiveType,
  Ruleset,
  ScenarioEventKind,
  StatKey,
  TriggerMetric,
} from './types';

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
  hold: (v) => `Удержать позицию ${fmtDuration(v)}`,
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
export const MODIFIER_FIELDS: {
  field: string;
  label: string;
  kind: 'order' | 'behavior' | 'tag' | 'kind' | 'number' | 'side' | 'echelon' | 'range' | 'class' | 'fort' | 'intel' | 'bool';
  /** Механика, без которой поле не имеет смысла: при выключенной поле в списке не предлагается. */
  feature?: keyof Features;
  /** Поле противника — проверяется для каждой пары стрелок — цель. */
  enemy?: boolean;
}[] = [
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
  { field: 'hq', label: 'Штаб', kind: 'bool' },
  { field: 'holdFast', label: '«Стоять насмерть»', kind: 'bool' },
  { field: 'spotted', label: 'Обнаружен противником', kind: 'bool', feature: 'detection' },
  { field: 'commandLevel', label: 'Уровень командира (0 — нет)', kind: 'number', feature: 'command' },
  { field: 'morale', label: 'Мораль (своя)', kind: 'number', feature: 'morale' },
  { field: 'cohesion', label: 'Слаженность (своя)', kind: 'number', feature: 'cohesion' },
  { field: 'readiness', label: 'Готовность (своя)', kind: 'number', feature: 'readiness' },
  { field: 'suppression', label: 'Подавление (своё), %', kind: 'number', feature: 'suppression' },
  { field: 'fatigue', label: 'Усталость (своя), %', kind: 'number', feature: 'fatigue' },
  { field: 'ammo', label: 'Боезапас (свой), %', kind: 'number', feature: 'ammo' },
  { field: 'fuel', label: 'Топливо (своё), %', kind: 'number', feature: 'fuel' },
  { field: 'equipment', label: 'Снаряжение (своё), %', kind: 'number', feature: 'equipment' },
  { field: 'vehicleCondition', label: 'Техсостояние (своё), %', kind: 'number', feature: 'vehicleCondition' },
  { field: 'comms', label: 'Связь (своя), %', kind: 'number', feature: 'comms' },
  { field: 'supply', label: 'Снабжение (своё), %', kind: 'number' },
  { field: 'losses', label: 'Потери элемента, %', kind: 'number' },
  { field: 'sideLosses', label: 'Потери своей стороны, %', kind: 'number' },
  { field: 'targetClass', label: 'Класс цели', kind: 'class', enemy: true },
  { field: 'enemy.tag', label: 'Тег противника', kind: 'tag', enemy: true },
  { field: 'enemy.kind', label: 'Состав противника', kind: 'kind', enemy: true },
  { field: 'enemy.order', label: 'Приказ противника', kind: 'order', enemy: true },
  { field: 'enemy.behavior', label: 'Поведение противника', kind: 'behavior', enemy: true },
  { field: 'enemy.echelon', label: 'Эшелон противника', kind: 'echelon', enemy: true },
  { field: 'enemy.fortification', label: 'Укрепления противника', kind: 'fort', enemy: true },
  { field: 'enemy.intel', label: 'Разведданные противника', kind: 'intel', enemy: true },
  { field: 'enemy.spotted', label: 'Противник обнаружен', kind: 'bool', feature: 'detection', enemy: true },
  { field: 'enemy.experience', label: 'Опыт противника', kind: 'number', enemy: true },
  { field: 'enemy.morale', label: 'Мораль противника', kind: 'number', feature: 'morale', enemy: true },
  { field: 'enemy.cohesion', label: 'Слаженность противника', kind: 'number', feature: 'cohesion', enemy: true },
  { field: 'enemy.suppression', label: 'Подавление противника, %', kind: 'number', feature: 'suppression', enemy: true },
  { field: 'enemy.fatigue', label: 'Усталость противника, %', kind: 'number', feature: 'fatigue', enemy: true },
  { field: 'enemy.ammo', label: 'Боезапас противника, %', kind: 'number', feature: 'ammo', enemy: true },
  { field: 'enemy.losses', label: 'Потери противника (элемента), %', kind: 'number', enemy: true },
];

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Число с заданным числом знаков после запятой — по-русски, с запятой: 3,5. */
export function dec(v: number, digits = 1): string {
  return v.toFixed(digits).replace('.', ',');
}

export const EVENT_KIND_LABELS: Record<ScenarioEventKind, string> = {
  arrive: 'Подход подкреплений',
  order: 'Смена приказа',
  conditions: 'Смена условий',
  strike: 'Удар огневой поддержки',
  effect: 'Временный эффект',
  band: 'Смена дистанции',
  resupply: 'Подвоз',
  command: 'Командир и связь',
  fortification: 'Укрепления и разведданные',
  transfer: 'Переброска на участок',
};

export const TRIGGER_LABELS: Record<TriggerMetric, string> = {
  losses: 'потери, % ≥',
  out: 'выбыло, % ≥',
  morale: 'мораль ≤',
  band: 'дистанция',
};

/** Все теги набора правил — для подсказок: теги типов, тег разведки и теги из условий своих правил. */
export function rulesetTags(r: Pick<Ruleset, 'componentTypes' | 'reconTag' | 'modifiers'>): string[] {
  const out = new Set<string>();
  for (const t of r.componentTypes) for (const tag of t.tags) out.add(tag);
  if (r.reconTag) out.add(r.reconTag);
  for (const m of r.modifiers)
    for (const c of m.when)
      if (c.field === 'tag' || c.field === 'enemy.tag') for (const v of Array.isArray(c.value) ? c.value : [c.value]) if (String(v).trim()) out.add(String(v));
  return [...out];
}

/** Теги подразделения — теги типов его состава, которые в строю: в бою элемент получает их все. */
export function compositionTags(r: Pick<Ruleset, 'componentTypes'>, composition: ComponentEntry[]): string[] {
  const out = new Set<string>();
  for (const c of composition) {
    if (!(c.current > 0)) continue;
    for (const tag of r.componentTypes.find((t) => t.id === c.typeId)?.tags ?? []) out.add(tag);
  }
  return [...out];
}
