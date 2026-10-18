// Состояние программы: данные (наборы правил, шаблоны, силы, сценарии, бои), вкладки-«окна»,
// настройки, уведомления и диалоги. Изменения автоматически сохраняются в хранилище.

import { produce } from 'immer';
import { create } from 'zustand';
import {
  clone,
  cloneUnit,
  findUnit,
  instantiate,
  isOutdated,
  makeBlankRuleset,
  makeDemoBattalion,
  makeDemoDefenders,
  makeDemoScenario,
  makeDemoTemplates,
  migrateUnit,
  makeLinearBrigade,
  makeLinearDefenders,
  makeLinearRuleset,
  makeLinearScenario,
  makeLinearTemplates,
  makeUniversalRuleset,
  newRootUnit,
  updateFromTemplate,
  walkUnits,
  newId,
  newScenario,
  normalizeRuleset,
  randomSeed,
  restoreBattleLog,
  extractForces,
  forceFromTemplate,
  rehashCopies,
  scenarioForceIds,
  resolveScenario,
  nextName,
  toTemplate,
  unitHash,
  rewindBattle,
  trimBattleForStorage,
  undoBattleAction,
  lastBattleAction,
  type Battle,
  type PauseRules,
  type UnitNode,
  type Id,
  type Ruleset,
  type Scenario,
} from '../engine';
import { battleMeta, storage, type BattleMeta, type Collection, type TrashItem } from './storage';

export type TabKind = 'home' | 'ruleset' | 'formation' | 'scenario' | 'battle' | 'montecarlo' | 'settings' | 'help' | 'library';

export interface Tab {
  key: string;
  kind: TabKind;
  ref?: string;
  sub?: string;
}

export interface Settings {
  theme: 'dark' | 'light';
  logLevel: 0 | 1 | 2;
  mcRuns: number;
  sidebar: boolean;
  density: 'compact' | 'normal';
  /** Раздел, список которого показан в навигаторе. */
  navSection: NavSection;
  /** Что останавливает «ход до события» в бою. */
  pauseRules?: PauseRules;
  /** Прогонов в прогнозе боя. */
  forecastRuns?: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
  action?: { label: string; run: () => void };
}

export interface Dialog {
  title: string;
  text?: string;
  input?: { value: string; placeholder?: string };
  options?: { value: string; label: string }[];
  okText?: string;
  danger?: boolean;
  /** Только сообщение — одна кнопка. */
  alert?: boolean;
  resolve: (v: string | boolean | null) => void;
}

interface AppState {
  loaded: boolean;
  rulesets: Record<Id, Ruleset>;
  /** Шаблоны: устройство и штат подразделений (без приказов и состояния). */
  formations: Record<Id, UnitNode>;
  /** Силы: конкретные подразделения по шаблонам — со своим состоянием и потерями. */
  forces: Record<Id, UnitNode>;
  scenarios: Record<Id, Scenario>;
  battleIndex: Record<Id, BattleMeta>;
  tabs: Tab[];
  active: string;
  settings: Settings;
  toasts: Toast[];
  dialog: Dialog | null;
  saving: number;
}

export type NavSection = 'scenarios' | 'forces' | 'units' | 'battles' | 'rulesets';

const DEFAULT_SETTINGS: Settings = { theme: 'dark', logLevel: 1, mcRuns: 200, sidebar: true, density: 'normal', navSection: 'scenarios' };

function loadLocal<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

export const useApp = create<AppState>(() => ({
  loaded: false,
  rulesets: {},
  formations: {},
  forces: {},
  scenarios: {},
  battleIndex: {},
  tabs: [{ key: 'home', kind: 'home' }],
  active: 'home',
  settings: loadLocal('warsim-settings', DEFAULT_SETTINGS),
  toasts: [],
  dialog: null,
  saving: 0,
}));

const set = useApp.setState;
const get = useApp.getState;

// ------------------------------------------------------------------ уведомления и диалоги

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
  setTimeout(() => dismissToast(id), kind === 'bad' || action ? 6000 : 3500);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function openDialog(d: Omit<Dialog, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => set({ dialog: { ...d, resolve: (v) => (set({ dialog: null }), resolve(v)) } }));
}

export async function confirmDialog(title: string, text?: string, okText = 'Да', danger = false): Promise<boolean> {
  return (await openDialog({ title, text, okText, danger })) === true;
}

export async function alertDialog(title: string, text?: string): Promise<void> {
  await openDialog({ title, text, okText: 'Закрыть', alert: true });
}

export async function promptDialog(title: string, value = '', text?: string): Promise<string | null> {
  const v = await openDialog({ title, text, input: { value } });
  return typeof v === 'string' ? v : null;
}

export async function chooseDialog(title: string, options: { value: string; label: string }[], text?: string): Promise<string | null> {
  const v = await openDialog({ title, text, options, okText: 'Выбрать' });
  return typeof v === 'string' ? v : null;
}

// ------------------------------------------------------------------ сохранение

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = new Map<string, () => Promise<void>>();

function scheduleSave(col: Collection, id: Id, getData: () => unknown, delay = 400) {
  const key = `${col}:${id}`;
  clearTimeout(timers.get(key));
  if (!pendingSaves.has(key)) set((s) => ({ saving: s.saving + 1 }));
  const run = async () => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (!pendingSaves.has(key)) return;
    pendingSaves.delete(key);
    try {
      const data = getData();
      if (data) await storage.save(col, id, data);
    } catch (e) {
      toast(`Не удалось сохранить: ${(e as Error).message}`, 'bad');
    } finally {
      set((s) => ({ saving: Math.max(0, s.saving - 1) }));
    }
  };
  pendingSaves.set(key, run);
  timers.set(key, setTimeout(run, delay));
}

/** Дописать отложенное сохранение объекта сейчас — например, перед переносом в корзину. */
async function flushSave(col: Collection, id: Id) {
  await pendingSaves.get(`${col}:${id}`)?.();
}

/** Немедленно выполнить отложенные сохранения (перед закрытием окна). */
export async function flushSaves() {
  await Promise.all([...pendingSaves.values()].map((fn) => fn()));
}

// ------------------------------------------------------------------ отмена и повтор

// История хранит прежние версии изменённых объектов (наборов правил, подразделений, сценариев).
// Изменения одного тика объединяются в один шаг; непрерывный ввод текста (и движение ползунка)
// в одном объекте — тоже. Клики, перетаскивания и команды всегда отдельные шаги.

type Col = 'rulesets' | 'formations' | 'forces' | 'scenarios';
type Op = 'edit' | 'add' | 'delete' | 'custom';

interface HistEntry {
  items: Map<string, unknown>;
  op: Op;
  label: string;
  at: number;
  typing?: boolean;
}

/** Изменение вызвано вводом в поле (событие input), а не кликом или командой. */
const isTyping = () => typeof window !== 'undefined' && (window.event as Event | undefined)?.type === 'input';

const HIST_LIMIT = 200;
const COALESCE_MS = 1200;
const undoStack: HistEntry[] = [];
const redoStack: HistEntry[] = [];
let pendingEntry: HistEntry | null = null;

export const useHistory = create<{ undo: string | null; redo: string | null }>(() => ({ undo: null, redo: null }));

function syncHistory() {
  useHistory.setState({ undo: undoStack[undoStack.length - 1]?.label ?? null, redo: redoStack[redoStack.length - 1]?.label ?? null });
}

const NOUN: Record<Col, string> = { rulesets: 'набор правил', formations: 'шаблон', forces: 'силы', scenarios: 'сценарий' };

function splitKey(key: string): [Col, Id] {
  const i = key.indexOf(':');
  return [key.slice(0, i) as Col, key.slice(i + 1)];
}

function describe(e: HistEntry): string {
  const [key] = e.items.keys();
  const [col, id] = splitKey(key);
  const obj = (e.items.get(key) ?? get()[col][id]) as { name?: string } | undefined;
  const name = `«${obj?.name ?? ''}»`;
  const more = e.items.size > 1 ? ` и ещё ${e.items.size - 1}` : '';
  if (e.op === 'add') return `создание: ${NOUN[col]} ${name}${more}`;
  if (e.op === 'delete') return `удаление: ${NOUN[col]} ${name}${more}`;
  return `изменения в ${name}${more}`;
}

function commitPending() {
  const e = pendingEntry;
  pendingEntry = null;
  if (!e || !e.items.size) return;
  if (!e.label) e.label = describe(e);
  undoStack.push(e);
  if (undoStack.length > HIST_LIMIT) undoStack.shift();
  syncHistory();
}

function openEntry(op: Op, label = '') {
  pendingEntry = { items: new Map(), op, label, at: Date.now(), typing: op === 'edit' && isTyping() };
  redoStack.length = 0;
  queueMicrotask(commitPending);
}

/** Запомнить прежнюю версию объекта перед изменением. */
function record(col: Col, id: Id, op: Op) {
  if (!get().loaded) return;
  const key = `${col}:${id}`;
  if (!pendingEntry) {
    const last = undoStack[undoStack.length - 1];
    const now = Date.now();
    if (op === 'edit' && last?.typing && isTyping() && last.items.size === 1 && last.items.has(key) && now - last.at < COALESCE_MS) {
      last.at = now;
      redoStack.length = 0;
      syncHistory();
      return;
    }
    openEntry(op);
  }
  if (!pendingEntry!.items.has(key)) pendingEntry!.items.set(key, get()[col][id]);
}

/** Следующие изменения (в этом же тике) — один шаг истории с понятным названием. */
export function historyStep(label: string) {
  commitPending();
  openEntry('custom', label);
}

function applyEntry(e: HistEntry): HistEntry {
  const inv: HistEntry = { items: new Map(), op: e.op, label: e.label, at: 0 };
  set((s) => {
    const next = { rulesets: { ...s.rulesets }, formations: { ...s.formations }, forces: { ...s.forces }, scenarios: { ...s.scenarios } } as Record<Col, Record<Id, unknown>>;
    for (const [key, val] of e.items) {
      const [col, id] = splitKey(key);
      inv.items.set(key, s[col][id]);
      if (val === undefined) delete next[col][id];
      else next[col][id] = val;
    }
    return next as Pick<AppState, Col>;
  });
  for (const key of e.items.keys()) {
    const [col, id] = splitKey(key);
    if (get()[col][id]) scheduleSave(col, id, () => get()[col][id], 0);
    else void storage.remove(col, id);
  }
  closeTabsWhere((t) => !tabExists(t));
  return inv;
}

/** Уведомления с кнопками отмены/повтора после нового шага истории уже неактуальны. */
function dropActionToasts() {
  set((s) => ({ toasts: s.toasts.filter((t) => !t.action) }));
}

export function undo() {
  commitPending();
  dropActionToasts();
  const e = undoStack.pop();
  if (!e) return toast('Отменять нечего.');
  redoStack.push(applyEntry(e));
  syncHistory();
  toast(`Отменено: ${e.label}`, 'info', { label: 'Повторить', run: redo });
}

export function redo() {
  commitPending();
  dropActionToasts();
  const e = redoStack.pop();
  if (!e) return toast('Повторять нечего.');
  undoStack.push({ ...applyEntry(e), at: 0 });
  syncHistory();
  toast(`Повторено: ${e.label}`);
}

/** Уведомление с кнопкой «Отменить» для только что сделанного шага. */
export function toastUndoable(text: string, kind: Toast['kind'] = 'info') {
  queueMicrotask(() => {
    commitPending();
    const e = undoStack[undoStack.length - 1];
    toast(text, kind, {
      label: 'Отменить',
      run: () => {
        if (undoStack[undoStack.length - 1] === e) undo();
        else toast('После этого были другие изменения — отменяйте по шагам (Ctrl+Z).', 'bad');
      },
    });
  });
}

// ------------------------------------------------------------------ загрузка

export async function initApp() {
  const [rs, fs, fc, sc, bt] = await Promise.all([
    storage.list('rulesets'),
    storage.list('formations'),
    storage.list('forces'),
    storage.list('scenarios'),
    storage.list('battles'),
  ]);
  // Копия — до любых изменений при загрузке; повреждённые файлы хранилище уже отложило в сторону.
  await storage.backup('auto').catch(() => null);
  const problems = (await storage.problems()).map((p) => `${COL_LABEL[p.col] ?? p.col}: ${p.file} — ${p.error}`);
  const take = <T extends { id?: Id; name?: string }, R>(col: Collection, list: unknown[], fix: (x: T) => R): Record<Id, R> => {
    const out: Record<Id, R> = {};
    for (const x of list as T[]) {
      try {
        if (!x?.id) throw new Error();
        out[x.id] = fix(x);
      } catch {
        problems.push(`${COL_LABEL[col]}: «${x?.name ?? x?.id ?? '?'}» — не распознано`);
      }
    }
    return out;
  };
  const rulesets = take('rulesets', rs, (r: Ruleset) => normalizeRuleset(r));
  // Старые файлы («формирование + элементы») переводятся в дерево подразделений при загрузке.
  const formations = take('formations', fs, (f: UnitNode) => migrateUnit(f));
  const forces = take('forces', fc, (f: UnitNode) => migrateUnit(f));
  const scenarios = take('scenarios', sc, (x: Scenario) => migrateScenario(x));
  const battleIndex = take('battles', bt, (b: BattleMeta) => b);

  const firstRun = !Object.keys(rulesets).length && !localStorage.getItem('warsim-initialized');
  set({ rulesets, formations, forces, scenarios, battleIndex });
  if (firstRun) {
    await installExamples();
    localStorage.setItem('warsim-initialized', '1');
    localStorage.setItem(MODEL_FLAG, '1');
  } else {
    await addLinearExample();
    await migrateToForces();
  }
  if (!Object.keys(get().rulesets).length) {
    // Без набора правил программа бесполезна — создаём пустой.
    const r = makeBlankRuleset('Мой набор правил');
    set((s) => ({ rulesets: { ...s.rulesets, [r.id]: r } }));
    scheduleSave('rulesets', r.id, () => get().rulesets[r.id]);
  }
  const saved = loadLocal<{ tabs: Tab[]; active: string }>('warsim-tabs', { tabs: [], active: '' });
  const valid = saved.tabs.filter((t) => tabExists(t));
  set({
    loaded: true,
    tabs: valid.length ? valid : [{ key: 'home', kind: 'home' }],
    active: valid.some((t) => t.key === saved.active) ? saved.active : (valid[0]?.key ?? 'home'),
  });
  if (problems.length) void reportProblems(problems);
  // Пока программа открыта, копия делается раз в час (если что-то изменилось).
  setInterval(() => void flushSaves().then(() => storage.backup('auto')).catch(() => null), 3600e3);
}

const COL_LABEL: Record<string, string> = { rulesets: 'Наборы правил', formations: 'Шаблоны', forces: 'Силы', scenarios: 'Сценарии', battles: 'Бои' };

async function reportProblems(list: string[]) {
  const last = (await storage.backups().catch(() => []))[0];
  const shown = list.slice(0, 8).join('\n') + (list.length > 8 ? `\n… и ещё ${list.length - 8}` : '');
  await alertDialog(
    'Часть данных не удалось прочитать',
    `${shown}\n\nОстальное загружено. Нечитаемые файлы не удалены — они отложены в папку «damaged» внутри папки данных.` +
      (last ? `\nПоследняя резервная копия — ${fmtDate(last.createdAt)}; вернуть из неё можно в Настройках → «Данные».` : ''),
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ корзина и резервные копии

/** Вернуть объекты из корзины. */
export async function restoreFromTrash(items: Pick<TrashItem, 'col' | 'key'>[]): Promise<number> {
  let n = 0;
  for (const it of items) {
    const data = (await storage.restoreTrash(it.col, it.key)) as { id?: Id } | null;
    if (!data?.id) continue;
    try {
      if (it.col === 'battles') set((s) => ({ battleIndex: { ...s.battleIndex, [data.id!]: battleMeta(data as Battle) } }));
      else {
        const col = it.col as Col;
        const fix = col === 'rulesets' ? normalizeRuleset : col === 'formations' || col === 'forces' ? migrateUnit : migrateScenario;
        set((s) => ({ [col]: { ...s[col], [data.id!]: fix(data as never) } }) as Partial<AppState>);
      }
      n++;
    } catch {
      toast(`Не удалось вернуть «${it.key}»: объект не распознан.`, 'bad');
    }
  }
  if (!n && items.length) toast('В корзине этого уже нет.', 'bad');
  return n;
}

/** Вернуть наборы правил, шаблоны, силы и сценарии из резервной копии (с перезапуском окна). */
export async function restoreBackup(id: string, label: string) {
  const ok = await confirmDialog(
    `Восстановить данные из копии от ${label}?`,
    'Наборы правил, шаблоны, силы и сценарии из копии заменят текущие версии; созданное позже копии останется. Бои не затрагиваются.\nТекущее состояние перед этим само сохранится в отдельную копию — восстановление можно отменить, вернувшись к ней.',
    'Восстановить',
  );
  if (!ok) return;
  await flushSaves();
  try {
    const n = await storage.restoreBackup(id);
    toast(`Восстановлено объектов: ${n}. Перезапуск…`, 'good');
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    toast(`Не удалось восстановить: ${(e as Error).message}`, 'bad');
  }
}

export function migrateScenario(sc: Scenario): Scenario {
  return { ...sc, sides: sc.sides.map((sd) => ({ ...sd, formations: (sd.formations ?? []).map((f) => migrateUnit(f)) })) as Scenario['sides'] };
}

const linearUnits = () => [...makeLinearTemplates(), makeLinearBrigade(), makeLinearDefenders()];

/** Модель «шаблоны + силы» введена: шаблоны очищены, подразделения сценариев перенесены в силы. */
const MODEL_FLAG = 'warsim-model-forces';

/** Примеры: шаблоны (чертежи) отдельно, силы сторон — отдельно; сценарии ссылаются на силы. */
function exampleScenario(sc: Scenario, rootIds: [string, string], templates: Record<Id, UnitNode>, before: Map<Id, string>) {
  sc.sides.forEach((sd, i) => sd.formations[0] && (sd.formations[0].id = rootIds[i]));
  rehashCopies(sc.sides.flatMap((sd) => sd.formations), before, templates);
  return extractForces(sc, new Set(), () => newId('u'));
}

export async function installExamples() {
  const universal = makeUniversalRuleset();
  const linear = makeLinearRuleset();
  const named = (u: UnitNode, name: string) => ({ ...u, name });
  const raw = [
    ...[...makeDemoTemplates(), named(makeDemoBattalion(), 'Мотострелковый батальон (пример)'), named(makeDemoDefenders(), 'Оборонительный узел усиленной роты (пример)')].map((u) => ({
      ...u,
      rulesetId: universal.id,
    })),
    ...linearUnits(),
  ];
  const before = new Map(raw.map((t) => [t.id, unitHash(t)]));
  const templates = Object.fromEntries(raw.map((t) => [t.id, toTemplate(t)]));
  rehashCopies(Object.values(templates), before, templates);
  const a = exampleScenario(makeDemoScenario(), ['force-demo-bn', 'force-demo-def'], templates, before);
  const b = exampleScenario(makeLinearScenario(), ['force-lin-brig', 'force-lin-def'], templates, before);
  await putExamples([universal, linear], Object.values(templates), [a.scenario, b.scenario], [...a.forces, ...b.forces]);
  localStorage.setItem('warsim-examples-linear', '1');
}

async function putExamples(rs: Ruleset[], units: UnitNode[], scs: Scenario[], forces: UnitNode[] = []) {
  set((s) => ({
    rulesets: { ...s.rulesets, ...Object.fromEntries(rs.map((r) => [r.id, r])) },
    formations: { ...s.formations, ...Object.fromEntries(units.map((u) => [u.id, u])) },
    forces: { ...s.forces, ...Object.fromEntries(forces.map((u) => [u.id, u])) },
    scenarios: { ...s.scenarios, ...Object.fromEntries(scs.map((x) => [x.id, x])) },
  }));
  for (const r of rs) await storage.save('rulesets', r.id, r);
  for (const f of units) await storage.save('formations', f.id, f);
  for (const f of forces) await storage.save('forces', f.id, f);
  for (const x of scs) await storage.save('scenarios', x.id, x);
}

/**
 * Переход на «шаблоны + силы». Один раз: шаблоны очищаются от приказов и состояния (актуальные копии
 * остаются актуальными), подразделения с потерями сохраняются ещё и как силы. Всегда: сценарий со
 * старыми копиями подразделений (в том числе импортированный) переводится на силы.
 */
async function migrateToForces() {
  const s = get();
  const first = !localStorage.getItem(MODEL_FLAG);
  let templates = s.formations;
  const extraForces: UnitNode[] = [];
  const before = new Map(Object.values(s.formations).map((t) => [t.id, unitHash(t)]));
  if (first) {
    templates = Object.fromEntries(Object.values(s.formations).map((t) => [t.id, toTemplate(t)]));
    rehashCopies(Object.values(templates), before, templates);
    // Шаблон (бывшее подразделение библиотеки) с потерями — это, по сути, уже конкретные силы: сохраняем и их.
    for (const t of Object.values(s.formations)) {
      if (t.id.startsWith('demo-')) continue;
      let hurt = false;
      walkUnits(t, (n) => n.composition.forEach((c) => (c.current < c.authorized || (c.recoverable ?? 0) > 0) && (hurt = true)));
      if (!hurt) continue;
      const f = cloneUnit(t);
      walkUnits(f, (n) => void (n.order = null));
      f.templateId = t.id;
      f.templateHash = unitHash(templates[t.id]);
      extraForces.push(f);
    }
  }
  const taken = new Set<Id>();
  for (const f of Object.values(s.forces)) walkUnits(f, (n) => void taken.add(n.id));
  const forces: UnitNode[] = [...extraForces];
  const scenarios: Scenario[] = [];
  for (const sc of Object.values(s.scenarios)) {
    if (sc.sides.every((sd) => sd.units)) continue;
    const copy = clone(sc);
    if (first) rehashCopies(copy.sides.flatMap((sd) => sd.formations), before, templates);
    const r = extractForces(copy, taken, () => newId('u'));
    forces.push(...r.forces);
    scenarios.push(r.scenario);
  }
  const changedTemplates = first ? Object.values(templates).filter((t) => JSON.stringify(t) !== JSON.stringify(s.formations[t.id])) : [];
  set((st) => ({
    formations: first ? templates : st.formations,
    forces: { ...st.forces, ...Object.fromEntries(forces.map((f) => [f.id, f])) },
    scenarios: { ...st.scenarios, ...Object.fromEntries(scenarios.map((x) => [x.id, x])) },
  }));
  for (const t of changedTemplates) await storage.save('formations', t.id, t);
  for (const f of forces) await storage.save('forces', f.id, f);
  for (const x of scenarios) await storage.save('scenarios', x.id, x);
  localStorage.setItem(MODEL_FLAG, '1');
  if (first && (forces.length || changedTemplates.length))
    queueMicrotask(() =>
      toast(
        `Подразделения теперь делятся на «Шаблоны» (устройство и штат) и «Силы» (конкретные подразделения с потерями). Подразделения сценариев перенесены в «Силы»: ${forces.length}.`,
        'info',
      ),
    );
}

/** Пример боя для «Линейной тактики» появился позже остальных — добавляется один раз тем, у кого этот набор уже есть. */
async function addLinearExample() {
  if (localStorage.getItem('warsim-examples-linear')) return;
  localStorage.setItem('warsim-examples-linear', '1');
  const s = get();
  const rs = s.rulesets['rs-linear'];
  if (!rs || s.scenarios['sc-demo-linear']) return;
  // Прежние значения примера давали слишком вялый бой; свои настройки ГМ не трогаем.
  const k = rs.coefficients;
  const upd = k.casualtyScale === 1 && k.moralePerLossPct === 1.2 ? [{ ...rs, coefficients: { ...k, ...pickCoefficients(makeLinearRuleset(), ['casualtyScale', 'moralePerLossPct']) } }] : [];
  const units = linearUnits().filter((u) => !s.formations[u.id]);
  await putExamples(upd, units, [makeLinearScenario()]);
}

function pickCoefficients(r: Ruleset, keys: string[]) {
  return Object.fromEntries(keys.map((x) => [x, r.coefficients[x as keyof Ruleset['coefficients']]]));
}

useApp.subscribe((s, prev) => {
  if (s.settings !== prev.settings) localStorage.setItem('warsim-settings', JSON.stringify(s.settings));
  if (s.loaded && (s.tabs !== prev.tabs || s.active !== prev.active)) localStorage.setItem('warsim-tabs', JSON.stringify({ tabs: s.tabs, active: s.active }));
});

export function updateSettings(patch: Partial<Settings>) {
  set((s) => ({ settings: { ...s.settings, ...patch } }));
}

// ------------------------------------------------------------------ вкладки

export function tabKey(kind: TabKind, ref?: string) {
  return ref ? `${kind}:${ref}` : kind;
}

function tabExists(t: Tab): boolean {
  const s = get();
  switch (t.kind) {
    case 'ruleset':
      return !!s.rulesets[t.ref!];
    case 'scenario':
    case 'montecarlo':
      return !!s.scenarios[t.ref!];
    case 'formation':
      return !!resolveFormation(t.ref!);
    case 'battle':
      return !!s.battleIndex[t.ref!] || !!useBattles.getState().battles[t.ref!];
    default:
      return true;
  }
}

export function openTab(kind: TabKind, ref?: string, opts: { background?: boolean; sub?: string } = {}) {
  const key = tabKey(kind, ref);
  set((s) => {
    const exists = s.tabs.find((t) => t.key === key);
    let tabs = s.tabs;
    if (!exists) {
      const idx = s.tabs.findIndex((t) => t.key === s.active);
      tabs = [...s.tabs];
      tabs.splice(idx + 1, 0, { key, kind, ref, sub: opts.sub });
    } else if (opts.sub) {
      tabs = s.tabs.map((t) => (t.key === key ? { ...t, sub: opts.sub } : t));
    }
    return { tabs, active: opts.background ? s.active : key };
  });
}

export function closeTab(key: string) {
  set((s) => {
    const idx = s.tabs.findIndex((t) => t.key === key);
    if (idx < 0) return {};
    const tabs = s.tabs.filter((t) => t.key !== key);
    let active = s.active;
    if (active === key) active = tabs[Math.min(idx, tabs.length - 1)]?.key ?? '';
    if (!tabs.length) return { tabs: [{ key: 'home', kind: 'home' as const }], active: 'home' };
    return { tabs, active };
  });
}

export function closeTabsWhere(pred: (t: Tab) => boolean) {
  for (const t of get().tabs.filter(pred)) closeTab(t.key);
}

export function activateTab(key: string) {
  set({ active: key });
}

export function setTabSub(key: string, sub: string) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, sub } : t)) }));
}

export function moveTab(from: string, to: string) {
  set((s) => {
    const tabs = [...s.tabs];
    const i = tabs.findIndex((t) => t.key === from);
    const j = tabs.findIndex((t) => t.key === to);
    if (i < 0 || j < 0) return {};
    const [t] = tabs.splice(i, 1);
    tabs.splice(j, 0, t);
    return { tabs };
  });
}

// ------------------------------------------------------------------ наборы правил

export function updateRuleset(id: Id, fn: (r: Ruleset) => void) {
  if (get().rulesets[id]) record('rulesets', id, 'edit');
  set((s) => {
    if (!s.rulesets[id]) return {};
    const next = produce(s.rulesets[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { rulesets: { ...s.rulesets, [id]: next } };
  });
  scheduleSave('rulesets', id, () => get().rulesets[id]);
}

export function replaceRuleset(r: Ruleset) {
  const n = normalizeRuleset(r);
  record('rulesets', n.id, get().rulesets[n.id] ? 'edit' : 'add');
  set((s) => ({ rulesets: { ...s.rulesets, [n.id]: n } }));
  scheduleSave('rulesets', n.id, () => get().rulesets[n.id], 0);
}

export function createRuleset(from?: Id): Id {
  const src = from ? get().rulesets[from] : undefined;
  const r = src ? { ...clone(src), id: newId('rs'), name: `${src.name.replace(/ \(пример\)$/, '')} (копия)`, updatedAt: undefined } : makeBlankRuleset();
  replaceRuleset(r);
  openTab('ruleset', r.id);
  return r.id;
}

/** Новый набор правил: на основе существующего (по умолчанию — того, с которым работают) или пустой. */
export async function newRulesetDialog(): Promise<Id | undefined> {
  const s = get();
  const def = defaultRulesetId();
  const list = Object.values(s.rulesets).sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : a.name.localeCompare(b.name, 'ru')));
  const v = await chooseDialog(
    'Новый набор правил — на основе чего?',
    [
      ...list.map((r) => ({ value: r.id, label: `На основе «${r.name}»${r.era ? ` — ${r.era}` : ''}` })),
      { value: '', label: 'Пустой: каталог типов с нуля, остальное — по умолчанию' },
    ],
    'Проще всего взять похожий набор и поменять в нём нужное: типы и их огневую мощь, приказы, условия, коэффициенты. Исходный набор не изменится.',
  );
  if (v === null) return;
  return createRuleset(v || undefined);
}

export async function deleteRuleset(id: Id) {
  const s = get();
  const r = s.rulesets[id];
  if (!r) return;
  if (Object.keys(s.rulesets).length <= 1) {
    toast('Нельзя удалить единственный набор правил.', 'bad');
    return;
  }
  const users = Object.values(s.scenarios).filter((x) => x.rulesetId === id).length;
  const ok = await confirmDialog(`Удалить набор правил «${r.name}»?`, users ? `Его используют сценарии: ${users}. Их придётся перевести на другой набор.` : undefined, 'Удалить', true);
  if (!ok) return;
  await flushSave('rulesets', id);
  record('rulesets', id, 'delete');
  set((st) => {
    const { [id]: _, ...rest } = st.rulesets;
    return { rulesets: rest };
  });
  toastUndoable(`Набор правил «${r.name}» удалён (он в корзине).`);
  await storage.remove('rulesets', id);
  closeTabsWhere((t) => t.kind === 'ruleset' && t.ref === id);
}

// ------------------------------------------------------------------ подразделения

/** Ссылка вкладки конструктора: «lib:id» — шаблон, «force:id» — силы. */
export function resolveFormation(ref: string): { f: UnitNode; rulesetId?: Id; kind: 'template' | 'force' } | null {
  const s = get();
  const [scope, a] = ref.split(':');
  if (scope === 'lib') {
    const f = s.formations[a];
    return f ? { f, rulesetId: f.rulesetId, kind: 'template' } : null;
  }
  if (scope === 'force') {
    const f = s.forces[a];
    return f ? { f, rulesetId: f.rulesetId, kind: 'force' } : null;
  }
  return null;
}

export function updateFormationRef(ref: string, fn: (f: UnitNode) => void) {
  const [scope, a] = ref.split(':');
  if (scope === 'lib') return updateFormation(a, fn);
  if (scope === 'force') return updateForce(a, fn);
}

export function updateFormation(id: Id, fn: (f: UnitNode) => void) {
  if (get().formations[id]) record('formations', id, 'edit');
  set((s) => {
    if (!s.formations[id]) return {};
    const next = produce(s.formations[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { formations: { ...s.formations, [id]: next } };
  });
  scheduleSave('formations', id, () => get().formations[id]);
}

export function addFormation(f: UnitNode, open = true): Id {
  record('formations', f.id, 'add');
  set((s) => ({ formations: { ...s.formations, [f.id]: f } }));
  scheduleSave('formations', f.id, () => get().formations[f.id], 0);
  if (open) openTab('formation', `lib:${f.id}`);
  return f.id;
}

/**
 * Набор правил для нового подразделения или сценария: тот, с которым сейчас работают
 * (открытая вкладка), иначе — самый используемый, иначе — последний изменённый.
 */
export function defaultRulesetId(): Id | undefined {
  const s = get();
  const t = s.tabs.find((x) => x.key === s.active);
  let ctx: Id | undefined;
  if (t?.kind === 'ruleset') ctx = t.ref;
  else if (t?.kind === 'scenario' || t?.kind === 'montecarlo') ctx = s.scenarios[t.ref!]?.rulesetId;
  else if (t?.kind === 'formation') ctx = resolveFormation(t.ref!)?.rulesetId;
  else if (t?.kind === 'battle') ctx = useBattles.getState().battles[t.ref!]?.ruleset.id;
  if (ctx && s.rulesets[ctx]) return ctx;
  const used = new Map<Id, number>();
  for (const f of Object.values(s.formations)) if (f.rulesetId) used.set(f.rulesetId, (used.get(f.rulesetId) ?? 0) + 1);
  for (const sc of Object.values(s.scenarios)) used.set(sc.rulesetId, (used.get(sc.rulesetId) ?? 0) + 1);
  // При равенстве (например, сразу после установки примеров) — основной пример, «Универсальный».
  const main = (r: Ruleset) => (r.id === 'rs-universal' ? 0 : 1);
  return Object.values(s.rulesets).sort(
    (a, b) =>
      (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || main(a) - main(b) || a.name.localeCompare(b.name, 'ru'),
  )[0]?.id;
}

export function createFormation(rulesetId?: Id): Id {
  return addFormation(newRootUnit('Новое подразделение', { rulesetId: rulesetId ?? defaultRulesetId(), level: '' }));
}

export function duplicateFormation(id: Id): Id | undefined {
  const f = get().formations[id];
  if (!f) return;
  const c = cloneUnit(f);
  c.name = `${f.name} (копия)`;
  return addFormation(c);
}

export async function deleteFormation(id: Id) {
  const f = get().formations[id];
  if (!f) return;
  if (!(await confirmDialog(`Удалить шаблон «${f.name}»?`, 'Силы, созданные по нему, останутся — просто перестанут обновляться по шаблону.', 'Удалить', true))) return;
  await flushSave('formations', id);
  record('formations', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.formations;
    return { formations: rest };
  });
  toastUndoable(`Шаблон «${f.name}» удалён (он в корзине).`);
  await storage.remove('formations', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `lib:${id}`);
}

// ------------------------------------------------------------------ силы

export function updateForce(id: Id, fn: (f: UnitNode) => void) {
  if (get().forces[id]) record('forces', id, 'edit');
  set((s) => {
    if (!s.forces[id]) return {};
    const next = produce(s.forces[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { forces: { ...s.forces, [id]: next } };
  });
  scheduleSave('forces', id, () => get().forces[id]);
}

export function addForce(f: UnitNode, open = true): Id {
  record('forces', f.id, 'add');
  set((s) => ({ forces: { ...s.forces, [f.id]: { ...f, updatedAt: new Date().toISOString() } } }));
  scheduleSave('forces', f.id, () => get().forces[f.id], 0);
  if (open) openTab('formation', `force:${f.id}`);
  return f.id;
}

/** Силы по шаблону (×count, с номерами по порядку). */
export function createForcesFromTemplate(templateId: Id, opts: { count?: number; faction?: string; name?: string; open?: boolean } = {}): Id[] {
  const tpl = get().formations[templateId];
  if (!tpl) return [];
  const n = Math.max(1, Math.min(50, opts.count ?? 1));
  const base = opts.name ?? tpl.name.replace(/ \(пример\)$/, '');
  const ids: Id[] = [];
  if (n > 1) historyStep(`создание сил по шаблону «${tpl.name}»`);
  for (let k = 0; k < n; k++) {
    const f = forceFromTemplate(tpl, { name: k ? nextName(base, k) : base, faction: opts.faction });
    ids.push(addForce(f, false));
  }
  if (opts.open !== false && ids.length === 1) openTab('formation', `force:${ids[0]}`);
  return ids;
}

/** Новые силы: по шаблону (как обычно) или пустое подразделение. */
export async function newForceDialog(faction?: string): Promise<Id | undefined> {
  const s = get();
  const list = Object.values(s.formations).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const v = await chooseDialog(
    'Новые силы — по какому шаблону?',
    [...list.map((t) => ({ value: t.id, label: `${t.level ? `${t.level} · ` : ''}${t.name}` })), { value: '', label: 'Пустое подразделение (собрать вручную)' }],
    'Силы — конкретное подразделение: по шаблону берётся устройство и штат, а состояние и потери у каждого свои. Шаблон потом можно менять — силы обновятся по нему, сохранив потери.',
  );
  if (v === null) return;
  if (v) return createForcesFromTemplate(v, { faction })[0];
  return addForce(newRootUnit('Новое подразделение', { rulesetId: defaultRulesetId(), level: '', faction }));
}

export function duplicateForce(id: Id): Id | undefined {
  const f = get().forces[id];
  if (!f) return;
  const c = cloneUnit(f);
  c.name = `${f.name} (копия)`;
  return addForce(c);
}

/** Сценарии, где участвует это подразделение сил. */
export function forceUsage(id: Id): Scenario[] {
  return Object.values(get().scenarios).filter((sc) => scenarioForceIds(sc).has(id));
}

export async function deleteForce(id: Id) {
  const f = get().forces[id];
  if (!f) return;
  const used = forceUsage(id);
  const text = used.length ? `Оно участвует в сценариях: ${used.map((x) => `«${x.name}»`).join(', ')} — там его не станет.` : undefined;
  if (!(await confirmDialog(`Удалить силы «${f.name}»?`, text, 'Удалить', true))) return;
  await flushSave('forces', id);
  historyStep(`удаление сил «${f.name}»`);
  record('forces', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.forces;
    return { forces: rest };
  });
  for (const sc of used) updateScenario(sc.id, (d) => d.sides.forEach((sd) => (sd.units = (sd.units ?? []).filter((u) => u.forceId !== id))));
  toastUndoable(`Силы «${f.name}» удалены (они в корзине).`);
  await storage.remove('forces', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `force:${id}`);
}

/** Сценарий, готовый к бою: стороны собраны из текущих сил. */
export function scenarioForBattle(sc: Scenario): Scenario {
  return resolveScenario(sc, get().forces);
}

// ------------------------------------------------------------------ сценарии

export function updateScenario(id: Id, fn: (s: Scenario) => void) {
  if (get().scenarios[id]) record('scenarios', id, 'edit');
  set((s) => {
    if (!s.scenarios[id]) return {};
    const next = produce(s.scenarios[id], (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    return { scenarios: { ...s.scenarios, [id]: next } };
  });
  scheduleSave('scenarios', id, () => get().scenarios[id]);
}

export function addScenario(sc: Scenario, open = true): Id {
  record('scenarios', sc.id, 'add');
  set((s) => ({ scenarios: { ...s.scenarios, [sc.id]: sc } }));
  scheduleSave('scenarios', sc.id, () => get().scenarios[sc.id], 0);
  if (open) openTab('scenario', sc.id);
  return sc.id;
}

export function createScenario(rulesetId?: Id): Id {
  const s = get();
  const rs = s.rulesets[rulesetId ?? defaultRulesetId() ?? ''] ?? Object.values(s.rulesets)[0];
  const sc = newScenario(rs, 'Новый сценарий', randomSeed());
  // Стороны нового сценария ссылаются на силы.
  sc.sides.forEach((sd) => (sd.units = []));
  return addScenario(sc);
}

export function duplicateScenario(id: Id): Id | undefined {
  const sc = get().scenarios[id];
  if (!sc) return;
  const c = clone(sc);
  c.id = newId('sc');
  c.name = `${sc.name} (копия)`;
  return addScenario(c);
}

export async function deleteScenario(id: Id) {
  const sc = get().scenarios[id];
  if (!sc) return;
  if (!(await confirmDialog(`Удалить сценарий «${sc.name}»?`, 'Сохранённые бои по нему останутся.', 'Удалить', true))) return;
  await flushSave('scenarios', id);
  record('scenarios', id, 'delete');
  set((s) => {
    const { [id]: _, ...rest } = s.scenarios;
    return { scenarios: rest };
  });
  toastUndoable(`Сценарий «${sc.name}» удалён (он в корзине).`);
  await storage.remove('scenarios', id);
  closeTabsWhere((t) => ((t.kind === 'scenario' || t.kind === 'montecarlo') && t.ref === id) || (t.kind === 'formation' && !!t.ref?.startsWith(`sc:${id}:`)));
}

// ------------------------------------------------------------------ бои (живые объекты, без immer)

interface BattlesState {
  battles: Record<Id, Battle>;
  rev: Record<Id, number>;
}

export const useBattles = create<BattlesState>(() => ({ battles: {}, rev: {} }));

export function putBattle(b: Battle, persist = true) {
  useBattles.setState((s) => ({ battles: { ...s.battles, [b.id]: b }, rev: { ...s.rev, [b.id]: (s.rev[b.id] ?? 0) + 1 } }));
  set((s) => ({ battleIndex: { ...s.battleIndex, [b.id]: battleMeta(b) } }));
  // На диск — без подробного журнала: в 5–10 раз меньше; подробности восстанавливаются повтором.
  if (persist)
    scheduleSave('battles', b.id, () => {
      const x = useBattles.getState().battles[b.id];
      return x && trimBattleForStorage(x);
    }, 1200);
}

/**
 * Вернуть бою подробный журнал и разборы (после загрузки с диска их нет). Для больших боёв это
 * может занять секунду. false — бой сохранён другой версией программы и повтор с ним разошёлся.
 */
export function ensureFullLog(b: Battle): boolean {
  if (!b.logTrimmed) return true;
  const ok = restoreBattleLog(b);
  if (ok) touchBattle(b.id);
  else toast('Подробности этого боя недоступны: он сохранён другой версией программы. Главное и обычное в журнале остались.', 'bad');
  return ok;
}

/** Удалить несколько боёв одним подтверждением. */
export async function deleteBattles(ids: Id[], title: string): Promise<boolean> {
  if (!ids.length) return false;
  if (!(await confirmDialog(title, `Будет удалено боёв: ${ids.length}. Сценарии и подразделения не затрагиваются.`, 'Удалить', true))) return false;
  for (const id of ids) await deleteBattle(id, false, true);
  toast(`Удалено боёв: ${ids.length} (они в корзине).`, 'good', { label: 'Вернуть', run: () => void restoreFromTrash(ids.map((key) => ({ col: 'battles', key }))) });
  return true;
}

// Откат в бою: бой повторяется с теми же бросками и решениями ГМ до нужного момента.
// Отменённые состояния хранятся в памяти — «Вернуть» (Ctrl+Y) возвращает их, пока бой не продолжили.
const battleRedo = new Map<Id, Battle[]>();

const NOT_REPLAYABLE = 'Этот бой сохранён другой версией программы — повтор с ним расходится, отменить ход нельзя. Можно «Повторить с решениями ГМ» в меню боя.';

function replaceBattle(prev: Battle, next: Battle, what: string) {
  battleRedo.set(prev.id, [...(battleRedo.get(prev.id) ?? []), prev]);
  putBattle(next);
  toast(`${what}.`, 'info', { label: 'Вернуть', run: () => redoBattle(prev.id) });
}

/** Отменить последнее в бою: вмешательство ГМ после последнего хода или сам ход (Ctrl+Z на вкладке боя). */
export function undoBattle(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  const a = lastBattleAction(b);
  if (!a) return toast('Отменять нечего: бой в самом начале.');
  const nb = undoBattleAction(b);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  replaceBattle(b, nb, a.kind === 'turn' ? `Отменён ход ${a.turn}` : `Отменено: ${a.label}`);
}

/** Вернуть отменённое в бою (Ctrl+Y на вкладке боя). */
export function redoBattle(id: Id) {
  const stack = battleRedo.get(id);
  const prev = stack?.pop();
  if (!prev) return toast('Возвращать нечего.');
  putBattle(prev);
  toast(`Возвращено: ход ${prev.turn}.`);
}

/** Бой продолжили (ход, вмешательство) — отменённое уже не вернуть. */
export function forgetBattleRedo(id: Id) {
  battleRedo.delete(id);
}

/** Вернуться к концу выбранного хода; решения ГМ после него отбрасываются. */
export async function rewindBattleDialog(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b || b.turn < 1) return;
  const min = b.ruleset.turnMinutes;
  const time = (t: number) => `${Math.floor((t * min) / 60)}:${String((t * min) % 60).padStart(2, '0')}`;
  const options = Array.from({ length: b.turn }, (_, i) => b.turn - 1 - i).map((t) => ({
    value: String(t),
    label: t === 0 ? 'Начало боя (до первого хода)' : `После хода ${t} · ${time(t)}`,
  }));
  const v = await chooseDialog(
    'Вернуться к ходу',
    options,
    'Бой будет повторён с теми же бросками кубиков и вашими решениями до выбранного момента; более поздние ходы и решения отбрасываются. Вернуть их можно сразу после этого (Ctrl+Y).',
  );
  if (v === null) return;
  const t = Number(v);
  const nb = rewindBattle(b, t);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  replaceBattle(b, nb, t === 0 ? 'Бой возвращён к началу' : `Бой возвращён к ходу ${t}`);
}

/**
 * Ответвить бой: новый бой — копия этого до выбранного хода (те же броски и решения ГМ), а исходный
 * остаётся как есть — можно сыграть иначе и сравнить.
 */
export async function branchBattleDialog(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  const min = b.ruleset.turnMinutes;
  const time = (t: number) => `${Math.floor((t * min) / 60)}:${String((t * min) % 60).padStart(2, '0')}`;
  const options = Array.from({ length: b.turn + 1 }, (_, i) => b.turn - i).map((t) => ({
    value: String(t),
    label: t === b.turn ? `С текущего момента (после хода ${t}${b.interventions.some((x) => x.turn === t) ? ', с вашими решениями' : ''})` : t === 0 ? 'С начала боя' : `После хода ${t} · ${time(t)}`,
  }));
  const v = await chooseDialog(
    'Ответвить бой',
    options,
    'Новый бой — копия этого до выбранного момента: те же броски и ваши решения. Исходный бой не меняется — можно сыграть иначе и сравнить исходы.',
  );
  if (v === null) return;
  const t = Number(v);
  const nb = t === b.turn ? clone(b) : rewindBattle(b, t);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  const base = b.name.replace(/ — ветка с хода \d+$/, '');
  nb.id = newId('bt');
  nb.name = `${base} — ветка с хода ${t}`;
  nb.branchOf = { battleId: b.id, name: b.name, turn: t };
  nb.createdAt = new Date().toISOString();
  delete nb.appliedToForces;
  putBattle(nb);
  openTab('battle', nb.id);
  toast(`Ветка боя создана: «${nb.name}». Исходный бой не изменился.`, 'good');
}

/** Вызвать после изменения боя движком (ход, вмешательство). */
export function touchBattle(id: Id) {
  const b = useBattles.getState().battles[id];
  if (b) putBattle(b);
}

export async function loadBattle(id: Id): Promise<Battle | null> {
  const live = useBattles.getState().battles[id];
  if (live) return live;
  const b = (await storage.load('battles', id)) as Battle | null;
  if (b) putBattle(b, false);
  return b;
}

export async function deleteBattle(id: Id, ask = true, quiet = false) {
  const meta = get().battleIndex[id];
  if (ask && !(await confirmDialog(`Удалить бой «${meta?.name ?? id}»?`, 'Бой попадёт в корзину и хранится там 30 дней.', 'Удалить', true))) return;
  await flushSave('battles', id);
  useBattles.setState((s) => {
    const { [id]: _, ...rest } = s.battles;
    return { battles: rest };
  });
  set((s) => {
    const { [id]: _, ...rest } = s.battleIndex;
    return { battleIndex: rest };
  });
  await storage.remove('battles', id);
  closeTabsWhere((t) => t.kind === 'battle' && t.ref === id);
  if (!quiet) toast(`Бой «${meta?.name ?? id}» удалён (он в корзине).`, 'info', { label: 'Вернуть', run: () => void restoreFromTrash([{ col: 'battles', key: id }]) });
}

export function renameBattle(id: Id, name: string) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  b.name = name;
  touchBattle(id);
}

// ------------------------------------------------------------------ импорт и экспорт

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export async function exportJson(kind: string, name: string, data: unknown) {
  const ok = await storage.exportFile(`${safeName(name)}.${kind}.json`, JSON.stringify(data, null, 2));
  if (ok) toast('Файл сохранён.', 'good');
}

export async function exportText(name: string, text: string, ext = 'txt') {
  const ok = await storage.exportFile(`${safeName(name)}.${ext}`, text);
  if (ok) toast('Файл сохранён.', 'good');
}

export async function importFile() {
  const file = await storage.importFile();
  if (!file) return;
  let data: any;
  try {
    data = JSON.parse(file.content);
  } catch {
    toast('Файл не является JSON.', 'bad');
    return;
  }
  const s = get();
  if (data?.componentTypes && data?.rangeBands) {
    const r = normalizeRuleset(data as Ruleset);
    if (s.rulesets[r.id]) {
      r.id = newId('rs');
      r.name = `${r.name} (импорт)`;
    }
    replaceRuleset(r);
    openTab('ruleset', r.id);
    toast(`Импортирован набор правил «${r.name}».`, 'good');
  } else if (data?.log && data?.elements && data?.ruleset) {
    const b = data as Battle;
    if (s.battleIndex[b.id]) b.id = newId('bt');
    putBattle(b);
    openTab('battle', b.id);
    toast(`Импортирован бой «${b.name}».`, 'good');
  } else if (data?.sides && data?.rulesetId) {
    let sc = migrateScenario(data as Scenario);
    if (s.scenarios[sc.id]) {
      sc.id = newId('sc');
      sc.name = `${sc.name} (импорт)`;
    }
    // Файл сценария несёт свои подразделения — они становятся силами, сценарий ссылается на них.
    let n = 0;
    if (sc.sides.some((sd) => !sd.units)) {
      const taken = new Set<Id>();
      for (const f of Object.values(s.forces)) walkUnits(f, (x) => void taken.add(x.id));
      const r = extractForces(sc, taken, () => newId('u'));
      historyStep(`импорт сценария «${sc.name}»`);
      for (const f of r.forces) addForce(f, false);
      n = r.forces.length;
      sc = r.scenario;
    }
    addScenario(sc);
    if (!s.rulesets[sc.rulesetId]) toast('Набор правил сценария не найден — выберите другой в сценарии.', 'bad');
    else toast(`Импортирован сценарий «${sc.name}»${n ? `, в «Силы» добавлено подразделений: ${n}` : ''}.`, 'good');
  } else if ((data?.elements && data?.subunits) || (data?.children && data?.composition)) {
    const f = migrateUnit(data);
    // С принадлежностью — это силы (конкретное подразделение), без неё — шаблон.
    const asForce = typeof data.faction === 'string';
    if ((asForce ? s.forces : s.formations)[f.id]) {
      f.id = newId('fm');
      f.name = `${f.name} (импорт)`;
    }
    if (asForce) addForce(f);
    else addFormation(toTemplate(f));
    toast(`Импортировано: ${asForce ? 'силы' : 'шаблон'} «${f.name}».`, 'good');
  } else {
    toast('Не удалось распознать содержимое файла.', 'bad');
  }
}

// ------------------------------------------------------------------ шаблоны

/** Все копии шаблона: в других шаблонах и в силах. */
export function templateUsages(templateId: Id): { ref: string; owner: string; nodeId: Id; outdated: boolean }[] {
  const s = get();
  const tpl = s.formations[templateId];
  const out: { ref: string; owner: string; nodeId: Id; outdated: boolean }[] = [];
  const scan = (root: UnitNode, ref: string, owner: string) =>
    walkUnits(root, (n) => {
      if (n.templateId === templateId && n.id !== templateId) out.push({ ref, owner, nodeId: n.id, outdated: isOutdated(n, tpl) });
    });
  for (const f of Object.values(s.formations)) if (f.id !== templateId) scan(f, `lib:${f.id}`, f.name);
  for (const f of Object.values(s.forces)) scan(f, `force:${f.id}`, f.name);
  return out;
}

/** Обновить одну копию по её шаблону (на месте). */
export function updateCopy(ref: string, nodeId: Id) {
  updateFormationRef(ref, (root) => {
    const replace = (list: UnitNode[]): boolean => {
      const i = list.findIndex((x) => x.id === nodeId);
      if (i >= 0) {
        const tpl = get().formations[list[i].templateId ?? ''];
        if (tpl) list[i] = updateFromTemplate(JSON.parse(JSON.stringify(list[i])), tpl);
        return true;
      }
      return list.some((x) => replace(x.children));
    };
    if (root.id === nodeId) {
      const tpl = get().formations[root.templateId ?? ''];
      if (tpl) Object.assign(root, updateFromTemplate(JSON.parse(JSON.stringify(root)), tpl), { id: root.id });
    } else replace(root.children);
  });
}

/** Обновить все устаревшие копии шаблона. */
export function updateAllCopies(templateId: Id): number {
  const list = templateUsages(templateId).filter((u) => u.outdated);
  for (const u of list) updateCopy(u.ref, u.nodeId);
  if (list.length) toast(`Обновлено копий: ${list.length}.`, 'good');
  return list.length;
}

/** Копия шаблона для вставки. */
export function instantiateLibrary(id: Id, opts: { attachedFrom?: string; name?: string } = {}): UnitNode | null {
  const tpl = get().formations[id];
  return tpl ? instantiate(tpl, opts) : null;
}

/** Есть ли в дереве узел из этого шаблона (чтобы не вставить шаблон сам в себя). */
export function containsTemplate(root: UnitNode, templateId: Id): boolean {
  if (root.id === templateId) return true;
  let found = false;
  walkUnits(root, (n) => {
    if (n.templateId === templateId) found = true;
  });
  return found;
}

export { findUnit };
