// Наборы правил-примеры и «фабрики» новых объектов. Всё это — данные:
// ГМ может скопировать, переименовать или удалить их в программе.

import { COEFFICIENT_DEFAULTS, COMPAT_NEUTRAL, DEFAULT_FEATURES, RECALIBRATED } from './coefficients';
import { turnsFor } from './duration';
import { newId } from './ids';
import { instantiate, newRootUnit, newUnit, walkUnits } from './units';
import type { ComponentType, Weapon, CustomModifier, EffectDef, Id, LevelDef, Objective, OrderDef, Ruleset, Scenario, SideDef, UnitNode } from './types';

export const SCHEMA_VERSION = 1;

/**
 * Версия данных наборов правил и сценариев — хранится в самих файлах, чтобы одноразовые обновления
 * выполнялись один раз для данных, а не для компьютера: 2 — калибровка коэффициентов, длительность в часах;
 * 3 — эталонная длина хода, удача 0,25, подавление, опыт, танки и правила примера; 4 — вооружение типов
 * (урон мин.–макс., точность по дистанциям) вместо таблицы огневой мощи.
 */
export const DATA_VERSION = 4;

export { newId } from './ids';

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------- общие части наборов правил

const STANDARD_ORDERS: OrderDef[] = [
  {
    id: 'attack',
    name: 'Атака',
    behavior: 'attack',
    exposure: 1,
    effects: { protection: 0.75, concealment: 0.6, fatigue: 1.4, ammoUse: 1.2 },
    description: 'Сближение с противником и захват позиции.',
  },
  {
    id: 'defend',
    name: 'Оборона',
    behavior: 'defend',
    exposure: 1,
    effects: { protection: 1.3, concealment: 1.3, fatigue: 0.8 },
    description: 'Удержание позиции; действуют укрепления.',
  },
  {
    id: 'ambush',
    name: 'Засада',
    behavior: 'ambush',
    exposure: 0.8,
    effects: { fire: 1.1, protection: 1.2, concealment: 2.5, fatigue: 0.7 },
    description: 'Пока засада не обнаружена, её первый залп усилен.',
  },
  {
    id: 'recon',
    name: 'Разведка',
    behavior: 'recon',
    exposure: 0.5,
    effects: { fire: 0.5, protection: 1.1, concealment: 1.8, detection: 1.6, fatigue: 1.2, ammoUse: 0.5 },
    description: 'Наблюдение, избегание огневого контакта.',
  },
  {
    id: 'consolidate',
    name: 'Закрепление',
    behavior: 'consolidate',
    exposure: 0.9,
    effects: { fire: 0.8, protection: 1.4, concealment: 1.2, fatigue: 0.5, recovery: 1.5 },
    description: 'Оборудование позиции, отдых, приведение в порядок.',
  },
  {
    id: 'retreat',
    name: 'Отступление',
    behavior: 'retreat',
    exposure: 0.8,
    effects: { fire: 0.4, protection: 0.8, concealment: 0.8, fatigue: 1.5, moraleLoss: 1.2, ammoUse: 0.5 },
    description: 'Организованный выход из боя.',
  },
  {
    id: 'rout',
    name: 'Паническое бегство',
    behavior: 'rout',
    exposure: 1,
    effects: { fire: 0.05, protection: 0.5, concealment: 0.5, fatigue: 2, moraleLoss: 1.5, ammoUse: 0.1 },
    description: 'Неуправляемое бегство: большие потери пропавшими и брошенной техникой.',
  },
  {
    id: 'reserve',
    name: 'Резерв',
    behavior: 'reserve',
    exposure: 0,
    effects: { fire: 0, fatigue: 0.3, recovery: 2 },
    description: 'Не участвует в бою, пока ГМ не введёт его (или пока не опустеет первая линия).',
  },
];

// Ветераны на равных бьют новобранцев примерно в 4 боях из 5, а двойной перевес новобранцев даёт им шанс
// (около 20%). До версии данных 3 опыт был сильнее двукратного перевеса — см. PREVIOUS_EXPERIENCE.
const STANDARD_EXPERIENCE: LevelDef[] = [
  {
    name: 'Новобранцы',
    effects: { fire: 0.9, protection: 0.95, moraleLoss: 1.2, panic: 1.3, initiative: 0.9, suppression: 1.2, recovery: 0.9, detection: 0.95 },
  },
  { name: 'Обученные', effects: {} },
  {
    name: 'Опытные',
    effects: { fire: 1.05, protection: 1.02, moraleLoss: 0.9, panic: 0.85, initiative: 1.05, suppression: 0.9, recovery: 1.1, detection: 1.05 },
  },
  {
    name: 'Ветераны',
    effects: { fire: 1.15, protection: 1.05, moraleLoss: 0.8, panic: 0.7, initiative: 1.15, suppression: 0.8, recovery: 1.2, detection: 1.1 },
  },
];

/** Уровни опыта примера до версии данных 3: в наборе, где их не меняли, они заменяются на нынешние. */
const PREVIOUS_EXPERIENCE: LevelDef[] = [
  {
    name: 'Новобранцы',
    effects: { fire: 0.8, protection: 0.85, moraleLoss: 1.3, panic: 1.5, initiative: 0.8, suppression: 1.3, recovery: 0.8, detection: 0.9 },
  },
  { name: 'Обученные', effects: {} },
  {
    name: 'Опытные',
    effects: { fire: 1.1, protection: 1.05, moraleLoss: 0.85, panic: 0.75, initiative: 1.1, suppression: 0.85, recovery: 1.15, detection: 1.05 },
  },
  {
    name: 'Ветераны',
    effects: { fire: 1.25, protection: 1.1, moraleLoss: 0.7, panic: 0.5, initiative: 1.25, suppression: 0.7, recovery: 1.3, detection: 1.1 },
  },
];

/** Огонь танка примера по живой силе до версии данных 3 (дальняя, средняя, ближняя). */
const PREVIOUS_TANK_INF = [0.2, 0.35, 0.45];
const TANK_INF: [number, number, number] = [0.35, 0.7, 0.9];

/** Правило примера: пехоту без противотанковых средств танки давят морально. */
const TANK_FEAR_RULE: CustomModifier = {
  id: 'mod-tank-fear',
  name: 'Танки против пехоты без ПТ-средств',
  description: 'Пехота, которой нечем ответить танкам, теряет мораль быстрее (по доле огня танков по ней).',
  enabled: true,
  when: [
    { field: 'tag', op: 'not_has', value: 'ПТ' },
    { field: 'enemy.tag', op: 'has', value: 'танк' },
  ],
  effects: { moraleLoss: 1.3, panic: 1.3 },
};

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

/** Заготовки временных эффектов: ГМ накладывает их в бою или по плану боя. */
const STANDARD_EFFECTS: EffectDef[] = [
  {
    id: 'smoke',
    name: 'Дымовая завеса',
    turns: 2,
    effects: { concealment: 2.5, detection: 0.5, fire: 0.8 },
    description: 'Скрывает своих от наблюдения, но и мешает вести огонь.',
  },
  { id: 'surprise', name: 'Внезапность', turns: 1, effects: { fire: 1.3, initiative: 1.5, protection: 1.1 }, description: 'Удар, которого противник не ждал.' },
  { id: 'flares', name: 'Осветительные ракеты', turns: 2, effects: { detection: 1.6 }, description: 'Подсветка поля боя ночью и в сумерках.' },
  {
    id: 'confusion',
    name: 'Растерянность',
    turns: 2,
    effects: { initiative: 0.6, moraleLoss: 1.4, fire: 0.85 },
    description: 'Потеря управления, неразбериха, ложные слухи.',
  },
  {
    id: 'inspired',
    name: 'Воодушевление',
    turns: 3,
    effects: { moraleLoss: 0.7, panic: 0.6, recovery: 1.3 },
    description: 'Пример командира, удачный момент, подход своих.',
  },
];

type MM = [number, number];
/** Вооружение типа: вид, урон по классам целей [мин, макс], расход боезапаса. */
const wpn = (weaponType: Id, damage: Record<Id, MM>, ammoUse = 0): Weapon => ({ weaponType, damage, ammoUse });
const acc = (bands: Id[], vals: number[]) => Object.fromEntries(bands.map((b, i) => [b, vals[i] ?? 1]));

function type(t: Partial<ComponentType> & Pick<ComponentType, 'id' | 'name' | 'kind' | 'targetClass'>): ComponentType {
  return {
    firepower: {},
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
    dataVersion: DATA_VERSION,
    id: 'rs-universal',
    name: 'Универсальный (пример)',
    description:
      'Пример набора правил. Классы целей, дистанции, каталог типов, приказы, условия и все коэффициенты можно менять — или создать свой набор для другой эпохи.',
    turnMinutes: 15,
    reconTag: 'разведка',
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
    weaponTypes: [
      { id: 'w-rifle', name: 'Стрелковое оружие', accuracy: acc(B, [0.1, 0.35, 1]), ammo: true },
      { id: 'w-mg', name: 'Пулемёт', accuracy: acc(B, [0.25, 0.67, 1]), ammo: true },
      { id: 'w-at', name: 'Противотанковое оружие', accuracy: acc(B, [0.45, 0.8, 1]), ammo: true },
      { id: 'w-mortar', name: 'Миномёт', accuracy: acc(B, [1, 1, 0.6]), ammo: true },
      { id: 'w-gun', name: 'Артиллерийское орудие', accuracy: acc(B, [1, 1, 0.45]), ammo: true },
      { id: 'w-tankgun', name: 'Танковая пушка', accuracy: acc(B, [0.6, 0.9, 1]), ammo: true },
    ],
    componentTypes: [
      type({
        id: 'rifleman',
        name: 'Стрелок',
        kind: 'personnel',
        targetClass: 'inf',
        value: 1,
        ammoUse: 5,
        weapons: [wpn('w-rifle', { inf: [0.08, 0.12], soft: [0.02, 0.03], armor: [0, 0.004] }, 5)],
      }),
      type({
        id: 'scout',
        name: 'Разведчик',
        kind: 'personnel',
        targetClass: 'inf',
        value: 1.3,
        ammoUse: 5,
        tags: ['разведка'],
        weapons: [wpn('w-rifle', { inf: [0.08, 0.12], soft: [0.02, 0.03], armor: [0, 0.004] }, 5)],
      }),
      type({
        id: 'mg',
        name: 'Пулемёт',
        kind: 'weapon',
        targetClass: 'inf',
        crew: 3,
        value: 4,
        protection: 1.2,
        suppressive: 2,
        ammoUse: 6,
        weapons: [wpn('w-mg', { inf: [0.25, 0.35], soft: [0.06, 0.08] }, 6)],
      }),
      type({
        id: 'at',
        name: 'Противотанковое средство',
        kind: 'weapon',
        targetClass: 'inf',
        crew: 2,
        value: 5,
        protection: 1.2,
        ammoUse: 7,
        tags: ['ПТ'],
        weapons: [wpn('w-at', { inf: [0.03, 0.05], soft: [0.2, 0.3], armor: [0.2, 0.3] }, 7)],
      }),
      type({
        id: 'mortar',
        name: 'Миномёт',
        kind: 'weapon',
        targetClass: 'inf',
        crew: 4,
        value: 6,
        indirect: true,
        suppressive: 3,
        ammoUse: 7,
        weapons: [wpn('w-mortar', { inf: [0.15, 0.35], soft: [0.06, 0.14], armor: [0.005, 0.015] }, 7)],
      }),
      type({
        id: 'gun',
        name: 'Артиллерийское орудие',
        kind: 'weapon',
        targetClass: 'inf',
        crew: 6,
        value: 10,
        indirect: true,
        suppressive: 3,
        ammoUse: 6,
        weapons: [wpn('w-gun', { inf: [0.4, 1], soft: [0.2, 0.4], armor: [0.02, 0.06] }, 6)],
      }),
      type({
        id: 'truck',
        name: 'Грузовик',
        kind: 'vehicle',
        targetClass: 'soft',
        crew: 1,
        value: 1.5,
        protection: 1,
        ammoUse: 0,
        fuelUse: 4,
        weapons: [],
      }),
      type({
        id: 'apc',
        name: 'Бронетранспортёр',
        kind: 'vehicle',
        targetClass: 'armor',
        crew: 2,
        value: 8,
        protection: 0.7,
        ammoUse: 6,
        fuelUse: 5,
        weapons: [wpn('w-mg', { inf: [0.2, 0.3], soft: [0.15, 0.25], armor: [0.03, 0.05] }, 6)],
      }),
      type({
        id: 'tank',
        name: 'Танк',
        kind: 'vehicle',
        targetClass: 'armor',
        crew: 3,
        value: 20,
        protection: 1.3,
        suppressive: 1.5,
        ammoUse: 6,
        fuelUse: 6,
        tags: ['ночное видение', 'танк', 'ПТ'],
        weapons: [wpn('w-tankgun', { inf: [0.3, 0.5], soft: [0.35, 0.55], armor: [0.4, 0.6] }, 6), wpn('w-mg', { inf: [0.45, 0.55] }, 4)],
      }),
    ],
    orders: STANDARD_ORDERS,
    experienceLevels: STANDARD_EXPERIENCE,
    commandLevels: STANDARD_COMMAND,
    conditions: [STANDARD_TERRAIN, STANDARD_TIME, STANDARD_WEATHER],
    fortifications: STANDARD_FORTIFICATIONS,
    intelLevels: STANDARD_INTEL,
    tempEffects: STANDARD_EFFECTS,
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
        byShare: true,
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
        byShare: true,
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
      TANK_FEAR_RULE,
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
    description:
      'Пример набора правил для эпохи гладкоствольного оружия: мушкеты, кавалерия, полевая артиллерия. Показывает, как настроить симулятор под другую эпоху.',
    turnMinutes: 20,
    reconTag: 'лёгкая',
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
    weaponTypes: [
      { id: 'w-musket', name: 'Мушкет', accuracy: acc(B, [0, 1, 0.5]), ammo: true },
      { id: 'w-rifled', name: 'Штуцер', accuracy: acc(B, [0.1, 1, 1]), ammo: true },
      { id: 'w-cannon', name: 'Полевая пушка', accuracy: acc(B, [0.5, 1, 0.6]), ammo: true },
      { id: 'w-blade', name: 'Холодное оружие', accuracy: acc(B, [0, 0, 1]), ammo: false },
    ],
    componentTypes: [
      type({
        id: 'musketeer',
        name: 'Мушкетёр',
        kind: 'personnel',
        targetClass: 'inf',
        value: 1,
        ammoUse: 5,
        weapons: [
          wpn('w-musket', { inf: [0.01, 0.014], cav: [0.008, 0.012], art: [0.004, 0.008] }, 5),
          wpn('w-blade', { inf: [0.02, 0.028], cav: [0.015, 0.025], art: [0.024, 0.03] }),
        ],
      }),
      type({
        id: 'grenadier',
        name: 'Гренадер',
        kind: 'personnel',
        targetClass: 'inf',
        value: 1.3,
        ammoUse: 5,
        weapons: [
          wpn('w-musket', { inf: [0.01, 0.014], cav: [0.008, 0.012], art: [0.004, 0.008] }, 5),
          wpn('w-blade', { inf: [0.033, 0.045], cav: [0.02, 0.03], art: [0.03, 0.044] }),
        ],
      }),
      type({
        id: 'jaeger',
        name: 'Егерь (стрелок)',
        kind: 'personnel',
        targetClass: 'inf',
        value: 1.4,
        ammoUse: 5,
        tags: ['лёгкая'],
        weapons: [wpn('w-rifled', { inf: [0.016, 0.024], cav: [0.012, 0.018], art: [0.016, 0.024] }, 5)],
      }),
      type({
        id: 'cuirassier',
        name: 'Кирасир',
        kind: 'personnel',
        targetClass: 'cav',
        value: 3,
        protection: 1.2,
        ammoUse: 1,
        tags: ['кавалерия'],
        weapons: [wpn('w-blade', { inf: [0.07, 0.11], cav: [0.06, 0.1], art: [0.1, 0.14] })],
      }),
      type({
        id: 'hussar',
        name: 'Гусар',
        kind: 'personnel',
        targetClass: 'cav',
        value: 2.2,
        ammoUse: 1,
        tags: ['лёгкая', 'кавалерия'],
        weapons: [wpn('w-blade', { inf: [0.045, 0.075], cav: [0.045, 0.075], art: [0.08, 0.12] })],
      }),
      type({
        id: 'fieldgun',
        name: 'Полевое орудие',
        kind: 'weapon',
        targetClass: 'art',
        crew: 10,
        value: 12,
        suppressive: 2.5,
        ammoUse: 8,
        weapons: [wpn('w-cannon', { inf: [0.3, 0.7], cav: [0.25, 0.55], art: [0.06, 0.14] }, 8)],
      }),
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
    tempEffects: [
      { id: 'smoke', name: 'Пороховой дым', turns: 2, effects: { concealment: 1.8, detection: 0.6, fire: 0.85 }, description: 'Поле затянуто дымом залпов.' },
      { id: 'surprise', name: 'Внезапная атака', turns: 1, effects: { fire: 1.3, initiative: 1.5 }, description: 'Удар с неожиданного направления.' },
      {
        id: 'confusion',
        name: 'Замешательство',
        turns: 2,
        effects: { initiative: 0.6, moraleLoss: 1.4, fire: 0.85 },
        description: 'Сбитый строй, потеря управления.',
      },
      {
        id: 'inspired',
        name: 'Воодушевление',
        turns: 3,
        effects: { moraleLoss: 0.7, panic: 0.6, recovery: 1.3 },
        description: 'Знамя впереди, командир в строю.',
      },
    ],
    features: { ...DEFAULT_FEATURES, fuel: false, breakdowns: false, vehicleCondition: false, comms: false },
    // Потери от залпов и штыков выше, чем у «универсального» набора, а исход решает мораль.
    coefficients: {
      ...COEFFICIENT_DEFAULTS,
      casualtyScale: 3,
      moralePerLossPct: 2,
      killedShare: 0.3,
      woundedShare: 0.55,
      missingShare: 0.15,
      frontDensity: 250,
      // Темпы этого набора подобраны для хода 20 минут.
      turnRefMinutes: 20,
    },
  };
}

/** Новый набор правил: общая структура без каталога типов и без своих модификаторов. */
export function makeBlankRuleset(name = 'Новый набор правил'): Ruleset {
  const r = makeUniversalRuleset();
  return {
    ...r,
    id: newId('rs'),
    name,
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

/**
 * Перевести на откалиброванные значения коэффициенты набора, которые в нём не меняли (равны прежним значениям
 * по умолчанию). Возвращает изменённые ключи.
 */
export function recalibrateRuleset(r: Ruleset, fromVersion = 0): string[] {
  const changed: string[] = [];
  for (const [key, [was, now, version]] of Object.entries(RECALIBRATED))
    if (version > fromVersion && r.coefficients[key] === was) {
      r.coefficients[key] = now;
      changed.push(key);
    }
  return changed;
}

const sameEffects = (a: LevelDef['effects'], b: LevelDef['effects']) => {
  const ka = Object.keys(a ?? {}).filter((k) => a[k as keyof typeof a] !== undefined);
  const kb = Object.keys(b ?? {}).filter((k) => b[k as keyof typeof b] !== undefined);
  return ka.length === kb.length && ka.every((k) => a[k as keyof typeof a] === b[k as keyof typeof b]);
};

/**
 * Обновление набора правил до версии данных 3. Эталонная длина хода — нынешняя длина хода набора (его темпы
 * подобраны под неё, расчёт не меняется). Данные примера, которые в наборе не меняли, — нынешние: уровни опыта,
 * огонь танка по живой силе, теги «танк»/«ПТ» и правило «Танки против пехоты без ПТ-средств», правила «Ночное
 * видение» и «Болото: техника вязнет» — по доле. Возвращает список изменённого (для сообщения ГМ).
 */
export function upgradeExampleData(r: Ruleset): string[] {
  const out: string[] = [];
  if (r.coefficients.turnRefMinutes === undefined) r.coefficients.turnRefMinutes = r.turnMinutes;
  const exp = r.experienceLevels;
  if (
    exp?.length === PREVIOUS_EXPERIENCE.length &&
    exp.every((l, i) => l.name === PREVIOUS_EXPERIENCE[i].name && sameEffects(l.effects, PREVIOUS_EXPERIENCE[i].effects))
  ) {
    r.experienceLevels = clone(STANDARD_EXPERIENCE);
    out.push('уровни опыта');
  }
  const tank = r.componentTypes.find((t) => t.id === 'tank');
  const inf = tank?.firepower.inf;
  const bands = ['long', 'medium', 'close'];
  if (tank && inf && bands.every((b, i) => inf[b] === PREVIOUS_TANK_INF[i])) {
    tank.firepower.inf = Object.fromEntries(bands.map((b, i) => [b, TANK_INF[i]]));
    for (const tag of ['танк', 'ПТ']) if (!tank.tags.includes(tag)) tank.tags = [...tank.tags, tag];
    const at = r.componentTypes.find((t) => t.id === 'at' && t.name === 'Противотанковое средство');
    if (at && !at.tags.includes('ПТ')) at.tags = [...at.tags, 'ПТ'];
    if (!r.modifiers.some((m) => m.id === TANK_FEAR_RULE.id)) r.modifiers = [...r.modifiers, clone(TANK_FEAR_RULE)];
    out.push('огонь танка по пехоте и правило «Танки против пехоты без ПТ-средств»');
  }
  let share = false;
  r.modifiers = r.modifiers.map((m) => {
    if ((m.id === 'mod-nv' || m.id === 'mod-swamp-vehicles') && m.byShare === undefined) {
      share = true;
      return { ...m, byShare: true };
    }
    return m;
  });
  if (share) out.push('правила «Ночное видение» и «Болото» — по доле');
  return out;
}

/**
 * Дополнить набор правил недостающим (наборы прежних версий). compat — для снимка правил старого боя:
 * механики, которых тогда не было, выключены (бой повторяется и продолжается так же, как шёл).
 */
export function normalizeRuleset(r: Ruleset, compat = false): Ruleset {
  const base = makeUniversalRuleset();
  const out: Ruleset = { ...base, ...r };
  out.schemaVersion = SCHEMA_VERSION;
  // Версия данных — только своя: у набора прежней версии её нет (обновления ещё не применялись).
  if (r.dataVersion === undefined) delete out.dataVersion;
  out.features = { ...DEFAULT_FEATURES, ...(compat ? { orderDelay: false } : {}), ...(r.features ?? {}) };
  out.coefficients = { ...COEFFICIENT_DEFAULTS, ...(compat ? COMPAT_NEUTRAL : {}), ...(r.coefficients ?? {}) };
  // Набор прежней версии: его темпы подобраны под его длину хода — она и есть эталон (расчёт не меняется).
  if (!compat && r.coefficients && r.coefficients.turnRefMinutes === undefined) out.coefficients.turnRefMinutes = out.turnMinutes;
  out.targetClasses = r.targetClasses ?? [];
  out.rangeBands = r.rangeBands ?? [];
  out.weaponTypes = r.weaponTypes ?? [];
  out.componentTypes = (r.componentTypes ?? []).map((t) => ({ ...type({ ...t }), ...t, tags: t.tags ?? [] }));
  out.orders = r.orders?.length ? r.orders : base.orders;
  out.experienceLevels = r.experienceLevels?.length ? r.experienceLevels : base.experienceLevels;
  out.commandLevels = r.commandLevels?.length ? r.commandLevels : base.commandLevels;
  out.conditions = r.conditions ?? [];
  out.fortifications = r.fortifications?.length ? r.fortifications : base.fortifications;
  out.intelLevels = r.intelLevels?.length ? r.intelLevels : base.intelLevels;
  out.modifiers = r.modifiers ?? [];
  // Наборы правил прежних версий: заготовки эффектов — стандартные.
  out.tempEffects = Array.isArray(r.tempEffects) ? r.tempEffects : base.tempEffects;
  // «Уровни подразделений» прежних версий больше не используются.
  delete (out as { unitLevels?: unknown }).unitLevels;
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
    dataVersion: DATA_VERSION,
    id: newId('sc'),
    name,
    description: '',
    rulesetId: rs.id,
    conditions,
    startBand: rs.rangeBands[0]?.id ?? '',
    hours: 4,
    maxTurns: turnsFor(4, rs),
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
      commandLevel: null,
      composition: [comp('rifleman', 30), comp('mg', 2), comp('at', 1)],
    }),
    newRootUnit('Мотострелковая рота', {
      id: 'demo-tpl-msr',
      commandLevel: null,
      composition: [comp('rifleman', 90), comp('mg', 3), comp('at', 3), comp('apc', 10)],
    }),
    newRootUnit('Танковая рота', {
      id: 'demo-tpl-tr',
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
    commandLevel: 4,
    comms: 85,
    supply: 80,
    order: 'attack',
    children: [
      newUnit('Штаб батальона', {
        id: 'demo-bn-hq',
        echelon: 'rear',
        isHQ: true,
        composition: [comp('rifleman', 20), comp('apc', 2), comp('truck', 4)],
      }),
      fromTemplate('demo-tpl-msr', '1-я мотострелковая рота', { id: 'demo-bn-c1' }, { rifleman: 84, apc: 9 }),
      fromTemplate('demo-tpl-msr', '2-я мотострелковая рота', { id: 'demo-bn-c2' }, { rifleman: 84, apc: 9 }),
      fromTemplate(
        'demo-tpl-msr',
        '3-я мотострелковая рота',
        { id: 'demo-bn-c3', order: 'reserve', echelon: 'rear', notes: 'Резерв командира батальона: введите её в бой сменой приказа.' },
        { rifleman: 84, apc: 9 },
      ),
      newUnit('Миномётная батарея', { id: 'demo-bn-mort', echelon: 'support', composition: [comp('mortar', 6), comp('truck', 6)] }),
      newUnit('Разведвзвод', {
        id: 'demo-bn-recon',
        order: 'recon',
        state: { experience: 3 },
        composition: [comp('scout', 20), comp('apc', 3)],
      }),
      fromTemplate('demo-tpl-tr', 'Танковая рота', { id: 'demo-bn-tank', echelon: 'support', state: { experience: 3 } }, { tank: 9 }),
    ],
  });
}

export function makeDemoDefenders(): UnitNode {
  return newRootUnit('Оборонительный узел «Высота 212» (пример)', {
    id: 'demo-def',
    commandLevel: 3,
    comms: 70,
    supply: 60,
    order: 'defend',
    children: [
      newUnit('Командный пункт', { id: 'demo-def-hq', echelon: 'rear', isHQ: true, composition: [comp('rifleman', 10)] }),
      fromTemplate('demo-tpl-msv', '1-й взвод', { id: 'demo-def-p1', state: { experience: 3 } }, { rifleman: 28 }),
      fromTemplate('demo-tpl-msv', '2-й взвод', { id: 'demo-def-p2' }, { rifleman: 27 }),
      fromTemplate('demo-tpl-msv', '3-й взвод', { id: 'demo-def-p3' }),
      newUnit('Противотанковый взвод', { id: 'demo-def-at', echelon: 'support', composition: [comp('at', 6), comp('truck', 3)] }),
      newUnit('Миномётный взвод', { id: 'demo-def-mort', echelon: 'support', composition: [comp('mortar', 4)] }),
      withoutType(fromTemplate('demo-tpl-msv', 'Резервный взвод', { id: 'demo-def-res', order: 'reserve', echelon: 'rear' }, { rifleman: 26 }), 'at'),
    ],
  });
}

// ---------------------------------------------------------------- пример для «Линейной тактики»

/** Шаблоны эпохи линейной тактики: из них собраны бригада и оборона переправы (кирасиры — без шаблона). */
export function makeLinearTemplates(): UnitNode[] {
  const rs = 'rs-linear';
  const company = (name: string, typeId: string, n: number) => newUnit(name, { composition: [comp(typeId, n)] });
  return [
    newRootUnit('Линейный пехотный батальон', {
      id: 'demo-lin-tpl-bn',
      rulesetId: rs,
      children: [
        company('Гренадерская рота', 'grenadier', 110),
        company('1-я мушкетёрская рота', 'musketeer', 120),
        company('2-я мушкетёрская рота', 'musketeer', 120),
        company('3-я мушкетёрская рота', 'musketeer', 120),
        newUnit('Застрельщики', { order: 'recon', echelon: 'support', composition: [comp('jaeger', 50)] }),
      ],
    }),
    newRootUnit('Пешая батарея', {
      id: 'demo-lin-tpl-bat',
      rulesetId: rs,
      commandLevel: null,
      echelon: 'support',
      composition: [comp('fieldgun', 8)],
    }),
    newRootUnit('Гусарский эскадрон', { id: 'demo-lin-tpl-hus', rulesetId: rs, commandLevel: null, composition: [comp('hussar', 120)] }),
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
    rulesetId: 'rs-linear',
    order: 'attack',
    supply: 85,
    children: [
      linCopy('demo-lin-tpl-bn', '1-й батальон'),
      linCopy('demo-lin-tpl-bn', '2-й батальон'),
      linCopy('demo-lin-tpl-bat', 'Батарея'),
      linCopy('demo-lin-tpl-hus', '1-й гусарский эскадрон', { echelon: 'support' }),
      linCopy('demo-lin-tpl-hus', '2-й гусарский эскадрон', {
        order: 'reserve',
        echelon: 'rear',
        notes: 'Резерв бригады: введите в бой сменой приказа, когда пехота расстроит оборону.',
      }),
    ],
  });
}

export function makeLinearDefenders(): UnitNode {
  return newRootUnit('Оборона переправы (пример)', {
    id: 'demo-lin-def',
    rulesetId: 'rs-linear',
    order: 'defend',
    supply: 70,
    children: [
      linCopy('demo-lin-tpl-bn', 'Батальон у переправы', { state: { experience: 3 } }),
      linCopy('demo-lin-tpl-bat', 'Батарея на холме'),
      newUnit('Кирасиры', {
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
  sc.hours = 6;
  sc.maxTurns = turnsFor(sc.hours, rs);
  sc.sides[0].name = 'Синие';
  sc.sides[0].formations = [instantiate(makeLinearBrigade())];
  sc.sides[0].objectives = [newObjective('take', 0, 2), newObjective('preserve', 30, 1)];
  sc.sides[1].name = 'Красные';
  sc.sides[1].formations = [instantiate(makeLinearDefenders())];
  sc.sides[1].fortification = 'earthworks';
  sc.sides[1].objectives = [newObjective('hold', 6, 2), newObjective('inflict', 20, 1)];
  // План боя: резервы вводятся по ходам — и в бою, и в массовых прогонах.
  const node = (side: 0 | 1, name: string) => {
    let id = '';
    for (const f of sc.sides[side].formations) walkUnits(f, (n) => void (n.name === name && (id = n.id)));
    return id;
  };
  sc.events = [
    {
      id: 'ev-lin-hussars',
      kind: 'order',
      turn: 8,
      side: 'A',
      nodeId: node(0, '2-й гусарский эскадрон'),
      orderId: 'attack',
      note: 'резерв бригады вводится в бой',
    },
    { id: 'ev-lin-cuir', kind: 'order', turn: 9, spread: 1, chance: 60, side: 'B', nodeId: node(1, 'Кирасиры'), orderId: 'attack', note: 'контратака кирасир' },
  ];
  return sc;
}

export function makeDemoScenario(): Scenario {
  const rs = makeUniversalRuleset();
  const sc = newScenario(rs, 'Пример: атака на высоту 212', 'DEMO-0001');
  sc.id = 'sc-demo';
  sc.description =
    'Мотострелковый батальон с приданной танковой ротой атакует подготовленный оборонительный узел усиленной роты с рубежа атаки (средняя дистанция). Сумерки, холмы. 3-я рота — в резерве комбата: ГМ может ввести её в бой между ходами (смена приказа), иначе она вступит, только если первая линия выбудет.';
  sc.conditions = { terrain: 'hills', time: 'twilight', weather: 'clear' };
  sc.startBand = 'medium';
  sc.hours = 4;
  sc.maxTurns = turnsFor(sc.hours, rs);
  sc.sides[0].name = 'Синие';
  sc.sides[0].formations = [instantiate(makeDemoBattalion())];
  sc.sides[0].intel = 'partial';
  sc.sides[0].objectives = [newObjective('take', 0, 2), newObjective('preserve', 25, 1)];
  // Артиллерия старшего начальника — по вызову ГМ («Удар…» в бою); в плане боя ударов нет, баланс примера тот же.
  sc.sides[0].support = [{ id: 'sup-art', name: 'Артдивизион полка', typeId: 'gun', count: 6, missions: 3 }];
  sc.sides[1].name = 'Красные';
  sc.sides[1].formations = [instantiate(makeDemoDefenders())];
  sc.sides[1].fortification = 'prepared';
  sc.sides[1].intel = 'partial';
  sc.sides[1].objectives = [newObjective('hold', 3.5, 2), newObjective('inflict', 20, 1)];
  return sc;
}
