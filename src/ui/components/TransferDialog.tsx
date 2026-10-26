// Окно «Передать в другое подразделение»: часть сил (или силы целиком) временно переходит под другое
// подразделение — своё или чужое — со всем составом, потерями и состоянием. Вернуть — «Вернуть…» в её меню.

import { useState } from 'react';
import { findParent, findUnit, locateNode, plural, type Id, type UnitNode } from '../../engine';
import { transferPart, useApp } from '../store';
import { Chev, Btn, Info, Modal } from './ui';

export function TransferDialog({ nodeId, onDone, onClose }: { nodeId: Id; onDone: (forceId: Id) => void; onClose: () => void }) {
  const forces = useApp((s) => s.forces);
  const rulesets = useApp((s) => s.rulesets);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Id | null>(null);
  const [open, setOpen] = useState<Set<Id>>(new Set());
  const here = locateNode(forces, nodeId);
  if (!here) return null;
  const moved = here.node;
  const parentId = findParent(here.force, nodeId)?.id;
  const query = q.trim().toLowerCase();
  const matches = (n: UnitNode): boolean => !query || n.name.toLowerCase().includes(query) || n.children.some(matches);
  const list = Object.values(forces).sort(
    (a, b) =>
      (a.id === here.force.id ? -1 : b.id === here.force.id ? 1 : 0) ||
      (a.faction ?? '').localeCompare(b.faction ?? '', 'ru') ||
      a.name.localeCompare(b.name, 'ru'),
  );
  const target = pick ? locateNode(forces, pick) : null;
  const otherRules = target && here.force.rulesetId && target.force.rulesetId && target.force.rulesetId !== here.force.rulesetId;

  const row = (n: UnitNode, depth: number): React.ReactNode => {
    if (!matches(n)) return null;
    // Нельзя — в саму передаваемую часть и её подчинённых; туда, где она уже, — незачем.
    const inside = !!findUnit(moved, n.id);
    const same = n.id === parentId;
    const canOpen = n.children.length > 0 && !inside;
    const isOpen = canOpen && (open.has(n.id) || (!!query && depth < 3) || (depth === 0 && n.id === here.force.id));
    return (
      <div key={n.id}>
        <div className={`pick-row${pick === n.id ? ' on' : ''}${inside || same ? ' taken' : ''}`} style={{ paddingLeft: 6 + depth * 18 }}>
          <button
            type="button"
            className="side-fold"
            disabled={!canOpen}
            onClick={() => setOpen((prev) => new Set(prev.has(n.id) ? [...prev].filter((x) => x !== n.id) : [...prev, n.id]))}
          >
            {canOpen ? <Chev open={isOpen} /> : ''}
          </button>
          <label className="check">
            <input type="radio" name="transfer-target" checked={pick === n.id} disabled={inside || same} onChange={() => setPick(n.id)} />
            <span className="pick-name">{n.name}</span>
          </label>
          <span className="grow" />
          {inside && <span className="faint small">{n.id === nodeId ? 'передаётся' : 'в её составе'}</span>}
          {same && <span className="badge">уже здесь</span>}
          {depth === 0 && n.faction && <span className="faint small">{n.faction}</span>}
          {depth === 0 && n.children.length > 0 && (
            <span className="faint small nowrap">
              {n.children.length} {plural(n.children.length, 'часть', 'части', 'частей')}
            </span>
          )}
        </div>
        {isOpen && n.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  const submit = () => {
    if (!pick) return;
    const forceId = transferPart(nodeId, pick);
    if (forceId) {
      onDone(forceId);
      onClose();
    }
  };

  return (
    <Modal
      wide
      title={`Передать «${moved.name}» в другое подразделение`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">
            {target ? `В «${target.node.name}»${target.force.id !== target.node.id ? ` · ${target.force.name}` : ''}` : 'Выберите, куда передать'}
          </span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!pick} onClick={submit}>
            Передать
          </Btn>
        </>
      }
    >
      {otherRules && (
        <div className="note warn" style={{ marginBottom: 8 }}>
          Подразделение составлено по другому набору правил ({rulesets[target!.force.rulesetId!]?.name ?? 'другой'}) — типы могут не совпасть.
        </div>
      )}
      <div className="row" style={{ marginBottom: 8, flexWrap: 'nowrap' }}>
        <input
          type="search"
          autoFocus
          placeholder="Поиск по названию, в том числе частей…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <Info text="Часть временно переходит в выбранное подразделение со всем составом, потерями и состоянием: в бою воюет в его составе, а сценарии, где она была отдельной частью стороны, сами ссылаются на новое место. Вернуть на прежнее место — «Вернуть…» в меню части (или кнопкой у её названия)." />
      </div>
      <div className="pick-list">{list.map((f) => row(f, 0))}</div>
    </Modal>
  );
}
