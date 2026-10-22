// Быстрый переход (Ctrl+K): любое подразделение — в том числе вложенное, сценарий, раздел
// набора правил, тип, бой — и основные команды. Поиск по словам в любом порядке.

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { walkUnits, type UnitNode } from '../../engine';
import { openUnit, setTabState } from '../hooks';
import { SECTIONS as NAV_SECTIONS } from '../nav';
import { HELP_GROUPS } from '../pages/HelpPage';
import { SECTIONS } from '../pages/RulesetPage';
import { startBattle } from '../pages/ScenarioPage';
import { createFormation, createScenario, importFile, newForceDialog, newRulesetDialog, openTab, redo, tabKey, undo, updateSettings, useApp } from '../store';

export const usePalette = create<{ open: boolean; query: string }>(() => ({ open: false, query: '' }));
/** Открыть быстрый переход; query — с чего начать поиск (из поля навигатора). */
export const openPalette = (query = '') => usePalette.setState({ open: true, query: typeof query === 'string' ? query : '' });
const closePalette = () => usePalette.setState({ open: false });

interface Item {
  id: string;
  group: string;
  title: string;
  sub?: string;
  /** Показывать без запроса. */
  top?: boolean;
  run: (background: boolean) => void;
}

const GROUP_ORDER = ['Сценарии', 'Подразделения', 'Команды сил', 'Бои', 'Наборы правил', 'Справка', 'Команды'];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function buildItems(): Item[] {
  const s = useApp.getState();
  const items: Item[] = [];
  const cmd = (title: string, run: () => void, sub?: string) => items.push({ id: `cmd:${title}`, group: 'Команды', title, sub, top: true, run: () => run() });
  cmd('Новый сценарий', () => createScenario());
  cmd('Новый шаблон', () => createFormation());
  cmd('Новые силы', () => void newForceDialog());
  cmd('Новый набор правил', () => void newRulesetDialog());
  cmd('Импорт из файла…', () => importFile());
  cmd('Отменить', undo, 'Ctrl+Z');
  cmd('Повторить', redo, 'Ctrl+Y');
  cmd(s.settings.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', () => updateSettings({ theme: s.settings.theme === 'dark' ? 'light' : 'dark' }));
  cmd(s.settings.sidebar ? 'Скрыть навигатор' : 'Показать навигатор', () => updateSettings({ sidebar: !s.settings.sidebar }), 'Ctrl+B');
  cmd('Главное', () => openTab('home'));
  for (const sec of NAV_SECTIONS) cmd(`Каталог: ${sec.label}`, () => openTab('library', sec.id));
  cmd('Справка', () => openTab('help'));
  cmd('Настройки', () => openTab('settings'));

  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru');
  for (const team of [...new Set(Object.values(s.forces).map((f) => f.faction?.trim() || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru')))
    items.push({ id: `team:${team}`, group: 'Команды сил', title: `Команда «${team}»`, run: (bg) => openTab('team', team, { background: bg }) });
  for (const sc of Object.values(s.scenarios).sort(byName)) {
    items.push({ id: `sc:${sc.id}`, group: 'Сценарии', title: sc.name, top: true, run: (bg) => openTab('scenario', sc.id, { background: bg }) });
    const rs = s.rulesets[sc.rulesetId];
    if (rs) items.push({ id: `bt:${sc.id}`, group: 'Сценарии', title: `Начать бой: ${sc.name}`, run: () => void startBattle(sc, rs) });
    items.push({ id: `mc:${sc.id}`, group: 'Сценарии', title: `Прогоны: ${sc.name}`, run: (bg) => openTab('montecarlo', sc.id, { background: bg }) });
  }

  const units = (root: UnitNode, ref: string, where: string, top: boolean, group: string) =>
    walkUnits(root, (n) => {
      const isRoot = n.id === root.id;
      items.push({
        id: `u:${ref}:${n.id}`,
        group,
        title: n.name,
        sub: isRoot ? where : `в «${root.name}»${where ? ` · ${where}` : ''}`,
        top: top && isRoot,
        run: (bg) => openUnit(ref, n.id, bg),
      });
    });
  for (const f of Object.values(s.forces).sort(byName)) units(f, `force:${f.id}`, f.faction ? `силы · ${f.faction}` : 'силы', true, 'Силы');
  for (const f of Object.values(s.formations).sort(byName)) units(f, `lib:${f.id}`, 'шаблон', true, 'Шаблоны');

  for (const r of Object.values(s.rulesets).sort(byName)) {
    items.push({ id: `rs:${r.id}`, group: 'Наборы правил', title: r.name, top: true, run: (bg) => openTab('ruleset', r.id, { background: bg }) });
    for (const sec of SECTIONS)
      items.push({
        id: `rs:${r.id}:${sec.id}`,
        group: 'Наборы правил',
        title: sec.label,
        sub: r.name,
        run: (bg) => openTab('ruleset', r.id, { background: bg, sub: sec.id }),
      });
    for (const t of r.componentTypes)
      items.push({
        id: `rt:${r.id}:${t.id}`,
        group: 'Наборы правил',
        title: t.name,
        sub: `тип · ${r.name}`,
        run: (bg) => {
          setTabState(`${tabKey('ruleset', r.id)}:type`, t.id);
          openTab('ruleset', r.id, { background: bg, sub: 'types' });
        },
      });
  }

  for (const g of HELP_GROUPS)
    for (const t of g.topics)
      items.push({
        id: `help:${t.id}`,
        group: 'Справка',
        title: t.title,
        sub: g.title,
        run: (bg) => openTab('help', undefined, { background: bg, sub: t.id }),
      });

  const battles = Object.values(s.battleIndex).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  battles.forEach((b, i) =>
    items.push({
      id: `b:${b.id}`,
      group: 'Бои',
      title: b.name,
      sub: b.finished ? 'итог' : `ход ${b.turn}`,
      top: i < 3,
      run: (bg) => openTab('battle', b.id, { background: bg }),
    }),
  );
  return items;
}

function search(items: Item[], q: string): Item[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((x) => x.top);
  const scored: { it: Item; score: number }[] = [];
  for (const it of items) {
    const title = norm(it.title);
    const hay = `${title} ${norm(it.sub ?? '')}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const q0 = words.join(' ');
    const score = title === q0 ? 0 : title.startsWith(q0) ? 1 : words.every((w) => title.includes(w)) ? 2 : 3;
    scored.push({ it, score });
  }
  // Группы идут по лучшему совпадению в них, внутри группы — по релевантности.
  const best = new Map<string, number>();
  for (const x of scored) best.set(x.it.group, Math.min(best.get(x.it.group) ?? 9, x.score));
  const g = (x: { it: Item }) => best.get(x.it.group)! * 10 + GROUP_ORDER.indexOf(x.it.group);
  scored.sort((a, b) => g(a) - g(b) || a.score - b.score);
  return scored.slice(0, 80).map((x) => x.it);
}

export function Palette() {
  const open = usePalette((s) => s.open);
  if (!open) return null;
  return <PaletteBody />;
}

function PaletteBody() {
  const [q, setQ] = useState(() => usePalette.getState().query);
  const [cur, setCur] = useState(0);
  const items = useMemo(buildItems, []);
  const list = useMemo(() => search(items, q), [items, q]);
  const ordered = useMemo(() => (q.trim() ? list : [...list].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))), [list, q]);
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: при новом запросе выделение — на первый пункт
  useEffect(() => setCur(0), [q]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка к выделенному пункту при его смене
  useEffect(() => {
    box.current?.querySelector('.pal-item.cur')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  const run = (it: Item | undefined, bg = false) => {
    if (!it) return;
    closePalette();
    it.run(bg);
  };
  return (
    <div className="backdrop pal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="palette" role="dialog" aria-label="Быстрый переход">
        <input
          autoFocus
          className="pal-input"
          placeholder="Подразделение, сценарий, тип, раздел правил или команда…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePalette();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCur((c) => Math.min(ordered.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCur((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(ordered[cur], e.ctrlKey || e.metaKey);
            }
          }}
        />
        <div className="pal-list" ref={box}>
          {ordered.length === 0 && <div className="pal-empty">Ничего не найдено</div>}
          {ordered.map((it, i) => (
            <div key={it.id}>
              {(i === 0 || ordered[i - 1].group !== it.group) && <div className="pal-group">{it.group}</div>}
              <div className={`pal-item${i === cur ? ' cur' : ''}`} onMouseMove={() => i !== cur && setCur(i)} onClick={(e) => run(it, e.ctrlKey || e.metaKey)}>
                <span className="pal-title">{it.title}</span>
                {it.sub && <span className="pal-sub">{it.sub}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="pal-foot">↑↓ выбор · Enter открыть · Ctrl+Enter в фоне · Esc закрыть</div>
      </div>
    </div>
  );
}
