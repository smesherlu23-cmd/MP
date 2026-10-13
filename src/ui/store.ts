// Состояние программы: библиотека (наборы правил, подразделения, сценарии, бои), вкладки-«окна»,
// настройки, уведомления и диалоги. Изменения автоматически сохраняются в хранилище.

import { produce } from 'immer';
import { create } from 'zustand';
import {
  clone,
  copyFormation,
  makeBlankRuleset,
  makeDemoBattalion,
  makeDemoDefenders,
  makeDemoScenario,
  makeLinearRuleset,
  makeUniversalRuleset,
  newFormation,
  newId,
  newScenario,
  normalizeRuleset,
  type Battle,
  type FormationDef,
  type Id,
  type Ruleset,
  type Scenario,
} from '../engine';
import { battleMeta, storage, type BattleMeta, type Collection } from './storage';

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
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

export interface Dialog {
  title: string;
  text?: string;
  input?: { value: string; placeholder?: string };
  options?: { value: string; label: string }[];
  okText?: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}

interface AppState {
  loaded: boolean;
  rulesets: Record<Id, Ruleset>;
  formations: Record<Id, FormationDef>;
  scenarios: Record<Id, Scenario>;
  battleIndex: Record<Id, BattleMeta>;
  tabs: Tab[];
  active: string;
  settings: Settings;
  toasts: Toast[];
  dialog: Dialog | null;
  saving: number;
}

const DEFAULT_SETTINGS: Settings = { theme: 'dark', logLevel: 1, mcRuns: 200, sidebar: true, density: 'normal' };

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
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'bad' ? 6000 : 3500);
}

function openDialog(d: Omit<Dialog, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => set({ dialog: { ...d, resolve: (v) => (set({ dialog: null }), resolve(v)) } }));
}

export async function confirmDialog(title: string, text?: string, okText = 'Да', danger = false): Promise<boolean> {
  return (await openDialog({ title, text, okText, danger })) === true;
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

/** Немедленно выполнить отложенные сохранения (перед закрытием окна). */
export async function flushSaves() {
  await Promise.all([...pendingSaves.values()].map((fn) => fn()));
}

// ------------------------------------------------------------------ загрузка

export async function initApp() {
  const [rs, fs, sc, bt] = await Promise.all([
    storage.list('rulesets'),
    storage.list('formations'),
    storage.list('scenarios'),
    storage.list('battles'),
  ]);
  const rulesets: Record<Id, Ruleset> = {};
  for (const r of rs as Ruleset[]) if (r?.id) rulesets[r.id] = normalizeRuleset(r);
  const formations: Record<Id, FormationDef> = {};
  for (const f of fs as FormationDef[]) if (f?.id) formations[f.id] = f;
  const scenarios: Record<Id, Scenario> = {};
  for (const x of sc as Scenario[]) if (x?.id) scenarios[x.id] = x;
  const battleIndex: Record<Id, BattleMeta> = {};
  for (const b of bt as BattleMeta[]) if (b?.id) battleIndex[b.id] = b;

  const firstRun = !Object.keys(rulesets).length && !localStorage.getItem('warsim-initialized');
  set({ rulesets, formations, scenarios, battleIndex });
  if (firstRun) {
    await installExamples();
    localStorage.setItem('warsim-initialized', '1');
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
}

export async function installExamples() {
  const universal = makeUniversalRuleset();
  const linear = makeLinearRuleset();
  const bn = { ...makeDemoBattalion(), rulesetId: universal.id };
  const def = { ...makeDemoDefenders(), rulesetId: universal.id };
  const sc = makeDemoScenario();
  // Связываем копии в сценарии с библиотекой, чтобы можно было вернуть результаты боя.
  sc.sides[0].formations = [copyFormation(bn)];
  sc.sides[1].formations = [copyFormation(def)];
  set((s) => ({
    rulesets: { ...s.rulesets, [universal.id]: universal, [linear.id]: linear },
    formations: { ...s.formations, [bn.id]: bn, [def.id]: def },
    scenarios: { ...s.scenarios, [sc.id]: sc },
  }));
  for (const r of [universal, linear]) await storage.save('rulesets', r.id, r);
  for (const f of [bn, def]) await storage.save('formations', f.id, f);
  await storage.save('scenarios', sc.id, sc);
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
  set((s) => ({ rulesets: { ...s.rulesets, [n.id]: n } }));
  scheduleSave('rulesets', n.id, () => get().rulesets[n.id], 0);
}

export function createRuleset(from?: Id): Id {
  const src = from ? get().rulesets[from] : undefined;
  const r = src ? { ...clone(src), id: newId('rs'), name: `${src.name} (копия)` } : makeBlankRuleset();
  replaceRuleset(r);
  openTab('ruleset', r.id);
  return r.id;
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
  set((st) => {
    const { [id]: _, ...rest } = st.rulesets;
    return { rulesets: rest };
  });
  await storage.remove('rulesets', id);
  closeTabsWhere((t) => t.kind === 'ruleset' && t.ref === id);
}

// ------------------------------------------------------------------ подразделения

/** ref: «lib:<id>» — библиотека; «sc:<scenarioId>:<formationId>» — копия в сценарии. */
export function resolveFormation(ref: string): { f: FormationDef; rulesetId?: Id; scenario?: Scenario; sideIndex?: number } | null {
  const s = get();
  const [scope, a, b] = ref.split(':');
  if (scope === 'lib') {
    const f = s.formations[a];
    return f ? { f, rulesetId: f.rulesetId } : null;
  }
  const sc = s.scenarios[a];
  if (!sc) return null;
  for (let i = 0; i < 2; i++) {
    const f = sc.sides[i].formations.find((x) => x.id === b);
    if (f) return { f, rulesetId: sc.rulesetId, scenario: sc, sideIndex: i };
  }
  return null;
}

export function updateFormationRef(ref: string, fn: (f: FormationDef) => void) {
  const [scope, a, b] = ref.split(':');
  if (scope === 'lib') return updateFormation(a, fn);
  updateScenario(a, (sc) => {
    for (const side of sc.sides) {
      const f = side.formations.find((x) => x.id === b);
      if (f) fn(f);
    }
  });
}

export function updateFormation(id: Id, fn: (f: FormationDef) => void) {
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

export function addFormation(f: FormationDef, open = true): Id {
  set((s) => ({ formations: { ...s.formations, [f.id]: f } }));
  scheduleSave('formations', f.id, () => get().formations[f.id], 0);
  if (open) openTab('formation', `lib:${f.id}`);
  return f.id;
}

export function createFormation(rulesetId?: Id): Id {
  const rs = rulesetId ?? Object.keys(get().rulesets)[0];
  return addFormation(newFormation('Новое подразделение', { rulesetId: rs }));
}

export function duplicateFormation(id: Id): Id | undefined {
  const f = get().formations[id];
  if (!f) return;
  const c = copyFormation(f);
  delete c.sourceId;
  const strip = (x: FormationDef) => {
    delete x.sourceId;
    x.elements.forEach((e) => delete e.sourceId);
    x.subunits.forEach(strip);
  };
  strip(c);
  c.name = `${f.name} (копия)`;
  return addFormation(c);
}

export async function deleteFormation(id: Id) {
  const f = get().formations[id];
  if (!f) return;
  if (!(await confirmDialog(`Удалить подразделение «${f.name}» из библиотеки?`, 'Копии в сценариях останутся.', 'Удалить', true))) return;
  set((s) => {
    const { [id]: _, ...rest } = s.formations;
    return { formations: rest };
  });
  await storage.remove('formations', id);
  closeTabsWhere((t) => t.kind === 'formation' && t.ref === `lib:${id}`);
}

// ------------------------------------------------------------------ сценарии

export function updateScenario(id: Id, fn: (s: Scenario) => void) {
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
  set((s) => ({ scenarios: { ...s.scenarios, [sc.id]: sc } }));
  scheduleSave('scenarios', sc.id, () => get().scenarios[sc.id], 0);
  if (open) openTab('scenario', sc.id);
  return sc.id;
}

export function createScenario(rulesetId?: Id): Id {
  const s = get();
  const rs = s.rulesets[rulesetId ?? ''] ?? Object.values(s.rulesets)[0];
  const seed = `${new Date().toISOString().slice(0, 10)}-${Math.floor(Math.random() * 9000 + 1000)}`;
  return addScenario(newScenario(rs, 'Новый сценарий', seed));
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
  set((s) => {
    const { [id]: _, ...rest } = s.scenarios;
    return { scenarios: rest };
  });
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
  if (persist) scheduleSave('battles', b.id, () => useBattles.getState().battles[b.id], 1200);
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

export async function deleteBattle(id: Id, ask = true) {
  const meta = get().battleIndex[id];
  if (ask && !(await confirmDialog(`Удалить бой «${meta?.name ?? id}»?`, undefined, 'Удалить', true))) return;
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
    const sc = data as Scenario;
    if (s.scenarios[sc.id]) {
      sc.id = newId('sc');
      sc.name = `${sc.name} (импорт)`;
    }
    addScenario(sc);
    if (!s.rulesets[sc.rulesetId]) toast('Набор правил сценария не найден — выберите другой в сценарии.', 'bad');
    else toast(`Импортирован сценарий «${sc.name}».`, 'good');
  } else if (data?.elements && data?.subunits) {
    const f = data as FormationDef;
    if (s.formations[f.id]) {
      f.id = newId('fm');
      f.name = `${f.name} (импорт)`;
    }
    addFormation(f);
    toast(`Импортировано подразделение «${f.name}».`, 'good');
  } else {
    toast('Не удалось распознать содержимое файла.', 'bad');
  }
}
