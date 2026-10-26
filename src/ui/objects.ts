// Объекты программы — сценарии, силы, шаблоны, наборы правил, бои — с одним набором действий: открыть,
// быстрый просмотр, избранное, переименовать, дублировать, сохранить в файл, удалить. Эти действия — в меню
// по правому щелчку везде, где объект показан (боковая панель, каталоги, главная, заголовок страницы).

import { create } from 'zustand';
import type { IconName } from './components/Icon';
import type { MenuItem } from './components/ui';
import { exportScenario, startBattle } from './pages/ScenarioPage';
import {
  branchBattleDialog,
  canRestore,
  createForcesFromTemplate,
  createRuleset,
  deleteBattle,
  deleteForce,
  deleteFormation,
  deleteRuleset,
  deleteScenario,
  duplicateForce,
  duplicateFormation,
  duplicateScenario,
  exportJson,
  get,
  loadBattle,
  openTab,
  promptDialog,
  renameBattle,
  restoreForces,
  updateFormation,
  updateForce,
  updateRuleset,
  updateScenario,
  updateSettings,
  useApp,
  useBattles,
} from './store';

/** Перетаскивание объекта (ключ страницы) — например, в избранное боковой панели. */
export const DND_OBJ = 'application/x-warsim-obj';

/** Идёт перетаскивание объекта: боковая панель показывает, куда его можно положить. */
export const useObjDrag = create<{ on: boolean }>(() => ({ on: false }));

export type ObjKind = 'scenario' | 'force' | 'template' | 'ruleset' | 'battle';

export interface Obj {
  kind: ObjKind;
  id: string;
}

export const OBJ_ICON: Record<ObjKind, IconName> = { scenario: 'scenario', force: 'forces', template: 'template', ruleset: 'ruleset', battle: 'battle' };

export const OBJ_NOUN: Record<ObjKind, string> = { scenario: 'Сценарий', force: 'Силы', template: 'Шаблон', ruleset: 'Набор правил', battle: 'Бой' };

/** Ключ страницы объекта — он же ключ в избранном и недавних. */
export const objKey = (o: Obj) => (o.kind === 'force' ? `formation:force:${o.id}` : o.kind === 'template' ? `formation:lib:${o.id}` : `${o.kind}:${o.id}`);

export function objFromKey(key: string | undefined): Obj | null {
  const m = key?.match(/^(scenario|ruleset|battle):(.+)$/);
  if (m) return { kind: m[1] as ObjKind, id: m[2] };
  const f = key?.match(/^formation:(force|lib):([^:]+)$/);
  return f ? { kind: f[1] === 'lib' ? 'template' : 'force', id: f[2] } : null;
}

export function objName(o: Obj): string | undefined {
  const s = get();
  switch (o.kind) {
    case 'scenario':
      return s.scenarios[o.id]?.name;
    case 'force':
      return s.forces[o.id]?.name;
    case 'template':
      return s.formations[o.id]?.name;
    case 'ruleset':
      return s.rulesets[o.id]?.name;
    case 'battle':
      return useBattles.getState().battles[o.id]?.name ?? s.battleIndex[o.id]?.name;
  }
}

export const objExists = (o: Obj) => objName(o) !== undefined;

export function openObj(o: Obj) {
  if (o.kind === 'force') openTab('formation', `force:${o.id}`);
  else if (o.kind === 'template') openTab('formation', `lib:${o.id}`);
  else openTab(o.kind, o.id);
}

export function renameObj(o: Obj, raw: string) {
  const name = raw.trim();
  if (!name || name === objName(o)) return;
  if (o.kind === 'scenario') updateScenario(o.id, (d) => void (d.name = name));
  else if (o.kind === 'force') updateForce(o.id, (d) => void (d.name = name));
  else if (o.kind === 'template') updateFormation(o.id, (d) => void (d.name = name));
  else if (o.kind === 'ruleset') updateRuleset(o.id, (d) => void (d.name = name));
  else void loadBattle(o.id).then((b) => b && renameBattle(o.id, name));
}

export function deleteObj(o: Obj) {
  if (o.kind === 'scenario') void deleteScenario(o.id);
  else if (o.kind === 'force') void deleteForce(o.id);
  else if (o.kind === 'template') void deleteFormation(o.id);
  else if (o.kind === 'ruleset') void deleteRuleset(o.id);
  else void deleteBattle(o.id);
}

async function duplicateObj(o: Obj) {
  if (o.kind === 'scenario') duplicateScenario(o.id);
  else if (o.kind === 'force') duplicateForce(o.id);
  else if (o.kind === 'template') duplicateFormation(o.id);
  else if (o.kind === 'ruleset') createRuleset(o.id);
  else if (await loadBattle(o.id)) void branchBattleDialog(o.id);
}

async function exportObj(o: Obj) {
  const s = get();
  if (o.kind === 'scenario') return s.scenarios[o.id] && exportScenario(s.scenarios[o.id]);
  if (o.kind === 'force') {
    const f = s.forces[o.id];
    return f && exportJson('force', f.name, { ...f, faction: f.faction ?? '' });
  }
  if (o.kind === 'template') return s.formations[o.id] && exportJson('template', s.formations[o.id].name, s.formations[o.id]);
  if (o.kind === 'ruleset') return s.rulesets[o.id] && exportJson('ruleset', s.rulesets[o.id].name, s.rulesets[o.id]);
  const b = await loadBattle(o.id);
  if (b) await exportJson('battle', b.name, b);
}

// ------------------------------------------------------------------ избранное и недавние

export const favorites = () => get().settings.favorites ?? [];

export const isFavorite = (key: string) => favorites().includes(key);

export function toggleFavorite(key: string) {
  const list = favorites();
  updateSettings({ favorites: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] });
}

/** Переставить объект избранного перед другим (null — в конец); не из избранного — добавить. */
export function placeFavorite(key: string, before: string | null) {
  const list = favorites().filter((k) => k !== key);
  const i = before ? list.indexOf(before) : -1;
  list.splice(i < 0 ? list.length : i, 0, key);
  updateSettings({ favorites: list });
}

const RECENT_MAX = 12;

/** Запомнить открытый объект в недавних. */
function noteRecent(key: string) {
  if (!objFromKey(key)) return;
  const list = get().settings.recent ?? [];
  if (list[0] === key) return;
  updateSettings({ recent: [key, ...list.filter((k) => k !== key)].slice(0, RECENT_MAX) });
}

useApp.subscribe((s, prev) => {
  if (s.loaded && s.active !== prev.active) noteRecent(s.active);
});

// ------------------------------------------------------------------ переименование на месте

/**
 * Что сейчас переименовывается на месте: строка боковой панели (row — её ключ: объект бывает и в избранном,
 * и в своём разделе) или заголовок окна.
 */
export const useRenaming = create<{ key: string | null; where: 'side' | 'title' | null; row?: string }>(() => ({ key: null, where: null }));

export const stopRename = () => useRenaming.setState({ key: null, where: null, row: undefined });

/** Переименовать: на месте — в заголовке окна (страница объекта открыта) или в боковой панели, иначе — в окне ввода. */
export function startRename(o: Obj, at?: { where: 'side' | 'title'; row?: string }) {
  const key = objKey(o);
  if (at) return useRenaming.setState({ key, where: at.where, row: at.row });
  if (get().active === key) {
    // Открыта страница объекта: название правится в её заголовке (или в заголовке окна, если он виден).
    const head = document.querySelector<HTMLInputElement>('.page-head .title-input, .battle-head .title-input');
    if (head) {
      head.focus();
      head.select();
      return;
    }
    if (document.querySelector('.tb-name')?.checkVisibility()) return useRenaming.setState({ key, where: 'title', row: undefined });
  }
  const el = document.querySelector<HTMLElement>(`.sidebar [data-obj="${CSS.escape(key)}"]`);
  if (el) return useRenaming.setState({ key, where: 'side', row: el.dataset.row });
  void promptDialog(`Новое название: ${OBJ_NOUN[o.kind].toLowerCase()}`, objName(o) ?? '').then((v) => v !== null && renameObj(o, v));
}

// ------------------------------------------------------------------ быстрый просмотр

export const useQuickLook = create<{ obj: Obj | null }>(() => ({ obj: null }));

export const quickLook = (o: Obj | null) => useQuickLook.setState({ obj: o });

/** Пробел — показать или скрыть быстрый просмотр объекта. */
export const toggleQuickLook = (o: Obj) => {
  const cur = useQuickLook.getState().obj;
  quickLook(cur && cur.kind === o.kind && cur.id === o.id ? null : o);
};

// ------------------------------------------------------------------ меню объекта

/**
 * Действия с объектом — для меню по правому щелчку и кнопки «⋯». open: false — без пункта «Открыть»
 * (меню на странице самого объекта).
 */
export function objMenu(o: Obj, opts: { open?: boolean; row?: string } = {}): (MenuItem | 'sep' | false)[] {
  if (!objExists(o)) return [];
  const s = get();
  const key = objKey(o);
  const fav = isFavorite(key);
  const sc = o.kind === 'scenario' ? s.scenarios[o.id] : undefined;
  const scRs = sc ? s.rulesets[sc.rulesetId] : undefined;
  const force = o.kind === 'force' ? s.forces[o.id] : undefined;
  return [
    opts.open !== false && { label: 'Открыть', kbd: 'Enter', onClick: () => openObj(o) },
    { label: 'Быстрый просмотр', kbd: 'Пробел', onClick: () => quickLook(o) },
    'sep',
    !!sc && { label: 'Начать бой', disabled: !scRs, onClick: () => scRs && void startBattle(sc, scRs) },
    !!sc && { label: 'Прогоны', disabled: !scRs, onClick: () => openTab('montecarlo', sc.id), tip: 'Массовые прогоны: вероятности исходов' },
    o.kind === 'template' && {
      label: 'Создать силы по шаблону',
      onClick: () => createForcesFromTemplate(o.id, { open: true }),
      tip: 'Конкретное подразделение с этим устройством и штатом',
    },
    !!force && {
      label: 'Восстановить полностью',
      disabled: !canRestore(force),
      onClick: () => restoreForces([o.id]),
      tip: 'Раненые и техника возвращаются, недостающее — до штата из резерва, состояние — к норме',
    },
    'sep',
    { label: fav ? 'Убрать из избранного' : 'В избранное', onClick: () => toggleFavorite(key) },
    { label: 'Переименовать', kbd: 'F2', onClick: () => startRename(o, opts.row ? { where: 'side', row: opts.row } : undefined) },
    {
      label: o.kind === 'battle' ? 'Ответвить бой…' : 'Дублировать',
      onClick: () => void duplicateObj(o),
      tip: o.kind === 'battle' ? 'Новый бой — копия этого до выбранного хода; исходный не меняется' : undefined,
    },
    { label: 'Сохранить в файл…', onClick: () => void exportObj(o) },
    'sep',
    { label: `Удалить ${o.kind === 'force' ? 'силы' : OBJ_NOUN[o.kind].toLowerCase()}`, kbd: 'Delete', danger: true, onClick: () => deleteObj(o) },
  ];
}

/** Клавиши на строке объекта в списке: Enter — открыть, пробел — быстрый просмотр, F2 — переименовать, Delete — удалить. */
export function objKeys(o: Obj, e: React.KeyboardEvent, row?: string): boolean {
  if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.key === 'Enter') openObj(o);
  else if (e.key === ' ') toggleQuickLook(o);
  else if (e.key === 'F2') startRename(o, row ? { where: 'side', row } : undefined);
  else if (e.key === 'Delete') deleteObj(o);
  else return false;
  e.preventDefault();
  return true;
}
