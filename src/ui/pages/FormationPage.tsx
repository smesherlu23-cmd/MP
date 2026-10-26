// Конструктор подразделений — один для шаблонов и сил. Шаблон: устройство и штат (без приказов и
// состояния). Силы: конкретное подразделение по шаблону — со своим состоянием, потерями, принадлежностью.
// Оргсхема или список (с перетаскиванием), редактор выбранного узла, вставка из шаблонов, придание.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findUnit,
  insertUnit,
  isOutdated,
  moveUnit,
  pathTo,
  remapTypes,
  resolveTree,
  transferFromRuleset,
  usedTypeIds,
  validateUnit,
  type DropPos,
  type Id,
  type Resolved,
} from '../../engine';
import { Crumbs } from '../components/Crumbs';
import { Link } from '../components/Link';
import { TypeMapModal } from '../components/RulesetTransfer';
import { ForceHistory } from '../components/ForceCampaign';
import { Card, Info, Menu, Seg, ToolbarSlot } from '../components/ui';
import { openUnit, useTabState } from '../hooks';
import {
  defaultRulesetId,
  deleteFormation,
  duplicateFormation,
  exportJson,
  historyStep,
  instantiateLibrary,
  openTab,
  promptDialog,
  replaceRuleset,
  resolveFormation,
  templateUsages,
  toast,
  updateAllCopies,
  updateCopy,
  updateFormationRef,
  useApp,
  createForcesFromTemplate,
  deleteForce,
  duplicateForce,
  forceUsage,
  restoreForces,
  teamColor,
  type Tab,
} from '../store';
import {
  type Ctx,
  DND_LIB,
  DND_NODE,
  KEYS_HELP,
  type NodeStats,
  canInsertTemplate,
  computeStats,
  initialCollapsed,
  saveAsTemplate,
  treeKey,
} from './unit/model';
import { EmptyStart, OrgChart, TreeList } from './unit/OrgChart';
import { InsertDialog, NodeEditor } from './unit/NodeEditor';
import { TransferDialog } from '../components/TransferDialog';
import { SummaryCard } from './unit/Summary';
import { ForceReadiness } from './ForcesPage';

export function FormationPage({ tab }: { tab: Tab }) {
  const ref = tab.ref!;
  const st = useApp();
  const res = resolveFormation(ref);
  const [selId, setSel] = useTabState<string>(`${tab.key}:sel`, res?.f.id ?? '');
  const [view, setView] = useTabState<'chart' | 'list'>('unit-view', 'chart');
  const [collapsedArr, setCollapsed] = useTabState<string[]>(`${tab.key}:collapsed`, res ? initialCollapsed(res.f) : []);
  const [insert, setInsert] = useState<{ id: Id; attach: boolean } | null>(null);
  const [transfer, setTransfer] = useState<Id | null>(null);
  const [drop, setDrop] = useState<{ id: Id; pos: DropPos } | null>(null);
  const [typeMap, setTypeMap] = useState<{ to: Id; ids: Id[] } | null>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctx = ctxRef.current;
      if (!ctx || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('.backdrop, .menu-pop')) return;
      // Enter и пробел на кнопке или ссылке — их собственное действие.
      if ((e.key === 'Enter' || e.key === ' ') && t.closest('button, a')) return;
      if (treeKey(ctx, e, viewRef.current)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const root = res?.f;
  const rs = st.rulesets[res?.rulesetId ?? ''] ?? st.rulesets[defaultRulesetId() ?? ''] ?? Object.values(st.rulesets)[0];
  const resolved = useMemo(() => (root ? resolveTree(root) : new Map<Id, Resolved>()), [root]);
  const stats = useMemo(() => (root && rs ? computeStats(root, rs) : new Map<Id, NodeStats>()), [root, rs]);
  if (!res || !root) return <div className="empty">Подразделение не найдено.</div>;
  if (!rs) return <div className="empty">Нет ни одного набора правил.</div>;
  const isLib = ref.startsWith('lib:');
  const selValid = findUnit(root, selId) ? selId : root.id;
  // Старшие выбранного узла всегда развёрнуты: выбранное видно, даже если открыто из поиска.
  const selPath = new Set(pathTo(root, selValid).map((n) => n.id));
  const collapsed = new Set(collapsedArr.filter((id) => id === selValid || !selPath.has(id)));

  const ctx: Ctx = {
    root,
    rs,
    ref,
    isLib,
    lib: st.formations,
    upd: (fn) => updateFormationRef(ref, fn),
    sel: selValid,
    setSel,
    resolved,
    stats,
    collapsed,
    toggle: (id) => {
      if (collapsed.has(id)) return setCollapsed(collapsedArr.filter((x) => x !== id));
      if (selPath.has(id)) setSel(id);
      setCollapsed([...collapsedArr.filter((x) => x !== id), id]);
    },
    openInsert: (id, attach) => setInsert({ id, attach }),
    openTransfer: isLib ? undefined : setTransfer,
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
  ctxRef.current = ctx;
  const changeRuleset = (id: Id) => {
    const nr = st.rulesets[id];
    if (!nr || id === rs.id) return;
    const known = new Set(nr.componentTypes.map((t) => t.id));
    const missing = usedTypeIds(root).filter((t) => !known.has(t));
    // Типов нет в новом наборе — сопоставить: заменить, добавить в набор или убрать.
    if (missing.length) return setTypeMap({ to: id, ids: missing });
    ctx.upd((d) => void (d.rulesetId = id));
    toast(`Подразделение считается по набору «${nr.name}».`, 'good');
  };
  const applyTypeMap = (to: Id, map: Record<Id, Id | null>, copy: Id[]) => {
    const nr = st.rulesets[to];
    historyStep(`переход на набор «${nr.name}»`);
    if (copy.length) replaceRuleset(transferFromRuleset(nr, rs, { componentTypes: copy }).ruleset);
    ctx.upd((d) => {
      remapTypes(d, map);
      d.rulesetId = to;
    });
    toast(`Подразделение считается по набору «${nr.name}»${copy.length ? `; в набор добавлено типов: ${copy.length}` : ''}.`, 'good');
  };
  const sel = findUnit(root, ctx.sel) ?? root;
  const issues = validateUnit(root, rs);
  const tpl = root.templateId ? st.formations[root.templateId] : undefined;
  const usages = isLib ? templateUsages(root.id) : [];
  const outdatedUsages = usages.filter((u) => u.outdated).length;
  const forceCopies = usages.filter((u) => u.ref.startsWith('force:')).length;
  const scenariosUsing = isLib ? [] : forceUsage(root.id);
  const factions = [
    ...new Set(
      Object.values(st.forces)
        .map((f) => f.faction?.trim())
        .filter((x): x is string => !!x),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ru'));

  return (
    <div className="page">
      <Crumbs
        items={isLib ? [{ label: 'Шаблоны', section: 'units' }] : [{ label: 'Силы', section: 'forces' }, ...(root.faction ? [{ label: root.faction }] : [])]}
      />
      <div className="page-head">
        <input className="title-input" value={root.name} onChange={(e) => ctx.upd((d) => void (d.name = e.target.value))} />
        <ToolbarSlot>
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
                    {
                      label: 'Создать силы по шаблону…',
                      tip: 'Конкретные подразделения с этим устройством и штатом — у каждого будут свои потери',
                      onClick: async () => {
                        const v = await promptDialog(
                          'Сколько подразделений сил создать?',
                          '1',
                          `По шаблону «${root.name}». Названия — с номерами по порядку; их можно поменять.`,
                        );
                        const n = Math.round(Number(v));
                        if (!v || !Number.isFinite(n) || n < 1) return;
                        const ids = createForcesFromTemplate(root.id, { count: n, open: n === 1 });
                        if (n > 1) toast(`Создано сил: ${ids.length} — они в разделе «Силы».`, 'good');
                      },
                    },
                    { label: 'Дублировать шаблон', onClick: () => duplicateFormation(root.id) },
                    { label: 'Сохранить в файл…', onClick: () => exportJson('template', root.name, root) },
                    'sep' as const,
                    { label: 'Удалить шаблон', danger: true, onClick: () => deleteFormation(root.id) },
                  ]
                : [
                    {
                      label: 'Восстановить полностью',
                      onClick: () => restoreForces([root.id]),
                      tip: 'Раненые и техника возвращаются, недостающее — до штата из резерва, состояние — к норме',
                    },
                    'sep' as const,
                    !!tpl && { label: `Открыть шаблон «${tpl.name}»`, onClick: () => openTab('formation', `lib:${tpl.id}`) },
                    { label: 'Сохранить как шаблон', onClick: () => saveAsTemplate(root, rs) },
                    { label: 'Дублировать', onClick: () => duplicateForce(root.id) },
                    { label: 'Сохранить в файл…', onClick: () => exportJson('force', root.name, { ...root, faction: root.faction ?? '' }) },
                    'sep' as const,
                    { label: 'Удалить силы', danger: true, onClick: () => deleteForce(root.id) },
                  ]),
            ]}
          />
        </ToolbarSlot>
      </div>

      <div className="meta" style={{ marginTop: -8, marginBottom: 14 }}>
        <span>
          набор правил:{' '}
          <select
            className="inline-select"
            value={rs.id}
            onChange={(e) => changeRuleset(e.target.value)}
            title="По какому набору правил считается это подразделение: каталог типов, уровни"
          >
            {Object.values(st.rulesets).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </span>
        {!isLib && (
          <span>
            <span className="team-dot sm" style={{ background: teamColor(root.faction ?? '') }} /> команда:{' '}
            <input
              className="inline-input"
              list="force-factions"
              value={root.faction ?? ''}
              placeholder="чьи это силы"
              onChange={(e) => ctx.upd((d) => void (d.faction = e.target.value || undefined))}
              title="Сторона, армия, отряд — силы сгруппированы по командам, у команды свой цвет (раздел «Силы»)"
            />
            <datalist id="force-factions">
              {factions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </span>
        )}
        {!isLib && tpl && (
          <span>
            по шаблону{' '}
            <Link kind="formation" refId={`lib:${tpl.id}`}>
              {tpl.name}
            </Link>
            {isOutdated(root, tpl) && (
              <>
                {' '}
                — <span className="warn">шаблон изменён</span>{' '}
                <a
                  href="#"
                  onClick={(e) => (e.preventDefault(), updateCopy(ref, root.id))}
                  title="Устройство и штат — из шаблона; названия, потери и состояние сил сохраняются"
                >
                  обновить
                </a>
              </>
            )}
          </span>
        )}
        {!isLib && (
          <span data-tip={scenariosUsing.map((x) => x.name).join('\n') || undefined}>
            {scenariosUsing.length ? (
              <>
                в сценариях: <b>{scenariosUsing.length}</b>
              </>
            ) : (
              <span className="faint">ни в одном сценарии</span>
            )}
          </span>
        )}
        {isLib && usages.length > 0 && (
          <span data-tip={[...new Set(usages.map((u) => u.owner))].join('\n')}>
            по шаблону создано сил: <b>{forceCopies}</b>
            {usages.length > forceCopies ? `, в других шаблонах: ${usages.length - forceCopies}` : ''}
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
          мышь и клавиши
          <Info text={`Перетаскивайте подразделения мышью — в том числе из боковой панели слева.\n\n${KEYS_HELP}`} />
        </span>
      </div>

      {!isLib && (root.children.length > 0 || root.composition.length > 0) && <ForceReadiness force={root} />}
      {!root.children.length && !root.composition.length && <EmptyStart ctx={ctx} />}
      {view === 'chart' ? (
        <div className="stack">
          <Card tight className="org-card">
            <OrgChart ctx={ctx} />
          </Card>
          <div className="grid align-start" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
            <NodeEditor key={sel.id} ctx={ctx} node={sel} />
            <SummaryCard node={sel} rs={rs} resolved={resolved} template={isLib} />
          </div>
        </div>
      ) : (
        <div className="split wide-left">
          <div className="stack">
            <Card tight>
              <TreeList ctx={ctx} />
            </Card>
            <SummaryCard node={sel} rs={rs} resolved={resolved} template={isLib} />
          </div>
          <NodeEditor key={sel.id} ctx={ctx} node={sel} />
        </div>
      )}
      {insert && <InsertDialog ctx={ctx} targetId={insert.id} attach={insert.attach} onClose={() => setInsert(null)} />}
      {transfer && (
        <TransferDialog
          nodeId={transfer}
          onClose={() => setTransfer(null)}
          onDone={(forceId) => {
            // Часть ушла в другие силы — открыть её там; внутри тех же сил — выбрать старшего.
            if (`force:${forceId}` !== ref) openUnit(`force:${forceId}`, transfer);
            else setSel(transfer);
          }}
        />
      )}
      {!isLib && <ForceHistory force={root} />}
      {typeMap && st.rulesets[typeMap.to] && (
        <TypeMapModal
          from={rs}
          to={st.rulesets[typeMap.to]}
          ids={typeMap.ids}
          onClose={() => setTypeMap(null)}
          onApply={(map, copy) => applyTypeMap(typeMap.to, map, copy)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ пустое подразделение
