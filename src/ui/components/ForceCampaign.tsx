// Силы между боями: отдых (раненые возвращаются, техника ремонтируется, состояние приходит в норму),
// пополнение до штата и боевой путь — бои, отдых и пополнения подразделения.

import { useMemo, useState } from 'react';
import { plural, recoverableOf, replenishForce, restForce, type ForceRecord, type Ruleset, type UnitNode } from '../../engine';
import { fmtDate, historyStep, openTab, toastUndoable, updateForce, useApp } from '../store';
import { Btn, Check, Field, Modal, Num, Section, Txt, fmt0 } from './ui';

const signed = (v: number | undefined, unit: string) => (v ? `${v > 0 ? '+' : '−'}${fmt0(Math.abs(v))} ${unit}` : '');

export function RestModal({ force, rs, onClose }: { force: UnitNode; rs: Ruleset | undefined; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const preview = useMemo(() => restForce(force, days, rs), [force, days, rs]);
  const rec = recoverableOf(force, rs);
  const k = rs?.coefficients ?? {};
  return (
    <Modal
      title={`Отдых и восстановление — ${force.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Запишется в боевой путь. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            onClick={() => {
              historyStep(`отдых «${force.name}»`);
              updateForce(force.id, (d) => void Object.assign(d, preview.force));
              toastUndoable(`«${force.name}»: отдых ${days} ${plural(days, 'день', 'дня', 'дней')} — в строй вернулось ${fmt0(preview.personnel)} чел.${preview.equipment ? `, отремонтировано ${preview.equipment} ед.` : ''}`);
              onClose();
            }}
          >
            Отдых
          </Btn>
        </>
      }
    >
      <div className="fields two">
        <Field label="Дней отдыха">
          <Num value={days} onChange={(v) => setDays(Math.max(1, Math.min(365, Math.round(v))))} min={1} max={365} integer width="100%" />
        </Field>
        <Field label="Ждут возвращения в строй">
          <div style={{ paddingTop: 6 }}>
            {fmt0(rec.personnel)} чел. раненых{rec.equipment ? `, ${fmt0(rec.equipment)} ед. техники и вооружения в ремонте` : ''}
          </div>
        </Field>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        За {days} {plural(days, 'день', 'дня', 'дней')} вернётся в строй: <b>{fmt0(preview.personnel)} чел.</b>
        {rec.equipment > 0 && (
          <>
            , отремонтировано: <b>{fmt0(preview.equipment)} ед.</b>
          </>
        )}
        . Мораль, слаженность, готовность, усталость, боезапас, топливо и снаряжение приблизятся к норме.
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        Темпы — в наборе правил, «Коэффициенты» → «Между боями (силы)»: раненые {k.restWoundedPerDay ?? 4}%/день, ремонт {k.restRepairPerDay ?? 6}%/день, состояние {k.restRecoverPerDay ?? 15}%/день.
        Сверх штата в строй не возвращаются.
      </p>
    </Modal>
  );
}

export function ReplenishModal({ force, rs, onClose }: { force: UnitNode; rs: Ruleset | undefined; onClose: () => void }) {
  const [personnel, setPersonnel] = useState(true);
  const [equipment, setEquipment] = useState(true);
  const [note, setNote] = useState('');
  const preview = useMemo(() => replenishForce(force, rs, { personnel, equipment }, note || undefined), [force, rs, personnel, equipment, note]);
  return (
    <Modal
      title={`Пополнить до штата — ${force.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Запишется в боевой путь. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!preview.personnel && !preview.equipment}
            onClick={() => {
              historyStep(`пополнение «${force.name}»`);
              updateForce(force.id, (d) => void Object.assign(d, preview.force));
              toastUndoable(`«${force.name}» пополнено: +${fmt0(preview.personnel)} чел.${preview.equipment ? `, +${preview.equipment} ед.` : ''}`);
              onClose();
            }}
          >
            Пополнить
          </Btn>
        </>
      }
    >
      <div className="stack" style={{ gap: 8 }}>
        <Check value={personnel} onChange={setPersonnel}>
          личный состав
        </Check>
        <Check value={equipment} onChange={setEquipment}>
          техника и вооружение
        </Check>
        <Field label="Примечание (откуда пополнение)">
          <Txt value={note} onChange={setNote} placeholder="маршевая рота, из резерва…" />
        </Field>
        <div className="note">
          Придёт: <b>{fmt0(preview.personnel)} чел.</b>
          {preview.equipment ? (
            <>
              , <b>{fmt0(preview.equipment)} ед.</b> техники и вооружения
            </>
          ) : null}
          . Раненые остаются ранеными — после отдыха вернутся, но не сверх штата.
        </div>
      </div>
    </Modal>
  );
}

const KIND_ICON: Record<ForceRecord['kind'], string> = { battle: '⚔', rest: '☾', replenish: '＋' };

/** Боевой путь сил: бои (с исходом и потерями), отдых, пополнения. */
export function ForceHistory({ force }: { force: UnitNode }) {
  const list = force.history ?? [];
  const index = useApp((s) => s.battleIndex);
  const battles = list.filter((x) => x.kind === 'battle' && x.battleId).length;
  const lost = list.filter((x) => x.kind === 'battle').reduce((a, x) => a - (x.personnel ?? 0), 0);
  const summary = list.length ? `боёв: ${battles}${lost > 0 ? `, потери за всё время: ${fmt0(lost)} чел.` : ''}` : 'пока пусто';
  return (
    <Section id="force-history" title="Боевой путь" summary={summary} defaultOpen={list.length > 0}>
      {!list.length && <div className="muted">Здесь появятся бои, итоги которых записаны в эти силы, а также отдых и пополнения.</div>}
      <div className="stack" style={{ gap: 4 }}>
        {[...list].reverse().map((x, i) => (
          <div key={i} className="history-row">
            <span className="faint small nowrap">{fmtDate(x.at)}</span>
            <span className="history-icon">{KIND_ICON[x.kind]}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              {x.battleId && index[x.battleId] ? (
                <a href="#" onClick={(e) => (e.preventDefault(), openTab('battle', x.battleId!))}>
                  {x.title}
                </a>
              ) : (
                x.title
              )}
              {x.outcome && <span className="faint"> · {x.outcome}</span>}
              {x.note && <span className="faint"> · {x.note}</span>}
            </span>
            <span className={`small nowrap ${(x.personnel ?? 0) < 0 ? 'bad' : (x.personnel ?? 0) > 0 ? 'good' : 'faint'}`}>
              {[signed(x.personnel, 'чел.'), signed(x.equipment, 'ед.')].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
