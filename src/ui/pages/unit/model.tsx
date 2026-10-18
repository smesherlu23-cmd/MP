// Шаблоны и силы на странице подразделения: контекст, сводки по ветвям, действия с узлами,
// клавиатура и перетаскивание.

import {
  cloneUnit,
  findParent,
  findUnit,
  isOutdated,
  moveUnit,
  newUnit,
  nextName,
  removeUnit,
  toTemplate,
  walkUnits,
  type DropPos,
  type Id,
  type Resolved,
  type Ruleset,
  type UnitNode,
} from '../../../engine';
import { fmt0, type MenuItem } from '../../components/ui';
import { addFormation, containsTemplate, historyStep, promptDialog, returnPart, toast, toastUndoable, updateCopy } from '../../store';

export const DND_NODE = 'application/x-warsim-unit';

/** Перетаскивание шаблона из навигатора. */
export const DND_LIB = 'application/x-warsim-lib';

/** Перетаскивание сил из навигатора (на сторону сценария). */
export const DND_FORCE = 'application/x-warsim-force';

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
  if (!s?.equipList.size) return undefined;
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

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Сохранить подразделение (поддерево) как самостоятельный шаблон: только устройство и штат. */
export function saveAsTemplate(node: UnitNode, rs: Ruleset) {
  const c = toTemplate(cloneUnit(node));
  delete c.templateId;
  delete c.templateHash;
  delete c.srcNodeId;
  delete c.attachedFrom;
  c.rulesetId = rs.id;
  addFormation(c, false);
  toast(`«${c.name}» сохранено как шаблон — по нему можно создавать силы и вставлять его в другие шаблоны.`, 'good');
}

// ------------------------------------------------------------------ контекст страницы

export interface Ctx {
  root: UnitNode;
  rs: Ruleset;
  ref: string;
  /** true — шаблон (устройство и штат), false — силы (конкретное подразделение с состоянием). */
  isLib: boolean;
  lib: Record<Id, UnitNode>;
  upd: (fn: (root: UnitNode) => void) => void;
  sel: Id;
  setSel: (id: Id) => void;
  resolved: Map<Id, Resolved>;
  stats: Map<Id, NodeStats>;
  collapsed: Set<Id>;
  toggle: (id: Id) => void;
  openInsert: (targetId: Id, attach: boolean) => void;
  /** Силы: передать часть в другое подразделение (окно выбора). */
  openTransfer?: (nodeId: Id) => void;
  drop: { id: Id; pos: DropPos } | null;
  setDrop: (d: { id: Id; pos: DropPos } | null) => void;
  onDrop: (e: React.DragEvent, targetId: Id, pos: DropPos) => void;
}

/** Шаблон, который сейчас редактируется (или по которому созданы силы). */
export function hostLibraryId(ctx: Ctx): Id | undefined {
  return ctx.isLib ? ctx.root.id : ctx.root.templateId;
}

/** Нельзя вставить шаблон в самого себя или в подразделение, которое он сам содержит. */
export function canInsertTemplate(ctx: Ctx, templateId: Id): boolean {
  const host = hostLibraryId(ctx);
  const tpl = ctx.lib[templateId];
  if (!tpl) return false;
  if (!host) return true;
  return templateId !== host && !containsTemplate(tpl, host);
}

export function addChild(ctx: Ctx, node: UnitNode) {
  const levels = ctx.rs.unitLevels;
  const li = levels.indexOf(node.level);
  const childLevel = li > 0 ? levels[li - 1] : '';
  const ch = newUnit(`${cap(childLevel) || 'Подразделение'} ${node.children.length + 1}`, { level: childLevel });
  ctx.upd((d) => void findUnit(d, node.id)!.children.push(ch));
  ctx.setSel(ch.id);
}

export function duplicateNode(ctx: Ctx, node: UnitNode) {
  if (node.id === ctx.root.id) return;
  const c = cloneUnit(node);
  const taken = new Set(findParent(ctx.root, node.id)?.children.map((x) => x.name));
  let k = 1;
  while (taken.has(nextName(node.name, k)) && k < 500) k++;
  c.name = nextName(node.name, k);
  ctx.upd((d) => {
    const p = findParent(d, node.id)!;
    p.children.splice(p.children.findIndex((x) => x.id === node.id) + 1, 0, c);
  });
  ctx.setSel(c.id);
}

/** Удалить узел без подтверждения: шаг можно отменить. */
export function deleteNode(ctx: Ctx, node: UnitNode) {
  if (node.id === ctx.root.id) return;
  const parent = findParent(ctx.root, node.id);
  const sib = parent?.children ?? [];
  const i = sib.findIndex((c) => c.id === node.id);
  const next = sib[i + 1] ?? sib[i - 1] ?? parent;
  historyStep(`удаление «${node.name}»`);
  ctx.upd((d) => void removeUnit(d.children, node.id));
  ctx.setSel(next?.id ?? ctx.root.id);
  const n = node.children.length ? ` вместе с подчинёнными` : '';
  toastUndoable(`«${node.name}» удалено${n}.`);
}

export function nodeActions(ctx: Ctx, node: UnitNode): (MenuItem | 'sep' | false)[] {
  const isRoot = node.id === ctx.root.id;
  const parent = isRoot ? null : findParent(ctx.root, node.id);
  const idx = parent ? parent.children.findIndex((c) => c.id === node.id) : -1;
  const tpl = node.templateId ? ctx.lib[node.templateId] : undefined;
  const outdated = isOutdated(node, tpl);
  const un = (fn: (n: UnitNode) => void) => ctx.upd((d) => fn(findUnit(d, node.id)!));
  return [
    { label: 'Добавить подчинённое', kbd: 'Ins', onClick: () => addChild(ctx, node) },
    { label: 'Вставить из шаблонов…', onClick: () => ctx.openInsert(node.id, false), tip: 'Готовый шаблон: взвод, роту, батарею…' },
    ctx.isLib && { label: 'Придать из шаблонов…', onClick: () => ctx.openInsert(node.id, true), tip: 'То же, но с отметкой «придано»' },
    'sep',
    !ctx.isLib &&
      !!ctx.openTransfer && {
        label: isRoot ? 'Передать целиком в другое подразделение…' : 'Передать в другое подразделение…',
        tip: 'Временно: со всем составом, потерями и состоянием; вернуть — «Вернуть…»',
        onClick: () => ctx.openTransfer!(node.id),
      },
    !ctx.isLib &&
      !!node.transfer && {
        label: `Вернуть в «${node.transfer.fromName}»`,
        tip: node.transfer.parentId ? 'На прежнее место у прежнего старшего' : 'Снова самостоятельные силы',
        onClick: () => {
          if (parent) ctx.setSel(parent.id);
          returnPart(node.id);
        },
      },
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
    !isRoot && { label: 'Дублировать', kbd: 'Ctrl+D', onClick: () => duplicateNode(ctx, node) },
    !isRoot && {
      label: 'Раньше в списке',
      disabled: idx <= 0,
      onClick: () => ctx.upd((d) => void moveUnit([d], node.id, parent!.children[idx - 1].id, 'before', true)),
    },
    !isRoot && {
      label: 'Позже в списке',
      disabled: !parent || idx >= parent.children.length - 1,
      onClick: () => ctx.upd((d) => void moveUnit([d], node.id, parent!.children[idx + 1].id, 'after', true)),
    },
    'sep',
    { label: 'Сохранить как шаблон', tip: 'Устройство и штат этого подразделения — отдельным шаблоном', onClick: () => saveAsTemplate(node, ctx.rs) },
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
    'sep',
    !isRoot && {
      label: 'Удалить',
      danger: true,
      kbd: 'Del',
      onClick: () => deleteNode(ctx, node),
    },
  ];
}

// ------------------------------------------------------------------ клавиатура

export const KEYS_HELP = [
  'Клавиши (когда курсор не в поле ввода):',
  '↑ ↓ ← → — выбор подразделения',
  'Ins — добавить подчинённое',
  'Ctrl+D — дублировать',
  'Del — удалить (можно отменить)',
  'F2 или Enter — переименовать',
  'Ctrl+Z / Ctrl+Y — отменить / повторить',
].join('\n');

/** Видимые узлы по порядку (свёрнутые ветки пропускаются). */
export function visibleNodes(ctx: Ctx): UnitNode[] {
  const out: UnitNode[] = [];
  const go = (n: UnitNode) => {
    out.push(n);
    if (!ctx.collapsed.has(n.id)) n.children.forEach(go);
  };
  go(ctx.root);
  return out;
}

/** Подчинённые этого узла на схеме идут столбиком (см. OrgNode). */
export function isStacked(ctx: Ctx, n: UnitNode): boolean {
  const k = n.children.length;
  return k > 1 && n.children.every((c) => !c.children.length) && (n.id !== ctx.root.id || k > 10);
}

export function treeKey(ctx: Ctx, e: KeyboardEvent, view: 'chart' | 'list'): boolean {
  const node = findUnit(ctx.root, ctx.sel) ?? ctx.root;
  const parent = findParent(ctx.root, node.id);
  const sib = parent?.children ?? [node];
  const i = sib.findIndex((c) => c.id === node.id);
  const open = (n: UnitNode) => ctx.collapsed.has(n.id) && ctx.toggle(n.id);
  const ctrl = e.ctrlKey || e.metaKey;
  const go = (n: UnitNode | null | undefined) => n && ctx.setSel(n.id);
  if (ctrl && e.code === 'KeyD') return duplicateNode(ctx, node), true;
  if (ctrl) return false;
  if (e.key === 'Delete') return deleteNode(ctx, node), true;
  if (e.key === 'Insert') return addChild(ctx, node), true;
  if (e.key === 'F2' || e.key === 'Enter') {
    const el = document.querySelector('.node-title') as HTMLInputElement | null;
    el?.focus();
    el?.select();
    return !!el;
  }
  if (!e.key.startsWith('Arrow')) return false;
  if (view === 'list') {
    const vis = visibleNodes(ctx);
    const k = vis.findIndex((n) => n.id === node.id);
    if (e.key === 'ArrowUp') go(vis[k - 1]);
    else if (e.key === 'ArrowDown') go(vis[k + 1]);
    else if (e.key === 'ArrowLeft') node.children.length && !ctx.collapsed.has(node.id) ? ctx.toggle(node.id) : go(parent);
    else if (e.key === 'ArrowRight') ctx.collapsed.has(node.id) ? open(node) : go(node.children[0]);
    return true;
  }
  // Схема: по вертикали — старший/подчинённый (в столбике — соседи), по горизонтали — соседи.
  const stacked = !!parent && isStacked(ctx, parent);
  if (e.key === 'ArrowUp') go(stacked && i > 0 ? sib[i - 1] : parent);
  else if (e.key === 'ArrowDown') {
    if (stacked && !node.children.length) go(sib[i + 1]);
    else if (node.children.length) {
      open(node);
      go(node.children[0]);
    }
  } else if (e.key === 'ArrowLeft') go(stacked ? parent : sib[i - 1]);
  else if (e.key === 'ArrowRight') go(stacked ? undefined : sib[i + 1]);
  return true;
}

// ------------------------------------------------------------------ перетаскивание

export function dragStart(e: React.DragEvent, ref: string, id: Id) {
  e.stopPropagation();
  e.dataTransfer.setData(DND_NODE, JSON.stringify({ ref, id }));
  e.dataTransfer.effectAllowed = 'move';
}

export function acceptsDrop(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(DND_NODE) || e.dataTransfer.types.includes(DND_LIB);
}

// ------------------------------------------------------------------ страница

/** Большая структура открывается свёрнутой с третьего уровня: сначала видно главное. */
export function initialCollapsed(root: UnitNode): string[] {
  let n = 0;
  walkUnits(root, () => void n++);
  if (n <= 40) return [];
  const out: string[] = [];
  walkUnits(root, (u, _p, depth) => depth >= 2 && u.children.length > 0 && void out.push(u.id));
  return out;
}

// ------------------------------------------------------------------ значки узла
