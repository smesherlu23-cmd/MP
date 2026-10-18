// Наборы правил-примеры и «фабрики» новых объектов. Всё это — данные:
// ГМ может скопировать, переименовать или удалить их в программе.

import { COEFFICIENT_DEFAULTS, DEFAULT_FEATURES } from './coefficients';
import { instantiate, newRootUnit, newUnit, walkUnits } from './units';
import type {
  ComponentType,
  Id,
  LevelDef,
  Objective,
  OrderDef,
  Ruleset,
  Scenario,
  SideDef,
  UnitNode,
} from './types';

export const SCHEMA_VERSION = 1;

let idCounter = 0;
/** Уникальный идентификатор для новых объектов (не влияет на расчёт боя). */
export function newId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1679616;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------- общие части наборов правил

const STANDARD_ORDERS: OrderDef[] = [
  { id: 'attack', name: 'Атака', behavior: 'attack', exposure: 1, effects: { protection: 0.75, concealment: 0.6, fatigue: 1.4, ammoUse: 1.2 }, description: 'Сближение с противником и захват позиции.' },
  { id: 'defend', name: 'Оборона', behavior: 'defend', exposure: 1, effects: { protection: 1.3, concealment: 1.3, fatigue: 0.8 }, description: 'Удержание позиции; действуют укрепления.' },
  { id: 'ambush', name: 'Засада', behavior: 'ambush', exposure: 0.8, effects: { fire: 1.1, protection: 1.2, concealment: 2.5, fatigue: 0.7 }, description: 'Пока засада не обнаружена, её первый залп усилен.' },
  { id: 'recon', name: 'Разведка', behavior: 'recon', exposure: 0.5, effects: { fire: 0.5, protection: 1.1, concealment: 1.8, detection: 1.6, fatigue: 1.2, ammoUse: 0.5 }, description: 'Наблюдение, избегание огневого контакта.' },
  { id: 'consolidate', name: 'Закрепление', behavior: 'consolidate', exposure: 0.9, effects: { fire: 0.8, protection: 1.4, concealment: 1.2, fatigue: 0.5, recovery: 1.5 }, description: 'Оборудование позиции, отдых, приведение в порядок.' },
  { id: 'retreat', name: 'Отступление', behavior: 'retreat', exposure: 0.8, effects: { fire: 0.4, protection: 0.8, concealment: 0.8, fatigue: 1.5, moraleLoss: 1.2, ammoUse: 0.5 }, description: 'Организованный выход из боя.' },
  { id: 'rout', name: 'Паническое бегство', behavior: 'rout', exposure: 1, effects: { fire: 0.05, protection: 0.5, concealment: 0.5, fatigue: 2, moraleLoss: 1.5, ammoUse: 0.1 }, description: 'Неуправляемое бегство: большие потери пропавшими и брошенной техникой.' },
  { id: 'reserve', name: 'Резерв', behavior: 'reserve', exposure: 0, effects: { fire: 0, fatigue: 0.3, recovery: 2 }, description: 'Не участвует в бою, пока ГМ не введёт его (или пока не опустеет первая линия).' },
];

const STANDARD_EXPERIENCE: LevelDef[] = [
  { name: 'Новобранцы', effects: { fire: 0.8, protection: 0.85, moraleLoss: 1.3, panic: 1.5, initiative: 0.8, suppression: 1.3, recovery: 0.8, detection: 0.9 } },
  { name: 'Обученные', effects: {} },
  { name: 'Опытные', effects: { fire: 1.1, protection: 1.05, moraleLoss: 0.85, panic: 0.75, initiative: 1.1, suppression: 0.85, recovery: 1.15, detection: 1.05 } },
  { name: 'Ветераны', effects: { fire: 1.25, protection: 1.1, moraleLoss: 0.7, panic: 0.5, initiative: 1.25, suppression: 0.7, recovery: 1.3, detection: 1.1 } },
];

const STANDARD_COMMAND: LevelDef[] = [
  { name: 'Некомпетентный', effects: { fire: 0.9, initiative: 0.7, moraleLoss: 1.2, panic: 1.3, recovery: 0.8 } },
  { name: 'Слабый', effects: { fire: 0.95, initiative: 0.85, moraleLoss: 1.1, panic: 1.15, recovery: 0.9 } },
  { name: 'Обычный', effects: {} },
  { name: 'Умелый', effects: { fire: 1.05, initiative: 1.15, moraleLoss: 0.9, panic: 0.85, recovery: 1.1 } },
  { name: 'Выдающийся', effects: { fire: 1.1, initiative: 1.3, moraleLoss: 0.8, panic: 0.7, recovery: 1.25 } },
];

const STANDARD_OUTCOMES = [
  { id: 'decisive', name: 'Решительная победа', minDiff: 0.5 },
  { id: 'victory', name: 'Победа', minDiff: 0.25 },
  { id: 'marginal', name: 'Незначительный перевес', minDiff: 0.1 },
  { id: 'draw', name: 'Ничья', minDiff: 0 },
];

const STANDARD_TIME = {
  id: 'time',
  name: 'Время суток',
  options: [
    { id: 'day', name: 'День', effects: {} },
    { id: 'twilight', name: 'Сумерки', effects: { detection: 0.75, fire: 0.9 } },
    { id: 'night', name: 'Ночь', effects: { detection: 0.45, fire: 0.75, concealment: 1.3, movement: 0.8, moraleLoss: 1.1, initiative: 0.9 } },
  ],
};

const STANDARD_WEATHER = {
  id: 'weather',
  name: 'Погода',
  options: [
    { id: 'clear', name: 'Ясно', effects: {} },
    { id: 'rain', name: 'Дождь', effects: { detection: 0.8, fatigue: 1.15, movement: 0.85, fire: 0.95 } },
    { id: 'snow', name: 'Снег', effects: { detection: 0.85, fatigue: 1.3, movement: 0.7 } },
    { id: 'fog', name: 'Туман', effects: { detection: 0.5, fire: 0.85, concealment: 1.2 } },
  ],
};

const STANDARD_TERRAIN = {
  id: 'terrain',
  name: 'Местность',
  options: [
    { id: 'plain', name: 'Равнина', effects: { detection: 1.1, protection: 0.9, movement: 1.2 } },
    { id: 'hills', name: 'Холмы', effects: { protection: 1.1, movement: 0.85, fatigue: 1.15 } },
    { id: 'forest', name: 'Лес', effects: { detection: 0.6, concealment: 1.4, protection: 1.2, movement: 0.7, fatigue: 1.2 } },
    { id: 'urban', name: 'Застройка', effects: { detection: 0.7, concealment: 1.3, protection: 1.5, movement: 0.6, ammoUse: 1.2 } },
    { id: 'swamp', name: 'Болото', effects: { detection: 0.9, movement: 0.4, fatigue: 1.5 } },
  ],
};

const STANDARD_FORTIFICATIONS = [
  { id: 'none', name: 'Нет', effects: {} },
  { id: 'hasty', name: 'Наспех оборудованные позиции', effects: { protection: 1.3, concealment: 1.1 } },
  { id: 'prepared', name: 'Подготовленная оборона', effects: { protection: 1.7, concealment: 1.3 } },
  { id: 'fortified', name: 'Долговременные укрепления', effects: { protection: 2.5, concealment: 1.5, moraleLoss: 0.85, recovery: 1.2 } },
];

const STANDARD_INTEL = [
  { id: 'none', name: 'Нет разведданных', effects: { detection: 0.85, initiative: 0.9 } },
  { id: 'partial', name: 'Частичные', effects: {} },
  { id: 'good', name: 'Полные', effects: { detection: 1.3, initiative: 1.15 } },
];

type FP3 = [number, number, number];
function fp(bands: Id[], table: Record<Id, FP3>): Record<Id, Record<Id, number>> {
  const out: Record<Id, Record<Id, number>> = {};
  for (const [cls, vals] of Object.entries(table)) {
    out[cls] = {};
    bands.forEach((b, i) => (out[cls][b] = vals[i] ?? 0));
  }
  return out;
}

function type(t: Partial<ComponentType> & Pick<ComponentType, 'id' | 'name' | 'kind' | 'targetClass' | 'firepower'>): ComponentType {
  return {
    crew: 1,
    value: 1,
    protection: 1,
    indirect: false,
    suppressive: 1,
    ammoUse: 6,
    fuelUse: 0,
    tags: [],
    ...t,
  };
}

// ---------------------------------------------------------------- универсальный пример

export function makeUniversalRuleset(): Ruleset {
  const B = ['long', 'medium', 'close'];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rs-universal',
    name: 'Универсальный (пример)',
    era: 'XX–XXI век, обобщённо',
    description:
      'Пример набора правил. Классы целей, дистанции, каталог типов, приказы, условия и все коэффициенты можно менять — или создать свой набор для другой эпохи.',
    turnMinutes: 15,
    reconTag: 'разведка',
    unitLevels: ['группа', 'отделение', 'взвод', 'рота', 'батарея', 'батальон', 'дивизион', 'полк', 'бригада', 'дивизия'],
    features: { ...DEFAULT_FEATURES },
    targetClasses: [
      { id: 'inf', name: 'Живая сила', lethality: 1, description: 'Пехота, расчёты, открыто расположенные люди.' },
      { id: 'soft', name: 'Небронированная техника', lethality: 1 },
      { id: 'armor', name: 'Бронетехника', lethality: 1 },
    ],
    rangeBands: [
      { id: 'long', name: 'Дальняя', detection: 0.35, turnsToClose: 3, description: 'За пределами действенного огня стрелкового оружия.' },
      { id: 'medium', name: 'Средняя', detection: 0.6, turnsToClose: 3, description: 'Действенный огонь стрелкового оружия и ПТ-средств.' },
      { id: 'close', name: 'Ближняя', detection: 0.9, turnsToClose: 1, description: 'Ближний бой, штурм позиций.' },
    ],
    componentTypes: [
      type({ id: 'rifleman', name: 'Стрелок', kind: 'personnel', targetClass: 'inf', value: 1, ammoUse: 5,
        firepower: fp(B, { inf: [0.01, 0.035, 0.1], soft: [0.002, 0.01, 0.025], armor: [0, 0, 0.002] }) }),
      type({ id: 'scout', name: 'Разведчик', kind: 'personnel', targetClass: 'inf', value: 1.3, ammoUse: 5, tags: ['разведка'],
        firepower: fp(B, { inf: [0.01, 0.035, 0.1], soft: [0.002, 0.01, 0.025], armor: [0, 0, 0.002] }) }),
      type({ id: 'mg', name: 'Пулемёт', kind: 'weapon', targetClass: 'inf', crew: 3, value: 4, protection: 1.2, suppressive: 2, ammoUse: 6,
        firepower: fp(B, { inf: [0.07, 0.2, 0.3], soft: [0.02, 0.05, 0.07], armor: [0, 0, 0] }) }),
      type({ id: 'at', name: 'Противотанковое средство', kind: 'weapon', targetClass: 'inf', crew: 2, value: 5, protection: 1.2, ammoUse: 7,
        firepower: fp(B, { inf: [0.01, 0.025, 0.04], soft: [0.12, 0.2, 0.25], armor: [0.1, 0.2, 0.25] }) }),
      type({ id: 'mortar', name: 'Миномёт', kind: 'weapon', targetClass: 'inf', crew: 4, value: 6, indirect: true, suppressive: 3, ammoUse: 7,
        firepower: fp(B, { inf: [0.25, 0.25, 0.15], soft: [0.1, 0.1, 0.07], armor: [0.01, 0.01, 0.008] }) }),
      type({ id: 'gun', name: 'Артиллерийское орудие', kind: 'weapon', targetClass: 'inf', crew: 6, value: 10, indirect: true, suppressive: 3, ammoUse: 6,
        firepower: fp(B, { inf: [0.7, 0.7, 0.3], soft: [0.3, 0.3, 0.15], armor: [0.04, 0.04, 0.025] }) }),
      type({ id: 'truck', name: 'Грузовик', kind: 'vehicle', targetClass: 'soft', crew: 1, value: 1.5, protection: 1, ammoUse: 0, fuelUse: 4,
        firepower: fp(B, { inf: [0, 0, 0], soft: [0, 0, 0], armor: [0, 0, 0] }) }),
      type({ id: 'apc', name: 'Бронетранспортёр', kind: 'vehicle', targetClass: 'armor', crew: 2, value: 8, protection: 0.7, ammoUse: 6, fuelUse: 5,
        firepower: fp(B, { inf: [0.07, 0.2, 0.25], soft: [0.07, 0.15, 0.2], armor: [0.008, 0.02, 0.04] }) }),
      type({ id: 'tank', name: 'Танк', kind: 'vehicle', targetClass: 'armor', crew: 3, value: 20, protection: 1.3, suppressive: 1.5, ammoUse: 6, fuelUse: 6,
        tags: ['ночное видение'],
        firepower: fp(B, { inf: [0.2, 0.35, 0.45], soft: [0.35, 0.45, 0.45], armor: [0.3, 0.45, 0.5] }) }),
    ],
    orders: STANDARD_ORDERS,
    experienceLevels: STANDARD_EXPERIENCE,
    commandLevels: STANDARD_COMMAND,
    conditions: [STANDARD_TERRAIN, STANDARD_TIME, STANDARD_WEATHER],
    fortifications: STANDARD_FORTIFICATIONS,
    intelLevels: STANDARD_INTEL,
    modifiers: [
      {
        id: 'mod-nv',
        name: 'Ночное видение',
        description: 'Ночью и в сумерках элементы с тегом «ночное видение» частично компенсируют темноту.',
        enabled: true,
        when: [
          { field: 'cond.time', op: 'in', value: ['night', 'twilight'] },
          { field: 'tag', op: 'has', value: 'ночное видение' },
        ],
        effects: { detection: 1.8, fire: 1.25 },
      },
      {
        id: 'mod-swamp-vehicles',
        name: 'Болото: техника вязнет',
        description: 'Элементы с техникой в болоте двигаются вдвое медленнее и быстрее изнашиваются.',
        enabled: true,
        when: [
          { field: 'cond.terrain', op: 'eq', value: 'swamp' },
          { field: 'kind', op: 'has', value: 'vehicle' },
        ],
        effects: { movement: 0.5, fatigue: 1.2 },
      },
      {
        id: 'mod-urban-at',
        name: 'Город: ближний бой с бронетехникой',
        description: 'В застройке на ближней дистанции пехота гораздо опаснее для бронетехники.',
        enabled: true,
        when: [
          { field: 'cond.terrain', op: 'eq', value: 'urban' },
          { field: 'range', op: 'eq', value: 'close' },
          { field: 'targetClass', op: 'eq', value: 'armor' },
        ],
        effects: { fire: 1.5 },
      },
    ],
    outcomeLevels: STANDARD_OUTCOMES,
    coefficients: { ...COEFFICIENT_DEFAULTS },
  };
}

// ---------------------------------------------------------------- пример другой эпохи

export function makeLinearRuleset(): Ruleset {
  const B = ['artillery', 'musket', 'melee'];
  const base = makeUniversalRuleset();
  return {
    ...base,
    id: 'rs-linear',
    name: 'Линейная тактика (пример)',
    era: 'XVIII — середина XIX века',
    description: 'Пример набора правил для эпохи гладкоствольного оружия: мушкеты, кавалерия, полевая артиллерия. Показывает, как настроить симулятор под другую эпоху.',
    turnMinutes: 20,
    reconTag: 'лёгкая',
    unitLevels: ['взвод', 'рота', 'эскадрон', 'батарея', 'батальон', 'полк', 'бригада', 'дивизия', 'корпус'],
    targetClasses: [
      { id: 'inf', name: 'Пехота', lethality: 1 },
      { id: 'cav', name: 'Кавалерия', lethality: 1 },
      { id: 'art', name: 'Артиллерия', lethality: 0.8 },
    ],
    rangeBands: [
      { id: 'artillery', name: 'Артиллерийская (600–1200 шагов)', detection: 0.7, turnsToClose: 2 },
      { id: 'musket', name: 'Мушкетная (до 200 шагов)', detection: 0.95, turnsToClose: 2 },
      { id: 'melee', name: 'Штыковой бой / сшибка', detection: 1, turnsToClose: 1 },
    ],
    componentTypes: [
      type({ id: 'musketeer', name: 'Мушкетёр', kind: 'personnel', targetClass: 'inf', value: 1, ammoUse: 5,
        firepower: fp(B, { inf: [0, 0.012, 0.03], cav: [0, 0.01, 0.025], art: [0, 0.006, 0.03] }) }),
      type({ id: 'grenadier', name: 'Гренадер', kind: 'personnel', targetClass: 'inf', value: 1.3, ammoUse: 5,
        firepower: fp(B, { inf: [0, 0.012, 0.045], cav: [0, 0.01, 0.03], art: [0, 0.006, 0.04] }) }),
      type({ id: 'jaeger', name: 'Егерь (стрелок)', kind: 'personnel', targetClass: 'inf', value: 1.4, ammoUse: 5, tags: ['лёгкая'],
        firepower: fp(B, { inf: [0.002, 0.02, 0.02], cav: [0.001, 0.015, 0.015], art: [0.003, 0.02, 0.02] }) }),
      type({ id: 'cuirassier', name: 'Кирасир', kind: 'personnel', targetClass: 'cav', value: 3, protection: 1.2, ammoUse: 1, tags: ['кавалерия'],
        firepower: fp(B, { inf: [0, 0, 0.09], cav: [0, 0, 0.08], art: [0, 0, 0.12] }) }),
      type({ id: 'hussar', name: 'Гусар', kind: 'personnel', targetClass: 'cav', value: 2.2, ammoUse: 1, tags: ['лёгкая', 'кавалерия'],
        firepower: fp(B, { inf: [0, 0.002, 0.06], cav: [0, 0.002, 0.06], art: [0, 0.002, 0.1] }) }),
      type({ id: 'fieldgun', name: 'Полевое орудие', kind: 'weapon', targetClass: 'art', crew: 10, value: 12, suppressive: 2.5, ammoUse: 8,
        firepower: fp(B, { inf: [0.25, 0.5, 0.3], cav: [0.15, 0.4, 0.2], art: [0.08, 0.1, 0.05] }) }),
    ],
    conditions: [
      {
        id: 'terrain',
        name: 'Местность',
        options: [
          { id: 'plain', name: 'Равнина', effects: { movement: 1.1 } },
          { id: 'hills', name: 'Холмы', effects: { protection: 1.15, movement: 0.85 } },
          { id: 'forest', name: 'Лес', effects: { detection: 0.6, protection: 1.3, movement: 0.6 } },
          { id: 'village', name: 'Деревня', effects: { protection: 1.5, movement: 0.7 } },
          { id: 'marsh', name: 'Болото', effects: { movement: 0.4, fatigue: 1.5 } },
        ],
      },
      { ...STANDARD_TIME, options: STANDARD_TIME.options.map((o) => (o.id === 'night' ? { ...o, effects: { ...o.effects, fire: 0.5 } } : o)) },
      {
        ...STANDARD_WEATHER,
        options: [
          ...STANDARD_WEATHER.options.filter((o) => o.id !== 'rain'),
          { id: 'rain', name: 'Дождь (подмоченный порох)', effects: { fire: 0.6, detection: 0.85, fatigue: 1.15, movement: 0.85 } },
        ],
      },
    ],
    fortifications: [
      { id: 'none', name: 'Нет', effects: {} },
      { id: 'earthworks', name: 'Полевые укрепления (редуты, флеши)', effects: { protection: 1.6, moraleLoss: 0.9 } },
      { id: 'fortress', name: 'Крепость', effects: { protection: 3, moraleLoss: 0.8 } },
    ],
    modifiers: [
      {
        id: 'mod-cav-forest',
        name: 'Кавалерия в лесу и болоте',
        description: 'Кавалерия теряет натиск в лесу и на болоте.',
        enabled: true,
        when: [
          { field: 'cond.terrain', op: 'in', value: ['forest', 'marsh'] },
          { field: 'tag', op: 'has', value: 'кавалерия' },
        ],
        effects: { fire: 0.5, movement: 0.6 },
      },
      {
        id: 'mod-square',
        name: 'Каре против кавалерии',
        description: 'Пехота в обороне встречает кавалерию сомкнутым строем.',
        enabled: true,
        when: [
          { field: 'behavior', op: 'eq', value: 'defend' },
          { field: 'targetClass', op: 'eq', value: 'cav' },
        ],
        effects: { fire: 1.5 },
      },
    ],
    features: { ...DEFAULT_FEATURES, fuel: false, breakdowns: false, vehicleCondition: false, comms: false },
    // Потери от залпов и штыков выше, чем у «универсального» набора, а исход решает мораль.
    coefficients: { ...COEFFICIENT_DEFAULTS, casualtyScale: 3, moralePerLossPct: 2, killedShare: 0.3, woundedShare: 0.55, missingShare: 0.15 },
  };
}

/** Новый набор правил: общая структура без каталога типов и без своих модификаторов. */
export function makeBlankRuleset(name = 'Новый набор правил'): Ruleset {
  const r = makeUniversalRuleset();
  return {
    ...r,
    id: newId('rs'),
    name,
    era: '',
    description: '',
    componentTypes: [],
    modifiers: [],
  };
}

/** Уровень командира в начале боя: первый «нейтральный» (без влияния), иначе средний. */
export function defaultCommandLevel(rs: Pick<Ruleset, 'commandLevels'>): number {
  const n = rs.commandLevels.length;
  if (!n) return 0;
  const i = rs.commandLevels.findIndex((l) => Object.values(l.effects ?? {}).every((v) => v === undefined || v === 1));
  return i >= 0 ? i + 1 : Math.ceil(n / 2);
}

/** Заполняет поля, которых нет в старых файлах, значениями по умолчанию. */
export function normalizeRuleset(r: Ruleset): Ruleset {
  const base = makeUniversalRuleset();
  const out: Ruleset = { ...base, ...r };
  out.schemaVersion = SCHEMA_VERSION;
  out.features = { ...DEFAULT_FEATURES, ...(r.features ?? {}) };
  out.coefficients = { ...COEFFICIENT_DEFAULTS, ...(r.coefficients ?? {}) };
  out.targetClasses = r.targetClasses ?? [];
  out.rangeBands = r.rangeBands ?? [];
  out.componentTypes = (r.componentTypes ?? []).map((t) => ({ ...type({ ...t }), ...t, tags: t.tags ?? [] }));
  out.orders = r.orders?.length ? r.orders : base.orders;
  out.experienceLevels = r.experienceLevels?.length ? r.experienceLevels : base.experienceLevels;
  out.commandLevels = r.commandLevels?.length ? r.commandLevels : base.commandLevels;
  out.conditions = r.conditions ?? [];
  out.fortifications = r.fortifications?.length ? r.fortifications : base.fortifications;
  out.intelLevels = r.intelLevels?.length ? r.intelLevels : base.intelLevels;
  out.modifiers = r.modifiers ?? [];
  out.unitLevels = Array.isArray(r.unitLevels) ? r.unitLevels : base.unitLevels;
  out.outcomeLevels = r.outcomeLevels?.length ? r.outcomeLevels : base.outcomeLevels;
  return out;
}

// ---------------------------------------------------------------- фабрики

export function newObjective(type: Objective['type'], value = 0, weight = 1): Objective {
  return { id: newId('obj'), type, value, weight };
}

export function newSide(id: 'A' | 'B', rs: Ruleset): SideDef {
  return {
    id,
    name: id === 'A' ? 'Синие' : 'Красные',
    color: id === 'A' ? '#3b82f6' : '#ef4444',
    formations: [],
    fortification: rs.fortifications[0]?.id ?? 'none',
    intel: rs.intelLevels[Math.min(1, rs.intelLevels.length - 1)]?.id ?? 'none',
    objectives: [],
  };
}

export function newScenario(rs: Ruleset, name = 'Новый сценарий', seed = 'seed-1'): Scenario {
  const conditions: Record<Id, Id> = {};
  for (const cat of rs.conditions) if (cat.options[0]) conditions[cat.id] = cat.options[0].id;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('sc'),
    name,
    description: '',
    rulesetId: rs.id,
    conditions,
    startBand: rs.rangeBands[0]?.id ?? '',
    maxTurns: 20,
    seed,
    sides: [newSide('A', rs), newSide('B', rs)],
  };
}

// ---------------------------------------------------------------- демонстрационные данные

const comp = (typeId: string, authorized: number, current = authorized) => ({ typeId, authorized, current });

/** Шаблоны: из них в примерах собраны батальон и оборонительный узел. */
export function makeDemoTemplates(): UnitNode[] {
  return [
    newRootUnit('Мотострелковый взвод', {
      id: 'demo-tpl-msv',
      level: 'взвод',
      commandLevel: null,
      composition: [comp('rifleman', 30), comp('mg', 2), comp('at', 1)],
    }),
    newRootUnit('Мотострелковая рота', {
      id: 'demo-tpl-msr',
      level: 'рота',
      commandLevel: null,
      composition: [comp('rifleman', 90), comp('mg', 3), comp('at', 3), comp('apc', 10)],
    }),
    newRootUnit('Танковая рота', {
      id: 'demo-tpl-tr',
      level: 'рота',
      commandLevel: null,
      state: { experience: 3 },
      composition: [comp('tank', 10)],
    }),
  ];
}

const tpl = (id: string) => makeDemoTemplates().find((t) => t.id === id)!;

function fromTemplate(id: string, name: string, patch: Partial<UnitNode> = {}, current: Record<string, number> = {}): UnitNode {
  const c = instantiate(tpl(id), { name });
  // У вставленной копии свои значения состояния не задаём — она наследует их от старшего.
  c.state = { ...(patch.state ?? {}) };
  c.comms = null;
  c.supply = null;
  c.echelon = null;
  c.order = null;
  Object.assign(c, { ...patch, state: c.state });
  for (const [typeId, v] of Object.entries(current)) {
    const e = c.composition.find((x) => x.typeId === typeId);
    if (e) e.current = v;
  }
  return c;
}

/** Копия может отличаться от шаблона: здесь у резервного взвода нет противотанкового средства. */
function withoutType(u: UnitNode, typeId: string): UnitNode {
  u.composition = u.composition.filter((c) => c.typeId !== typeId);
  return u;
}

export function makeDemoBattalion(): UnitNode {
  return newRootUnit('1-й мотострелковый батальон (пример)', {
    id: 'demo-bn',
    level: 'батальон',
    commanderName: 'майор Орлов',
    commandLevel: 4,
    comms: 85,
    supply: 80,
    order: 'attack',
    children: [
      newUnit('Штаб батальона', { id: 'demo-bn-hq', level: 'штаб', echelon: 'rear', isHQ: true, composition: [comp('rifleman', 20), comp('apc', 2), comp('truck', 4)] }),
      fromTemplate('demo-tpl-msr', '1-я мотострелковая рота', { id: 'demo-bn-c1' }, { rifleman: 84, apc: 9 }),
      fromTemplate('demo-tpl-msr', '2-я мотострелковая рота', { id: 'demo-bn-c2' }, { rifleman: 84, apc: 9 }),
      fromTemplate(
        'demo-tpl-msr',
        '3-я мотострелковая рота',
        { id: 'demo-bn-c3', order: 'reserve', echelon: 'rear', notes: 'Резерв командира батальона: введите её в бой сменой приказа.' },
        { rifleman: 84, apc: 9 },
      ),
      newUnit('Миномётная батарея', { id: 'demo-bn-mort', level: 'батарея', echelon: 'support', composition: [comp('mortar', 6), comp('truck', 6)] }),
      newUnit('Разведвзвод', { id: 'demo-bn-recon', level: 'взвод', order: 'recon', state: { experience: 3 }, composition: [comp('scout', 20), comp('apc', 3)] }),
      fromTemplate('demo-tpl-tr', 'Танковая рота', { id: 'demo-bn-tank', echelon: 'support', attachedFrom: 'отдельный танковый батальон', state: { experience: 3 } }, { tank: 9 }),
    ],
  });
}

export function makeDemoDefenders(): UnitNode {
  return newRootUnit('Оборонительный узел «Высота 212» (пример)', {
    id: 'demo-def',
    level: 'усиленная рота',
    commanderName: 'капитан Вольф',
    commandLevel: 3,
    comms: 70,
    supply: 60,
    order: 'defend',
    children: [
      newUnit('Командный пункт', { id: 'demo-def-hq', level: 'штаб', echelon: 'rear', isHQ: true, composition: [comp('rifleman', 10)] }),
      fromTemplate('demo-tpl-msv', '1-й взвод', { id: 'demo-def-p1', state: { experience: 3 } }, { rifleman: 28 }),
      fromTemplate('demo-tpl-msv', '2-й взвод', { id: 'demo-def-p2' }, { rifleman: 27 }),
      fromTemplate('demo-tpl-msv', '3-й взвод', { id: 'demo-def-p3' }),
      newUnit('Противотанковый взвод', { id: 'demo-def-at', level: 'взвод', echelon: 'support', composition: [comp('at', 6), comp('truck', 3)] }),
      newUnit('Миномётный взвод', { id: 'demo-def-mort', level: 'взвод', echelon: 'support', composition: [comp('mortar', 4)] }),
      withoutType(fromTemplate('demo-tpl-msv', 'Резервный взвод', { id: 'demo-def-res', order: 'reserve', echelon: 'rear' }, { rifleman: 26 }), 'at'),
    ],
  });
}

// ---------------------------------------------------------------- пример для «Линейной тактики»

/** Шаблоны эпохи линейной тактики: из них собраны бригада и оборона переправы (кирасиры — без шаблона). */
export function makeLinearTemplates(): UnitNode[] {
  const rs = 'rs-linear';
  const company = (name: string, typeId: string, n: number) => newUnit(name, { level: 'рота', composition: [comp(typeId, n)] });
  return [
    newRootUnit('Линейный пехотный батальон', {
      id: 'demo-lin-tpl-bn',
      level: 'батальон',
      rulesetId: rs,
      children: [
        company('Гренадерская рота', 'grenadier', 110),
        company('1-я мушкетёрская рота', 'musketeer', 120),
        company('2-я мушкетёрская рота', 'musketeer', 120),
        company('3-я мушкетёрская рота', 'musketeer', 120),
        newUnit('Застрельщики', { level: 'взвод', order: 'recon', echelon: 'support', composition: [comp('jaeger', 50)] }),
      ],
    }),
    newRootUnit('Пешая батарея', { id: 'demo-lin-tpl-bat', level: 'батарея', rulesetId: rs, commandLevel: null, echelon: 'support', composition: [comp('fieldgun', 8)] }),
    newRootUnit('Гусарский эскадрон', { id: 'demo-lin-tpl-hus', level: 'эскадрон', rulesetId: rs, commandLevel: null, composition: [comp('hussar', 120)] }),
  ];
}

const linTpl = (id: string) => makeLinearTemplates().find((t) => t.id === id)!;

function linCopy(id: string, name: string, patch: Partial<UnitNode> = {}): UnitNode {
  const c = instantiate(linTpl(id), { name });
  c.state = { ...(patch.state ?? {}) };
  c.order = null;
  Object.assign(c, { ...patch, state: c.state });
  return c;
}

export function makeLinearBrigade(): UnitNode {
  return newRootUnit('Пехотная бригада (пример)', {
    id: 'demo-lin-brig',
    level: 'бригада',
    rulesetId: 'rs-linear',
    commanderName: 'генерал-майор Раевский',
    order: 'attack',
    supply: 85,
    children: [
      linCopy('demo-lin-tpl-bn', '1-й батальон'),
      linCopy('demo-lin-tpl-bn', '2-й батальон'),
      linCopy('demo-lin-tpl-bat', 'Батарея'),
      linCopy('demo-lin-tpl-hus', '1-й гусарский эскадрон', { echelon: 'support' }),
      linCopy('demo-lin-tpl-hus', '2-й гусарский эскадрон', { order: 'reserve', echelon: 'rear', notes: 'Резерв бригады: введите в бой сменой приказа, когда пехота расстроит оборону.' }),
    ],
  });
}

export function makeLinearDefenders(): UnitNode {
  return newRootUnit('Оборона переправы (пример)', {
    id: 'demo-lin-def',
    level: 'полк',
    rulesetId: 'rs-linear',
    commanderName: 'полковник Дюбуа',
    order: 'defend',
    supply: 70,
    children: [
      linCopy('demo-lin-tpl-bn', 'Батальон у переправы', { state: { experience: 3 } }),
      linCopy('demo-lin-tpl-bat', 'Батарея на холме'),
      newUnit('Кирасиры', {
        level: 'эскадрон',
        order: 'reserve',
        echelon: 'rear',
        state: { experience: 3 },
        composition: [comp('cuirassier', 110)],
        notes: 'Контратака по усмотрению ГМ.',
      }),
    ],
  });
}

export function makeLinearScenario(): Scenario {
  const rs = makeLinearRuleset();
  const sc = newScenario(rs, 'Пример: бой у переправы (линейная тактика)', 'LIN-0001');
  sc.id = 'sc-demo-linear';
  sc.description =
    'Пехотная бригада с батареей и гусарами штурмует переправу, которую держит батальон за полевыми укреплениями при батарее; кирасиры обороны — в резерве. ' +
    'Ход — 20 минут, бой открывается артиллерийской дистанцией. По плану боя второй гусарский эскадрон вводится на 8-м ходу, а кирасиры около 9-го хода контратакуют (не всегда — вероятность 60%); ГМ может ввести резервы и раньше сменой приказа.';
  sc.conditions = { terrain: 'hills', time: 'day', weather: 'clear' };
  sc.maxTurns = 16;
  sc.sides[0].name = 'Синие';
  sc.sides[0].formations = [instantiate(makeLinearBrigade())];
  sc.sides[0].objectives = [newObjective('take', 0, 2), newObjective('preserve', 30, 1)];
  sc.sides[1].name = 'Красные';
  sc.sides[1].formations = [instantiate(makeLinearDefenders())];
  sc.sides[1].fortification = 'earthworks';
  sc.sides[1].objectives = [newObjective('hold', 12, 2), newObjective('inflict', 20, 1)];
  // План боя: резервы вводятся по ходам — и в бою, и в массовых прогонах.
  const node = (side: 0 | 1, name: string) => {
    let id = '';
    for (const f of sc.sides[side].formations) walkUnits(f, (n) => void (n.name === name && (id = n.id)));
    return id;
  };
  sc.events = [
    { id: 'ev-lin-hussars', kind: 'order', turn: 8, side: 'A', nodeId: node(0, '2-й гусарский эскадрон'), orderId: 'attack', note: 'резерв бригады вводится в бой' },
    { id: 'ev-lin-cuir', kind: 'order', turn: 9, spread: 1, chance: 60, side: 'B', nodeId: node(1, 'Кирасиры'), orderId: 'attack', note: 'контратака кирасир' },
  ];
  return sc;
}

export function makeDemoScenario(): Scenario {
  const rs = makeUniversalRuleset();
  const sc = newScenario(rs, 'Пример: атака на высоту 212', 'DEMO-0001');
  sc.id = 'sc-demo';
  sc.description =
    'Мотострелковый батальон с приданной танковой ротой атакует подготовленный оборонительный узел усиленной роты. Сумерки, холмы. 3-я рота — в резерве комбата: ГМ может ввести её в бой между ходами (смена приказа), иначе она вступит, только если первая линия выбудет.';
  sc.conditions = { terrain: 'hills', time: 'twilight', weather: 'clear' };
  sc.maxTurns = 16;
  sc.sides[0].name = 'Синие';
  sc.sides[0].formations = [instantiate(makeDemoBattalion())];
  sc.sides[0].intel = 'partial';
  sc.sides[0].objectives = [newObjective('take', 0, 2), newObjective('preserve', 25, 1)];
  sc.sides[1].name = 'Красные';
  sc.sides[1].formations = [instantiate(makeDemoDefenders())];
  sc.sides[1].fortification = 'prepared';
  sc.sides[1].intel = 'partial';
  sc.sides[1].objectives = [newObjective('hold', 12, 2), newObjective('inflict', 20, 1)];
  return sc;
}
