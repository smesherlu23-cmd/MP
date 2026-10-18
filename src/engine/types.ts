// Модель данных симулятора. Движок не зависит от интерфейса: всё, что здесь описано,
// сериализуется в JSON и может редактироваться как в программе, так и вручную.

export type Id = string;
export type SideId = 'A' | 'B';

/**
 * Ключи характеристик, на которые действуют модификаторы. Все значения — множители (1 = без изменений).
 * Каждая характеристика оценивается «с точки зрения» своего владельца:
 *  fire — огонь стрелка; protection — защищённость поражаемого; detection — наблюдатель;
 *  concealment — наблюдаемый; остальное — сам элемент.
 */
export const STAT_KEYS = [
  'fire',
  'protection',
  'detection',
  'concealment',
  'movement',
  'fatigue',
  'moraleLoss',
  'panic',
  'suppression',
  'ammoUse',
  'lethality',
  'initiative',
  'recovery',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Effects = Partial<Record<StatKey, number>>;

export interface Named {
  id: Id;
  name: string;
  description?: string;
}

/** Класс цели: пехота, бронетехника, кавалерия, корабли… */
export interface TargetClass extends Named {
  /** Множитель превращения воздействия в потери для этого класса. */
  lethality: number;
}

/** Дистанция боя. Список упорядочен от самой дальней к самой ближней. */
export interface RangeBand extends Named {
  /** Базовый шанс обнаружить противника на этой дистанции (0..1). */
  detection: number;
  /** Сколько ходов полноценного наступления нужно, чтобы перейти на следующую (более близкую) дистанцию. */
  turnsToClose: number;
}

/** personnel — люди; weapon — расчётное вооружение (пулемёт, орудие, катапульта); vehicle — техника. */
export type ComponentKind = 'personnel' | 'weapon' | 'vehicle';

/** Тип составляющей подразделения (каталог «конструктора»). */
export interface ComponentType extends Named {
  kind: ComponentKind;
  /** Каким классом цели является. */
  targetClass: Id;
  /** Людей на единицу (для personnel обычно 1). */
  crew: number;
  /** Боевая ценность одной единицы (очки) — для расчёта боеспособности и приоритета целей. */
  value: number;
  /** Защищённость относительно «типичной» цели своего класса (1 = как у всех). */
  protection: number;
  /** Огневая мощь: [класс цели][дистанция] = ожидаемые «поражения» за ход одной единицей. */
  firepower: Record<Id, Record<Id, number>>;
  /** Стреляет с закрытых позиций: не нуждается в прямой видимости, достаёт тыловые эшелоны. */
  indirect: boolean;
  /** Подавляющее действие огня (1 = обычное). */
  suppressive: number;
  /** Расход боезапаса, % за ход активного огня. */
  ammoUse: number;
  /** Расход топлива, % за ход движения (только техника). */
  fuelUse: number;
  tags: string[];
}

/** Поведение — то, как движок трактует приказ. */
export const BEHAVIORS = ['attack', 'defend', 'ambush', 'recon', 'consolidate', 'retreat', 'rout', 'reserve'] as const;
export type Behavior = (typeof BEHAVIORS)[number];

export interface OrderDef extends Named {
  behavior: Behavior;
  effects: Effects;
  /** Насколько элемент подставляется под огонь (0 = вне боя, 1 = полностью). */
  exposure: number;
}

/** Уровень (опыт, командир) с набором эффектов. Номер уровня = индекс + 1. */
export interface LevelDef {
  name: string;
  description?: string;
  effects: Effects;
}

export interface OptionDef extends Named {
  effects: Effects;
}

/** Категория условий боя (местность, время суток, погода или своя — сезон, высота…). */
export interface ConditionCategory extends Named {
  options: OptionDef[];
}

export type ConditionOp = 'eq' | 'neq' | 'in' | 'nin' | 'has' | 'not_has' | 'gte' | 'lte';

export interface ModifierCondition {
  /** Поле контекста: cond.<категория>, range, turn, order, behavior, tag, kind, experience, side,
   *  echelon, fortification, intel, sector, targetClass; состояние — morale, cohesion, suppression, fatigue, ammo,
   *  losses (потери элемента, %), sideLosses (потери стороны, %); enemy.<поле> — то же у противника. */
  field: string;
  op: ConditionOp;
  value: string | number | string[];
}

/** Пользовательское правило: «если … то характеристика ×N». */
export interface CustomModifier extends Named {
  enabled: boolean;
  when: ModifierCondition[];
  effects: Effects;
}

/** Временный эффект (заготовка в наборе правил): дымовая завеса, внезапность, растерянность… */
export interface EffectDef extends Named {
  effects: Effects;
  /** Сколько ходов действует по умолчанию. */
  turns: number;
}

export interface OutcomeLevel {
  id: Id;
  name: string;
  /** Минимальная разница оценок сторон (0..1). Уровень с 0 — ничья. */
  minDiff: number;
}

/** Переключатели механик: выключенная механика не влияет на расчёт и скрывается в интерфейсе. */
export interface Features {
  detection: boolean;
  initiative: boolean;
  suppression: boolean;
  ammo: boolean;
  fuel: boolean;
  equipment: boolean;
  fatigue: boolean;
  morale: boolean;
  cohesion: boolean;
  readiness: boolean;
  vehicleCondition: boolean;
  comms: boolean;
  command: boolean;
  breakdowns: boolean;
  panic: boolean;
  retreat: boolean;
}

export type Coefficients = Record<string, number>;

export interface Ruleset {
  schemaVersion: number;
  id: Id;
  name: string;
  era?: string;
  description?: string;
  /** Минут в одном ходу (для отображения времени боя). */
  turnMinutes: number;
  /** Тег, отмечающий разведывательные элементы/типы. */
  reconTag: string;
  /** Уровни подразделений эпохи (подсказки в конструкторе): отделение, взвод, рота… */
  unitLevels: string[];
  features: Features;
  targetClasses: TargetClass[];
  rangeBands: RangeBand[];
  componentTypes: ComponentType[];
  orders: OrderDef[];
  experienceLevels: LevelDef[];
  commandLevels: LevelDef[];
  conditions: ConditionCategory[];
  fortifications: OptionDef[];
  intelLevels: OptionDef[];
  modifiers: CustomModifier[];
  /** Заготовки временных эффектов для боя и плана боя. */
  tempEffects: EffectDef[];
  outcomeLevels: OutcomeLevel[];
  coefficients: Coefficients;
  updatedAt?: string;
}

// ---------------------------------------------------------------- подразделения

export interface ComponentEntry {
  typeId: Id;
  /** Штатная численность. */
  authorized: number;
  /** В строю (исправно / боеспособно). */
  current: number;
  /** Раненые / техника в ремонте — вне строя, но могут вернуться. */
  recoverable?: number;
}

export type Echelon = 'front' | 'support' | 'rear';

/** Параметры состояния, которые подразделение может задать само или унаследовать от старшего. */
export const STATE_KEYS = ['experience', 'morale', 'cohesion', 'readiness', 'ammo', 'fuel', 'equipment', 'fatigue', 'vehicleCondition'] as const;
export type StateKey = (typeof STATE_KEYS)[number];
export type UnitState = Record<StateKey, number>;

/**
 * Подразделение любого уровня — от группы в 2–3 бойца до корпуса. У него может быть свой состав
 * (люди, вооружение, техника) и подчинённые подразделения. Незаданные параметры наследуются от старшего.
 */
export interface UnitNode {
  id: Id;
  name: string;
  /** Уровень: отделение, взвод, рота… — свободный текст, подсказки берутся из набора правил. */
  level: string;
  /** Собственный состав (может быть пустым у чисто управленческого узла). */
  composition: ComponentEntry[];
  children: UnitNode[];
  commanderName: string;
  /** Уровень командира 1..N; null — своего командира нет. */
  commandLevel: number | null;
  /** null — как у старшего. */
  order: Id | null;
  echelon: Echelon | null;
  comms: number | null;
  supply: number | null;
  /** Свои значения состояния; отсутствующий ключ — как у старшего. */
  state: Partial<UnitState>;
  /** Атака и защита, % (100 = как в каталоге). */
  attackMod: number;
  defenseMod: number;
  /** Штаб: его потеря лишает старшее подразделение командира и ухудшает связь. */
  isHQ: boolean;
  /** «Стоять насмерть»: не отходит добровольно. */
  holdFast: boolean;
  tags: string[];
  notes?: string;
  /** Корень копии: по какому шаблону создано (силы или копия внутри другого шаблона). */
  templateId?: Id;
  /** Отпечаток шаблона на момент вставки или обновления — чтобы заметить изменения шаблона. */
  templateHash?: string;
  /** Узел копии: какому узлу шаблона он соответствует. */
  srcNodeId?: Id;
  /** Придано: откуда (пустая строка — просто «придано»). */
  attachedFrom?: string;
  /** Набор правил (у шаблонов и сил). */
  rulesetId?: Id;
  /** Принадлежность сил (армия, сторона, фракция) — только у сил, для порядка в списках. */
  faction?: string;
  /** Боевой путь сил: бои, отдых, пополнения (только у корня сил). */
  history?: ForceRecord[];
  updatedAt?: string;
}

/** Запись боевого пути сил. */
export interface ForceRecord {
  at: string;
  kind: 'battle' | 'rest' | 'replenish';
  title: string;
  battleId?: Id;
  /** Итог боя для стороны этих сил: «Победа (решительная)», «Поражение»… */
  outcome?: string;
  /** Изменение численности: люди и техника/вооружение (− потери, + вернулось/пришло). */
  personnel?: number;
  equipment?: number;
  note?: string;
}

// ---------------------------------------------------------------- сценарий

export const OBJECTIVE_TYPES = ['hold', 'take', 'inflict', 'preserve', 'recon', 'noRout'] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export interface Objective {
  id: Id;
  type: ObjectiveType;
  /** Параметр: число ходов (hold) или процент (inflict, preserve, recon). */
  value: number;
  weight: number;
  label?: string;
}

/** Подразделение сил на стороне сценария: целиком или его часть (узел внутри него). */
export interface SideUnitRef {
  forceId: Id;
  /** Часть подразделения; не задано — целиком. */
  nodeId?: Id;
  /** На этот бой придано другому подразделению стороны (id его узла). */
  attachTo?: Id;
}

export interface SideDef {
  id: SideId;
  name: string;
  color: string;
  /**
   * Подразделения стороны (каждое — дерево) так, как они вступают в бой. В программе сторона хранит
   * ссылки на силы (units), а деревья собираются из сил перед боем (resolveScenario).
   */
  formations: UnitNode[];
  /** Силы на стороне: подразделения целиком или их части; приданные — внутри другого. */
  units?: SideUnitRef[];
  /** Приказы на этот бой: id узла сил → приказ. Не задано — как у старшего. */
  orders?: Record<Id, Id>;
  fortification: Id;
  intel: Id;
  /** Пусто — задачи выводятся из приказов автоматически. */
  objectives: Objective[];
  /**
   * Компетентность командиров в начале боя: id формирования (узла) → уровень, 0 — без командира.
   * Не задано — обычный. Командир есть у каждого формирования; в конструкторе его нет, по ходу боя уровень меняет ГМ.
   */
  commanders?: Record<Id, number>;
  /** Части подразделений стороны, которые в этом бою не участвуют (id узлов; вместе с подчинёнными). */
  excluded?: Id[];
  /** Участок боя: id узла → участок (наследуется подчинёнными). Не задано — первый участок. */
  sectorOf?: Record<Id, Id>;
  /** Огневая поддержка вне поля боя: артиллерия, авиация, корабли. */
  support?: SupportAsset[];
}

/** Средство огневой поддержки стороны: не на поле боя, его нельзя поразить; бьёт по вызову. */
export interface SupportAsset {
  id: Id;
  name: string;
  /** Тип из каталога набора правил: его огневая мощь (лучшая по дистанциям) — мощь одной единицы. */
  typeId: Id;
  /** Сколько единиц участвует в одном ударе (орудий, самолётов). */
  count: number;
  /** Сколько ударов доступно за бой. */
  missions: number;
}

/** Участок боя: своя дистанция, при желании — своя местность и укрепления. Переброски между участками нет. */
export interface SectorDef {
  id: Id;
  name: string;
  /** Начальная дистанция; не задано — как в сценарии. */
  startBand?: Id;
  /** Условия, отличные от сценария (категория → вариант), например местность. */
  conditions?: Record<Id, Id>;
  /** Укрепления сторон на участке; не задано — как у стороны. */
  fortification?: Partial<Record<SideId, Id>>;
}

export interface Scenario {
  schemaVersion: number;
  id: Id;
  name: string;
  description?: string;
  rulesetId: Id;
  conditions: Record<Id, Id>;
  startBand: Id;
  maxTurns: number;
  seed: string;
  sides: [SideDef, SideDef];
  /** План боя: события по ходам — работают и в бою, и в массовых прогонах. */
  events?: ScenarioEvent[];
  /** Участки боя; пусто — один общий участок. */
  sectors?: SectorDef[];
  updatedAt?: string;
}

/**
 * Событие плана боя. arrive — подход подкреплений (до этого подразделение вне боя), order — смена
 * приказа подразделению, conditions — смена условий (ночь, дождь…), strike — удар огневой поддержки,
 * effect — временный эффект (дымовая завеса, внезапность…).
 */
export type ScenarioEventKind = 'arrive' | 'order' | 'conditions' | 'strike' | 'effect';

/**
 * Условие события: оно наступает в первый ход (не раньше turn), когда условие выполнено.
 * losses — потери личного состава, % (не меньше value); out — выбыло (уничтожено, бежит, отходит), % боевой
 * ценности (не меньше value); morale — средняя мораль (не больше value); band — дистанция value (id) или ближе.
 */
export type TriggerMetric = 'losses' | 'out' | 'morale' | 'band';
export interface EventTrigger {
  metric: TriggerMetric;
  /** Чьё состояние проверяется (для band — не важно). */
  side: SideId;
  /** Подразделение (узел) стороны; не задано — вся сторона. */
  nodeId?: Id;
  value: number | string;
}

export interface ScenarioEvent {
  id: Id;
  kind: ScenarioEventKind;
  /** Ход, в начале которого событие наступает (1 — с первого хода). */
  turn: number;
  /** Разброс ±N ходов: событие наступит в случайный ход от turn−N до turn+N. */
  spread?: number;
  /** Вероятность, % (по умолчанию 100): подкрепление может и не подойти. */
  chance?: number;
  side?: SideId;
  /** Узел стороны (формирование или подразделение) — для arrive, order и effect. */
  nodeId?: Id;
  orderId?: Id;
  conditions?: Record<Id, Id>;
  /** strike: средство поддержки стороны side и цель — узел противника (не задано — по всей стороне). */
  assetId?: Id;
  targetNodeId?: Id;
  /** effect: заготовка эффекта из набора правил и срок, ходов (не задано — как в заготовке). */
  effectId?: Id;
  turns?: number;
  /** Условие наступления; turn тогда — «не раньше хода». */
  trigger?: EventTrigger;
  /** Задержка после выполнения условия, ходов. */
  delay?: number;
  note?: string;
}

// ---------------------------------------------------------------- состояние боя

export interface CompState {
  typeId: Id;
  authorized: number;
  start: number;
  current: number;
  /** Техника/вооружение: уничтожено, повреждено (ремонтопригодно), брошено. */
  destroyed: number;
  damaged: number;
  abandoned: number;
  /** Люди (для personnel) или экипажи (для техники/вооружения). */
  kia: number;
  wia: number;
  mia: number;
}

/** pending — подкрепление, которое ещё не подошло (вне боя: не стреляет, не несёт потерь). */
export type ElementStatus = 'active' | 'pending' | 'withdrawn' | 'routed' | 'destroyed';

export interface ElementState {
  id: Id;
  /** Узел подразделения, из которого создан элемент. */
  defId: Id;
  name: string;
  level: string;
  side: SideId;
  formationId: Id;
  echelon: Echelon;
  orderId: Id;
  holdFast: boolean;
  isHQ: boolean;
  ownTags: string[];
  comps: CompState[];
  experience: number;
  morale: number;
  cohesion: number;
  readiness: number;
  ammo: number;
  fuel: number;
  equipment: number;
  fatigue: number;
  vehicleCondition: number;
  attackMod: number;
  defenseMod: number;
  suppression: number;
  status: ElementStatus;
  /** Ходов в отступлении/бегстве. */
  exitTurns: number;
  /** Ходов в закреплении (укрепление позиции растёт). */
  digInTurns: number;
  spotted: boolean;
  spottedLastTurn: boolean;
  everSpotted: boolean;
  firedThisTurn: boolean;
  firedLastTurn: boolean;
  underFireThisTurn: boolean;
  ambushUsed: boolean;
  startValue: number;
  startPersonnel: number;
  authorizedPersonnel: number;
  /** Люди, рассеянные при уничтожении элемента как боевой единицы. */
  scattered: number;
  turnValueLost: number;
  turnPersonnelLost: number;
  /** Морально-боевые показатели в начале боя (для отчёта). */
  startMorale: number;
  /** Участок боя (если участков несколько). */
  sector?: Id;
  /** Свой командир элемента (0 — нет), его связь и снабжение (null — как у формирования). */
  ownCommandLevel?: number;
  ownCommanderName?: string;
  comms?: number | null;
  supply?: number | null;
}

export interface FormationState {
  id: Id;
  defId: Id;
  name: string;
  level: string;
  side: SideId;
  parentId: Id | null;
  commanderName: string;
  /** 0 — своего командира нет. */
  commandLevel: number;
  comms: number;
  supply: number;
  orderId: Id;
  hqLost: boolean;
  broken: boolean;
}

export interface SideState {
  id: SideId;
  name: string;
  color: string;
  fortification: Id;
  intel: Id;
  objectives: Objective[];
  /** Ход, на котором сторона перестала удерживать позиции (0 — удерживает). */
  lostHoldTurn: number;
  initiative: number;
}

export type Phase =
  | 'setup'
  | 'turn'
  | 'detection'
  | 'initiative'
  | 'fire'
  | 'losses'
  | 'movement'
  | 'supply'
  | 'fatigue'
  | 'morale'
  | 'checks'
  | 'gm'
  | 'plan'
  | 'end';

export type Severity = 'info' | 'good' | 'bad' | 'critical';

export interface Factor {
  label: string;
  value: number;
  /** mult — множитель, add — слагаемое, base — базовое значение, chance — вероятность. */
  kind: 'mult' | 'add' | 'base' | 'chance';
}

export interface LogEntry {
  turn: number;
  phase: Phase;
  severity: Severity;
  side?: SideId;
  /** Элементы, к которым относится запись (для фильтрации). */
  refs?: Id[];
  /** Текст; ссылки на элементы — [[e:ID]], на формирования — [[f:ID]], на стороны — [[s:A]]. */
  text: string;
  factors?: Factor[];
  /** Разбор был, но не сохранён на диск (восстанавливается повтором боя). */
  hadFactors?: boolean;
  /** Числа записи — для сводок по формированиям: потери людей (убито/ранено/пропало), техники по типам, мораль до и после. */
  data?: { pers?: number; kia?: number; wia?: number; mia?: number; equip?: Record<Id, number>; morale?: [number, number] };
  /** 0 — ключевое, 1 — обычное, 2 — подробное. */
  level: 0 | 1 | 2;
}

export interface SideSnapshot {
  personnel: number;
  vehicles: number;
  value: number;
  ce: number;
  morale: number;
  active: number;
}

export interface TurnSnapshot {
  turn: number;
  band: number;
  /** Дистанции по участкам (если участков несколько). */
  bands?: Record<Id, number>;
  sides: Record<SideId, SideSnapshot>;
}

export type InterventionType =
  | 'setOrder'
  | 'editElement'
  | 'resupply'
  | 'setConditions'
  | 'setBand'
  | 'endBattle'
  | 'setFormation'
  | 'arrive'
  | 'addEffect'
  | 'removeEffect'
  | 'strike'
  | 'cancelStrike';

/** Участок в бою: своя дистанция и сближение. */
export interface SectorState {
  id: Id;
  name: string;
  bandIndex: number;
  closingProgress: number;
  /** Условия участка поверх общих (категория → вариант). */
  conditions: Record<Id, Id>;
  fortification: Partial<Record<SideId, Id>>;
}

/** Действующий (или отработавший) временный эффект. */
export interface ActiveEffect {
  id: Id;
  name: string;
  effects: Effects;
  /** Ходы действия включительно. */
  from: number;
  until: number;
  side: SideId;
  /** Формирование (со всеми подчинёнными) или элементы; не задано — вся сторона. */
  formationId?: Id;
  elementIds?: Id[];
  source: 'gm' | 'plan';
}

/** Средство огневой поддержки в бою: сколько ударов осталось. */
export interface SupportState extends SupportAsset {
  side: SideId;
  left: number;
}

/** Удар огневой поддержки: заказан на ход turn (или уже нанесён). */
export interface StrikeOrder {
  id: Id;
  side: SideId;
  assetId: Id;
  /** Цель: формирование противника, его элементы; не задано — вся сторона противника. */
  formationId?: Id;
  elementIds?: Id[];
  turn: number;
  done?: boolean;
  source: 'gm' | 'plan';
}

export interface Intervention {
  /** Ход, ПЕРЕД которым было сделано вмешательство (0 — до первого хода). */
  turn: number;
  type: InterventionType;
  payload: Record<string, unknown>;
  note?: string;
}

export interface Battle {
  schemaVersion: number;
  id: Id;
  name: string;
  scenarioId: Id;
  scenario: Scenario;
  ruleset: Ruleset;
  seed: string;
  rng: [number, number, number, number];
  turn: number;
  bandIndex: number;
  closingProgress: number;
  conditions: Record<Id, Id>;
  sides: Record<SideId, SideState>;
  formations: FormationState[];
  elements: ElementState[];
  log: LogEntry[];
  /** Журнал сохранён без подробностей и разборов — их восстанавливает restoreBattleLog. */
  logTrimmed?: boolean;
  /** Сторона, у которой была инициатива в прошлом ходу. */
  lastInitiative?: SideId;
  history: TurnSnapshot[];
  interventions: Intervention[];
  /** Ход, на который выпало событие плана с разбросом (id события → ход). */
  eventTurns?: Record<Id, number>;
  /** Участки боя (если их несколько; иначе дистанция — bandIndex). */
  sectors?: SectorState[];
  effects?: ActiveEffect[];
  support?: SupportState[];
  strikes?: StrikeOrder[];
  /** Ветка другого боя: с какого боя и хода. */
  branchOf?: { battleId: Id; name: string; turn: number };
  quietTurns: number;
  finished: boolean;
  endReason?: string;
  result?: BattleResult;
  createdAt: string;
  updatedAt?: string;
  /** Не вести журнал (массовое моделирование). */
  silent?: boolean;
  /** Когда итоги боя записаны в силы сторон (чтобы не записать дважды). */
  appliedToForces?: string;
}

// ---------------------------------------------------------------- итоги

export interface PersonnelStats {
  authorized: number;
  start: number;
  current: number;
  kia: number;
  wia: number;
  mia: number;
  losses: number;
  lossPct: number;
}

export interface EquipmentStats {
  typeId: Id;
  name: string;
  kind: ComponentKind;
  authorized: number;
  start: number;
  current: number;
  destroyed: number;
  damaged: number;
  abandoned: number;
  losses: number;
  lossPct: number;
}

export interface ObjectiveResult {
  objective: Objective;
  label: string;
  score: number;
  explanation: string;
}

export interface UnitSummary {
  personnel: PersonnelStats;
  equipment: EquipmentStats[];
  /** Остаточная боеспособность, % от начальной. */
  combatEffectiveness: number;
  /** Доля сохранившейся боевой ценности, %. */
  strength: number;
  /** Организация, % (слаженность × связь × управление). */
  organization: number;
  morale: number;
  supply: { ammo: number; fuel: number; equipment: number };
  status: Record<ElementStatus | 'retreating' | 'routing', number>;
}

export interface FormationSummary extends UnitSummary {
  formationId: Id;
  name: string;
  depth: number;
}

export interface SideResult extends UnitSummary {
  side: SideId;
  name: string;
  score: number;
  objectives: ObjectiveResult[];
  formations: FormationSummary[];
  valueLossPct: number;
  enemySpottedPct: number;
}

export interface BattleResult {
  turns: number;
  endReason: string;
  outcomeId: Id;
  outcomeName: string;
  winner: SideId | null;
  scoreDiff: number;
  headline: string;
  sides: Record<SideId, SideResult>;
  keyEvents: string[];
}
