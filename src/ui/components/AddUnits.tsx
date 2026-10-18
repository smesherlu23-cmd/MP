// Окно «Добавить подразделения» на сторону сценария: несколько сразу, любое количество копий,
// целиком или отдельные части (рота из батальона, батальон из бригады).

import { useMemo, useState } from 'react';
import { extractPart, instantiate, nextName, plural, summarizeUnits, type Ruleset, type Scenario, type UnitNode } from '../../engine';
import { toast, updateScenario, useApp } from '../store';
import { Btn, Check, Modal, Num, fmt0 } from './ui';

interface Pick {
  libId: string;
  nodeId: string;
  count: number;
}

const keyOf = (libId: string, nodeId: string) => `${libId}/${nodeId}`;

export function AddUnitsModal({ sc, side, rs, onClose }: { sc: Scenario; side: number; rs: Ruleset; onClose: () => void }) {
  const library = useApp((s) => s.formations);
  const rulesets = useApp((s) => s.rulesets);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());

  const units = useMemo(
    () =>
      Object.values(library)
        .filter((u) => all || !u.rulesetId || u.rulesetId === sc.rulesetId)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [library, all, sc.rulesetId],
  );
  const others = Object.values(library).length - Object.values(library).filter((u) => !u.rulesetId || u.rulesetId === sc.rulesetId).length;
  const query = q.trim().toLowerCase();
  // Поиск ищет и по частям: подходящий узел виден вместе со своими старшими.
  const matches = (n: UnitNode): boolean => !query || n.name.toLowerCase().includes(query) || n.children.some(matches);

  /** Узел и его старшие/младшие не выбираются одновременно — иначе силы задвоятся. */
  const related = (libId: string, nodeId: string): Set<string> => {
    const out = new Set<string>();
    const lib = library[libId];
    if (!lib) return out;
    const walk = (n: UnitNode, path: string[]): boolean => {
      if (n.id === nodeId) {
        path.forEach((x) => out.add(x));
        const down = (m: UnitNode) => m.children.forEach((c) => (out.add(c.id), down(c)));
        down(n);
        return true;
      }
      return n.children.some((c) => walk(c, [...path, n.id]));
    };
    walk(lib, []);
    return out;
  };

  const toggle = (libId: string, nodeId: string, on: boolean) =>
    setPicks((prev) => {
      const next = new Map(prev);
      if (!on) next.delete(keyOf(libId, nodeId));
      else {
        for (const id of related(libId, nodeId)) next.delete(keyOf(libId, id));
        next.set(keyOf(libId, nodeId), { libId, nodeId, count: 1 });
      }
      return next;
    });

  const cache = useMemo(() => new WeakMap<UnitNode, number>(), [rs]);
  const persOf = (n: UnitNode) => {
    let v = cache.get(n);
    if (v === undefined) cache.set(n, (v = summarizeUnits([n], rs).persCur));
    return v;
  };
  const chosen = [...picks.values()];
  const total = chosen.reduce((a, p) => {
    const lib = library[p.libId];
    const node = lib && (p.nodeId === lib.id ? lib : findIn(lib, p.nodeId));
    return a + (node ? persOf(node) * p.count : 0);
  }, 0);
  const copies = chosen.reduce((a, p) => a + p.count, 0);

  const add = () => {
    const made: UnitNode[] = [];
    for (const p of chosen) {
      const lib = library[p.libId];
      if (!lib) continue;
      for (let k = 0; k < p.count; k++) {
        const c = p.nodeId === lib.id ? instantiate(lib) : extractPart(lib, p.nodeId);
        if (!c) continue;
        // Копии целого — следующими номерами («2-й взвод»); копии части — номером в скобках: «3-я рота» в составе уже есть.
        if (k > 0) c.name = p.nodeId === lib.id ? nextName(c.name, k) : `${c.name} (${k + 1})`;
        made.push(c);
      }
    }
    if (!made.length) return;
    updateScenario(sc.id, (d) => void d.sides[side].formations.push(...made));
    toast(`На сторону «${sc.sides[side].name}» добавлено: ${made.length === 1 ? `«${made[0].name}»` : `${made.length} ${plural(made.length, 'подразделение', 'подразделения', 'подразделений')}`}.`, 'good');
    onClose();
  };

  const row = (lib: UnitNode, n: UnitNode, depth: number): React.ReactNode => {
    if (!matches(n)) return null;
    const key = keyOf(lib.id, n.id);
    const pick = picks.get(key);
    const isOpen = open.has(key) || (!!query && n.children.some(matches) && depth < 3);
    const other = lib.rulesetId && lib.rulesetId !== sc.rulesetId;
    return (
      <div key={key}>
        <div className={`pick-row${pick ? ' on' : ''}`} style={{ paddingLeft: 6 + depth * 18 }}>
          <button
            type="button"
            className="side-fold"
            disabled={!n.children.length}
            onClick={() => setOpen((prev) => new Set(prev.has(key) ? [...prev].filter((x) => x !== key) : [...prev, key]))}
            title={n.children.length ? (isOpen ? 'Скрыть части' : 'Показать части — можно взять только некоторые') : undefined}
          >
            {n.children.length ? (isOpen ? '▾' : '▸') : ''}
          </button>
          <Check value={!!pick} onChange={(v) => toggle(lib.id, n.id, v)}>
            <span className="pick-name">
              {n.level && <span className="faint">{n.level} · </span>}
              {n.name}
            </span>
          </Check>
          <span className="grow" />
          {depth === 0 && other && <span className="badge warn">{rulesets[lib.rulesetId!]?.name ?? 'другой набор правил'}</span>}
          <span className="faint small nowrap">{fmt0(persOf(n))} чел.</span>
          {pick && (
            <span className="row nowrap" style={{ gap: 4 }} title="Сколько копий добавить (номера в названиях — по порядку)">
              <span className="faint small">×</span>
              <Num value={pick.count} onChange={(v) => setPicks((prev) => new Map(prev).set(key, { ...pick, count: Math.max(1, Math.min(50, Math.round(v))) }))} min={1} max={50} integer width={52} />
            </span>
          )}
        </div>
        {isOpen && n.children.map((c) => row(lib, c, depth + 1))}
      </div>
    );
  };

  return (
    <Modal
      wide
      title={`Добавить подразделения — «${sc.sides[side].name}»`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">{copies ? `Выбрано: ${copies} · ${fmt0(total)} чел.` : 'Отметьте подразделения или их части (▸ — раскрыть)'}</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!copies} onClick={add}>
            Добавить{copies ? ` (${copies})` : ''}
          </Btn>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <input type="search" autoFocus placeholder="Поиск по названию, в том числе частей…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        {others > 0 && (
          <Check value={all} onChange={setAll} title="Подразделения других наборов правил: их типы могут отсутствовать в наборе правил сценария">
            другие наборы правил ({others})
          </Check>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        На сторону можно взять несколько подразделений сразу и любое число копий (×N). Нужна только часть — раскройте подразделение (▸) и отметьте нужные роты,
        взводы, батальоны: часть войдёт в бой самостоятельно, с приказом и состоянием, унаследованными от старшего.
      </p>
      <div className="pick-list">
        {units.map((u) => row(u, u, 0))}
        {!units.length && <div className="muted" style={{ padding: 10 }}>В библиотеке нет подразделений этого набора правил.</div>}
      </div>
    </Modal>
  );
}

function findIn(root: UnitNode, id: string): UnitNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findIn(c, id);
    if (f) return f;
  }
  return null;
}
