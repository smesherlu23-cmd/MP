// Каркас: вкладки-«окна» сверху, навигатор слева, содержимое активной вкладки.

import { useEffect, useMemo, useState } from 'react';
import { BattlePage } from './pages/BattlePage';
import { DND_LIB, FormationPage } from './pages/FormationPage';
import { HelpPage } from './pages/HelpPage';
import { HomePage } from './pages/HomePage';
import { MonteCarloPage } from './pages/MonteCarloPage';
import { RulesetPage } from './pages/RulesetPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { SettingsPage } from './pages/SettingsPage';
import { Palette, openPalette } from './components/Palette';
import { Btn, Menu } from './components/ui';
import {
  activateTab,
  closeTab,
  createFormation,
  createRuleset,
  createScenario,
  dismissToast,
  importFile,
  moveTab,
  openTab,
  redo,
  resolveFormation,
  undo,
  updateSettings,
  useApp,
  useBattles,
  useHistory,
  type Tab,
  type TabKind,
} from './store';

const ICONS: Record<TabKind, string> = {
  home: '⌂',
  ruleset: '§',
  formation: '▦',
  scenario: '◈',
  battle: '⚔',
  montecarlo: '∑',
  settings: '⚙',
  help: '?',
  library: '▤',
};

function useTabTitle(t: Tab): string {
  const s = useApp();
  const battles = useBattles((x) => x.battles);
  switch (t.kind) {
    case 'home':
      return 'Главная';
    case 'settings':
      return 'Настройки';
    case 'help':
      return 'Справка';
    case 'library':
      return 'Библиотека';
    case 'ruleset':
      return s.rulesets[t.ref!]?.name ?? 'Набор правил';
    case 'scenario':
      return s.scenarios[t.ref!]?.name ?? 'Сценарий';
    case 'montecarlo':
      return `Прогоны: ${s.scenarios[t.ref!]?.name ?? ''}`;
    case 'formation': {
      const r = resolveFormation(t.ref!);
      return r ? `${r.f.name}${r.scenario ? ' (сценарий)' : ''}` : 'Подразделение';
    }
    case 'battle': {
      const b = battles[t.ref!];
      const m = s.battleIndex[t.ref!];
      return `${b?.name ?? m?.name ?? 'Бой'}${b ? ` · ход ${b.turn}` : ''}`;
    }
  }
}

function TabItem({ t, active }: { t: Tab; active: boolean }) {
  const title = useTabTitle(t);
  return (
    <div
      className={`tab${active ? ' active' : ''}`}
      title={title}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/tab', t.key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = e.dataTransfer.getData('text/tab');
        if (from && from !== t.key) moveTab(from, t.key);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(t.key);
        }
      }}
      onClick={() => activateTab(t.key)}
    >
      <span className="tab-icon">{ICONS[t.kind]}</span>
      <span className="tab-title">{title}</span>
      <button
        className="tab-close"
        title="Закрыть (Ctrl+W)"
        onClick={(e) => {
          e.stopPropagation();
          closeTab(t.key);
        }}
      >
        ×
      </button>
    </div>
  );
}

function SideSection(props: { id: string; title: string; count: number; onAdd?: () => void; addTitle?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem(`warsim-side-${props.id}`) !== '0');
  return (
    <div className="side-section">
      <div
        className="side-head"
        onClick={() => {
          setOpen(!open);
          localStorage.setItem(`warsim-side-${props.id}`, open ? '0' : '1');
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span className="grow">
          {props.title} <span className="count">{props.count}</span>
        </span>
        {props.onAdd && (
          <Btn
            kind="ghost"
            sm
            icon
            title={props.addTitle}
            onClick={(e) => {
              e.stopPropagation();
              props.onAdd!();
            }}
          >
            +
          </Btn>
        )}
      </div>
      {open && <div className="side-items">{props.children}</div>}
    </div>
  );
}

function Sidebar() {
  const s = useApp();
  const [q, setQ] = useState('');
  const [allBattles, setAllBattles] = useState(false);
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());
  const activeTab = s.tabs.find((t) => t.key === s.active);
  const isActive = (kind: TabKind, ref?: string) => activeTab?.kind === kind && activeTab.ref === ref;
  const item = (kind: TabKind, ref: string, name: string, sub?: string, dragLib?: string) => (
    <div
      key={ref}
      className={`side-item${isActive(kind, ref) ? ' active' : ''}`}
      title={dragLib ? `${name}\nМожно перетащить в структуру подразделения или на сторону сценария` : name}
      draggable={!!dragLib}
      onDragStart={(e) => {
        if (!dragLib) return;
        e.dataTransfer.setData(DND_LIB, dragLib);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={(e) => openTab(kind, ref, { background: e.ctrlKey || e.metaKey })}
      onAuxClick={(e) => e.button === 1 && openTab(kind, ref, { background: true })}
    >
      <span>{name}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
  const scenarios = Object.values(s.scenarios).filter((x) => match(x.name)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const formations = Object.values(s.formations).filter((x) => match(x.name)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const rulesets = Object.values(s.rulesets).filter((x) => match(x.name)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const battles = Object.values(s.battleIndex)
    .filter((x) => match(x.name))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return (
    <aside className={`sidebar${s.settings.sidebar ? '' : ' hidden'}`}>
      <div className="sidebar-search">
        <input type="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
      </div>
      <SideSection id="sc" title="Сценарии" count={scenarios.length} onAdd={() => createScenario()} addTitle="Новый сценарий">
        {scenarios.length ? scenarios.map((x) => item('scenario', x.id, x.name)) : <div className="side-empty">Нет сценариев</div>}
      </SideSection>
      <SideSection id="fm" title="Подразделения" count={formations.length} onAdd={() => createFormation()} addTitle="Новое подразделение">
        {formations.length ? formations.map((x) => item('formation', `lib:${x.id}`, x.name, x.level, x.id)) : <div className="side-empty">Библиотека пуста</div>}
      </SideSection>
      <SideSection id="bt" title="Бои" count={battles.length}>
        {battles.length ? (
          battles.slice(0, allBattles || q ? 200 : 8).map((x) => item('battle', x.id, x.name, x.finished ? 'итог' : `ход ${x.turn}`))
        ) : (
          <div className="side-empty">Боёв пока нет</div>
        )}
        {!q && !allBattles && battles.length > 8 && (
          <div className="side-empty">
            <a href="#" onClick={(e) => (e.preventDefault(), setAllBattles(true))}>
              показать все ({battles.length})
            </a>
          </div>
        )}
      </SideSection>
      <SideSection id="rs" title="Наборы правил" count={rulesets.length} onAdd={() => createRuleset()} addTitle="Новый набор правил">
        {rulesets.map((x) => item('ruleset', x.id, x.name))}
      </SideSection>
    </aside>
  );
}

function DialogHost() {
  const d = useApp((s) => s.dialog);
  const [value, setValue] = useState('');
  useEffect(() => {
    if (d?.input) setValue(d.input.value);
    else if (d?.options) setValue(d.options[0]?.value ?? '');
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
          {d.text && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{d.text}</div>}
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
          <Btn onClick={() => d.resolve(null)}>Отмена</Btn>
          <Btn kind={d.danger ? 'danger' : 'primary'} onClick={ok}>
            {d.okText ?? 'ОК'}
          </Btn>
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
      return <HelpPage />;
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
    default:
      return <HomePage />;
  }
}

export function App() {
  const s = useApp();
  const hist = useHistory();
  const active = useMemo(() => s.tabs.find((t) => t.key === s.active) ?? s.tabs[0], [s.tabs, s.active]);

  useEffect(() => {
    document.documentElement.dataset.theme = s.settings.theme;
    document.documentElement.dataset.density = s.settings.density;
  }, [s.settings.theme, s.settings.density]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTab(st.active);
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const i = st.tabs.findIndex((t) => t.key === st.active);
        const n = st.tabs.length;
        activateTab(st.tabs[(i + (e.shiftKey ? n - 1 : 1)) % n].key);
      } else if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        const t = st.tabs[Number(e.key) - 1];
        if (t) {
          e.preventDefault();
          activateTab(t.key);
        }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
        e.preventDefault();
        openPalette();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        updateSettings({ sidebar: !st.settings.sidebar });
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        // Отмена своя для всей программы (и в полях ввода): незаконченный ввод сначала применяется.
        if (st.dialog || document.querySelector('.backdrop')) return;
        e.preventDefault();
        const a = document.activeElement as HTMLElement | null;
        if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
        if (e.code === 'KeyY' || e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" title="Показать/скрыть навигатор (Ctrl+B)" onClick={() => updateSettings({ sidebar: !s.settings.sidebar })}>
          ☰ WARSIM
        </div>
        <nav className="tabs">
          {s.tabs.map((t) => (
            <TabItem key={t.key} t={t} active={t.key === active?.key} />
          ))}
        </nav>
        <div className="topbar-right">
          <button className="find-btn" onClick={openPalette} title="Быстрый переход к любому объекту и команде">
            <span>Найти…</span>
            <span className="kbd">Ctrl+K</span>
          </button>
          <Menu
            sm
            title="Меню"
            items={[
              { label: 'Отменить', kbd: 'Ctrl+Z', disabled: !hist.undo, tip: hist.undo ?? undefined, onClick: undo },
              { label: 'Повторить', kbd: 'Ctrl+Y', disabled: !hist.redo, tip: hist.redo ?? undefined, onClick: redo },
              'sep',
              { label: 'Импорт из файла…', onClick: () => importFile(), tip: 'Набор правил, подразделение, сценарий или бой в формате JSON' },
              { label: s.settings.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', onClick: () => updateSettings({ theme: s.settings.theme === 'dark' ? 'light' : 'dark' }) },
              { label: s.settings.sidebar ? 'Скрыть навигатор' : 'Показать навигатор', kbd: 'Ctrl+B', onClick: () => updateSettings({ sidebar: !s.settings.sidebar }) },
              'sep',
              { label: 'Справка', onClick: () => openTab('help') },
              { label: 'Настройки', onClick: () => openTab('settings') },
            ]}
          />
        </div>
      </header>
      <Sidebar />
      <main className="content">{active && <Page key={active.key} t={active} />}</main>
      <DialogHost />
      <Palette />
      <Toasts />
      <TooltipHost />
    </div>
  );
}

/** Одна всплывающая подсказка на всё окно: показывается у любого элемента с атрибутом data-tip. */
function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);
  useEffect(() => {
    let cur: Element | null = null;
    const over = (e: MouseEvent) => {
      const t = (e.target as Element)?.closest?.('[data-tip]') ?? null;
      if (t === cur) return;
      cur = t;
      const text = t?.getAttribute('data-tip');
      if (!t || !text) return setTip(null);
      const r = t.getBoundingClientRect();
      const above = r.bottom + 90 > window.innerHeight;
      setTip({ text, left: Math.min(Math.max(8, r.left + r.width / 2 - 170), window.innerWidth - 348), top: above ? r.top - 6 : r.bottom + 6, above });
    };
    const hide = () => {
      cur = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', hide);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : undefined }}>
      {tip.text}
    </div>
  );
}
