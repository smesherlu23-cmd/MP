// Оргсхема и список подразделения, значки узлов, подсказка для пустого подразделения.

import { useLayoutEffect, useRef, useState } from 'react';
import { isOutdated, type DropPos, type UnitNode } from '../../../engine';
import { Menu } from '../../components/ui';
import { type Ctx, acceptsDrop, addChild, canInsertTemplate, dragStart, isStacked, nodeActions, riskOf, statsLine, statsTip } from './model';

export function EmptyStart({ ctx }: { ctx: Ctx }) {
  const hasLib = Object.values(ctx.lib).some((u) => (!u.rulesetId || u.rulesetId === ctx.rs.id) && canInsertTemplate(ctx, u.id));
  const focusComposition = () => {
    ctx.setSel(ctx.root.id);
    requestAnimationFrame(() => {
      const el = document.querySelector('.comp-add') as HTMLSelectElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
    });
  };
  return (
    <div className="empty-start">
      <div className="empty-start-title">Подразделение пока пустое. С чего начать?</div>
      <div className="empty-start-actions">
        <button type="button" onClick={() => addChild(ctx, ctx.root)}>
          <b>+ Подчинённое</b>
          <span>взводы, отделения, расчёты — любая глубина</span>
        </button>
        <button type="button" onClick={() => ctx.openInsert(ctx.root.id, false)} disabled={!hasLib}>
          <b>Вставить из шаблонов</b>
          <span>{hasLib ? 'готовые взводы, роты, батареи' : 'подходящих шаблонов пока нет'}</span>
        </button>
        <button type="button" onClick={focusComposition}>
          <b>Свой состав</b>
          <span>люди, оружие и техника самого подразделения — для небольшого отряда этого достаточно</span>
        </button>
      </div>
    </div>
  );
}

/** compact — для списка: значок «шаблон» только если шаблон изменился (иначе он лишь занимает место). */
export function NodeBadges({ ctx, node, compact }: { ctx: Ctx; node: UnitNode; compact?: boolean }) {
  const tpl0 = node.templateId ? ctx.lib[node.templateId] : undefined;
  const outdated = isOutdated(node, tpl0);
  const tpl = compact && !outdated ? undefined : tpl0;
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

export function OrgChart({ ctx }: { ctx: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  const org = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // Широкая схема уменьшается, чтобы помещаться по ширине (не мельче 70%), дальше — прокрутка.
  // biome-ignore lint/correctness/useExhaustiveDependencies: масштаб подгоняется при смене подразделения и свёртывании ветвей
  useLayoutEffect(() => {
    const box = ref.current;
    const el = org.current;
    if (!box || !el) return;
    const fit = () => {
      const natural = el.getBoundingClientRect().width / zoomRef.current;
      const next = Math.max(0.7, Math.min(1, (box.clientWidth - 16) / Math.max(1, natural)));
      if (Math.abs(next - zoomRef.current) > 0.01) setZoom(Math.round(next * 100) / 100);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [ctx.root, ctx.collapsed.size]);
  // При открытии и смене выбора — показать выбранный блок (по умолчанию корень в центре).
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка к выделенному при смене выделения и масштаба
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.querySelector('.org-box.sel') as HTMLElement | null;
    if (!box) return;
    const cr = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    if (br.left < cr.left || br.right > cr.right || ctx.sel === ctx.root.id) el.scrollLeft += br.left + br.width / 2 - (cr.left + cr.width / 2);
    if (br.top < cr.top || br.bottom > cr.bottom) el.scrollTop += br.top - cr.top - 20;
  }, [ctx.sel, zoom]);
  return (
    <div className="org-scroll" ref={ref}>
      <div className="org" ref={org} style={zoom < 1 ? { zoom } : undefined}>
        <ul>
          <OrgNode ctx={ctx} node={ctx.root} />
        </ul>
      </div>
    </div>
  );
}

export function OrgBox({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const st = ctx.stats.get(node.id);
  const isRoot = node.id === ctx.root.id;
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
      </div>
      <div className="org-badges">
        <NodeBadges ctx={ctx} node={node} />
      </div>
    </div>
  );
}

export function OrgNode({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const folded = ctx.collapsed.has(node.id);
  // Подчинённые без своих подчинённых (взводы роты, отделения взвода) — столбиком: так схема не расползается вширь.
  // У корня столбик — только когда подчинённых много, иначе верхний уровень читается лучше в ряд.
  const stack = isStacked(ctx, node);
  return (
    <li>
      <OrgBox ctx={ctx} node={node} />
      {node.children.length > 0 && (
        <button type="button" className="org-fold" onClick={() => ctx.toggle(node.id)} title={folded ? 'Развернуть' : 'Свернуть'}>
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

export function TreeList({ ctx }: { ctx: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка к выделенной строке при смене выделения
  useLayoutEffect(() => {
    ref.current?.querySelector('.unit-row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [ctx.sel]);
  return (
    <div className="unit-tree" ref={ref}>
      <TreeRow ctx={ctx} node={ctx.root} depth={0} />
    </div>
  );
}

export function TreeRow({ ctx, node, depth }: { ctx: Ctx; node: UnitNode; depth: number }) {
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
        <span className="unit-name" title={node.level ? `${node.level} · ${node.name}` : node.name}>
          {node.name}
        </span>
        {node.level && <span className="unit-level">{node.level}</span>}
        <NodeBadges ctx={ctx} node={node} compact />
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
