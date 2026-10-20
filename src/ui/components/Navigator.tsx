// Навигатор слева: поиск и «Создать» сверху, ниже — разделы деревом в порядке работы (игра, подготовка).
// Каждый раздел разворачивается на месте; щелчок по названию раздела открывает его каталог.
// Раздел открытой вкладки подсвечен — всегда видно, где находишься.

import { useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { arrowNav, Menu, pressable } from './ui';
import { openPalette } from './Palette';
import { NAV_GROUPS, isNavOpen, sectionMeta, sectionOf, setNavOpen, showSection } from '../nav';
import { LEVEL_LABEL } from './ForceCampaign';
import { DND_FORCE, DND_LIB } from '../pages/unit/model';
import {
  createFormation,
  createScenario,
  deleteBattles,
  forceStatus,
  teamColor,
  importFile,
  newForceDialog,
  newRulesetDialog,
  openTab,
  useApp,
  type NavSection,
  type TabKind,
} from '../store';

/** Создать объект раздела (у боёв своей кнопки нет — бой начинается из сценария). */
export function createIn(sec: NavSection) {
  if (sec === 'scenarios') createScenario();
  else if (sec === 'forces') void newForceDialog();
  else if (sec === 'units') createFormation();
  else if (sec === 'rulesets') void newRulesetDialog();
}

const withIcon = (icon: IconName, text: string) => (
  <span className="menu-ico">
    <Icon name={icon} size={15} />
    {text}
  </span>
);

/** Пункты меню «+ Создать» — в навигаторе и на главной. */
export const CREATE_ITEMS = () => [
  { label: withIcon('scenario', 'Сценарий'), onClick: () => createIn('scenarios'), tip: 'Обстановка и две стороны' },
  { label: withIcon('forces', 'Силы'), onClick: () => createIn('forces'), tip: 'Конкретное подразделение по шаблону' },
  { label: withIcon('template', 'Шаблон'), onClick: () => createIn('units'), tip: 'Устройство и штат подразделения' },
  { label: withIcon('ruleset', 'Набор правил'), onClick: () => createIn('rulesets') },
  'sep' as const,
  { label: withIcon('import', 'Импорт из файла…'), onClick: () => importFile(), tip: 'Набор правил, подразделение, сценарий или бой в формате JSON' },
];

function NavItem(props: { icon: IconName; label: string; count?: number; selected?: boolean; here?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className={`nav-item${props.selected ? ' selected' : ''}${props.here ? ' here' : ''}`} onClick={props.onClick} title={props.title}>
      <span className="nav-icon">
        <Icon name={props.icon} />
      </span>
      <span className="grow">{props.label}</span>
      {props.count !== undefined && <span className="nav-count">{props.count}</span>}
    </button>
  );
}

export function Navigator() {
  const s = useApp();
  const activeTab = s.tabs.find((t) => t.key === s.active);
  const here = sectionOf(activeTab);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const counts: Record<NavSection, number> = {
    scenarios: Object.keys(s.scenarios).length,
    forces: Object.keys(s.forces).length,
    units: Object.keys(s.formations).length,
    battles: Object.keys(s.battleIndex).length,
    rulesets: Object.keys(s.rulesets).length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const isOpen = (kind: TabKind, ref: string) => activeTab?.ref === ref && activeTab.kind === kind;

  const row = (
    key: string,
    name: string,
    onOpen: (o: { background?: boolean; preview?: boolean }) => void,
    opts: { sub?: string; active?: boolean; dragLib?: string; dragForce?: string; color?: string; warn?: { cls: string; text: string } } = {},
  ) => (
    <div
      key={key}
      className={`side-item${opts.active ? ' active' : ''}`}
      title={
        opts.dragLib
          ? `${name}\nМожно перетащить в структуру шаблона или сил`
          : opts.dragForce
            ? `${name}${opts.warn ? ` — ${opts.warn.text.toLowerCase()}` : ''}\nМожно перетащить на сторону сценария`
            : opts.sub
              ? `${name}\n${opts.sub}`
              : name
      }
      draggable={!!(opts.dragLib || opts.dragForce)}
      onDragStart={(e) => {
        if (opts.dragLib) e.dataTransfer.setData(DND_LIB, opts.dragLib);
        else if (opts.dragForce) e.dataTransfer.setData(DND_FORCE, opts.dragForce);
        else return;
        e.dataTransfer.effectAllowed = 'copy';
      }}
      // Щелчок — просмотр (заменяет прежний просмотр, вкладки не копятся); двойной щелчок или Enter — обычная вкладка.
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey ? { background: true } : { preview: true })}
      onDoubleClick={() => onOpen({})}
      onAuxClick={(e) => e.button === 1 && onOpen({ background: true })}
      {...pressable((e) => onOpen({ background: e.ctrlKey || e.metaKey }))}
    >
      {opts.color && <span className="team-dot sm" style={{ background: opts.color }} aria-hidden />}
      <span>{name}</span>
      {opts.sub && <span className="sub">{opts.sub}</span>}
      {opts.warn && (
        <span className={`side-warn ${opts.warn.cls}`} aria-hidden>
          <Icon name="alert" size={13} />
        </span>
      )}
    </div>
  );
  const group = (title: string, items: React.ReactNode[], onDelete?: () => void, deleteTitle?: string, color?: string) =>
    items.length ? (
      <div key={`g:${title}`} className="nav-group">
        <div className="nav-group-title">
          {color && <span className="team-dot sm" style={{ background: color }} aria-hidden />}
          <span className="grow">{title}</span>
          {onDelete && (
            <button type="button" className="nav-group-del" onClick={onDelete} title={deleteTitle}>
              ×
            </button>
          )}
        </div>
        {items}
      </div>
    ) : null;

  /** Список раздела и подпись для пустого списка. */
  const sectionList = (sec: NavSection): { list: React.ReactNode[]; empty: string } => {
    if (sec === 'scenarios') {
      const battlesBy = new Map<string, number>();
      for (const b of Object.values(s.battleIndex)) battlesBy.set(b.scenarioId, (battlesBy.get(b.scenarioId) ?? 0) + 1);
      const list = Object.values(s.scenarios)
        .filter((x) => match(x.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((x) =>
          row(x.id, x.name, (o) => openTab('scenario', x.id, o), {
            sub: battlesBy.get(x.id) ? `боёв: ${battlesBy.get(x.id)}` : undefined,
            active:
              (activeTab?.kind === 'scenario' || activeTab?.kind === 'montecarlo') && activeTab.ref === x.id
                ? true
                : !!activeTab?.ref?.startsWith(`sc:${x.id}:`),
          }),
        );
      return { list, empty: 'Сценариев пока нет.' };
    }
    if (sec === 'units') {
      const units = Object.values(s.formations)
        .filter((x) => match(x.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const rsIds = [...new Set(units.map((u) => u.rulesetId ?? ''))];
      const item = (x: (typeof units)[number]) =>
        row(x.id, x.name, (o) => openTab('formation', `lib:${x.id}`, o), {
          sub: x.level,
          active: isOpen('formation', `lib:${x.id}`),
          dragLib: x.id,
        });
      // Шаблоны разных наборов правил — отдельными группами: видно, к какому набору относится каждый.
      const list =
        rsIds.length > 1
          ? rsIds.map((id) => group(s.rulesets[id]?.name ?? 'Без набора правил', units.filter((u) => (u.rulesetId ?? '') === id).map(item)))
          : units.map(item);
      return { list, empty: 'Шаблонов нет.' };
    }
    if (sec === 'forces') {
      const units = Object.values(s.forces)
        .filter((x) => match(x.name) || match(x.faction ?? ''))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const factions = [...new Set(units.map((u) => u.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));
      const item = (x: (typeof units)[number]) =>
        row(x.id, x.name, (o) => openTab('formation', `force:${x.id}`, o), {
          sub: x.level,
          active: isOpen('formation', `force:${x.id}`),
          dragForce: x.id,
          color: teamColor(x.faction ?? ''),
          warn: ((l) => (l === 'ready' ? undefined : LEVEL_LABEL[l]))(forceStatus(x).level),
        });
      // Силы — по командам: чьи это войска; у команды свой цвет.
      const list =
        factions.length > 1
          ? factions.map((f) => group(f || 'Без команды', units.filter((u) => (u.faction?.trim() || '') === f).map(item), undefined, undefined, teamColor(f)))
          : units.map(item);
      return { list, empty: 'Сил пока нет.' };
    }
    if (sec === 'battles') {
      const battles = Object.values(s.battleIndex)
        .filter((x) => match(x.name))
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      const byScenario = new Map<string, typeof battles>();
      for (const b of battles) byScenario.set(b.scenarioId, [...(byScenario.get(b.scenarioId) ?? []), b]);
      const list = [...byScenario.entries()].map(([scId, items]) => {
        const scName = s.scenarios[scId]?.name ?? items[0].name.split(' · ')[0];
        return group(
          scName,
          items.map((b) =>
            row(b.id, b.name.startsWith(`${scName} · `) ? b.name.slice(scName.length + 3) : b.name, (o) => openTab('battle', b.id, o), {
              sub: b.finished ? (b.headline ?? 'итог') : `ход ${b.turn}`,
              active: isOpen('battle', b.id),
            }),
          ),
          () =>
            deleteBattles(
              items.map((b) => b.id),
              `Удалить все бои сценария «${scName}»?`,
            ),
          `Удалить все бои этого сценария (${items.length})`,
        );
      });
      return { list, empty: 'Боёв пока нет. Бой начинается со страницы сценария.' };
    }
    const list = Object.values(s.rulesets)
      .filter((x) => match(x.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((x) => row(x.id, x.name, (o) => openTab('ruleset', x.id, o), { active: isOpen('ruleset', x.id) }));
    return { list, empty: 'Наборов правил нет.' };
  };

  const section = (sec: NavSection) => {
    const meta = sectionMeta(sec);
    const { list, empty } = sectionList(sec);
    const has = list.some(Boolean);
    // При фильтре видны все разделы с совпадениями — развёрнутыми; без совпадений раздел скрыт.
    if (q && !has) return null;
    const open = q ? true : isNavOpen(s.settings.navOpen, sec);
    return (
      <div key={sec} className={`nav-sec${open ? ' open' : ''}`} data-sec={sec}>
        <div className="nav-sec-head">
          <button
            type="button"
            className="nav-chev"
            aria-expanded={open}
            title={open ? 'Свернуть' : 'Развернуть'}
            disabled={!!q}
            onClick={() => setNavOpen(sec, !open)}
          >
            <Icon name="right" size={14} />
          </button>
          <NavItem
            icon={meta.icon}
            label={meta.label}
            count={counts[sec]}
            selected={activeTab?.kind === 'library' && activeTab.ref === sec}
            here={here === sec}
            title={`${meta.about}\nЩелчок — каталог раздела`}
            onClick={() => showSection(sec)}
          />
          {meta.create && (
            <button type="button" className="nav-add" title={meta.create} onClick={() => createIn(sec)}>
              <Icon name="plus" size={15} />
            </button>
          )}
        </div>
        {open && <div className="nav-list">{has ? list : <div className="nav-empty">{empty}</div>}</div>}
      </div>
    );
  };

  return (
    <aside className={`sidebar nav${s.settings.sidebar ? '' : ' hidden'}`}>
      <div className="nav-tools">
        <button type="button" className="nav-search" onClick={openPalette} title="Быстрый переход к любому объекту и команде">
          <Icon name="search" size={15} />
          <span className="grow">Найти…</span>
          <span className="kbd">Ctrl+K</span>
        </button>
        <Menu alignLeft className="primary nav-create" label="+ Создать" title="Создать сценарий, силы, шаблон или набор правил" items={CREATE_ITEMS()} />
      </div>
      {total > 12 && (
        <div className="nav-filter">
          <input type="search" placeholder="Фильтр по названию…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="nav-scroll" ref={listRef} onKeyDown={(e) => arrowNav(e, listRef.current, '.side-item')}>
        <div className="nav-home">
          <NavItem icon="home" label="Главное" here={activeTab?.kind === 'home'} onClick={() => openTab('home')} title="Что продолжить, с чего начать" />
        </div>
        {NAV_GROUPS.map((g) => {
          const items = g.ids.map(section).filter(Boolean);
          return items.length ? (
            <div key={g.label} className="nav-block">
              <div className="nav-heading">{g.label}</div>
              {items}
            </div>
          ) : null;
        })}
        {q && !NAV_GROUPS.some((g) => g.ids.some((id) => sectionList(id).list.some(Boolean))) && <div className="nav-empty">Ничего не найдено</div>}
      </div>
      <nav className="nav-bottom">
        <NavItem icon="help" label="Справка" here={activeTab?.kind === 'help'} onClick={() => openTab('help')} />
        <NavItem icon="settings" label="Настройки" here={activeTab?.kind === 'settings'} onClick={() => openTab('settings')} />
      </nav>
    </aside>
  );
}
