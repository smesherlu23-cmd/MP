// Навигация: разделы программы, «где я» для каждой вкладки, история переходов (назад / вперёд).

import { create } from 'zustand';
import { openTab, resolveFormation, updateSettings, useApp, type NavSection, type Tab, type TabKind } from './store';

export const SECTIONS: { id: NavSection; label: string; icon: string; create: string }[] = [
  { id: 'scenarios', label: 'Сценарии', icon: '◈', create: 'Новый сценарий' },
  { id: 'units', label: 'Подразделения', icon: '▦', create: 'Новое подразделение' },
  { id: 'battles', label: 'Бои', icon: '⚔', create: '' },
  { id: 'rulesets', label: 'Наборы правил', icon: '§', create: 'Новый набор правил' },
];

/** Раздел, к которому относится вкладка (подразделение сценария — к сценариям). */
export function sectionOf(t: Pick<Tab, 'kind' | 'ref'> | undefined): NavSection | null {
  switch (t?.kind) {
    case 'scenario':
    case 'montecarlo':
      return 'scenarios';
    case 'formation':
      return t.ref?.startsWith('sc:') ? 'scenarios' : 'units';
    case 'battle':
      return 'battles';
    case 'ruleset':
      return 'rulesets';
    default:
      return null;
  }
}

/** Показать раздел в навигаторе (и сам навигатор, если он скрыт). */
export function showSection(id: NavSection) {
  updateSettings({ navSection: id, sidebar: true });
}

// ------------------------------------------------------------------ назад / вперёд

export const useNav = create<{ back: boolean; fwd: boolean }>(() => ({ back: false, fwd: false }));
const back: string[] = [];
const fwd: string[] = [];
let jumping = false;

const sync = () => useNav.setState({ back: back.length > 0, fwd: fwd.length > 0 });

useApp.subscribe((s, prev) => {
  if (s.active === prev.active || !prev.loaded) return;
  // Навигатор следует за открытой вкладкой: видно, в каком разделе находишься.
  const sec = sectionOf(s.tabs.find((t) => t.key === s.active));
  if (sec && sec !== s.settings.navSection) updateSettings({ navSection: sec });
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
    (kind === 'scenario' || kind === 'montecarlo' ? !!s.scenarios[ref!] : kind === 'ruleset' ? !!s.rulesets[ref!] : kind === 'formation' ? !!resolveFormation(ref!) : kind === 'battle' ? !!s.battleIndex[ref!] : true);
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
