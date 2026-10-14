// Конструктор подразделений: структура войск в виде оргсхемы или списка (с перетаскиванием),
// редактор выбранного подразделения, вставка из библиотеки (шаблоны), придание.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BEHAVIOR_LABELS,
  ECHELON_LABELS,
  KIND_LABELS,
  ROOT_RESOLVED,
  STATE_LABELS,
  cloneUnit,
  findParent,
  findUnit,
  insertUnit,
  isOutdated,
  moveUnit,
  newUnit,
  nextName,
  removeUnit,
  resolveTree,
  summarizeUnits,
  validateUnit,
  type ComponentKind,
  type DropPos,
  type Echelon,
  type Id,
  type Resolved,
  type Ruleset,
  type Scenario,
  type StateKey,
  type UnitNode,
} from '../../engine';
import { Link } from '../components/Link';
import { Area, Btn, Card, Check, Field, Info, Menu, Modal, Num, Range, Section, Sel, Seg, Tags, Txt, fmt0, fmt1, type MenuItem } from '../components/ui';
import { useTabState } from '../hooks';
import {
  addFormation,
  confirmDialog,
  containsTemplate,
  deleteFormation,
  duplicateFormation,
  exportJson,
  instantiateLibrary,
  openTab,
  promptDialog,
  resolveFormation,
  templateUsages,
  toast,
  updateAllCopies,
  updateCopy,
  updateFormationRef,
  updateScenario,
  useApp,
  type Tab,
} from '../store';

export const DND_NODE = 'application/x-warsim-unit';
export const DND_LIB = 'application/x-warsim-lib';

// ------------------------------------------------------------------ сводки по поддеревьям

export interface NodeStats {
  pers: number;
  persAuth: number;
  equip: number;
  equipList: Map<string, number>;
}

/** Люди и техника каждого узла вместе с подчинёнными (один проход снизу вверх). */
export function computeStats(root: UnitNode, rs: Ruleset): Map<Id, NodeStats> {
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const out = new Map<Id, NodeStats>();
  const go = (n: UnitNode): NodeStats => {
    const s: NodeStats = { pers: 0, persAuth: 0, equip: 0, equipList: new Map() };
    for (const c of n.composition) {
      const t = types.get(c.typeId);
      if (!t) continue;
      const crew = t.kind === 'personnel' ? 1 : t.crew;
      s.pers += c.current * crew;
      s.persAuth += c.authorized * crew;
      if (t.kind !== 'personnel') {
        s.equip += c.current;
        s.equipList.set(t.name, (s.equipList.get(t.name) ?? 0) + c.current);
      }
    }
    for (const ch of n.children) {
      const cs = go(ch);
      s.pers += cs.pers;
      s.persAuth += cs.persAuth;
      s.equip += cs.equip;
      for (const [k, v] of cs.equipList) s.equipList.set(k, (s.equipList.get(k) ?? 0) + v);
    }
    out.set(n.id, s);
    return s;
  };
  go(root);
  return out;
}

export function statsLine(s: NodeStats | undefined): string {
  if (!s) return '';
  return `${fmt0(s.pers)} чел.${s.equip ? ` · ${fmt0(s.equip)} ед.` : ''}`;
}

export function statsTip(s: NodeStats | undefined): string | undefined {
  if (!s || !s.equipList.size) return undefined;
  return [...s.equipList.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function riskOf(state: Resolved['state'], rs: Ruleset): { label: string; cls: string } {
  const k = rs.coefficients;
  const panicMult = rs.experienceLevels[state.experience - 1]?.effects.panic ?? 1;
  const m = state.morale / Math.max(0.3, panicMult);
  if (rs.features.panic && m < k.panicMorale) return { label: 'высокий: паника', cls: 'bad' };
  if (rs.features.retreat && m < k.retreatMorale) return { label: 'повышенный: отход', cls: 'warn' };
  if (m < k.retreatMorale + 15) return { label: 'умеренный', cls: 'warn' };
  return { label: 'низкий', cls: 'good' };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Сохранить подразделение (поддерево) в библиотеку как самостоятельный шаблон. */
function saveToLibrary(node: UnitNode, rs: Ruleset) {
  const c = cloneUnit(node);
  delete c.templateId;
  delete c.templateHash;
  delete c.srcNodeId;
  delete c.attachedFrom;
  c.rulesetId = rs.id;
  addFormation(c, false);
  toast(`«${c.name}» сохранено в библиотеку — его можно вставлять в другие подразделения.`, 'good');
}

// ------------------------------------------------------------------ контекст страницы

interface Ctx {
  root: UnitNode;
  rs: Ruleset;
  ref: string;
  isLib: boolean;
  lib: Record<Id, UnitNode>;
  scenario?: Scenario;
  sideIndex?: number;
  upd: (fn: (root: UnitNode) => void) => void;
  sel: Id;
  setSel: (id: Id) => void;
  resolved: Map<Id, Resolved>;
  stats: Map<Id, NodeStats>;
  collapsed: Set<Id>;
  toggle: (id: Id) => void;
  openInsert: (targetId: Id, attach: boolean) => void;
  drop: { id: Id; pos: DropPos } | null;
  setDrop: (d: { id: Id; pos: DropPos } | null) => void;
  onDrop: (e: React.DragEvent, targetId: Id, pos: DropPos) => void;
}

/** Подразделение библиотеки, которое сейчас редактируется (или из которого скопировано). */
function hostLibraryId(ctx: Ctx): Id | undefined {
  return ctx.isLib ? ctx.root.id : ctx.root.templateId;
}

/** Нельзя вставить шаблон в самого себя или в подразделение, которое он сам содержит. */
function canInsertTemplate(ctx: Ctx, templateId: Id): boolean {
  const host = hostLibraryId(ctx);
  const tpl = ctx.lib[templateId];
  if (!tpl) return false;
  if (!host) return true;
  return templateId !== host && !containsTemplate(tpl, host);
}

function nodeActions(ctx: Ctx, node: UnitNode): (MenuItem | 'sep' | false)[] {
  const isRoot = node.id === ctx.root.id;
  const parent = isRoot ? null : findParent(ctx.root, node.id);
  const idx = parent ? parent.children.findIndex((c) => c.id === node.id) : -1;
  const tpl = node.templateId ? ctx.lib[node.templateId] : undefined;
  const outdated = isOutdated(node, tpl);
  const un = (fn: (n: UnitNode) => void) => ctx.upd((d) => fn(findUnit(d, node.id)!));
  const levels = ctx.rs.unitLevels;
  const li = levels.indexOf(node.level);
  const childLevel = li > 0 ? levels[li - 1] : '';
  return [
    {
      label: 'Добавить подчинённое',
      onClick: () => {
        const ch = newUnit(`${cap(childLevel) || 'Подразделение'} ${node.children.length + 1}`, { level: childLevel });
        un((n) => void n.children.push(ch));
        ctx.setSel(ch.id);
      },
    },
    { label: 'Вставить из библиотеки…', onClick: () => ctx.openInsert(node.id, false), tip: 'Готовое подразделение из библиотеки как шаблон: взвод, роту, батарею…' },
    { label: 'Придать из библиотеки…', onClick: () => ctx.openInsert(node.id, true), tip: 'То же, но с отметкой «придано»' },
    'sep',
    !isRoot && {
      label: 'Размножить…',
      tip: 'Сделать несколько одинаковых подразделений с номерами по порядку',
      onClick: async () => {
        const v = await promptDialog('Сколько всего должно быть таких подразделений?', '3', `Будут созданы копии «${node.name}» с номерами по порядку.`);
        const n = Math.min(50, Math.round(Number(v)));
        if (!v || !Number.isFinite(n) || n < 2) return;
        ctx.upd((d) => {
          const p = findParent(d, node.id)!;
          const i = p.children.findIndex((c) => c.id === node.id);
          const copies = Array.from({ length: n - 1 }, (_, k) => {
            const c = cloneUnit(node);
            c.name = nextName(node.name, k + 1);
            return c;
          });
          p.children.splice(i + 1, 0, ...copies);
        });
      },
    },
    !isRoot && {
      label: 'Дублировать',
      onClick: () =>
        ctx.upd((d) => {
          const p = findParent(d, node.id)!;
          const c = cloneUnit(node);
          c.name = nextName(node.name, 1);
          p.children.splice(p.children.findIndex((x) => x.id === node.id) + 1, 0, c);
        }),
    },
    !isRoot && { label: 'Раньше в списке', disabled: idx <= 0, onClick: () => ctx.upd((d) => void moveUnit([d], node.id, parent!.children[idx - 1].id, 'before', true)) },
    !isRoot && { label: 'Позже в списке', disabled: !parent || idx >= parent.children.length - 1, onClick: () => ctx.upd((d) => void moveUnit([d], node.id, parent!.children[idx + 1].id, 'after', true)) },
    'sep',
    { label: 'Сохранить в библиотеку', tip: 'Чтобы вставлять это подразделение в другие как шаблон', onClick: () => saveToLibrary(node, ctx.rs) },
    !!tpl && outdated && { label: 'Обновить из шаблона', onClick: () => updateCopy(ctx.ref, node.id), tip: `Шаблон «${tpl.name}» изменён после вставки` },
    !!node.templateId &&
      !(ctx.isLib && isRoot) && {
        label: 'Отвязать от шаблона',
        tip: 'Подразделение перестанет отслеживать изменения шаблона',
        onClick: () =>
          un((n) => {
            delete n.templateId;
            delete n.templateHash;
          }),
      },
    !isRoot && node.attachedFrom !== undefined && { label: 'Снять отметку «придано»', onClick: () => un((n) => void delete n.attachedFrom) },
    !isRoot &&
      !ctx.isLib && {
        label: node.attachedFrom !== undefined ? 'Отделить (снова самостоятельное)' : 'Выделить в самостоятельное',
        tip: 'Станет отдельным подразделением этой стороны сценария',
        onClick: () => {
          const sc = ctx.scenario!;
          updateScenario(sc.id, (d) => {
            const side = d.sides[ctx.sideIndex!];
            const root = side.formations.find((f) => f.id === ctx.root.id);
            if (!root) return;
            const x = removeUnit(root.children, node.id);
            if (!x) return;
            delete x.attachedFrom;
            side.formations.push(x);
          });
          ctx.setSel(ctx.root.id);
          toast(`«${node.name}» — теперь самостоятельное подразделение стороны.`, 'good');
        },
      },
    'sep',
    !isRoot && {
      label: 'Удалить',
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog(`Удалить «${node.name}»${node.children.length ? ' со всеми подчинёнными' : ''}?`, undefined, 'Удалить', true))) return;
        ctx.upd((d) => void removeUnit(d.children, node.id));
        ctx.setSel(parent?.id ?? ctx.root.id);
      },
    },
  ];
}

// ------------------------------------------------------------------ перетаскивание

function dragStart(e: React.DragEvent, ref: string, id: Id) {
  e.stopPropagation();
  e.dataTransfer.setData(DND_NODE, JSON.stringify({ ref, id }));
  e.dataTransfer.effectAllowed = 'move';
}

function acceptsDrop(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(DND_NODE) || e.dataTransfer.types.includes(DND_LIB);
}

// ------------------------------------------------------------------ страница

export function FormationPage({ tab }: { tab: Tab }) {
  const ref = tab.ref!;
  const st = useApp();
  const res = resolveFormation(ref);
  const [selId, setSel] = useTabState<string>(`${tab.key}:sel`, res?.f.id ?? '');
  const [view, setView] = useTabState<'chart' | 'list'>('unit-view', 'chart');
  const [collapsedArr, setCollapsed] = useTabState<string[]>(`${tab.key}:collapsed`, []);
  const [insert, setInsert] = useState<{ id: Id; attach: boolean } | null>(null);
  const [drop, setDrop] = useState<{ id: Id; pos: DropPos } | null>(null);
  const root = res?.f;
  const rs = st.rulesets[res?.rulesetId ?? ''] ?? Object.values(st.rulesets)[0];
  const resolved = useMemo(() => (root ? resolveTree(root) : new Map<Id, Resolved>()), [root]);
  const stats = useMemo(() => (root && rs ? computeStats(root, rs) : new Map<Id, NodeStats>()), [root, rs]);
  if (!res || !root) return <div className="empty">Подразделение не найдено.</div>;
  if (!rs) return <div className="empty">Нет ни одного набора правил.</div>;
  const isLib = ref.startsWith('lib:');
  const collapsed = new Set(collapsedArr);

  const ctx: Ctx = {
    root,
    rs,
    ref,
    isLib,
    lib: st.formations,
    scenario: res.scenario,
    sideIndex: res.sideIndex,
    upd: (fn) => updateFormationRef(ref, fn),
    sel: findUnit(root, selId) ? selId : root.id,
    setSel,
    resolved,
    stats,
    collapsed,
    toggle: (id) => setCollapsed(collapsed.has(id) ? collapsedArr.filter((x) => x !== id) : [...collapsedArr, id]),
    openInsert: (id, attach) => setInsert({ id, attach }),
    drop,
    setDrop,
    onDrop: (e, targetId, posIn) => {
      e.preventDefault();
      e.stopPropagation();
      setDrop(null);
      const pos: DropPos = targetId === root.id ? 'inside' : posIn;
      const libId = e.dataTransfer.getData(DND_LIB);
      if (libId) {
        if (!canInsertTemplate(ctx, libId)) {
          toast('Нельзя вставить подразделение само в себя.', 'bad');
          return;
        }
        const copy = instantiateLibrary(libId);
        if (!copy) return;
        ctx.upd((d) => insertUnit([d], copy, targetId, pos));
        setSel(copy.id);
        return;
      }
      const raw = e.dataTransfer.getData(DND_NODE);
      if (!raw) return;
      const { ref: from, id } = JSON.parse(raw) as { ref: string; id: Id };
      if (from !== ref) return;
      ctx.upd((d) => {
        if (!moveUnit([d], id, targetId, pos, true)) toast('Так переместить нельзя: подразделение не может стать подчинённым самого себя.', 'bad');
      });
    },
  };
  const sel = findUnit(root, ctx.sel) ?? root;
  const issues = validateUnit(root, rs);
  const tpl = root.templateId ? st.formations[root.templateId] : undefined;
  const usages = isLib ? templateUsages(root.id) : [];
  const outdatedUsages = usages.filter((u) => u.outdated).length;

  return (
    <div className="page">
      {!isLib && (
        <div className="crumbs">
          В сценарии{' '}
          <Link kind="scenario" refId={res.scenario!.id}>
            «{res.scenario!.name}»
          </Link>{' '}
          · {res.scenario!.sides[res.sideIndex!].name}
        </div>
      )}
      <div className="page-head">
        <input className="title-input" value={root.name} onChange={(e) => ctx.upd((d) => void (d.name = e.target.value))} />
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Схема', title: 'Штатная схема блоками' },
            { value: 'list', label: 'Список', title: 'Компактное дерево' },
          ]}
        />
        <Menu
          items={[
            { label: 'Развернуть всё', onClick: () => setCollapsed([]) },
            'sep',
            ...(isLib
              ? [
                  { label: 'Дублировать', onClick: () => duplicateFormation(root.id) },
                  { label: 'Сохранить в файл…', onClick: () => exportJson('formation', root.name, root) },
                  'sep' as const,
                  { label: 'Удалить из библиотеки', danger: true, onClick: () => deleteFormation(root.id) },
                ]
              : [
                  !!tpl && { label: `Открыть в библиотеке «${tpl.name}»`, onClick: () => openTab('formation', `lib:${tpl.id}`) },
                  { label: 'Сохранить в библиотеку', onClick: () => saveToLibrary(root, rs) },
                ]),
          ]}
        />
      </div>

      <div className="meta" style={{ marginTop: -8, marginBottom: 14 }}>
        {!isLib && tpl && (
          <span>
            из библиотеки:{' '}
            <Link kind="formation" refId={`lib:${tpl.id}`}>
              {tpl.name}
            </Link>
            {isOutdated(root, tpl) && (
              <>
                {' '}
                — <span className="warn">изменено в библиотеке</span>{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), updateCopy(ref, root.id))}>
                  обновить
                </a>
              </>
            )}
          </span>
        )}
        {isLib && usages.length > 0 && (
          <span data-tip={[...new Set(usages.map((u) => u.owner))].join('\n')}>
            копий в других подразделениях и сценариях: <b>{usages.length}</b>
            {outdatedUsages > 0 && (
              <>
                {' '}
                · <span className="warn">отличаются от шаблона: {outdatedUsages}</span>{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), updateAllCopies(root.id))}>
                  обновить все
                </a>
              </>
            )}
          </span>
        )}
        {issues.length > 0 && (
          <span data-tip={issues.map((x) => `• ${x.text}`).join('\n')}>
            <span className="warn">⚠</span> замечаний: {issues.length}
          </span>
        )}
        <span className="faint">
          перетаскивайте подразделения мышью · из навигатора слева можно перетащить подразделение библиотеки
        </span>
      </div>

      {view === 'chart' ? (
        <div className="stack">
          <Card tight className="org-card">
            <OrgChart ctx={ctx} />
          </Card>
          <div className="grid align-start" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
            <NodeEditor key={sel.id} ctx={ctx} node={sel} />
            <SummaryCard node={sel} rs={rs} resolved={resolved} />
          </div>
        </div>
      ) : (
        <div className="split wide-left">
          <div className="stack">
            <Card tight>
              <TreeList ctx={ctx} />
            </Card>
            <SummaryCard node={sel} rs={rs} resolved={resolved} />
          </div>
          <NodeEditor key={sel.id} ctx={ctx} node={sel} />
        </div>
      )}
      {insert && <InsertDialog ctx={ctx} targetId={insert.id} attach={insert.attach} onClose={() => setInsert(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ значки узла

function NodeBadges({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const tpl = node.templateId ? ctx.lib[node.templateId] : undefined;
  const outdated = isOutdated(node, tpl);
  const isLibRoot = ctx.isLib && node.id === ctx.root.id;
  return (
    <>
      {node.isHQ && <span className="badge warn">штаб</span>}
      {node.attachedFrom !== undefined && (
        <span className="badge info" data-tip={node.attachedFrom ? `Придано из: ${node.attachedFrom}` : 'Придано'}>
          придано
        </span>
      )}
      {tpl && !isLibRoot && (
        <span className={`badge${outdated ? ' bad' : ''}`} data-tip={outdated ? `Шаблон «${tpl.name}» изменён — можно обновить` : `Из шаблона «${tpl.name}»`}>
          {outdated ? 'шаблон ⟳' : 'шаблон'}
        </span>
      )}
    </>
  );
}

// ------------------------------------------------------------------ оргсхема

function OrgChart({ ctx }: { ctx: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  // При открытии и смене выбора — показать выбранный блок (по умолчанию корень в центре).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.querySelector('.org-box.sel') as HTMLElement | null;
    if (!box) return;
    const cr = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    if (br.left < cr.left || br.right > cr.right || ctx.sel === ctx.root.id) el.scrollLeft += br.left + br.width / 2 - (cr.left + cr.width / 2);
    if (br.top < cr.top || br.bottom > cr.bottom) el.scrollTop += br.top - cr.top - 20;
  }, [ctx.sel]);
  return (
    <div className="org-scroll" ref={ref}>
      <div className="org">
        <ul>
          <OrgNode ctx={ctx} node={ctx.root} />
        </ul>
      </div>
    </div>
  );
}

function OrgBox({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const st = ctx.stats.get(node.id);
  const isRoot = node.id === ctx.root.id;
  const order = node.order ? ctx.rs.orders.find((o) => o.id === node.order)?.name : undefined;
  const isDrop = ctx.drop?.id === node.id;
  return (
    <div
      className={`org-box${ctx.sel === node.id ? ' sel' : ''}${isDrop ? ' drop-inside' : ''}${node.composition.length ? '' : ' group'}`}
      draggable={!isRoot}
      onDragStart={(e) => dragStart(e, ctx.ref, node.id)}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (ctx.drop?.id !== node.id) ctx.setDrop({ id: node.id, pos: 'inside' });
      }}
      onDragLeave={() => ctx.drop?.id === node.id && ctx.setDrop(null)}
      onDrop={(e) => ctx.onDrop(e, node.id, 'inside')}
      onClick={() => ctx.setSel(node.id)}
    >
      <div className="org-top">
        <span className="org-level">{node.level || '\u00a0'}</span>
        <span className="org-menu" onClick={(e) => e.stopPropagation()}>
          <Menu sm items={nodeActions(ctx, node)} />
        </span>
      </div>
      <div className="org-name">{node.name}</div>
      <div className="org-stats" data-tip={statsTip(st)}>
        {statsLine(st)}
        {order ? ` · ${order}` : ''}
      </div>
      <div className="org-badges">
        <NodeBadges ctx={ctx} node={node} />
      </div>
    </div>
  );
}

function OrgNode({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const folded = ctx.collapsed.has(node.id);
  // Подчинённые без своих подчинённых (взводы роты, отделения взвода) — столбиком: так схема не расползается вширь.
  // У корня столбик — только когда подчинённых много, иначе верхний уровень читается лучше в ряд.
  const n = node.children.length;
  const stack = n > 1 && node.children.every((c) => !c.children.length) && (node.id !== ctx.root.id || n > 10);
  return (
    <li>
      <OrgBox ctx={ctx} node={node} />
      {node.children.length > 0 && (
        <button className="org-fold" onClick={() => ctx.toggle(node.id)} title={folded ? 'Развернуть' : 'Свернуть'}>
          {folded ? `▸ ${node.children.length}` : '▾'}
        </button>
      )}
      {node.children.length > 0 &&
        !folded &&
        (stack ? (
          <div className="org-leaves">
            {node.children.map((c) => (
              <div key={c.id} className="org-leaf">
                <OrgBox ctx={ctx} node={c} />
              </div>
            ))}
          </div>
        ) : (
          <ul>
            {node.children.map((c) => (
              <OrgNode key={c.id} ctx={ctx} node={c} />
            ))}
          </ul>
        ))}
    </li>
  );
}

// ------------------------------------------------------------------ список

function TreeList({ ctx }: { ctx: Ctx }) {
  return (
    <div className="unit-tree">
      <TreeRow ctx={ctx} node={ctx.root} depth={0} />
    </div>
  );
}

function TreeRow({ ctx, node, depth }: { ctx: Ctx; node: UnitNode; depth: number }) {
  const st = ctx.stats.get(node.id);
  const isRoot = node.id === ctx.root.id;
  const folded = ctx.collapsed.has(node.id);
  const drop = ctx.drop?.id === node.id ? ctx.drop.pos : null;
  const r = ctx.resolved.get(node.id)!;
  const risk = node.composition.length ? riskOf(r.state, ctx.rs) : null;
  return (
    <>
      <div
        className={`unit-row${ctx.sel === node.id ? ' sel' : ''}${drop ? ` drop-${drop}` : ''}`}
        style={{ paddingLeft: 6 + depth * 18 }}
        draggable={!isRoot}
        onDragStart={(e) => dragStart(e, ctx.ref, node.id)}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = (e.clientY - rect.top) / rect.height;
          const pos: DropPos = isRoot ? 'inside' : y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
          if (ctx.drop?.id !== node.id || ctx.drop.pos !== pos) ctx.setDrop({ id: node.id, pos });
        }}
        onDragLeave={() => ctx.drop?.id === node.id && ctx.setDrop(null)}
        onDrop={(e) => ctx.onDrop(e, node.id, ctx.drop?.pos ?? 'inside')}
        onClick={() => ctx.setSel(node.id)}
      >
        <span
          className="unit-fold"
          onClick={(e) => {
            e.stopPropagation();
            if (node.children.length) ctx.toggle(node.id);
          }}
        >
          {node.children.length ? (folded ? '▸' : '▾') : ''}
        </span>
        {risk && <span className={`status-dot ${risk.cls}`} data-tip={`Риск паники и отхода: ${risk.label}`} />}
        <span className="unit-name">
          {node.level && <span className="faint">{node.level} · </span>}
          {node.name}
        </span>
        <NodeBadges ctx={ctx} node={node} />
        <span className="grow" />
        <span className="faint small nowrap" data-tip={statsTip(st)}>
          {statsLine(st)}
        </span>
        <span className="unit-menu" onClick={(e) => e.stopPropagation()}>
          <Menu sm items={nodeActions(ctx, node)} />
        </span>
      </div>
      {!folded && node.children.map((c) => <TreeRow key={c.id} ctx={ctx} node={c} depth={depth + 1} />)}
    </>
  );
}

// ------------------------------------------------------------------ сводка

function FireTable({ fire, rs }: { fire: Record<string, Record<string, number>>; rs: Ruleset }) {
  return (
    <table className="tbl compact">
      <thead>
        <tr>
          <th>По классу цели</th>
          {rs.rangeBands.map((b) => (
            <th key={b.id} className="num">
              {b.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rs.targetClasses.map((c) => (
          <tr key={c.id}>
            <td>{c.name}</td>
            {rs.rangeBands.map((b) => (
              <td key={b.id} className="num">
                {fmt1(fire[c.id]?.[b.id] ?? 0)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryCard({ node, rs, resolved }: { node: UnitNode; rs: Ruleset; resolved: Map<Id, Resolved> }) {
  const s = summarizeUnits([node], rs, resolved);
  const shortage = s.persAuth > 0 ? (1 - s.persCur / s.persAuth) * 100 : 0;
  return (
    <div className="stack">
      <Card title={node.children.length ? 'Сводка с подчинёнными' : 'Сводка'}>
        <div className="stat-row">
          <div className="stat">
            <span className="k">Личный состав</span>
            <span className="v">
              {fmt0(s.persCur)} <small>из {fmt0(s.persAuth)}</small>
            </span>
          </div>
          <div className="stat" data-tip="Сумма очков боевой ценности всех единиц">
            <span className="k">Ценность</span>
            <span className="v">{fmt0(s.value)}</span>
          </div>
          {rs.features.morale && s.combatUnits > 0 && (
            <div className="stat">
              <span className="k">Мораль</span>
              <span className="v">{Math.round(s.morale)}</span>
            </div>
          )}
        </div>
        <div className="faint small row" style={{ marginTop: 4, gap: 4 }}>
          в бою — элементов: {s.combatUnits}
          <Info text="Каждое подразделение с собственным составом сражается в бою как отдельный элемент: стреляет, несёт потери, может отступить." />
          {shortage >= 1 ? ` · некомплект ${fmt1(shortage)}%` : ''}
          {s.recoverable ? ` · раненых ${s.recoverable}` : ''}
        </div>
        {s.equip.length > 0 && (
          <table className="tbl compact" style={{ marginTop: 10 }}>
            <tbody>
              {s.equip.map((q) => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td className="num">
                    {q.cur} <span className="faint">из {q.auth}</span>
                    {q.rec ? <span className="faint"> (+{q.rec} в ремонте)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Section id="formation-fire" title="Огневая мощь" summary="за ход, без модификаторов" tight>
        <FireTable fire={s.fire} rs={rs} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ редактор подразделения

function InheritRange(props: { label: string; own: number | null | undefined; inherited: number; isRoot: boolean; onSet: (v: number) => void; onClear: () => void; hint?: string }) {
  const isOwn = props.own !== undefined && props.own !== null;
  return (
    <Field
      label={
        <>
          {props.label}
          {isOwn ? (
            <a href="#" className="small" onClick={(e) => (e.preventDefault(), props.onClear())} data-tip={props.isRoot ? 'Вернуть значение по умолчанию' : 'Брать значение у старшего'}>
              ↺
            </a>
          ) : (
            <span className="faint small">{props.isRoot ? '· по умолчанию' : '· как у старшего'}</span>
          )}
        </>
      }
      hint={props.hint}
    >
      <Range value={isOwn ? props.own! : props.inherited} onChange={props.onSet} />
    </Field>
  );
}

function NodeEditor({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const { rs } = ctx;
  const isRoot = node.id === ctx.root.id;
  const parent = isRoot ? null : findParent(ctx.root, node.id);
  const pr = parent ? ctx.resolved.get(parent.id)! : ROOT_RESOLVED;
  const ft = rs.features;
  const un = (fn: (n: UnitNode) => void) => ctx.upd((d) => fn(findUnit(d, node.id)!));
  const setState = (k: StateKey, v: number | undefined) =>
    un((n) => {
      if (v === undefined) delete n.state[k];
      else n.state[k] = v;
    });
  const inheritText = isRoot ? 'по умолчанию' : 'как у старшего';
  const orderName = (id: Id | null) => (id ? (rs.orders.find((o) => o.id === id)?.name ?? id) : (rs.orders.find((o) => o.behavior === 'defend')?.name ?? 'Оборона'));
  const expName = (lv: number) => `${lv}. ${rs.experienceLevels[lv - 1]?.name ?? ''}`;
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  let ownCur = 0;
  let ownAuth = 0;
  for (const c of node.composition) {
    const t = types.get(c.typeId);
    if (!t) continue;
    const crew = t.kind === 'personnel' ? 1 : t.crew;
    ownCur += c.current * crew;
    ownAuth += c.authorized * crew;
  }
  const showRecoverable = node.composition.some((c) => (c.recoverable ?? 0) > 0);
  const stateKeys = (['morale', 'cohesion', 'readiness', 'fatigue', 'ammo', 'fuel', 'equipment', 'vehicleCondition'] as StateKey[]).filter(
    (k) => (ft as unknown as Record<string, boolean>)[k] !== false,
  );
  const tpl = node.templateId ? ctx.lib[node.templateId] : undefined;
  const isLibRoot = ctx.isLib && isRoot;

  return (
    <div className="stack">
      <Card
        title={<input className="title-input" style={{ fontSize: 15, minWidth: 160, width: '100%' }} value={node.name} onChange={(e) => un((n) => void (n.name = e.target.value))} />}
        actions={<Menu sm items={nodeActions(ctx, node)} />}
      >
        {((tpl && !isLibRoot) || node.attachedFrom !== undefined) && (
          <div className="meta" style={{ marginBottom: 10 }}>
            {tpl && !isLibRoot && (
              <span>
                шаблон:{' '}
                <Link kind="formation" refId={`lib:${tpl.id}`}>
                  {tpl.name}
                </Link>
                {isOutdated(node, tpl) && (
                  <>
                    {' '}
                    — <span className="warn">изменён</span>{' '}
                    <a href="#" onClick={(e) => (e.preventDefault(), updateCopy(ctx.ref, node.id))}>
                      обновить
                    </a>
                  </>
                )}
              </span>
            )}
            {node.attachedFrom !== undefined && (
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                придано из
                <input value={node.attachedFrom} placeholder="откуда (необязательно)" onChange={(e) => un((n) => void (n.attachedFrom = e.target.value))} style={{ minHeight: 24, width: 200 }} />
              </span>
            )}
          </div>
        )}
        <div className="fields">
          <Field label="Уровень">
            <input list={`levels-${rs.id}`} value={node.level} placeholder="рота, взвод…" onChange={(e) => un((n) => void (n.level = e.target.value))} />
            <datalist id={`levels-${rs.id}`}>
              {rs.unitLevels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
          <Field label="Приказ">
            <Sel
              value={node.order ?? ''}
              onChange={(v) => un((n) => void (n.order = v || null))}
              options={[{ value: '', label: `${orderName(pr.order)} (${inheritText})` }, ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: BEHAVIOR_LABELS[o.behavior] }))]}
            />
          </Field>
          <Field label="Эшелон" hint="Насколько подразделение подставлено под прямой огонь.">
            <Sel
              value={node.echelon ?? ''}
              onChange={(v) => un((n) => void (n.echelon = (v || null) as Echelon | null))}
              options={[{ value: '', label: `${ECHELON_LABELS[pr.echelon]} (${inheritText})` }, ...(Object.keys(ECHELON_LABELS) as Echelon[]).map((k) => ({ value: k, label: ECHELON_LABELS[k] }))]}
            />
          </Field>
          <Field label="Командир">
            <Txt value={node.commanderName} onChange={(v) => un((n) => void (n.commanderName = v))} placeholder="звание, фамилия" />
          </Field>
          {ft.command && (
            <Field label="Уровень командира" hint="Командир влияет на подразделение и всех подчинённых; влияние старших командиров ослабевает с каждым уровнем.">
              <Sel
                value={node.commandLevel ?? 0}
                onChange={(v) => un((n) => void (n.commandLevel = v || null))}
                options={[{ value: 0, label: '— нет своего —' }, ...rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))]}
              />
            </Field>
          )}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 18 }}>
          <Check value={node.isHQ} onChange={(v) => un((n) => void (n.isHQ = v))} title="Потеря штаба лишает старшее подразделение командира и ухудшает связь">
            Штаб
          </Check>
          <Check value={node.holdFast} onChange={(v) => un((n) => void (n.holdFast = v))} title="Не отходит добровольно; шанс паники вдвое ниже">
            Стоять насмерть
          </Check>
          {!isRoot && node.attachedFrom === undefined && (
            <Check value={false} onChange={() => un((n) => void (n.attachedFrom = ''))} title="Отметить как приданное подразделение">
              Придано
            </Check>
          )}
        </div>
      </Card>

      <Card
        title={
          <>
            Собственный состав{' '}
            <Info text="Люди, вооружение и техника самого подразделения, без подчинённых. Подразделение с собственным составом сражается в бою как отдельный элемент; без состава — только управляет подчинёнными." />
          </>
        }
        actions={
          node.composition.length > 0 && (
            <span className="row" style={{ gap: 8 }}>
              <span className="muted small">
                {fmt0(ownCur)} из {fmt0(ownAuth)} чел.
              </span>
              <Btn sm kind="ghost" onClick={() => un((n) => n.composition.forEach((c) => (c.current = c.authorized)))}>
                До штата
              </Btn>
            </span>
          )
        }
        tight
      >
        {node.composition.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl comp-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th className="num">Штат</th>
                  <th className="num">В строю</th>
                  {showRecoverable && (
                    <th className="num" data-tip="Раненые (люди) или техника в ремонте — могут вернуться в строй">
                      Ран./ремонт
                    </th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {node.composition.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <Sel value={c.typeId} onChange={(v) => un((n) => void (n.composition[i].typeId = v))} options={rs.componentTypes.map((tt) => ({ value: tt.id, label: tt.name }))} />
                    </td>
                    <td className="num">
                      <Num value={c.authorized} onChange={(v) => un((n) => void (n.composition[i].authorized = v))} min={0} integer width={80} />
                    </td>
                    <td className="num">
                      <Num value={c.current} onChange={(v) => un((n) => void (n.composition[i].current = v))} min={0} integer width={80} />
                    </td>
                    {showRecoverable && (
                      <td className="num nowrap">
                        {c.recoverable ? (
                          <>
                            {c.recoverable}{' '}
                            <Btn
                              sm
                              kind="ghost"
                              title="Вернуть в строй"
                              onClick={() =>
                                un((n) => {
                                  const cc = n.composition[i];
                                  cc.current += cc.recoverable ?? 0;
                                  cc.recoverable = 0;
                                })
                              }
                            >
                              вернуть
                            </Btn>
                          </>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    )}
                    <td style={{ width: 30 }}>
                      <Btn sm kind="ghost" icon title="Убрать" onClick={() => un((n) => void n.composition.splice(i, 1))}>
                        ×
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '6px 14px 4px' }}>
          {types.size ? (
            <select
              value=""
              onChange={(ev) => {
                const id = ev.target.value;
                if (id) un((n) => void n.composition.push({ typeId: id, authorized: 10, current: 10 }));
              }}
            >
              <option value="">+ Добавить из каталога…</option>
              {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => (
                <optgroup key={k} label={KIND_LABELS[k]}>
                  {rs.componentTypes
                    .filter((t) => t.kind === k)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="muted">
              Каталог пуст — добавьте типы в{' '}
              <Link kind="ruleset" refId={rs.id} sub="types">
                наборе правил
              </Link>
              .
            </span>
          )}
        </div>
      </Card>

      <Card
        title={
          <>
            Состояние{' '}
            <Info text="Незаданное значение берётся у старшего подразделения — так можно задать мораль или опыт целому батальону и уточнить только отдельные роты. Значок ↺ возвращает наследование." />
          </>
        }
      >
        <div className="fields two">
          <Field label={<>Опыт{node.state.experience === undefined && <span className="faint small">· {inheritText}</span>}</>}>
            <Sel
              value={node.state.experience ?? 0}
              onChange={(v) => setState('experience', v || undefined)}
              options={[{ value: 0, label: `${expName(pr.state.experience)} (${inheritText})` }, ...rs.experienceLevels.map((_, i) => ({ value: i + 1, label: expName(i + 1) }))]}
            />
          </Field>
          {stateKeys.map((k) => (
            <InheritRange
              key={k}
              label={`${STATE_LABELS[k]}${k === 'morale' || k === 'cohesion' || k === 'readiness' ? '' : ', %'}`}
              own={node.state[k]}
              inherited={pr.state[k]}
              isRoot={isRoot}
              onSet={(v) => setState(k, v)}
              onClear={() => setState(k, undefined)}
            />
          ))}
          {ft.comms && (
            <InheritRange label="Связь, %" own={node.comms} inherited={pr.comms} isRoot={isRoot} onSet={(v) => un((n) => void (n.comms = v))} onClear={() => un((n) => void (n.comms = null))} />
          )}
          <InheritRange
            label="Снабжение, %"
            own={node.supply}
            inherited={pr.supply}
            isRoot={isRoot}
            onSet={(v) => un((n) => void (n.supply = v))}
            onClear={() => un((n) => void (n.supply = null))}
            hint="Скорость подвоза боезапаса и топлива во время боя."
          />
        </div>
      </Card>

      <Section
        id="unit-extra"
        title="Дополнительно"
        summary={[node.attackMod !== 100 && `атака ${node.attackMod}%`, node.defenseMod !== 100 && `защита ${node.defenseMod}%`, ...node.tags].filter(Boolean).join(', ') || 'атака и защита, теги, заметки'}
      >
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <Field label="Атака, %" hint="100% — как в каталоге. Особое вооружение, выучка, тактика.">
              <Num value={node.attackMod} onChange={(v) => un((n) => void (n.attackMod = v))} min={0} />
            </Field>
            <Field label="Защита, %">
              <Num value={node.defenseMod} onChange={(v) => un((n) => void (n.defenseMod = v))} min={1} />
            </Field>
          </div>
          <Field label="Теги" hint={`Используются в своих правилах. Тег «${rs.reconTag}» делает подразделение разведчиком.`}>
            <Tags value={node.tags} onChange={(v) => un((n) => void (n.tags = v))} suggestions={[...new Set(rs.componentTypes.flatMap((t) => t.tags).concat(rs.reconTag ? [rs.reconTag] : []))]} />
          </Field>
          <Area value={node.notes ?? ''} onChange={(v) => un((n) => void (n.notes = v))} rows={2} placeholder="Заметки" />
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ вставка из библиотеки

function InsertDialog({ ctx, targetId, attach, onClose }: { ctx: Ctx; targetId: Id; attach: boolean; onClose: () => void }) {
  const target = findUnit(ctx.root, targetId);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Id | null>(null);
  const [count, setCount] = useState(1);
  const [att, setAtt] = useState(attach);
  const [from, setFrom] = useState('');
  const items = Object.values(ctx.lib)
    .filter((u) => (!u.rulesetId || u.rulesetId === ctx.rs.id) && canInsertTemplate(ctx, u.id))
    .filter((u) => !q || `${u.name} ${u.level}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const doInsert = (id: Id | null = pick) => {
    const tpl = id ? ctx.lib[id] : undefined;
    if (!tpl || !target) return;
    const numbered = /^\d/.test(tpl.name);
    const copies = Array.from({ length: count }, (_, i) => {
      // «1-й взвод» → «1-й», «2-й»…; «Взвод» → «Взвод 1», «Взвод 2»…
      const name = count > 1 ? (numbered ? nextName(tpl.name, i) : `${tpl.name} ${i + 1}`) : undefined;
      return instantiateLibrary(tpl.id, { attachedFrom: att ? from.trim() : undefined, name })!;
    });
    ctx.upd((d) => void findUnit(d, targetId)!.children.push(...copies));
    ctx.setSel(copies[0].id);
    onClose();
  };
  return (
    <Modal
      title={`${attach ? 'Придать' : 'Вставить'} в «${target?.name ?? ''}»`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="row" style={{ gap: 6 }}>
            <span className="muted small">Количество</span>
            <Num value={count} onChange={setCount} min={1} max={50} integer width={70} />
          </span>
          <Check value={att} onChange={setAtt} title="Отметить как приданное подразделение">
            придано
          </Check>
          {att && <input value={from} placeholder="откуда (необязательно)" onChange={(e) => setFrom(e.target.value)} style={{ width: 200 }} />}
          <div className="grow" />
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!pick} onClick={() => doInsert()}>
            {count > 1 ? `Вставить ×${count}` : 'Вставить'}
          </Btn>
        </>
      }
    >
      <input type="search" autoFocus placeholder="Поиск по библиотеке…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      <div className="insert-list">
        {items.map((u) => {
          const s = summarizeUnits([u], ctx.rs);
          return (
            <div key={u.id} className={`insert-item${pick === u.id ? ' sel' : ''}`} onClick={() => setPick(u.id)} onDoubleClick={() => doInsert(u.id)}>
              <span className="grow">
                {u.level && <span className="faint">{u.level} · </span>}
                {u.name}
              </span>
              <span className="faint small nowrap">
                {fmt0(s.persCur)} чел.{u.children.length ? ` · подчинённых: ${u.children.length}` : ''}
              </span>
            </div>
          );
        })}
        {!items.length && <div className="empty">Подходящих подразделений в библиотеке нет. Соберите взвод или роту и сохраните в библиотеку через меню «⋯».</div>}
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        Копия помнит свой шаблон: если позже изменить шаблон в библиотеке, копию можно обновить, не теряя её потерь и состояния.
      </p>
    </Modal>
  );
}
