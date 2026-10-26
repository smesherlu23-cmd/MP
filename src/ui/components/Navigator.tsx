// Боковая панель (как в Finder): разделы деревом в порядке работы (игра, подготовка). Поиск и «Создать» —
// в панели инструментов окна. Каждый раздел разворачивается на месте; щелчок по названию раздела открывает
// его каталог. Раздел открытой страницы подсвечен — всегда видно, где находишься.

import { useRef, useState } from 'react';
import { cloneUnit, findUnit, toTemplate } from '../../engine';
import { Icon, type IconName } from './Icon';
import { RenameInput, arrowNav, openContextMenu } from './ui';
import {
  DND_OBJ,
  OBJ_ICON,
  openObj,
  objFromKey,
  objKey,
  objKeys,
  objMenu,
  objName,
  placeFavorite,
  renameObj,
  startRename,
  stopRename,
  useObjDrag,
  useRenaming,
  type Obj,
} from '../objects';

/** Сколько объектов раздела видно в навигаторе без фильтра (остальные — в каталоге). */
const NAV_LIMIT = 6;
import { NAV_GROUPS, isNavOpen, sectionMeta, sectionOf, setNavOpen, showSection, useNavFilter } from '../nav';
import { LEVEL_LABEL } from './ForceCampaign';
import { DND_FORCE, DND_LIB, DND_NODE } from '../pages/unit/model';
import {
  containsTemplate,
  createFormation,
  createScenario,
  deleteBattles,
  toast,
  toastUndoable,
  transferPart,
  updateFormation,
  forceStatus,
  teamColor,
  importFile,
  newForceDialog,
  newRulesetDialog,
  openTab,
  useApp,
  type NavSection,
  type TabKind,
  updateSettings,
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

/** Пункты меню «+» (создать) — в панели инструментов и на главной. */
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
  const filter = useNavFilter((x) => x.q);
  const listRef = useRef<HTMLDivElement>(null);
  const rename = useRenaming();
  const dragging = useObjDrag((x) => x.on);
  const [over, setOver] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const counts: Record<NavSection, number> = {
    scenarios: Object.keys(s.scenarios).length,
    forces: Object.keys(s.forces).length,
    units: Object.keys(s.formations).length,
    battles: Object.keys(s.battleIndex).length,
    rulesets: Object.keys(s.rulesets).length,
  };
  const isOpen = (kind: TabKind, ref: string) => activeTab?.ref === ref && activeTab.kind === kind;

  /**
   * Подразделение со страницы шаблона или сил можно бросить на строку в боковой панели: на силы — передать
   * часть им (как «Передать…»), на шаблон — добавить в него копию.
   */
  const dropTarget = (o: Obj) => {
    if (o.kind !== 'force' && o.kind !== 'template') return undefined;
    return (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DND_NODE);
      if (!raw) return;
      const x = JSON.parse(raw) as { ref?: string; id?: string };
      const [scope, rootId] = (x.ref ?? '').split(':');
      const root = scope === 'force' ? s.forces[rootId] : scope === 'lib' ? s.formations[rootId] : undefined;
      const node = root && x.id ? findUnit(root, x.id) : null;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      if (o.kind === 'force') {
        if (scope !== 'force') return toast('В силы передаются только части других сил. Шаблон вставляется на странице сил.', 'bad');
        transferPart(node.id, o.id);
        return;
      }
      if (scope === 'lib' && rootId === o.id) return;
      const copy = toTemplate(cloneUnit(node));
      if (containsTemplate(copy, o.id)) return toast('Нельзя вставить шаблон сам в себя.', 'bad');
      updateFormation(o.id, (d) => void d.children.push(copy));
      toastUndoable(`Копия «${node.name}» добавлена в шаблон «${objName(o)}».`);
    };
  };

  const row = (
    key: string,
    name: string,
    onOpen: () => void,
    opts: {
      obj?: Obj;
      icon?: IconName;
      sub?: string;
      hint?: string;
      active?: boolean;
      dragLib?: string;
      dragForce?: string;
      color?: string;
      warn?: { cls: string; text: string };
      /** Строка избранного: перетаскивается внутри избранного, меню — с «Убрать из избранного». */
      fav?: boolean;
    } = {},
  ) => {
    const ok = opts.obj ? objKey(opts.obj) : undefined;
    const renaming = !!ok && rename.key === ok && rename.where === 'side' && rename.row === key;
    const target = opts.obj && dropTarget(opts.obj);
    const tip = renaming
      ? undefined
      : opts.dragLib
        ? `${name}\nМожно перетащить в структуру шаблона или сил`
        : opts.dragForce
          ? `${name}${opts.warn ? ` — ${opts.warn.text.toLowerCase()}` : ''}\nМожно перетащить на сторону сценария`
          : opts.sub || opts.hint || opts.warn
            ? [name, opts.sub, opts.hint, opts.warn?.text].filter(Boolean).join('\n')
            : name;
    return (
      // biome-ignore lint/a11y/useSemanticElements: строка списка с вложенным полем переименования — не <button>
      <div
        key={key}
        role="button"
        tabIndex={0}
        data-obj={ok}
        data-row={key}
        className={`side-item${opts.active ? ' active' : ''}${over === `${key}:${opts.fav ? 'f' : ''}` ? ' drop-inside' : ''}`}
        title={tip}
        draggable={!renaming && !!(opts.obj || opts.dragLib || opts.dragForce)}
        onDragStart={(e) => {
          if (opts.dragLib) e.dataTransfer.setData(DND_LIB, opts.dragLib);
          else if (opts.dragForce) e.dataTransfer.setData(DND_FORCE, opts.dragForce);
          if (ok) e.dataTransfer.setData(DND_OBJ, ok);
          e.dataTransfer.effectAllowed = 'copyMove';
          useObjDrag.setState({ on: true });
        }}
        onDragEnd={() => useObjDrag.setState({ on: false })}
        onDragOver={(e) => {
          const fav = opts.fav && e.dataTransfer.types.includes(DND_OBJ);
          if (!fav && !(target && e.dataTransfer.types.includes(DND_NODE))) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(`${key}:${opts.fav ? 'f' : ''}`);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          setOver(null);
          useObjDrag.setState({ on: false });
          const k = e.dataTransfer.getData(DND_OBJ);
          if (opts.fav && k && ok) {
            e.preventDefault();
            e.stopPropagation();
            if (k !== ok) placeFavorite(k, ok);
            return;
          }
          if (target) target(e);
        }}
        onClick={() => !renaming && onOpen()}
        onDoubleClick={() => opts.obj && startRename(opts.obj, { where: 'side', row: key })}
        onKeyDown={(e) => {
          if (renaming) return;
          if (opts.obj) objKeys(opts.obj, e, key);
          else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen();
          }
        }}
        onContextMenu={(e) => opts.obj && openContextMenu(e, objMenu(opts.obj, { row: key }))}
      >
        {opts.icon && (
          <span className="side-icon">
            <Icon name={opts.icon} size={15} />
          </span>
        )}
        {opts.color && <span className="team-dot sm" style={{ background: opts.color }} aria-hidden />}
        {renaming && opts.obj ? (
          <RenameInput
            value={objName(opts.obj) ?? name}
            onDone={(v) => {
              stopRename();
              if (v !== null && opts.obj) renameObj(opts.obj, v);
            }}
          />
        ) : (
          <span>{name}</span>
        )}
        {opts.sub && !renaming && <span className="sub">{opts.sub}</span>}
        {opts.warn && (
          <span className={`side-warn ${opts.warn.cls}`} aria-hidden>
            <Icon name="alert" size={13} />
          </span>
        )}
      </div>
    );
  };
  const group = (title: string, items: React.ReactNode[], onDelete?: () => void, deleteTitle?: string, color?: string, onOpen?: () => void) =>
    items.length ? (
      <div key={`g:${title}`} className="nav-group">
        <div className="nav-group-title">
          {color && <span className="team-dot sm" style={{ background: color }} aria-hidden />}
          {onOpen ? (
            <button type="button" className="grow nav-group-link" onClick={onOpen} title={`Страница команды «${title}»`}>
              {title}
            </button>
          ) : (
            <span className="grow">{title}</span>
          )}
          {onDelete && (
            <button type="button" className="nav-group-del" onClick={onDelete} title={deleteTitle}>
              ×
            </button>
          )}
        </div>
        {items}
      </div>
    ) : null;

  /**
   * Длинный раздел (без фильтра) показывает недавно изменённые и открытое сейчас; остальное — в каталоге
   * раздела по ссылке «Ещё N». Порядок показанных — прежний.
   */
  const capped = <T extends { id: string; updatedAt?: string }>(items: T[], active: (x: T) => boolean): { shown: T[]; hidden: number } => {
    if (q || items.length <= NAV_LIMIT + 2) return { shown: items, hidden: 0 };
    const keep = new Set(
      [...items]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, NAV_LIMIT)
        .map((x) => x.id),
    );
    for (const x of items) if (active(x)) keep.add(x.id);
    const shown = items.filter((x) => keep.has(x.id));
    return { shown, hidden: items.length - shown.length };
  };
  const more = (sec: NavSection, hidden: number) =>
    hidden > 0 ? (
      <button key="more" type="button" className="nav-more" onClick={() => showSection(sec)} title="Открыть каталог раздела — там все, с поиском">
        ещё {hidden} — все в каталоге →
      </button>
    ) : null;

  /** Список раздела и подпись для пустого списка. */
  const sectionList = (sec: NavSection): { list: React.ReactNode[]; empty: string } => {
    if (sec === 'scenarios') {
      const battlesBy = new Map<string, number>();
      for (const b of Object.values(s.battleIndex)) battlesBy.set(b.scenarioId, (battlesBy.get(b.scenarioId) ?? 0) + 1);
      const all = Object.values(s.scenarios)
        .filter((x) => match(x.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const { shown, hidden } = capped(all, (x) => activeTab?.ref === x.id || !!activeTab?.ref?.startsWith(`sc:${x.id}:`));
      const list = shown.map((x) =>
        row(x.id, x.name, () => openTab('scenario', x.id), {
          obj: { kind: 'scenario', id: x.id },
          // Число боёв — в подсказке: справа от названия подпись только обрезала бы его.
          hint: battlesBy.get(x.id) ? `боёв: ${battlesBy.get(x.id)}` : undefined,
          active:
            (activeTab?.kind === 'scenario' || activeTab?.kind === 'montecarlo') && activeTab.ref === x.id ? true : !!activeTab?.ref?.startsWith(`sc:${x.id}:`),
        }),
      );
      return { list: [...list, more(sec, hidden)], empty: 'Сценариев пока нет.' };
    }
    if (sec === 'units') {
      const { shown: units, hidden } = capped(
        Object.values(s.formations)
          .filter((x) => match(x.name))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        (x) => isOpen('formation', `lib:${x.id}`),
      );
      const rsIds = [...new Set(units.map((u) => u.rulesetId ?? ''))];
      const item = (x: (typeof units)[number]) =>
        row(x.id, x.name, () => openTab('formation', `lib:${x.id}`), {
          obj: { kind: 'template', id: x.id },
          sub: x.level,
          active: isOpen('formation', `lib:${x.id}`),
          dragLib: x.id,
        });
      // Шаблоны разных наборов правил — отдельными группами: видно, к какому набору относится каждый.
      const list =
        rsIds.length > 1
          ? rsIds.map((id) => group(s.rulesets[id]?.name ?? 'Без набора правил', units.filter((u) => (u.rulesetId ?? '') === id).map(item)))
          : units.map(item);
      return { list: [...list, more(sec, hidden)], empty: 'Шаблонов нет.' };
    }
    if (sec === 'forces') {
      const { shown: units, hidden } = capped(
        Object.values(s.forces)
          .filter((x) => match(x.name) || match(x.faction ?? ''))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        (x) => isOpen('formation', `force:${x.id}`),
      );
      const factions = [...new Set(units.map((u) => u.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));
      const item = (x: (typeof units)[number]) =>
        row(x.id, x.name, () => openTab('formation', `force:${x.id}`), {
          obj: { kind: 'force', id: x.id },
          sub: x.level,
          active: isOpen('formation', `force:${x.id}`),
          dragForce: x.id,
          color: teamColor(x.faction ?? ''),
          warn: ((l) => (l === 'ready' ? undefined : LEVEL_LABEL[l]))(forceStatus(x).level),
        });
      // Силы — по командам: чьи это войска; у команды свой цвет.
      const list =
        factions.length > 1
          ? factions.map((f) =>
              group(f || 'Без команды', units.filter((u) => (u.faction?.trim() || '') === f).map(item), undefined, undefined, teamColor(f), () =>
                openTab('team', f || undefined),
              ),
            )
          : units.map(item);
      return { list: [...list, more(sec, hidden)], empty: 'Сил пока нет.' };
    }
    if (sec === 'battles') {
      const { shown: battles, hidden } = capped(
        Object.values(s.battleIndex)
          .filter((x) => match(x.name))
          .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
        (x) => isOpen('battle', x.id),
      );
      const byScenario = new Map<string, typeof battles>();
      for (const b of battles) byScenario.set(b.scenarioId, [...(byScenario.get(b.scenarioId) ?? []), b]);
      const list = [...byScenario.entries()].map(([scId, items]) => {
        const scName = s.scenarios[scId]?.name ?? items[0].name.split(' · ')[0];
        return group(
          scName,
          items.map((b) =>
            row(b.id, b.name.startsWith(`${scName} · `) ? b.name.slice(scName.length + 3) : b.name, () => openTab('battle', b.id), {
              obj: { kind: 'battle', id: b.id },
              sub: b.finished ? (b.headline ?? 'итог') : `ход ${b.turn}`,
              active: isOpen('battle', b.id),
              warn: b.unrecorded ? { cls: 'warn', text: 'Итоги не записаны в силы' } : undefined,
            }),
          ),
          () => deleteBattles(items.map((b) => b.id)),
          `Удалить все бои этого сценария (${items.length})`,
        );
      });
      return { list: [...list, more(sec, hidden)], empty: 'Боёв пока нет. Бой начинается со страницы сценария.' };
    }
    const list = Object.values(s.rulesets)
      .filter((x) => match(x.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((x) => row(x.id, x.name, () => openTab('ruleset', x.id), { obj: { kind: 'ruleset', id: x.id }, active: isOpen('ruleset', x.id) }));
    return { list, empty: 'Наборов правил нет.' };
  };

  /** Строка избранного или недавних: со значком раздела. */
  const objRow = (k: string, where: 'fav' | 'rec') => {
    const o = objFromKey(k)!;
    return row(`${where}:${k}`, objName(o) ?? '', () => openObj(o), { obj: o, icon: OBJ_ICON[o.kind], active: s.active === k, fav: where === 'fav' });
  };
  const alive = (k: string) => {
    const o = objFromKey(k);
    return !!o && objName(o) !== undefined;
  };
  const favKeys = (s.settings.favorites ?? []).filter(alive);
  const recentKeys = (s.settings.recent ?? []).filter(alive).slice(0, 5);
  const recentOpen = !!s.settings.navRecent;

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
    <div className="sidebar nav">
      <div className="nav-scroll" ref={listRef} onKeyDown={(e) => arrowNav(e, listRef.current, '.side-item')}>
        <div className="nav-home">
          <NavItem icon="home" label="Главное" here={activeTab?.kind === 'home'} onClick={() => openTab('home')} title="Что продолжить, с чего начать" />
        </div>
        {!q && (favKeys.length > 0 || dragging) && (
          // biome-ignore lint/a11y/noStaticElementInteractions: место, куда бросают объект, чтобы добавить его в избранное
          <div
            className={`nav-block nav-favs${over === 'favs' ? ' drop-over' : ''}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DND_OBJ)) return;
              e.preventDefault();
              setOver('favs');
            }}
            onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
            onDrop={(e) => {
              setOver(null);
              useObjDrag.setState({ on: false });
              const k = e.dataTransfer.getData(DND_OBJ);
              if (!k) return;
              e.preventDefault();
              placeFavorite(k, null);
            }}
          >
            <div className="nav-heading">Избранное</div>
            {favKeys.map((k) => objRow(k, 'fav'))}
            {!favKeys.length && <div className="nav-empty nav-drop-hint">Перетащите сюда, чтобы закрепить</div>}
          </div>
        )}
        {NAV_GROUPS.map((g) => {
          const items = g.ids.map(section).filter(Boolean);
          return items.length ? (
            <div key={g.label} className="nav-block">
              <div className="nav-heading">{g.label}</div>
              {items}
            </div>
          ) : null;
        })}
        {/* Недавние — под разделами: появляясь, они не сдвигают строки, по которым щёлкают. */}
        {!q && recentKeys.length > 0 && (
          <div className={`nav-block nav-sec nav-recent${recentOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="nav-heading nav-heading-btn"
              aria-expanded={recentOpen}
              onClick={() => updateSettings({ navRecent: !recentOpen })}
              title={recentOpen ? 'Свернуть' : 'Недавно открытые'}
            >
              Недавние
              <span className="nav-chev">
                <Icon name="right" size={12} />
              </span>
            </button>
            {recentOpen && <div className="nav-list flat">{recentKeys.map((k) => objRow(k, 'rec'))}</div>}
          </div>
        )}
        {q && !NAV_GROUPS.some((g) => g.ids.some((id) => sectionList(id).list.some(Boolean))) && <div className="nav-empty">Ничего не найдено</div>}
      </div>
      <nav className="nav-bottom">
        <NavItem icon="help" label="Справка" here={activeTab?.kind === 'help'} onClick={() => openTab('help')} />
        <NavItem icon="settings" label="Настройки" here={activeTab?.kind === 'settings'} onClick={() => openTab('settings')} />
      </nav>
    </div>
  );
}
