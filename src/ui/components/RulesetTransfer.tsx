// Перенос из другого набора правил: типы, приказы, условия, укрепления, разведданные, свои правила,
// временные эффекты. Одинаковые id заменяются, новые добавляются; классы целей типов переносятся с ними.

import { useState } from 'react';
import { TRANSFER_KINDS, TRANSFER_LABELS, transferFromRuleset, type Id, type Ruleset, type TransferKind } from '../../engine';
import { historyStep, replaceRuleset, toastUndoable, useApp } from '../store';
import { Btn, Check, Modal, Sel } from './ui';

const itemsOf = (r: Ruleset, k: TransferKind): { id: Id; name: string }[] =>
  ((r as unknown as Record<string, { id: Id; name: string }[]>)[k] ?? []).map((x) => ({ id: x.id, name: x.name }));

export function TransferModal({ target, onClose }: { target: Ruleset; onClose: () => void }) {
  const rulesets = Object.values(useApp((s) => s.rulesets)).filter((r) => r.id !== target.id);
  const [srcId, setSrcId] = useState(rulesets[0]?.id ?? '');
  const [sel, setSel] = useState<Partial<Record<TransferKind, Id[]>>>({});
  const [open, setOpen] = useState<TransferKind | null>('componentTypes');
  const src = rulesets.find((r) => r.id === srcId);
  const total = Object.values(sel).reduce((a, l) => a + (l?.length ?? 0), 0);
  const toggle = (k: TransferKind, id: Id, on: boolean) => setSel({ ...sel, [k]: on ? [...(sel[k] ?? []), id] : (sel[k] ?? []).filter((x) => x !== id) });
  const apply = () => {
    if (!src) return;
    const res = transferFromRuleset(target, src, sel);
    historyStep(`перенос из «${src.name}» в «${target.name}»`);
    replaceRuleset(res.ruleset);
    toastUndoable(`Перенесено из «${src.name}»: добавлено ${res.added}, заменено ${res.replaced}.${res.notes.length ? ` ${res.notes.join(' ')}` : ''}`);
    onClose();
  };
  return (
    <Modal
      wide
      title={`Перенести в «${target.name}» из другого набора`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">С тем же идентификатором — заменится, остальное добавится. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!total} onClick={apply}>
            Перенести{total ? ` (${total})` : ''}
          </Btn>
        </>
      }
    >
      {!rulesets.length ? (
        <div className="note">Других наборов правил нет.</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted">Из набора</span>
            <Sel
              value={srcId}
              onChange={(v) => {
                setSrcId(v);
                setSel({});
              }}
              options={rulesets.map((r) => ({ value: r.id, label: r.name }))}
              width={280}
            />
          </div>
          {src &&
            TRANSFER_KINDS.map((k) => {
              const items = itemsOf(src, k);
              if (!items.length) return null;
              const picked = new Set(sel[k] ?? []);
              const exists = new Set(itemsOf(target, k).map((x) => x.id));
              return (
                <div key={k} className="transfer-kind">
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="sec-toggle" onClick={() => setOpen(open === k ? null : k)}>
                      <span className="chev">{open === k ? '▾' : '▸'}</span>
                      <h4>{TRANSFER_LABELS[k]}</h4>
                    </button>
                    <span className="faint small">{picked.size ? `выбрано ${picked.size} из ${items.length}` : `${items.length}`}</span>
                    <span className="grow" />
                    <button
                      type="button"
                      className="link-btn small"
                      onClick={() => setSel({ ...sel, [k]: picked.size === items.length ? [] : items.map((x) => x.id) })}
                    >
                      {picked.size === items.length ? 'снять все' : 'выбрать все'}
                    </button>
                  </div>
                  {open === k && (
                    <div className="transfer-items">
                      {items.map((x) => (
                        <Check key={x.id} value={picked.has(x.id)} onChange={(v) => toggle(k, x.id, v)}>
                          {x.name}
                          {exists.has(x.id) && (
                            <span className="badge warn" style={{ marginLeft: 6 }}>
                              заменит
                            </span>
                          )}
                        </Check>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </>
      )}
    </Modal>
  );
}

/**
 * Переход подразделения на другой набор правил: каждому типу состава — тип нового набора (предложен
 * по id и названию), «добавить тип в набор» (копия с огневой мощью) или «убрать из состава».
 */
export function TypeMapModal({
  from,
  to,
  ids,
  onApply,
  onClose,
}: {
  from: Ruleset;
  to: Ruleset;
  ids: Id[];
  onApply: (map: Record<Id, Id | null>, copy: Id[]) => void;
  onClose: () => void;
}) {
  const [map, setMap] = useState<Record<Id, string>>(() => {
    const out: Record<Id, string> = {};
    for (const id of ids) {
      if (to.componentTypes.some((t) => t.id === id)) out[id] = id;
      else {
        const name = from.componentTypes
          .find((t) => t.id === id)
          ?.name?.trim()
          .toLowerCase();
        out[id] = to.componentTypes.find((t) => t.name.trim().toLowerCase() === name)?.id ?? (from.componentTypes.some((t) => t.id === id) ? '+copy' : '');
      }
    }
    return out;
  });
  const nameOf = (id: Id) => from.componentTypes.find((t) => t.id === id)?.name ?? id;
  return (
    <Modal
      title={`Перейти на «${to.name}»: типы состава`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Численность сохраняется; одинаковые после замены типы складываются. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            onClick={() => {
              const out: Record<Id, Id | null> = {};
              const copy: Id[] = [];
              for (const id of ids) {
                const v = map[id];
                if (v === '+copy') {
                  copy.push(id);
                  out[id] = id;
                } else out[id] = v || null;
              }
              onApply(out, copy);
              onClose();
            }}
          >
            Перейти
          </Btn>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Некоторых типов этого подразделения нет в наборе «{to.name}». Выберите, чем их заменить.
      </p>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>Было («{from.name}»)</th>
            <th>Станет</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <td>{nameOf(id)}</td>
              <td>
                <Sel
                  value={map[id] ?? ''}
                  onChange={(v) => setMap({ ...map, [id]: v })}
                  width={260}
                  options={[
                    ...to.componentTypes.map((t) => ({ value: t.id, label: t.name })),
                    ...(from.componentTypes.some((t) => t.id === id) && !to.componentTypes.some((t) => t.id === id)
                      ? [{ value: '+copy', label: `добавить «${nameOf(id)}» в набор` }]
                      : []),
                    { value: '', label: 'убрать из состава' },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
