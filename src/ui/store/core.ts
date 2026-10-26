// Ядро состояния программы: данные и открытая страница, уведомления и диалоги, сохранение с задержкой,
// отмена и повтор правок (Ctrl+Z / Ctrl+Y).

import { create } from 'zustand';
import type { PauseRules, UnitNode, Id, Ruleset, Scenario } from '../../engine';
import { storage, type BattleMeta, type Collection } from '../storage';
import { resolveFormation } from './library';
import { useBattles } from './battles';

export type TabKind = 'home' | 'ruleset' | 'formation' | 'scenario' | 'battle' | 'montecarlo' | 'settings' | 'help' | 'library' | 'team';

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
  /** Какие разделы навигатора развёрнуты (не задано — по умолчанию, см. NAV_OPEN_DEFAULT). */
  navOpen?: Partial<Record<NavSection, boolean>>;
  /** Что останавливает «ход до события» в бою. */
  pauseRules?: PauseRules;
  /** Прогонов в прогнозе боя. */
  forecastRuns?: number;
  /** Ширина боковой панели, px. */
  sideWidth?: number;
  /** Ширина инспектора справа, px. */
  inspectorWidth?: number;
  /** Инспектор справа показан. */
  inspector?: boolean;
  /** Цвета команд (принадлежность сил): название → цвет. Не задано — по одноимённой стороне сценария или из палитры. */
  teamColors?: Record<string, string>;
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

export interface AppState {
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

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', logLevel: 1, mcRuns: 200, sidebar: true, density: 'normal' };

export function loadLocal<T>(key: string, def: T): T {
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

export const set = useApp.setState;

export const get = useApp.getState;

// ------------------------------------------------------------------ уведомления и диалоги

export let toastId = 0;

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
  setTimeout(() => dismissToast(id), kind === 'bad' || action ? 6000 : 3500);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function openDialog(d: Omit<Dialog, 'resolve'>): Promise<string | boolean | null> {
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

export const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const pendingSaves = new Map<string, () => Promise<void>>();

export function scheduleSave(col: Collection, id: Id, getData: () => unknown, delay = 400) {
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
export async function flushSave(col: Collection, id: Id) {
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

export type Col = 'rulesets' | 'formations' | 'forces' | 'scenarios';

export type Op = 'edit' | 'add' | 'delete' | 'custom';

export interface HistEntry {
  items: Map<string, unknown>;
  op: Op;
  label: string;
  at: number;
  typing?: boolean;
}

/** Изменение вызвано вводом в поле (событие input), а не кликом или командой. */
export const isTyping = () => typeof window !== 'undefined' && (window.event as Event | undefined)?.type === 'input';

export const HIST_LIMIT = 200;

export const COALESCE_MS = 1200;

export const undoStack: HistEntry[] = [];

export const redoStack: HistEntry[] = [];

export let pendingEntry: HistEntry | null = null;

export const useHistory = create<{ undo: string | null; redo: string | null }>(() => ({ undo: null, redo: null }));

export function syncHistory() {
  useHistory.setState({ undo: undoStack[undoStack.length - 1]?.label ?? null, redo: redoStack[redoStack.length - 1]?.label ?? null });
}

export const NOUN: Record<Col, string> = { rulesets: 'набор правил', formations: 'шаблон', forces: 'силы', scenarios: 'сценарий' };

export function splitKey(key: string): [Col, Id] {
  const i = key.indexOf(':');
  return [key.slice(0, i) as Col, key.slice(i + 1)];
}

export function describe(e: HistEntry): string {
  const [key] = e.items.keys();
  const [col, id] = splitKey(key);
  const obj = (e.items.get(key) ?? get()[col][id]) as { name?: string } | undefined;
  const name = `«${obj?.name ?? ''}»`;
  const more = e.items.size > 1 ? ` и ещё ${e.items.size - 1}` : '';
  if (e.op === 'add') return `создание: ${NOUN[col]} ${name}${more}`;
  if (e.op === 'delete') return `удаление: ${NOUN[col]} ${name}${more}`;
  return `изменения в ${name}${more}`;
}

export function commitPending() {
  const e = pendingEntry;
  pendingEntry = null;
  if (!e?.items.size) return;
  if (!e.label) e.label = describe(e);
  undoStack.push(e);
  if (undoStack.length > HIST_LIMIT) undoStack.shift();
  syncHistory();
}

export function openEntry(op: Op, label = '') {
  pendingEntry = { items: new Map(), op, label, at: Date.now(), typing: op === 'edit' && isTyping() };
  redoStack.length = 0;
  queueMicrotask(commitPending);
}

/** Запомнить прежнюю версию объекта перед изменением. */
export function record(col: Col, id: Id, op: Op) {
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

export function applyEntry(e: HistEntry): HistEntry {
  const inv: HistEntry = { items: new Map(), op: e.op, label: e.label, at: 0 };
  set((s) => {
    const next = { rulesets: { ...s.rulesets }, formations: { ...s.formations }, forces: { ...s.forces }, scenarios: { ...s.scenarios } } as Record<
      Col,
      Record<Id, unknown>
    >;
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
export function dropActionToasts() {
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

export const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ корзина и резервные копии

// Настройки и открытые вкладки — в localStorage (переживают перезапуск).
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

export function tabExists(t: Tab): boolean {
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
    case 'team':
      return Object.values(s.forces).some((f) => (f.faction?.trim() || '') === (t.ref ?? ''));
    default:
      return true;
  }
}

/** Куда уйти, когда открытый объект удалён: в его раздел (или к старшему объекту). */
function parentOf(t: Tab): Tab {
  const lib = (ref: NavSection): Tab => ({ key: tabKey('library', ref), kind: 'library', ref });
  switch (t.kind) {
    case 'scenario':
      return lib('scenarios');
    case 'montecarlo':
      return tabExists({ key: '', kind: 'scenario', ref: t.ref }) ? { key: tabKey('scenario', t.ref), kind: 'scenario', ref: t.ref } : lib('scenarios');
    case 'formation': {
      const sc = t.ref?.match(/^sc:([^:]+):/)?.[1];
      if (sc && get().scenarios[sc]) return { key: tabKey('scenario', sc), kind: 'scenario', ref: sc };
      return lib(t.ref?.startsWith('force:') ? 'forces' : t.ref?.startsWith('sc:') ? 'scenarios' : 'units');
    }
    case 'team':
      return lib('forces');
    case 'battle':
      return lib('battles');
    case 'ruleset':
      return lib('rulesets');
    default:
      return { key: 'home', kind: 'home' };
  }
}

/** Состояние страницы (подраздел) запоминается, пока программа открыта: при возврате страница та же. */
const subs = new Map<string, string>();

/**
 * Открыть страницу. Вкладок нет: страница занимает окно, прежняя уходит в историю «назад».
 * Уже открытая страница остаётся (меняется только подраздел, если он задан).
 */
export function openTab(kind: TabKind, ref?: string, opts: { sub?: string } = {}) {
  const key = tabKey(kind, ref);
  set((s) => {
    const cur = s.tabs.find((t) => t.key === s.active);
    if (cur?.sub) subs.set(cur.key, cur.sub);
    if (cur?.key === key) return opts.sub && opts.sub !== cur.sub ? { tabs: [{ ...cur, sub: opts.sub }] } : {};
    const sub = opts.sub ?? subs.get(key);
    return { tabs: [{ key, kind, ref, ...(sub ? { sub } : {}) }], active: key };
  });
}

/** Закрыть страницу: если она открыта — перейти в её раздел. */
export function closeTab(key: string) {
  const cur = get().tabs.find((t) => t.key === key);
  subs.delete(key);
  if (!cur) return;
  const to = parentOf(cur);
  set({ tabs: [to], active: to.key });
}

export function closeTabsWhere(pred: (t: Tab) => boolean) {
  for (const t of get().tabs.filter(pred)) closeTab(t.key);
}

export function setTabSub(key: string, sub: string) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, sub } : t)) }));
}

// ------------------------------------------------------------------ наборы правил
