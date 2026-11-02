// Решения ГМ в бою: подвоз, переброска на участок, заметка в журнал.

import { useState } from 'react';
import { create } from 'zustand';
import { plural, type Battle, type SideId } from '../../../engine';
import type { Target } from '../../components/BattleControls';
import { Area, Btn, Check, Field, Modal, Num, Sel } from '../../components/ui';
import type { Iv } from './common';

// ------------------------------------------------------------------ окна решений

type Decision = { kind: 'resupply' | 'transfer'; target: Target } | { kind: 'note'; target?: Target };

export const useDecision = create<{ d: Decision | null }>(() => ({ d: null }));
export const openDecision = (d: Decision) => useDecision.setState({ d });
const closeDecision = () => useDecision.setState({ d: null });

/** Элементы цели: выбранные или все элементы формирования (с подчинёнными). */
export function targetElements(b: Battle, t: Target): string[] {
  if (t.elementIds) return t.elementIds;
  if (t.formationId) {
    const ids = new Set([t.formationId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of b.formations)
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
    }
    return b.elements.filter((x) => ids.has(x.formationId)).map((x) => x.id);
  }
  return b.elements.filter((x) => x.side === t.side).map((x) => x.id);
}

export function DecisionHost({ b, iv }: { b: Battle; iv: Iv }) {
  const d = useDecision((s) => s.d);
  if (!d || b.finished) return null;
  if (d.kind === 'resupply') return <ResupplyModal b={b} target={d.target} iv={iv} />;
  if (d.kind === 'transfer') return <TransferModal b={b} target={d.target} iv={iv} />;
  return <NoteModal b={b} target={d.target} iv={iv} />;
}

const SUPPLY_KEYS = [
  { key: 'ammo', label: 'Боезапас' },
  { key: 'fuel', label: 'Топливо' },
  { key: 'equipment', label: 'Снаряжение' },
] as const;

/** Подвоз: что (боезапас, топливо, снаряжение) и сколько процентов — выбранным элементам или формированию. */
function ResupplyModal({ b, target, iv }: { b: Battle; target: Target; iv: Iv }) {
  const keys = SUPPLY_KEYS.filter((x) => b.ruleset.features[x.key]);
  const [on, setOn] = useState<Record<string, number>>(() => (keys[0] ? { [keys[0].key]: 25 } : {}));
  const ids = targetElements(b, target).filter((id) => b.elements.find((x) => x.id === id)?.status === 'active');
  const els = b.elements.filter((x) => ids.includes(x.id));
  const avg = (k: 'ammo' | 'fuel' | 'equipment') => (els.length ? Math.round(els.reduce((a, x) => a + x[k], 0) / els.length) : 0);
  return (
    <Modal
      title={`Подвоз — ${target.label}`}
      onClose={closeDecision}
      footer={
        <>
          <span className="grow" />
          <Btn onClick={closeDecision}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!ids.length || !Object.keys(on).length}
            onClick={() => {
              iv('resupply', { elementIds: ids, ...on });
              closeDecision();
            }}
          >
            Подвезти
          </Btn>
        </>
      }
    >
      {!keys.length && <div className="muted">В наборе правил выключены боезапас, топливо и снаряжение — подвозить нечего.</div>}
      {!ids.length && <div className="muted">Среди выбранных нет элементов в бою.</div>}
      <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {keys.map((x) => (
          <Field
            key={x.key}
            label={
              <>
                {x.label} <span className="faint small">· сейчас в среднем {avg(x.key)}%</span>
              </>
            }
          >
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <Check
                value={x.key in on}
                onChange={(v) => {
                  const next = { ...on };
                  if (v) next[x.key] = 25;
                  else delete next[x.key];
                  setOn(next);
                }}
              />
              <Num
                value={on[x.key] ?? 25}
                onChange={(v) => setOn({ ...on, [x.key]: Math.max(1, Math.min(100, Math.round(v))) })}
                min={1}
                max={100}
                integer
                suffix="%"
                width="100%"
              />
            </div>
          </Field>
        ))}
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        {ids.length} {plural(ids.length, 'элемент', 'элемента', 'элементов')}: к запасу каждого прибавится заданный процент (не больше 100%).
      </p>
    </Modal>
  );
}

/** Переброска на другой участок: несколько ходов в пути (вне боя), потом в бою там. */
function TransferModal({ b, target, iv }: { b: Battle; target: Target; iv: Iv }) {
  const sectors = b.sectors ?? [];
  const ids = targetElements(b, target).filter((id) => b.elements.find((x) => x.id === id)?.status === 'active');
  const here = new Set(b.elements.filter((x) => ids.includes(x.id)).map((x) => x.sector));
  const [to, setTo] = useState(() => sectors.find((x) => !here.has(x.id))?.id ?? sectors[0]?.id ?? '');
  const [turns, setTurns] = useState(1);
  const moving = b.elements.filter((x) => ids.includes(x.id) && x.sector !== to).length;
  return (
    <Modal
      title={`Переброска — ${target.label}`}
      onClose={closeDecision}
      footer={
        <>
          <span className="grow" />
          <Btn onClick={closeDecision}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!moving}
            onClick={() => {
              iv('transfer', { ...(target.formationId ? { formationId: target.formationId } : { elementIds: ids }), sector: to, turns });
              closeDecision();
            }}
          >
            Перебросить
          </Btn>
        </>
      }
    >
      <div className="fields two">
        <Field label="На участок">
          <Sel value={to} onChange={setTo} options={sectors.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="В пути" hint="Сколько ходов части вне боя (не стреляют и не несут потерь); 0 — сразу на новом участке.">
          <Num value={turns} onChange={(v) => setTurns(Math.max(0, Math.round(v)))} min={0} max={20} integer suffix="ход." width={110} />
        </Field>
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        {moving
          ? `Перебрасывается: ${moving} ${plural(moving, 'элемент', 'элемента', 'элементов')}${turns ? `, в бою на новом участке с ${b.turn + 1 + turns}-го хода` : ''}. Отходящие и бегущие не перебрасываются.`
          : 'Все выбранные уже на этом участке.'}
      </p>
    </Modal>
  );
}

/** Своя запись в журнал: решение игрока, событие вне расчёта. */
function NoteModal({ b, target, iv }: { b: Battle; target?: Target; iv: Iv }) {
  const [text, setText] = useState('');
  const [side, setSide] = useState<SideId | ''>(target?.side ?? '');
  return (
    <Modal
      title="Заметка в журнал"
      onClose={closeDecision}
      footer={
        <>
          <span className="muted small grow">Запишется в журнал этого хода; в расчёте не участвует.</span>
          <Btn onClick={closeDecision}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!text.trim()}
            onClick={() => {
              iv('note', { text, ...(side ? { side } : {}), ...(target ? { elementIds: targetElements(b, target) } : {}) });
              closeDecision();
            }}
          >
            Записать
          </Btn>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        <Area value={text} onChange={setText} rows={3} placeholder="Например: игрок решил отвести роту к опушке" />
        <Field label="Относится к">
          <Sel
            value={side}
            onChange={(v) => setSide(v as SideId | '')}
            options={[{ value: '', label: 'всему бою' }, ...(['A', 'B'] as SideId[]).map((x) => ({ value: x, label: b.sides[x].name }))]}
            width={220}
          />
        </Field>
      </div>
    </Modal>
  );
}
