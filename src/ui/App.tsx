// Каркас: вкладки-«окна» сверху, навигатор слева, содержимое активной вкладки.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BattlePage } from './pages/BattlePage';
import { FormationPage } from './pages/FormationPage';
import { HelpPage } from './pages/HelpPage';
import { HomePage } from './pages/HomePage';
import { MonteCarloPage } from './pages/MonteCarloPage';
import { RulesetPage } from './pages/RulesetPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { SettingsPage } from './pages/SettingsPage';
import { Navigator } from './components/Navigator';
import { Palette, openPalette } from './components/Palette';
import { goBack, goForward, useNav } from './nav';
import { Btn, Menu } from './components/ui';
import { desktop } from './storage';
import {
  activateTab,
  alertDialog,
  closeTab,
  dismissToast,
  importFile,
  moveTab,
  redo,
  redoBattle,
  resolveFormation,
  undo,
  undoBattle,
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

/** Значок вкладки: силы и шаблоны открываются в одном конструкторе, но различаются. */
const tabIcon = (t: Tab) => (t.kind === 'formation' && t.ref?.startsWith('force:') ? '⚑' : ICONS[t.kind]);

function useTabTitle(t: Tab): string {
  const s = useApp();
  const battles = useBattles((x) => x.battles);
  return tabTitle(t, s, battles);
}

function tabTitle(t: Tab, s: ReturnType<typeof useApp.getState>, battles: ReturnType<typeof useBattles.getState>['battles']): string {
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
      return r ? r.f.name : r === null && t.ref?.startsWith('force:') ? 'Силы' : 'Шаблон';
    }
    case 'battle': {
      const b = battles[t.ref!];
      const m = s.battleIndex[t.ref!];
      const name = b?.name ?? m?.name ?? 'Бой';
      const turn = b ? ` · ход ${b.turn}` : '';
      // Отличающаяся часть — вперёд: вкладки боёв одного сценария иначе выглядят одинаково.
      const i = name.lastIndexOf(' · ');
      return i > 0 ? `${name.slice(i + 3)}${turn} — ${name.slice(0, i)}` : `${name}${turn}`;
    }
  }
}

/**
 * Полоса вкладок: вкладки сжимаются, как в браузере; если и так не помещаются — прокручиваются,
 * активная всегда видна, а кнопка «▾» справа показывает список всех вкладок.
 */
function Tabs({ tabs, active }: { tabs: Tab[]; active?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(false);
  const s = useApp();
  const battles = useBattles((x) => x.battles);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);
  useEffect(() => {
    ref.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length, overflow]);
  return (
    <>
      <nav className="tabs" ref={ref}>
        {tabs.map((t) => (
          <TabItem key={t.key} t={t} active={t.key === active} />
        ))}
      </nav>
      {overflow && (
        <div className="tabs-more">
          <Menu
            sm
            label={`▾ ${tabs.length}`}
            title="Все открытые вкладки"
            items={tabs.map((t) => ({ label: `${tabIcon(t)} ${tabTitle(t, s, battles)}`, onClick: () => activateTab(t.key), kbd: t.key === active ? '●' : undefined }))}
          />
        </div>
      )}
    </>
  );
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
      <span className="tab-icon">{tabIcon(t)}</span>
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

async function showAbout() {
  const info = await desktop?.appInfo?.();
  await alertDialog(
    'WarSim — симулятор боя',
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
  const nav = useNav();
  const active = useMemo(() => s.tabs.find((t) => t.key === s.active) ?? s.tabs[0], [s.tabs, s.active]);

  useEffect(() => {
    document.documentElement.dataset.theme = s.settings.theme;
    document.documentElement.dataset.density = s.settings.density;
    desktop?.setWindowTheme?.(s.settings.theme);
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
      } else if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select')) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') goBack();
        else goForward();
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
        // На вкладке боя отменяются ходы и решения ГМ в этом бою.
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" title="Показать/скрыть навигатор (Ctrl+B)" onClick={() => updateSettings({ sidebar: !s.settings.sidebar })}>
          ☰ WARSIM
        </div>
        <div className="nav-arrows">
          <button disabled={!nav.back} onClick={goBack} title="Назад (Alt+←)">
            ‹
          </button>
          <button disabled={!nav.fwd} onClick={goForward} title="Вперёд (Alt+→)">
            ›
          </button>
        </div>
        <Tabs tabs={s.tabs} active={active?.key} />
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
              { label: 'О программе', onClick: () => void showAbout() },
            ]}
          />
        </div>
      </header>
      <Navigator />
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
    // С клавиатуры подсказка показывается, когда на элемент переходят клавишей Tab (не по щелчку).
    const focus = (e: FocusEvent) => {
      const t = e.target as Element;
      if (t?.matches?.(':focus-visible')) show(t.closest('[data-tip]'));
    };
    const hide = () => {
      cur = null;
      setTip(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
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
