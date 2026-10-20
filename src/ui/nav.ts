// Навигация: разделы программы, «где я» для каждой вкладки, история переходов (назад / вперёд).

import { create } from 'zustand';
import type { IconName } from './components/Icon';
import { openTab, resolveFormation, updateSettings, useApp, type NavSection, type Tab, type TabKind } from './store';

export interface SectionMeta {
  id: NavSection;
  label: string;
  icon: IconName;
  /** Подпись кнопки создания (пусто — бои создаются из сценария). */
  create: string;
  /** Что это за раздел — одной строкой, для каталога и главной. */
  about: string;
}

/** Разделы в порядке работы: сначала подготовка (правила → шаблоны → силы), потом игра (сценарии → бои). */
export const SECTIONS: SectionMeta[] = [
  { id: 'rulesets', label: 'Наборы правил', icon: 'ruleset', create: 'Новый набор правил', about: 'Типы вооружения, приказы, условия и коэффициенты расчёта' },
  { id: 'units', label: 'Шаблоны', icon: 'template', create: 'Новый шаблон', about: 'Устройство и штат подразделений — от отделения до дивизии' },
  { id: 'forces', label: 'Силы', icon: 'forces', create: 'Новые силы', about: 'Конкретные подразделения по шаблонам: потери боёв записываются в них' },
  { id: 'scenarios', label: 'Сценарии', icon: 'scenario', create: 'Новый сценарий', about: 'Обстановка и две стороны с их силами, задачами и планом боя' },
  { id: 'battles', label: 'Бои', icon: 'battle', create: '', about: 'Сыгранные и идущие бои: ход за ходом, с журналом и итогами' },
];

/** Группы навигатора: подготовка и игра. */
export const NAV_GROUPS: { label: string; ids: NavSection[] }[] = [
  { label: 'Игра', ids: ['scenarios', 'battles'] },
  { label: 'Подготовка', ids: ['forces', 'units', 'rulesets'] },
];

export const sectionMeta = (id: NavSection) => SECTIONS.find((x) => x.id === id)!;

/** Развёрнутые по умолчанию разделы навигатора. */
export const NAV_OPEN_DEFAULT: Record<NavSection, boolean> = { scenarios: true, battles: true, forces: true, units: false, rulesets: false };

export const isNavOpen = (open: Partial<Record<NavSection, boolean>> | undefined, id: NavSection) => open?.[id] ?? NAV_OPEN_DEFAULT[id];

export function setNavOpen(id: NavSection, on: boolean) {
  const s = useApp.getState().settings;
  if (isNavOpen(s.navOpen, id) === on) return;
  updateSettings({ navOpen: { ...s.navOpen, [id]: on } });
}

/** Раздел, к которому относится вкладка: «lib:» — шаблоны, «force:» — силы. */
export function sectionOf(t: Pick<Tab, 'kind' | 'ref'> | undefined): NavSection | null {
  switch (t?.kind) {
    case 'scenario':
    case 'montecarlo':
      return 'scenarios';
    case 'formation':
      return t.ref?.startsWith('force:') ? 'forces' : 'units';
    case 'battle':
      return 'battles';
    case 'ruleset':
      return 'rulesets';
    case 'library':
      return (t.ref as NavSection) ?? null;
    default:
      return null;
  }
}

/** Открыть каталог раздела. */
export function showSection(id: NavSection) {
  openTab('library', id);
}

// ------------------------------------------------------------------ назад / вперёд

export const useNav = create<{ back: boolean; fwd: boolean }>(() => ({ back: false, fwd: false }));
const back: string[] = [];
const fwd: string[] = [];
let jumping = false;

const sync = () => useNav.setState({ back: back.length > 0, fwd: fwd.length > 0 });

useApp.subscribe((s, prev) => {
  if (s.active === prev.active || !prev.loaded) return;
  // Навигатор следует за переходами: раздел открытого объекта разворачивается. Когда вкладка просто
  // закрылась (в том числе при удалении объекта), навигатор не меняется.
  const closed = !s.tabs.some((t) => t.key === prev.active);
  const tab = s.tabs.find((t) => t.key === s.active);
  const sec = tab?.kind === 'library' ? null : sectionOf(tab);
  if (!closed && sec) setNavOpen(sec, true);
  if (jumping || !prev.active) return;
  back.push(prev.active);
  if (back.length > 100) back.shift();
  fwd.length = 0;
  sync();
});

/** Ключ вкладки → вкладка (закрытую открываем заново, если объект ещё существует). */
function jumpTo(key: string): boolean {
  const s = useApp.getState();
  const i = key.indexOf(':');
  const kind = (i < 0 ? key : key.slice(0, i)) as TabKind;
  const ref = i < 0 ? undefined : key.slice(i + 1);
  const exists =
    s.tabs.some((t) => t.key === key) ||
    (kind === 'scenario' || kind === 'montecarlo'
      ? !!s.scenarios[ref!]
      : kind === 'ruleset'
        ? !!s.rulesets[ref!]
        : kind === 'formation'
          ? !!resolveFormation(ref!)
          : kind === 'battle'
            ? !!s.battleIndex[ref!]
            : true);
  if (!exists) return false;
  jumping = true;
  openTab(kind, ref);
  jumping = false;
  return true;
}

export function goBack() {
  const cur = useApp.getState().active;
  while (back.length) {
    const k = back.pop()!;
    if (k !== cur && jumpTo(k)) {
      fwd.push(cur);
      break;
    }
  }
  sync();
}

export function goForward() {
  const cur = useApp.getState().active;
  while (fwd.length) {
    const k = fwd.pop()!;
    if (k !== cur && jumpTo(k)) {
      back.push(cur);
      break;
    }
  }
  sync();
}
