// Навигатор слева: разделы программы сверху, список выбранного раздела ниже, справка и настройки внизу.
// Раздел открытой вкладки подсвечен — всегда видно, где находишься.

import { useRef, useState } from 'react';
import { arrowNav, pressable } from './ui';
import { SECTIONS, sectionOf } from '../nav';
import { DND_FORCE, DND_LIB } from '../pages/unit/model';
import {
  createFormation,
  createScenario,
  deleteBattles,
  newForceDialog,
  newRulesetDialog,
  openTab,
  updateSettings,
  useApp,
  type NavSection,
  type TabKind,
} from '../store';

function NavItem(props: { icon: string; label: string; count?: number; selected?: boolean; here?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className={`nav-item${props.selected ? ' selected' : ''}${props.here ? ' here' : ''}`} onClick={props.onClick} title={props.title}>
      <span className="nav-icon">{props.icon}</span>
      <span className="grow">{props.label}</span>
      {props.count !== undefined && <span className="nav-count">{props.count}</span>}
    </button>
  );
}

export function Navigator() {
  const s = useApp();
  const sec = s.settings.navSection ?? 'scenarios';
  const activeTab = s.tabs.find((t) => t.key === s.active);
  const here = sectionOf(activeTab);
  const [filters, setFilters] = useState<Partial<Record<NavSection, string>>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const q = (filters[sec] ?? '').trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const counts: Record<NavSection, number> = {
    scenarios: Object.keys(s.scenarios).length,
    forces: Object.keys(s.forces).length,
    units: Object.keys(s.formations).length,
    battles: Object.keys(s.battleIndex).length,
    rulesets: Object.keys(s.rulesets).length,
  };
  const meta = SECTIONS.find((x) => x.id === sec)!;
  const create = () =>
    sec === 'scenarios'
      ? createScenario()
      : sec === 'forces'
        ? void newForceDialog()
        : sec === 'units'
          ? createFormation()
          : sec === 'rulesets'
            ? void newRulesetDialog()
            : undefined;
  const isOpen = (kind: TabKind, ref: string) => activeTab?.ref === ref && activeTab.kind === kind;

  const row = (
    key: string,
    name: string,
    onOpen: (o: { background?: boolean; preview?: boolean }) => void,
    opts: { sub?: string; active?: boolean; dragLib?: string; dragForce?: string } = {},
  ) => (
    <div
      key={key}
      className={`side-item${opts.active ? ' active' : ''}`}
      title={
        opts.dragLib
          ? `${name}\nМожно перетащить в структуру шаблона или сил`
          : opts.dragForce
            ? `${name}\nМожно перетащить на сторону сценария`
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
      <span>{name}</span>
      {opts.sub && <span className="sub">{opts.sub}</span>}
    </div>
  );
  const group = (title: string, items: React.ReactNode[], onDelete?: () => void, deleteTitle?: string) =>
    items.length ? (
      <div key={`g:${title}`} className="nav-group">
        <div className="nav-group-title">
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

  let list: React.ReactNode;
  let empty = '';
  if (sec === 'scenarios') {
    const battlesBy = new Map<string, number>();
    for (const b of Object.values(s.battleIndex)) battlesBy.set(b.scenarioId, (battlesBy.get(b.scenarioId) ?? 0) + 1);
    const items = Object.values(s.scenarios)
      .filter((x) => match(x.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((x) =>
        row(x.id, x.name, (o) => openTab('scenario', x.id, o), {
          sub: battlesBy.get(x.id) ? `боёв: ${battlesBy.get(x.id)}` : undefined,
          active:
            (activeTab?.kind === 'scenario' || activeTab?.kind === 'montecarlo') && activeTab.ref === x.id ? true : !!activeTab?.ref?.startsWith(`sc:${x.id}:`),
        }),
      );
    list = items;
    empty = q ? 'Ничего не найдено' : 'Сценариев пока нет. Сценарий — это обстановка и две стороны с их подразделениями.';
  } else if (sec === 'units') {
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
    // Подразделения разных наборов правил — отдельными группами: видно, к какому набору относится каждое.
    list =
      rsIds.length > 1
        ? rsIds.map((id) => group(s.rulesets[id]?.name ?? 'Без набора правил', units.filter((u) => (u.rulesetId ?? '') === id).map(item)))
        : units.map(item);
    empty = q ? 'Ничего не найдено' : 'Шаблонов нет. Шаблон — устройство и штат подразделения: по нему создаются силы, из шаблонов собираются и более крупные.';
  } else if (sec === 'forces') {
    const units = Object.values(s.forces)
      .filter((x) => match(x.name) || match(x.faction ?? ''))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const factions = [...new Set(units.map((u) => u.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));
    const item = (x: (typeof units)[number]) =>
      row(x.id, x.name, (o) => openTab('formation', `force:${x.id}`, o), {
        sub: x.level,
        active: isOpen('formation', `force:${x.id}`),
        dragForce: x.id,
      });
    // Силы — по принадлежности: чьи это войска.
    list =
      factions.length > 1
        ? factions.map((f) => group(f || 'Без принадлежности', units.filter((u) => (u.faction?.trim() || '') === f).map(item)))
        : units.map(item);
    empty = q
      ? 'Ничего не найдено'
      : 'Сил пока нет. Силы — конкретные подразделения, созданные по шаблонам: у каждого своё состояние и свои потери после боёв.';
  } else if (sec === 'battles') {
    const battles = Object.values(s.battleIndex)
      .filter((x) => match(x.name))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const byScenario = new Map<string, typeof battles>();
    for (const b of battles) byScenario.set(b.scenarioId, [...(byScenario.get(b.scenarioId) ?? []), b]);
    list = [...byScenario.entries()].map(([scId, items]) => {
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
    empty = q ? 'Ничего не найдено' : 'Боёв пока нет. Бой начинается со страницы сценария — кнопка «▶ Начать бой».';
  } else {
    list = Object.values(s.rulesets)
      .filter((x) => match(x.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((x) => row(x.id, x.name, (o) => openTab('ruleset', x.id, o), { active: isOpen('ruleset', x.id) }));
    empty = q ? 'Ничего не найдено' : 'Наборов правил нет.';
  }
  const hasItems = Array.isArray(list) ? list.some(Boolean) : !!list;

  return (
    <aside className={`sidebar nav${s.settings.sidebar ? '' : ' hidden'}`}>
      <nav className="nav-sections">
        <NavItem icon="⌂" label="Главная" here={activeTab?.kind === 'home'} onClick={() => openTab('home')} />
        {SECTIONS.map((x) => (
          <NavItem
            key={x.id}
            icon={x.icon}
            label={x.label}
            count={counts[x.id]}
            selected={sec === x.id}
            here={here === x.id}
            onClick={() => updateSettings({ navSection: x.id })}
          />
        ))}
      </nav>
      <div className="nav-panel">
        <div className="nav-panel-head">{meta.label}</div>
        {meta.create && (
          <button type="button" className="nav-create" onClick={create}>
            + {meta.create}
          </button>
        )}
        {counts[sec] > 6 && (
          <div className="nav-filter">
            <input type="search" placeholder="Фильтр…" value={filters[sec] ?? ''} onChange={(e) => setFilters({ ...filters, [sec]: e.target.value })} />
          </div>
        )}
        <div className="nav-list" ref={listRef} onKeyDown={(e) => arrowNav(e, listRef.current, '.side-item')}>
          {hasItems ? list : <div className="nav-empty">{empty}</div>}
        </div>
      </div>
      <nav className="nav-bottom">
        <NavItem icon="?" label="Справка" here={activeTab?.kind === 'help'} onClick={() => openTab('help')} />
        <NavItem icon="⚙" label="Настройки" here={activeTab?.kind === 'settings'} onClick={() => openTab('settings')} />
      </nav>
    </aside>
  );
}
