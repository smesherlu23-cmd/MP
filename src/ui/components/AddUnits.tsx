// Окно «Добавить на сторону»: готовые силы (целиком или отдельные части — рота из батальона) или
// новые силы по шаблонам (×N). В сценарии — ссылки на силы: потери боя потом записываются в них.

import { useMemo, useState } from 'react';
import { pathTo, plural, summarizeUnits, type Id, type Ruleset, type Scenario, type SideUnitRef, type UnitNode } from '../../engine';
import { createForcesFromTemplate, historyStep, toast, updateScenario, useApp } from '../store';
import { Btn, Check, Modal, Num, Seg, fmt0 } from './ui';

const keyOf = (rootId: string, nodeId: string) => `${rootId}/${nodeId}`;

export function AddUnitsModal({ sc, side, rs, onClose }: { sc: Scenario; side: number; rs: Ruleset; onClose: () => void }) {
  const forces = useApp((s) => s.forces);
  const templates = useApp((s) => s.formations);
  const rulesets = useApp((s) => s.rulesets);
  const sideName = sc.sides[side].name;
  const [mode, setMode] = useState<'forces' | 'templates'>(Object.keys(forces).length ? 'forces' : 'templates');
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Map<string, { rootId: Id; nodeId: Id; count: number }>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: кэш численности сбрасывается при смене набора правил
  const cache = useMemo(() => new WeakMap<UnitNode, number>(), [rs]);
  const persOf = (n: UnitNode) => {
    let v = cache.get(n);
    if (v === undefined) cache.set(n, (v = summarizeUnits([n], rs).persCur));
    return v;
  };

  // Что уже участвует в сценарии: одно подразделение не может быть в двух местах.
  const used = new Map<Id, Id[]>();
  for (const sd of sc.sides) for (const u of sd.units ?? []) used.set(u.forceId, [...(used.get(u.forceId) ?? []), u.nodeId ?? u.forceId]);
  const busy = (root: UnitNode, nodeId: Id) => {
    const taken = used.get(root.id);
    if (!taken) return false;
    const path = pathTo(root, nodeId).map((n) => n.id);
    return taken.some((t) => path.includes(t) || pathTo(root, t).some((n) => n.id === nodeId));
  };

  const source = mode === 'forces' ? forces : templates;
  const fits = (u: UnitNode) => all || !u.rulesetId || u.rulesetId === sc.rulesetId;
  const list = Object.values(source)
    .filter(fits)
    .sort((a, b) => {
      // Силы этой стороны (по принадлежности) — первыми.
      const ma = mode === 'forces' && a.faction === sideName ? 0 : 1;
      const mb = mode === 'forces' && b.faction === sideName ? 0 : 1;
      return ma - mb || (a.faction ?? '').localeCompare(b.faction ?? '', 'ru') || a.name.localeCompare(b.name, 'ru');
    });
  const others = Object.values(source).filter((u) => !fits(u)).length;
  const query = q.trim().toLowerCase();
  const matches = (n: UnitNode): boolean => !query || n.name.toLowerCase().includes(query) || n.children.some(matches);

  const toggle = (root: UnitNode, nodeId: Id, on: boolean) =>
    setPicks((prev) => {
      const next = new Map(prev);
      if (!on) next.delete(keyOf(root.id, nodeId));
      else {
        // Старшие и младшие того же подразделения не выбираются вместе — силы задвоятся.
        const path = pathTo(root, nodeId).map((n) => n.id);
        for (const [k, p] of prev) if (p.rootId === root.id && (path.includes(p.nodeId) || pathTo(root, p.nodeId).some((n) => n.id === nodeId))) next.delete(k);
        next.set(keyOf(root.id, nodeId), { rootId: root.id, nodeId, count: 1 });
      }
      return next;
    });

  const chosen = [...picks.values()];
  const findIn = (root: UnitNode, id: Id) => pathTo(root, id).pop() ?? null;
  const total = chosen.reduce((a, p) => {
    const root = source[p.rootId];
    const node = root && findIn(root, p.nodeId);
    return a + (node ? persOf(node) * p.count : 0);
  }, 0);
  const count = chosen.reduce((a, p) => a + p.count, 0);

  const add = () => {
    const refs: SideUnitRef[] = [];
    historyStep(`добавление на сторону «${sideName}»`);
    for (const p of chosen) {
      if (mode === 'forces') refs.push(p.nodeId === p.rootId ? { forceId: p.rootId } : { forceId: p.rootId, nodeId: p.nodeId });
      else for (const id of createForcesFromTemplate(p.rootId, { count: p.count, faction: sideName, open: false })) refs.push({ forceId: id });
    }
    if (!refs.length) return;
    updateScenario(sc.id, (d) => void (d.sides[side].units ??= []).push(...refs));
    toast(
      mode === 'forces'
        ? `На сторону «${sideName}» добавлено: ${refs.length} ${plural(refs.length, 'подразделение', 'подразделения', 'подразделений')}.`
        : `Созданы силы по шаблонам (${refs.length}) и добавлены на сторону «${sideName}» — они в разделе «Силы».`,
      'good',
    );
    onClose();
  };

  const row = (root: UnitNode, n: UnitNode, depth: number): React.ReactNode => {
    if (!matches(n)) return null;
    const key = keyOf(root.id, n.id);
    const pick = picks.get(key);
    const taken = mode === 'forces' && busy(root, n.id);
    // Части выбираются только у сил: шаблон добавляется целиком (по нему создаются новые силы).
    const canOpen = mode === 'forces' && n.children.length > 0;
    const isOpen = canOpen && (open.has(key) || (!!query && n.children.some(matches) && depth < 3));
    const other = depth === 0 && root.rulesetId && root.rulesetId !== sc.rulesetId;
    return (
      <div key={key}>
        <div className={`pick-row${pick ? ' on' : ''}${taken ? ' taken' : ''}`} style={{ paddingLeft: 6 + depth * 18 }}>
          <button
            type="button"
            className="side-fold"
            disabled={!canOpen}
            onClick={() => setOpen((prev) => new Set(prev.has(key) ? [...prev].filter((x) => x !== key) : [...prev, key]))}
            title={canOpen ? (isOpen ? 'Скрыть части' : 'Показать части — можно взять только некоторые') : undefined}
          >
            {canOpen ? (isOpen ? '▾' : '▸') : ''}
          </button>
          <Check value={!!pick} onChange={(v) => !taken && toggle(root, n.id, v)}>
            <span className="pick-name">
              {n.level && <span className="faint">{n.level} · </span>}
              {n.name}
            </span>
          </Check>
          <span className="grow" />
          {taken && <span className="badge">уже в сценарии</span>}
          {depth === 0 && mode === 'forces' && root.faction && <span className="faint small">{root.faction}</span>}
          {other && <span className="badge warn">{rulesets[root.rulesetId!]?.name ?? 'другой набор правил'}</span>}
          <span className="faint small nowrap">{fmt0(persOf(n))} чел.</span>
          {pick && mode === 'templates' && (
            <span className="row nowrap" style={{ gap: 4 }} title="Сколько подразделений сил создать (номера в названиях — по порядку)">
              <span className="faint small">×</span>
              <Num
                value={pick.count}
                onChange={(v) => setPicks((prev) => new Map(prev).set(key, { ...pick, count: Math.max(1, Math.min(50, Math.round(v))) }))}
                min={1}
                max={50}
                integer
                width={52}
              />
            </span>
          )}
        </div>
        {isOpen && n.children.map((c) => row(root, c, depth + 1))}
      </div>
    );
  };

  return (
    <Modal
      wide
      title={`Добавить на сторону «${sideName}»`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">
            {count
              ? `Выбрано: ${count} · ${fmt0(total)} чел.`
              : mode === 'forces'
                ? 'Отметьте силы или их части (▸ — раскрыть)'
                : 'Отметьте шаблоны — по ним будут созданы новые силы'}
          </span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!count} onClick={add}>
            Добавить{count ? ` (${count})` : ''}
          </Btn>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <Seg
          value={mode}
          onChange={(v) => {
            setMode(v);
            setPicks(new Map());
          }}
          options={[
            { value: 'forces', label: `Силы (${Object.keys(forces).length})`, title: 'Готовые подразделения со своим состоянием и потерями' },
            { value: 'templates', label: 'Новые из шаблона', title: 'Создать новые силы по шаблону (полный штат) и сразу взять их в бой' },
          ]}
        />
        <input
          type="search"
          autoFocus
          placeholder="Поиск по названию, в том числе частей…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        {others > 0 && (
          <Check value={all} onChange={setAll} title="Подразделения других наборов правил: их типы могут отсутствовать в наборе правил сценария">
            другие наборы правил ({others})
          </Check>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {mode === 'forces'
          ? 'Силы — конкретные подразделения: потери этого боя потом запишутся именно в них. Нужна только часть — раскройте подразделение (▸) и отметьте роты, взводы, батальоны; она войдёт в бой самостоятельно, с состоянием старшего.'
          : `По шаблону создаются новые силы с полным штатом и принадлежностью «${sideName}»; они появятся в разделе «Силы» и сразу встанут на сторону.`}
      </p>
      <div className="pick-list">
        {list.map((u) => row(u, u, 0))}
        {!list.length && (
          <div className="muted" style={{ padding: 10 }}>
            {mode === 'forces'
              ? 'Сил этого набора правил пока нет — создайте их по шаблону (вкладка «Новые из шаблона»).'
              : 'Шаблонов этого набора правил нет.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
