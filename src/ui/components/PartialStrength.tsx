// Неполный состав в бою: из подразделения (или его части) в бой идёт не весь состав — по типам, вплоть
// до одного бойца или одной машины. Для малых операций: из отделения — трое, из взвода — один танк.

import { limitComposition, ownPersonnel, type Ruleset, type UnitNode } from '../../engine';
import { Btn, Modal, Num, fmt0 } from './ui';

export type PartialLimit = Record<string, number>;

/** Сколько людей (с экипажами) из узла идёт в бой и сколько в строю; partial — состав ограничен. */
export function partialCount(node: UnitNode, lim: PartialLimit | undefined, rs: Ruleset) {
  const used = limitComposition(node.composition, lim);
  return { all: ownPersonnel(node, rs).cur, took: ownPersonnel({ ...node, composition: used }, rs).cur, partial: used !== node.composition };
}

/**
 * Кто из узла идёт в бой — у подразделения на стороне. text — численность части («36 чел. · 3 ед.»): она
 * и открывает выбор; без text — ссылка «состав…». При неполном составе — отметка «в бою 3 из 9 чел.».
 */
export function PartialButton(props: { node: UnitNode; lim?: PartialLimit; rs: Ruleset; onOpen: () => void; text?: string; tip?: string }) {
  const { node, lim, rs, onOpen, text, tip } = props;
  if (!node.composition.some((c) => c.current > 0))
    return text ? (
      <span className="faint small nowrap" data-tip={tip}>
        {text}
      </span>
    ) : null;
  const { all, took, partial } = partialCount(node, lim, rs);
  const extra = tip ? `\n\n${tip}` : '';
  return (
    <button
      type="button"
      className={partial ? 'badge warn partial-btn' : text ? 'partial-stats small nowrap' : 'link-btn small partial-btn'}
      data-tip={
        partial ? `В бою не весь состав — щелчок, чтобы изменить${extra}` : `Кто идёт в бой: щелчок — выделить только часть состава (малые операции)${extra}`
      }
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {partial ? `в бою ${fmt0(took)} из ${fmt0(all)} чел.` : (text ?? 'состав…')}
    </button>
  );
}

/** Окно: сколько каждого типа из состава узла идёт в бой. Правки применяются сразу. */
export function PartialModal(props: {
  node: UnitNode;
  lim?: PartialLimit;
  rs: Ruleset;
  onChange: (lim: PartialLimit | undefined) => void;
  onClose: () => void;
}) {
  const { node, lim, rs, onChange, onClose } = props;
  const rows = new Map<string, number>();
  for (const c of node.composition) rows.set(c.typeId, (rows.get(c.typeId) ?? 0) + Math.max(0, c.current));
  const set = (typeId: string, v: number) => {
    const next = { ...(lim ?? {}) };
    if (v >= (rows.get(typeId) ?? 0)) delete next[typeId];
    else next[typeId] = Math.max(0, Math.round(v));
    onChange(Object.keys(next).length ? next : undefined);
  };
  const { all, took } = partialCount(node, lim, rs);
  return (
    <Modal
      title={`Кто идёт в бой — «${node.name}»`}
      onClose={onClose}
      footer={
        <>
          <Btn kind="ghost" onClick={() => onChange(undefined)} disabled={!lim}>
            Весь состав
          </Btn>
          <span className="grow" />
          <Btn kind="primary" onClick={onClose}>
            Готово
          </Btn>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Для малых операций: в бой идёт только часть состава, вплоть до одного бойца или одной машины. Остальные остаются в силах — не стреляют и потерь не
        несут; потери боя запишутся в силы, а мораль и усталость изменятся на долю участвовавших. Касается только этого сценария.
      </p>
      <table className="tbl compact partial-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th className="num">В строю</th>
            <th className="num">В бою</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...rows].map(([typeId, cur]) => {
            const value = Math.min(cur, lim?.[typeId] ?? cur);
            return (
              <tr key={typeId}>
                <td>{rs.componentTypes.find((t) => t.id === typeId)?.name ?? typeId}</td>
                <td className="num">{fmt0(cur)}</td>
                <td className="num">
                  <Num value={value} onChange={(v) => set(typeId, v)} min={0} max={cur} integer width={80} title={`Сколько идёт в бой (0–${cur})`} />
                </td>
                <td className="nowrap">
                  <Btn sm kind="ghost" disabled={value >= cur} onClick={() => set(typeId, cur)} title="Все, кто в строю">
                    все
                  </Btn>
                  <Btn sm kind="ghost" disabled={value <= 0} onClick={() => set(typeId, 0)} title="Этот тип в бою не участвует">
                    0
                  </Btn>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 10 }}>
        В бою: <b>{fmt0(took)}</b> из {fmt0(all)} чел.
        {took === 0 && <span className="warn"> — из этой части в бой не идёт никто, она не участвует.</span>}
      </div>
    </Modal>
  );
}
