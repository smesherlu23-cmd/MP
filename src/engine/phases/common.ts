// Общее для фаз хода: стороны, элементы узла, поддерево формирования.

import type { EngineContext } from '../context';
import type { Battle, ElementState, Id, SideId } from '../types';

export const SIDES: SideId[] = ['A', 'B'];

/** Элементы узла стороны: самого подразделения и всех его подчинённых. */
export function elementsOfNode(b: Battle, side: SideId, nodeId: Id): ElementState[] {
  const f = b.formations.find((x) => x.side === side && x.defId === nodeId);
  if (!f) return b.elements.filter((x) => x.side === side && x.defId === nodeId);
  const ids = new Set([f.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
  }
  return b.elements.filter((x) => ids.has(x.formationId));
}

/** Формирование и все его подчинённые (id). */
export function subtreeIds(E: EngineContext, fid: Id): Set<Id> {
  const ids = new Set<Id>([fid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of E.b.formations) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
      ids.add(f.id);
      grew = true;
    }
  }
  return ids;
}
