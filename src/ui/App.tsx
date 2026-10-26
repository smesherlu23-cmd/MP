// Каркас окна в духе macOS: боковая панель слева (на всю высоту), справа — панель инструментов
// (назад/вперёд, заголовок, действия страницы, поиск) и открытая страница. Вкладок нет: переходы — как в Finder.

import { useEffect, useMemo, useState } from 'react';
import { BattlePage } from './pages/BattlePage';
import { FormationPage } from './pages/FormationPage';
import { HelpPage } from './pages/HelpPage';
import { HomePage } from './pages/HomePage';
import { ForcesPage } from './pages/ForcesPage';
import { TeamPage } from './pages/TeamPage';
import { LibraryPage } from './pages/LibraryPage';
import { MonteCarloPage } from './pages/MonteCarloPage';
import { RulesetPage } from './pages/RulesetPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { SettingsPage } from './pages/SettingsPage';
import { Navigator } from './components/Navigator';
import { Palette, openPalette } from './components/Palette';
import { goBack, goForward, sectionMeta, setNavFilter, useNav, useNavFilter } from './nav';
import logo from './assets/logo.png';
import { Icon, type IconName } from './components/Icon';
import { Btn, ContextMenuHost, Menu, Splitter } from './components/ui';
import { CREATE_ITEMS } from './components/Navigator';
import { desktop } from './storage';
import {
  openTab,
  alertDialog,
  dismissToast,
  importFile,
  redo,
  redoBattle,
  resolveFormation,
  undo,
  undoBattle,
  updateSettings,
  useApp,
  useBattles,
  useHistory,
  type NavSection,
  type Tab,
  type TabKind,
} from './store';

const ICONS: Record<TabKind, IconName> = {
  home: 'home',
  ruleset: 'ruleset',
  formation: 'template',
  scenario: 'scenario',
  battle: 'battle',
  montecarlo: 'chart',
  settings: 'settings',
  help: 'help',
  library: 'template',
  team: 'forces',
};

/** Значок вкладки: силы и шаблоны открываются в одном конструкторе, но различаются. */
const tabIconName = (t: Tab): IconName =>
  t.kind === 'formation' && t.ref?.startsWith('force:') ? 'forces' : t.kind === 'library' && t.ref ? sectionMeta(t.ref as NavSection).icon : ICONS[t.kind];

function tabTitle(t: Tab, s: ReturnType<typeof useApp.getState>, battles: ReturnType<typeof useBattles.getState>['battles']): string {
  switch (t.kind) {
    case 'home':
      return 'Главное';
    case 'settings':
      return 'Настройки';
    case 'help':
      return 'Справка';
    case 'library':
      return t.ref ? sectionMeta(t.ref as NavSection).label : 'Каталог';
    case 'team':
      return t.ref ? `Команда «${t.ref}»` : 'Силы без команды';
    case 'ruleset':
      return s.rulesets[t.ref!]?.name ?? 'Набор правил';
    case 'scenario':
      return s.scenarios[t.ref!]?.name ?? 'Сценарий';
    case 'montecarlo':
      return `Прогоны: ${s.scenarios[t.ref!]?.name ?? ''}`;
    case 'formation': {
      const r = resolveFormation(t.ref!);
      return r ? r.f.name : r === null && t.ref?.startsWith('force:') ? 'Силы' : 'Шаблон';
    }
    case 'battle': {
      const b = battles[t.ref!];
      const m = s.battleIndex[t.ref!];
      const name = b?.name ?? m?.name ?? 'Бой';
      return b ? `${name} · ход ${b.turn}` : name;
    }
  }
}

async function showAbout() {
  const info = await desktop?.appInfo?.();
  await alertDialog(
    'Echelon Commander',
    `Модульный симулятор боя для ГМ варгейма и ролевых войн.${info ? `\nВерсия ${info.version}.\nПапка данных: ${info.dataDir}` : '\nВерсия для браузера: данные хранятся в браузере.'}`,
  );
}

function DialogHost() {
  const d = useApp((s) => s.dialog);
  const [value, setValue] = useState('');
  useEffect(() => {
    if (d?.input) setValue(d.input.value);
    else if (d?.options) setValue(d.options[0]?.value ?? '');
  }, [d]);
  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      d.resolve(d.alert ? true : null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [d]);
  if (!d) return null;
  const ok = () => d.resolve(d.input || d.options ? value : true);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && d.resolve(null)}>
      <div className="modal">
        <div className="modal-head">
          <h2>{d.title}</h2>
        </div>
        <div className="modal-body stack" style={{ gap: 10 }}>
          {d.text && (
            <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
              {d.text}
            </div>
          )}
          {d.input && (
            <input
              autoFocus
              value={value}
              placeholder={d.input.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ok();
                if (e.key === 'Escape') d.resolve(null);
              }}
            />
          )}
          {d.options && (
            <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} size={Math.min(10, Math.max(3, d.options.length))}>
              {d.options.map((o) => (
                <option key={o.value} value={o.value} onDoubleClick={() => d.resolve(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="modal-foot">
          {!d.alert && <Btn onClick={() => d.resolve(null)}>Отмена</Btn>}
          <button type="button" className={`btn ${d.danger ? 'danger' : 'primary'}`} onClick={ok} autoFocus={!d.input && !d.options}>
            {d.okText ?? 'ОК'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Page({ t }: { t: Tab }) {
  switch (t.kind) {
    case 'home':
      return <HomePage />;
    case 'settings':
      return <SettingsPage />;
    case 'help':
      return <HelpPage tab={t} />;
    case 'ruleset':
      return <RulesetPage tab={t} />;
    case 'formation':
      return <FormationPage tab={t} />;
    case 'scenario':
      return <ScenarioPage tab={t} />;
    case 'battle':
      return <BattlePage tab={t} />;
    case 'montecarlo':
      return <MonteCarloPage tab={t} />;
    case 'library':
      return t.ref === 'forces' ? <ForcesPage /> : <LibraryPage tab={t} />;
    case 'team':
      return <TeamPage team={t.ref ?? ''} />;
    default:
      return <HomePage />;
  }
}

const SIDE_W = { min: 200, max: 420, def: 260 };

/** Поле поиска в панели инструментов: ввод фильтрует боковую панель, Enter (или Ctrl+K) — найти что угодно. */
function ToolbarSearch() {
  const q = useNavFilter((x) => x.q);
  return (
    <label className="tb-search" title="Фильтр боковой панели; Enter или Ctrl+K — найти что угодно, включая вложенные части и команды">
      <Icon name="search" size={14} />
      <input
        type="search"
        placeholder="Поиск"
        value={q}
        onChange={(e) => {
          setNavFilter(e.target.value);
          if (e.target.value && !useApp.getState().settings.sidebar) updateSettings({ sidebar: true });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            openPalette(q);
          } else if (e.key === 'Escape') setNavFilter('');
        }}
      />
      {!q && <span className="kbd">Ctrl+K</span>}
    </label>
  );
}

export function App() {
  const s = useApp();
  const battles = useBattles((x) => x.battles);
  const hist = useHistory();
  const nav = useNav();
  const active = useMemo(() => s.tabs.find((t) => t.key === s.active) ?? s.tabs[0], [s.tabs, s.active]);
  // Ширина боковой панели меняется перетаскиванием края; сохраняется, когда отпустили.
  const [sideW, setSideW] = useState<number | null>(null);
  const sideWidth = sideW ?? s.settings.sideWidth ?? SIDE_W.def;
  useEffect(() => {
    if (sideW === null) return;
    const t = setTimeout(() => updateSettings({ sideWidth: sideW }), 300);
    return () => clearTimeout(t);
  }, [sideW]);

  useEffect(() => {
    document.documentElement.dataset.theme = s.settings.theme;
    document.documentElement.dataset.density = s.settings.density;
    desktop?.setWindowTheme?.(s.settings.theme);
  }, [s.settings.theme, s.settings.density]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select')) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') goBack();
        else goForward();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault();
        goBack();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault();
        goForward();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
        e.preventDefault();
        openPalette();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF' && !e.shiftKey) {
        // Поиск в панели инструментов — как Cmd+F в Finder.
        const el = document.querySelector<HTMLInputElement>('.tb-search input');
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        updateSettings({ sidebar: !st.settings.sidebar });
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'Comma') {
        e.preventDefault();
        openTab('settings');
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        // Отмена своя для всей программы (и в полях ввода): незаконченный ввод сначала применяется.
        if (st.dialog || document.querySelector('.backdrop')) return;
        e.preventDefault();
        const a = document.activeElement as HTMLElement | null;
        if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
        // На странице боя отменяются ходы и решения ГМ в этом бою.
        const tab = st.tabs.find((t) => t.key === st.active);
        if (tab?.kind === 'battle' && tab.ref) {
          if (e.code === 'KeyY' || e.shiftKey) redoBattle(tab.ref);
          else undoBattle(tab.ref);
        } else if (e.code === 'KeyY' || e.shiftKey) redo();
        else undo();
      }
    };
    // Боковые кнопки мыши — назад и вперёд, как в браузере.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.button === 3) goBack();
      else goForward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  const sidebar = s.settings.sidebar;
  const toggleSidebar = () => updateSettings({ sidebar: !sidebar });
  const title = active ? tabTitle(active, s, battles) : '';
  return (
    <div className={`app${sidebar ? '' : ' side-hidden'}`} style={{ '--side-w': `${sideWidth}px` } as React.CSSProperties}>
      <aside className="sidebar-col" aria-hidden={!sidebar} inert={!sidebar}>
        <div className="side-top">
          <button type="button" className="brand-name" title="Главное" onClick={() => openTab('home')}>
            <img src={logo} alt="" className="brand-logo" />
            <span>Echelon Commander</span>
          </button>
          <button type="button" className="tb-icon" title="Скрыть боковую панель (Ctrl+B)" onClick={toggleSidebar}>
            <Icon name="sidebar" size={17} />
          </button>
        </div>
        <Navigator />
        <Splitter side="left" label="Ширина боковой панели" width={sideWidth} min={SIDE_W.min} max={SIDE_W.max} def={SIDE_W.def} onChange={setSideW} />
      </aside>
      <div className="main-col">
        <header className="toolbar-win">
          {!sidebar && (
            <button type="button" className="tb-icon" title="Показать боковую панель (Ctrl+B)" onClick={toggleSidebar}>
              <Icon name="sidebar" size={17} />
            </button>
          )}
          <div className="tb-nav">
            <button type="button" className="tb-icon" disabled={!nav.back} onClick={goBack} title="Назад (Alt+←)">
              <Icon name="left" size={17} />
            </button>
            <button type="button" className="tb-icon" disabled={!nav.fwd} onClick={goForward} title="Вперёд (Alt+→)">
              <Icon name="right" size={17} />
            </button>
          </div>
          <div className="tb-title">
            <span className="tb-name" title={title}>
              <span className="tb-name-icon">{active && <Icon name={tabIconName(active)} size={15} />}</span>
              <span className="tb-name-text">{title}</span>
            </span>
            <div id="tb-crumbs" className="tb-crumbs" />
          </div>
          <div id="tb-actions" className="tb-actions" />
          <div className="tb-global">
            <Menu
              sm
              label={<Icon name="plus" size={17} />}
              className="tb-icon tb-create"
              title="Создать: сценарий, силы, шаблон или набор правил"
              items={CREATE_ITEMS()}
            />
            <button
              type="button"
              className="tb-icon"
              disabled={!hist.undo}
              onClick={undo}
              title={hist.undo ? `Отменить: ${hist.undo} (Ctrl+Z)` : 'Отменить (Ctrl+Z)'}
            >
              <Icon name="undo" size={17} />
            </button>
            <button
              type="button"
              className="tb-icon"
              disabled={!hist.redo}
              onClick={redo}
              title={hist.redo ? `Повторить: ${hist.redo} (Ctrl+Y)` : 'Повторить (Ctrl+Y)'}
            >
              <Icon name="redo" size={17} />
            </button>
            <ToolbarSearch />
            <Menu
              sm
              className="tb-icon"
              title="Меню"
              items={[
                { label: 'Отменить', kbd: 'Ctrl+Z', disabled: !hist.undo, tip: hist.undo ?? undefined, onClick: undo },
                { label: 'Повторить', kbd: 'Ctrl+Y', disabled: !hist.redo, tip: hist.redo ?? undefined, onClick: redo },
                'sep',
                { label: 'Найти…', kbd: 'Ctrl+K', onClick: () => openPalette() },
                { label: 'Импорт из файла…', onClick: () => importFile(), tip: 'Набор правил, подразделение, сценарий или бой в формате JSON' },
                'sep',
                {
                  label: s.settings.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема',
                  onClick: () => updateSettings({ theme: s.settings.theme === 'dark' ? 'light' : 'dark' }),
                },
                { label: sidebar ? 'Скрыть боковую панель' : 'Показать боковую панель', kbd: 'Ctrl+B', onClick: toggleSidebar },
                'sep',
                { label: 'Справка', onClick: () => openTab('help') },
                { label: 'Настройки', kbd: 'Ctrl+,', onClick: () => openTab('settings') },
                { label: 'О программе', onClick: () => void showAbout() },
              ]}
            />
          </div>
        </header>
        <main className="content">{active && <Page key={active.key} t={active} />}</main>
      </div>
      <DialogHost />
      <Palette />
      <Toasts />
      <TooltipHost />
      <ContextMenuHost />
    </div>
  );
}

/** Одна всплывающая подсказка на всё окно: показывается у любого элемента с атрибутом data-tip. */
function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);
  useEffect(() => {
    let cur: Element | null = null;
    const show = (t: Element | null) => {
      if (t === cur) return;
      cur = t;
      const text = t?.getAttribute('data-tip');
      if (!t || !text) return setTip(null);
      const r = t.getBoundingClientRect();
      const above = r.bottom + 90 > window.innerHeight;
      setTip({ text, left: Math.min(Math.max(8, r.left + r.width / 2 - 170), window.innerWidth - 348), top: above ? r.top - 6 : r.bottom + 6, above });
    };
    const over = (e: MouseEvent) => show((e.target as Element)?.closest?.('[data-tip]') ?? null);
    // С клавиатуры подсказка показывается, когда на элемент переходят клавишей Tab (не по щелчку);
    // у значка «?» — и по щелчку: его для того и нажимают.
    const focus = (e: FocusEvent) => {
      const t = e.target as Element;
      if (t?.matches?.(':focus-visible, .hint-icon')) show(t.closest('[data-tip]'));
    };
    const hide = () => {
      cur = null;
      setTip(null);
    };
    const down = (e: MouseEvent) => (e.target as Element)?.closest?.('.hint-icon') || hide();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', down);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : undefined }}>
      {tip.text}
    </div>
  );
}
