// Ядро состояния программы: данные и вкладки, уведомления и диалоги, сохранение с задержкой,
// отмена и повтор правок (Ctrl+Z / Ctrl+Y), вкладки.

import { create } from 'zustand';
import type { PauseRules, UnitNode, Id, Ruleset, Scenario } from '../../engine';
import { storage, type BattleMeta, type Collection } from '../storage';
import { resolveFormation } from './library';
import { useBattles } from './battles';

export type TabKind = 'home' | 'ruleset' | 'formation' | 'scenario' | 'battle' | 'montecarlo' | 'settings' | 'help' | 'library';

export interface Tab {
  key: string;
  kind: TabKind;
  ref?: string;
  sub?: string;
  /** Просмотр: следующий объект, открытый из навигатора или поиска, заменит эту вкладку (пока с ней не начали работать). */
  preview?: boolean;
  /** Закреплена: слева, не закрывается сама и не заменяется. */
  pinned?: boolean;
  /** Когда вкладкой пользовались в последний раз (для закрытия давно не используемых). */
  used?: number;
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
  /** Сколько вкладок держать открытыми (давно не используемые закрываются сами); 0 — без предела. */
  maxTabs?: number;
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

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', logLevel: 1, mcRuns: 200, sidebar: true, density: 'normal', navSection: 'scenarios' };

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
    default:
      return true;
  }
}

export const DEFAULT_MAX_TABS = 12;

/** Закреплённые — первыми, остальные в прежнем порядке. */
const orderTabs = (tabs: Tab[]) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];

let trimNoticeShown = false;

/** Вкладок больше предела — закрыть давно не используемые (не закреплённые и не keep). */
function trimTabs(tabs: Tab[], keep: string, max: number): Tab[] {
  if (max <= 0 || tabs.length <= max) return tabs;
  const out = [...tabs];
  const victims = out.filter((t) => !t.pinned && t.key !== keep).sort((a, b) => (a.preview === b.preview ? (a.used ?? 0) - (b.used ?? 0) : a.preview ? -1 : 1));
  let closed = 0;
  while (out.length > max && victims.length) {
    const v = victims.shift()!;
    out.splice(out.indexOf(v), 1);
    closed++;
  }
  if (closed && !trimNoticeShown) {
    trimNoticeShown = true;
    queueMicrotask(() =>
      toast(
        `Открыто больше ${max} вкладок — давно не используемые закрываются сами. Нужную можно закрепить (правый щелчок по вкладке); предел — в Настройках.`,
      ),
    );
  }
  return out;
}

/**
 * Открыть вкладку. preview — из навигатора и поиска: новый объект занимает место вкладки-просмотра
 * (а не добавляет ещё одну), пока с ней не начали работать. Уже открытая вкладка просто становится активной.
 */
export function openTab(kind: TabKind, ref?: string, opts: { background?: boolean; sub?: string; preview?: boolean } = {}) {
  const key = tabKey(kind, ref);
  set((s) => {
    const now = Date.now();
    const preview = !!opts.preview && !opts.background;
    const exists = s.tabs.find((t) => t.key === key);
    let tabs: Tab[];
    if (exists) {
      tabs = s.tabs.map((t) => (t.key === key ? { ...t, sub: opts.sub ?? t.sub, preview: t.preview && preview ? true : undefined, used: now } : t));
    } else {
      const tab: Tab = { key, kind, ref, sub: opts.sub, used: now, ...(preview ? { preview: true } : {}) };
      tabs = [...s.tabs];
      const pi = preview ? tabs.findIndex((t) => t.preview) : -1;
      if (pi >= 0) tabs[pi] = tab;
      else tabs.splice(tabs.findIndex((t) => t.key === s.active) + 1, 0, tab);
      tabs = trimTabs(orderTabs(tabs), opts.background ? s.active : key, s.settings.maxTabs ?? DEFAULT_MAX_TABS);
    }
    return { tabs, active: opts.background ? s.active : key };
  });
}

/** Вкладка-просмотр становится обычной (с ней начали работать). */
export function keepTab(key: string) {
  if (!get().tabs.some((t) => t.key === key && t.preview)) return;
  set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, preview: undefined } : t)) }));
}

export function pinTab(key: string, pinned: boolean) {
  set((s) => ({ tabs: orderTabs(s.tabs.map((t) => (t.key === key ? { ...t, pinned: pinned || undefined, preview: undefined } : t))) }));
}

/** Закрыть другие вкладки (кроме закреплённых); right — только справа от этой. */
export function closeOtherTabs(key: string, right = false) {
  const tabs = get().tabs;
  const i = tabs.findIndex((t) => t.key === key);
  closeTabsWhere((t) => !t.pinned && t.key !== key && (!right || tabs.indexOf(t) > i));
  activateTab(key);
}

/** Закрыть все вкладки, кроме закреплённых. */
export function closeAllTabs() {
  closeTabsWhere((t) => !t.pinned);
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
  set((s) => ({ active: key, tabs: s.tabs.map((t) => (t.key === key ? { ...t, used: Date.now() } : t)) }));
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
