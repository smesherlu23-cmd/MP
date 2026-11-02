// Окна боя: элемент, формирование, условия и дистанция.

import { useState } from 'react';
import { walkUnits, type Battle, type CustomModifier, type ElementState, type EngineContext, type SideId } from '../../../engine';
import { effectsText } from '../../components/EffectsEditor';
import { TagChips } from '../../components/TagChips';
import type { Target } from '../../components/BattleControls';
import { CommanderSelect } from '../../components/CommanderSelect';
import { RichText } from '../../components/LogView';
import { Btn, Check, Field, Menu, Modal, Num, Sel, fmt0 } from '../../components/ui';
import { SIDES, type Iv } from './common';
import { IvNote, openDecision } from './Decisions';
import { CMD_TIP, PendingOrder, statusOf } from './ForcesTable';

export const EDITABLE: { key: keyof ElementState; label: string; feature?: keyof Battle['ruleset']['features'] }[] = [
  { key: 'morale', label: 'Мораль', feature: 'morale' },
  { key: 'cohesion', label: 'Слаженность', feature: 'cohesion' },
  { key: 'readiness', label: 'Готовность', feature: 'readiness' },
  { key: 'suppression', label: 'Подавление', feature: 'suppression' },
  { key: 'fatigue', label: 'Усталость', feature: 'fatigue' },
  { key: 'ammo', label: 'Боезапас', feature: 'ammo' },
  { key: 'fuel', label: 'Топливо', feature: 'fuel' },
  { key: 'equipment', label: 'Снаряжение', feature: 'equipment' },
  { key: 'vehicleCondition', label: 'Техсостояние', feature: 'vehicleCondition' },
];

/** Чем больше, тем хуже: полоска окрашивается наоборот. */
export const HIGH_IS_BAD = new Set<keyof ElementState>(['suppression', 'fatigue']);

export function StateRow({ label, value, inverse }: { label: string; value: number; inverse?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const good = inverse ? 100 - v : v;
  const color = good < 30 ? 'var(--bad)' : good < 60 ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="state-row">
      <span className="muted">{label}</span>
      <div className="meter">
        <div style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="num">{Math.round(value)}</span>
    </div>
  );
}

export function ElementModal({
  b,
  E,
  id,
  onClose,
  iv,
  onFocusLog,
  onEffect,
  onStrike,
}: {
  b: Battle;
  E: EngineContext;
  id: string;
  onClose: () => void;
  iv: Iv;
  onFocusLog: (id: string) => void;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, t: Target) => void;
}) {
  const el = b.elements.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [patch, setPatch] = useState<Record<string, number>>({});
  const [comps, setComps] = useState<Record<string, number>>({});
  const [addType, setAddType] = useState('');
  if (!el) return null;
  const rs = b.ruleset;
  const fs = E.formationOf(el);
  const st = statusOf(E, el);
  const tags = E.tags(el);
  const sector = b.sectors?.length ? E.sectorOf(el) : null;
  // Заметки подразделения (из конструктора) — в окне элемента.
  let notes = '';
  for (const sd of b.scenario.sides)
    for (const f of sd.formations) walkUnits(f, (n) => void (n.id === el.defId && n.notes?.trim() && (notes = n.notes.trim())));
  // Какие свои правила сейчас действуют на элемент (без зависящих от цели) и множители типов состава.
  const contextual = (m: CustomModifier) => m.when.some((c) => c.field.startsWith('enemy.') || c.field === 'targetClass');
  const rules = el.status === 'active' ? rs.modifiers.filter((m) => m.enabled && !contextual(m) && E.ruleMatches(m, el)) : [];
  const perTarget = rs.modifiers.filter((m) => m.enabled && contextual(m)).length;
  const typeMods = el.status === 'active' ? E.typeShares(el) : [];
  const newTypes = rs.componentTypes.filter((t) => !el.comps.some((c) => c.typeId === t.id) && !(t.id in comps));
  const target = { side: el.side, elementIds: [el.id], label: el.name };
  const canEdit = !b.finished && el.status === 'active';
  const editing = edit && canEdit;
  const selfRef = `[[e:${el.id}]]`;
  // Только события самого элемента (первая ссылка в записи — на него), без его имени в тексте.
  const firstRef = (t: string) => /\[\[e:([^\]]+)\]\]/.exec(t)?.[1];
  const ownText = (t: string) => {
    const x = t.startsWith(selfRef) ? t.slice(selfRef.length).replace(/^:\s*/, '') : t.replace(` ${selfRef}`, '');
    return x.replace(/^[а-яёa-z]/, (c) => c.toUpperCase());
  };
  const events = b.log
    .filter((x) => x.level <= 1 && x.phase !== 'turn' && x.refs?.includes(el.id) && firstRef(x.text) === el.id)
    .slice(-6)
    .reverse()
    .map((x) => ({ turn: x.turn, text: ownText(x.text) }));
  const dirty = Object.keys(patch).length + Object.keys(comps).length > 0;
  const stateKeys = EDITABLE.filter((x) => !x.feature || rs.features[x.feature]);
  const cancel = () => {
    setPatch({});
    setComps({});
    setEdit(false);
  };
  const apply = () => {
    const p: Record<string, unknown> = { ...patch };
    if (Object.keys(comps).length) p.comps = Object.entries(comps).map(([typeId, current]) => ({ typeId, current }));
    iv('editElement', { elementId: el.id, patch: p });
    cancel();
  };
  return (
    <Modal
      wide
      title={
        <span>
          <span className="dot" style={{ background: b.sides[el.side].color, marginRight: 8 }} />
          {el.name} <span className={`small ${st.cls}`}>· {st.label}</span>
        </span>
      }
      onClose={onClose}
      footer={
        editing ? (
          <>
            <IvNote />
            <span className="grow" />
            <Btn onClick={cancel}>Отмена</Btn>
            <Btn kind="primary" disabled={!dirty} onClick={apply}>
              Применить
            </Btn>
          </>
        ) : (
          <>
            <Btn kind="ghost" onClick={() => onFocusLog(el.id)}>
              Все события в журнале
            </Btn>
            <div className="grow" />
            {canEdit && (
              <Btn
                onClick={() => onEffect({ side: el.side, elementIds: [el.id], label: el.name })}
                title="Временный эффект на этот элемент: дым, внезапность, растерянность…"
              >
                Эффект…
              </Btn>
            )}
            {canEdit && (b.support ?? []).some((a) => a.side !== el.side && a.left > 0) && (
              <Btn
                onClick={() => onStrike(el.side === 'A' ? 'B' : 'A', { side: el.side, elementIds: [el.id], label: el.name })}
                title="Удар огневой поддержки противника по этому элементу"
              >
                Удар…
              </Btn>
            )}
            {canEdit && (
              <Menu
                label="Ещё…"
                items={[
                  (rs.features.ammo || rs.features.fuel || rs.features.equipment) && {
                    label: 'Подвезти…',
                    onClick: () => (onClose(), openDecision({ kind: 'resupply', target })),
                  },
                  (b.sectors?.length ?? 0) > 1 && { label: 'Перебросить на участок…', onClick: () => (onClose(), openDecision({ kind: 'transfer', target })) },
                  { label: 'Заметка в журнал…', onClick: () => (onClose(), openDecision({ kind: 'note', target })) },
                ]}
              />
            )}
            {canEdit && (
              <Btn onClick={() => setEdit(true)} title="Пополнить или списать состав, добавить тип, поправить опыт, атаку, мораль, боезапас и т. п.">
                Изменить…
              </Btn>
            )}
            <Btn onClick={onClose}>Закрыть</Btn>
          </>
        )
      }
    >
      <div className="meta" style={{ marginBottom: 8 }}>
        <span>{fs.name}</span>
        {sector && <span>участок: {sector.name}</span>}
        {el.transit && (
          <span className="warn">
            в пути на участок «{b.sectors?.find((x) => x.id === el.transit!.to)?.name}», в бою с {el.transit.until}-го хода
          </span>
        )}
        <span>опыт: {rs.experienceLevels[el.experience - 1]?.name}</span>
        {(el.attackMod !== 100 || el.defenseMod !== 100) && (
          <span data-tip="Атака и защита подразделения с учётом старших (из конструктора) или по решению ГМ">
            атака {fmt0(el.attackMod)}% · защита {fmt0(el.defenseMod)}%
          </span>
        )}
        <span>
          {fmt0(E.personnel(el))} из {fmt0(el.startPersonnel)} чел.
        </span>
      </div>
      {(tags.length > 0 || rules.length > 0 || typeMods.length > 0) && (
        <div className="el-mods">
          {tags.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <span className="muted small" data-tip="Теги типов в составе элемента: по ним работают свои правила набора">
                теги
              </span>
              <TagChips tags={tags} rs={rs} />
            </div>
          )}
          {(rules.length > 0 || typeMods.length > 0) && (
            <div className="row" style={{ gap: 6 }}>
              <span
                className="muted small"
                data-tip={`Свои правила набора, условия которых сейчас выполнены, и множители типов состава.${perTarget ? ` Ещё ${perTarget} — зависят от цели и противника, они видны в разборе огня в журнале.` : ''}`}
              >
                действуют
              </span>
              {typeMods.map((x) => (
                <span key={x.type.id} className="chip" data-tip={`${effectsText(x.type.effects!)} — по доле ${Math.round(x.share * 100)}% ценности`}>
                  тип «{x.type.name}»
                </span>
              ))}
              {rules.map((m) => (
                <span
                  key={m.id}
                  className="chip accent"
                  data-tip={[effectsText(m.effects), m.byShare ? `по доле ${Math.round(E.shareOf(el, m) * 100)}%` : '', m.description]
                    .filter(Boolean)
                    .join('\n')}
                >
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {notes && <div className="ql-note">{notes}</div>}
      <div className="grid two align-start">
        <div className="stack">
          {canEdit && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="Приказ">
                <Sel
                  value={el.orderId}
                  onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })}
                  options={rs.orders.map((o) => ({ value: o.id, label: o.name, title: o.description }))}
                />
                <PendingOrder E={E} el={el} />
              </Field>
              {rs.features.command && ((el.ownCommandLevel ?? 0) > 0 || editing) && (
                <Field label="Свой командир" hint="Обычно элементом командует его формирование; здесь ГМ может дать элементу собственного командира.">
                  <CommanderSelect
                    levels={rs.commandLevels}
                    allowNone
                    tip={CMD_TIP}
                    value={el.ownCommandLevel ?? 0}
                    onChange={(v) => iv('editElement', { elementId: el.id, patch: { ownCommandLevel: v } })}
                  />
                </Field>
              )}
              {editing && (
                <>
                  <Field label="Эшелон">
                    <Sel
                      value={el.echelon}
                      onChange={(v) => iv('editElement', { elementId: el.id, patch: { echelon: v } })}
                      options={[
                        { value: 'front', label: 'Первый' },
                        { value: 'support', label: 'Второй' },
                        { value: 'rear', label: 'Тыл' },
                      ]}
                    />
                  </Field>
                  <Check
                    value={el.holdFast}
                    onChange={(v) => iv('editElement', { elementId: el.id, patch: { holdFast: v } })}
                    title="Не отходит добровольно; шанс паники вдвое ниже"
                  >
                    стоять насмерть
                  </Check>
                  <Field label="Опыт">
                    <Sel
                      value={patch.experience ?? el.experience}
                      onChange={(v) => setPatch({ ...patch, experience: Number(v) })}
                      options={rs.experienceLevels.map((l, i) => ({ value: i + 1, label: l.name, title: l.description }))}
                    />
                  </Field>
                  <Field label="Атака, %">
                    <Num value={patch.attackMod ?? el.attackMod} onChange={(v) => setPatch({ ...patch, attackMod: v })} min={0} width={80} />
                  </Field>
                  <Field label="Защита, %">
                    <Num value={patch.defenseMod ?? el.defenseMod} onChange={(v) => setPatch({ ...patch, defenseMod: v })} min={1} width={80} />
                  </Field>
                </>
              )}
            </div>
          )}
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Состав</th>
                <th className="num">В строю</th>
                <th className="num">Потери</th>
              </tr>
            </thead>
            <tbody>
              {el.comps.map((c) => {
                const t = E.type(c.typeId);
                const pers = t.kind === 'personnel';
                const lost = c.start - c.current;
                return (
                  <tr key={c.typeId}>
                    <td>{t.name}</td>
                    <td className="num nowrap">
                      {editing ? (
                        <Num
                          value={comps[c.typeId] ?? c.current}
                          onChange={(v) => setComps({ ...comps, [c.typeId]: v })}
                          min={0}
                          integer
                          width={64}
                          title="Пополнение или списание"
                        />
                      ) : (
                        <b>{c.current}</b>
                      )}{' '}
                      <span className="faint of-total">из {c.start}</span>
                    </td>
                    <td
                      className="num"
                      data-tip={
                        pers
                          ? `убито ${c.kia}, ранено ${c.wia}, пропало ${c.mia}`
                          : `уничтожено ${c.destroyed}, повреждено ${c.damaged}, брошено ${c.abandoned}`
                      }
                    >
                      {lost > 0 ? <span className="bad">−{lost}</span> : <span className="faint">—</span>}
                    </td>
                  </tr>
                );
              })}
              {editing &&
                Object.keys(comps)
                  .filter((typeId) => !el.comps.some((c) => c.typeId === typeId))
                  .map((typeId) => (
                    <tr key={typeId}>
                      <td>
                        {E.type(typeId).name} <span className="faint small">· новый</span>
                      </td>
                      <td className="num nowrap">
                        <Num value={comps[typeId]} onChange={(v) => setComps({ ...comps, [typeId]: v })} min={0} integer width={64} />
                      </td>
                      <td className="num">
                        <Btn
                          sm
                          kind="ghost"
                          icon
                          title="Не добавлять"
                          onClick={() => {
                            const next = { ...comps };
                            delete next[typeId];
                            setComps(next);
                          }}
                        >
                          ×
                        </Btn>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {editing && newTypes.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <Sel
                value={addType}
                onChange={setAddType}
                options={[{ value: '', label: '+ тип в состав…' }, ...newTypes.map((t) => ({ value: t.id, label: t.name, title: t.description }))]}
                width={200}
              />
              <Btn
                sm
                disabled={!addType}
                onClick={() => {
                  setComps({ ...comps, [addType]: 1 });
                  setAddType('');
                }}
                title="Придан расчёт, подошла техника: тип появится в составе элемента"
              >
                Добавить
              </Btn>
            </div>
          )}
        </div>
        <div className="stack">
          {editing ? (
            <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {stateKeys.map((x) => (
                <Field key={x.key} label={x.label}>
                  <Num
                    value={patch[x.key] ?? Math.round(el[x.key] as number)}
                    onChange={(v) => setPatch({ ...patch, [x.key]: v })}
                    min={0}
                    max={100}
                    width="100%"
                  />
                </Field>
              ))}
            </div>
          ) : (
            <div className="state-list">
              {stateKeys.map((x) => (
                <StateRow key={x.key} label={x.label} value={el[x.key] as number} inverse={HIGH_IS_BAD.has(x.key)} />
              ))}
            </div>
          )}
          {!editing && (
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>
                Последние события
              </div>
              <div className="stack small" style={{ gap: 4 }}>
                {events.length ? (
                  events.map((x, i) => (
                    <div key={i}>
                      <span className="faint">ход {x.turn} · </span>
                      <RichText text={x.text} b={b} />
                    </div>
                  ))
                ) : (
                  <span className="faint">Событий пока нет.</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ConditionsModal({ b, onClose, iv }: { b: Battle; onClose: () => void; iv: Iv }) {
  const rs = b.ruleset;
  const [cond, setCond] = useState<Record<string, string>>({ ...b.conditions });
  const [bandIdx, setBand] = useState(b.bandIndex);
  // Участки: своя дистанция и свои условия (пусто — как на всём поле).
  const [secs, setSecs] = useState(() =>
    (b.sectors ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      band: x.bandIndex,
      cond: { ...x.conditions },
      fort: { ...x.fortification } as Record<string, string>,
    })),
  );
  // Укрепления и разведданные сторон (укрепления — на всём поле и по участкам).
  const [sideFort, setSideFort] = useState<Record<SideId, string>>({ A: b.sides.A.fortification, B: b.sides.B.fortification });
  const [sideIntel, setSideIntel] = useState<Record<SideId, string>>({ A: b.sides.A.intel, B: b.sides.B.intel });
  const setSec = (i: number, patch: Partial<(typeof secs)[number]>) => setSecs(secs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const apply = () => {
    if (Object.keys(cond).some((k) => cond[k] !== b.conditions[k])) iv('setConditions', { conditions: cond });
    if (!b.sectors && bandIdx !== b.bandIndex) iv('setBand', { bandIndex: bandIdx });
    secs.forEach((x, i) => {
      const was = b.sectors![i];
      if (x.band !== was.bandIndex) iv('setBand', { sector: x.id, bandIndex: x.band });
      const changed: Record<string, string> = {};
      for (const cat of rs.conditions) if ((x.cond[cat.id] ?? '') !== (was.conditions[cat.id] ?? '')) changed[cat.id] = x.cond[cat.id] ?? '';
      if (Object.keys(changed).length) iv('setConditions', { sector: x.id, conditions: changed });
      for (const sd of SIDES)
        if ((x.fort[sd] ?? '') !== (was.fortification[sd] ?? '')) iv('setSide', { side: sd, sector: x.id, fortification: x.fort[sd] ?? '' });
    });
    for (const sd of SIDES) {
      const p: Record<string, unknown> = { side: sd };
      if (sideFort[sd] !== b.sides[sd].fortification) p.fortification = sideFort[sd];
      if (sideIntel[sd] !== b.sides[sd].intel) p.intel = sideIntel[sd];
      if (Object.keys(p).length > 1) iv('setSide', p);
    }
    onClose();
  };
  return (
    <Modal
      title="Условия боя"
      wide={!!b.sectors}
      onClose={onClose}
      footer={
        <>
          <IvNote />
          <span className="grow" />
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={apply}>
            Применить
          </Btn>
        </>
      }
    >
      <div className="fields two">
        {rs.conditions.map((c) => (
          <Field key={c.id} label={c.name}>
            <Sel
              value={cond[c.id] ?? ''}
              onChange={(v) => setCond({ ...cond, [c.id]: v })}
              options={c.options.map((o) => ({ value: o.id, label: o.name, title: o.description }))}
            />
          </Field>
        ))}
        {!b.sectors && (
          <Field label="Дистанция">
            <Sel value={bandIdx} onChange={setBand} options={rs.rangeBands.map((x, i) => ({ value: i, label: x.name }))} />
          </Field>
        )}
      </div>
      <div className="fields two" style={{ marginTop: 12 }}>
        {SIDES.map((sd) => (
          <Field
            key={sd}
            label={<span style={{ color: b.sides[sd].color }}>{b.sides[sd].name}</span>}
            hint="Укрепления разбиты или дооборудованы, разведка уточнила данные о противнике."
          >
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <Sel
                value={sideFort[sd]}
                onChange={(v) => setSideFort({ ...sideFort, [sd]: v })}
                options={rs.fortifications.map((o) => ({ value: o.id, label: `укрепления: ${o.name}`, title: o.description }))}
              />
              <Sel
                value={sideIntel[sd]}
                onChange={(v) => setSideIntel({ ...sideIntel, [sd]: v })}
                options={rs.intelLevels.map((o) => ({ value: o.id, label: `разведданные: ${o.name}`, title: o.description }))}
              />
            </div>
          </Field>
        ))}
      </div>
      {secs.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div className="small muted">Участки боя: своя дистанция и условия поверх общих</div>
          {secs.map((x, i) => (
            <div key={x.id} className="row" style={{ gap: 8 }}>
              <b style={{ minWidth: 110 }}>{x.name}</b>
              <Sel value={x.band} onChange={(v) => setSec(i, { band: v })} options={rs.rangeBands.map((r, j) => ({ value: j, label: r.name }))} width={170} />
              {rs.conditions.map((c) => (
                <Sel
                  key={c.id}
                  value={x.cond[c.id] ?? ''}
                  onChange={(v) => setSec(i, { cond: { ...x.cond, [c.id]: v } })}
                  options={[{ value: '', label: `${c.name}: как на всём поле` }, ...c.options.map((o) => ({ value: o.id, label: `${c.name}: ${o.name}` }))]}
                  width={190}
                />
              ))}
              {SIDES.map((sd) => (
                <Sel
                  key={sd}
                  value={x.fort[sd] ?? ''}
                  onChange={(v) => setSec(i, { fort: { ...x.fort, [sd]: v } })}
                  options={[
                    { value: '', label: `${b.sides[sd].name}: укрепления как у стороны` },
                    ...rs.fortifications.map((o) => ({ value: o.id, label: `${b.sides[sd].name}: ${o.name}` })),
                  ]}
                  width={210}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="faint small" style={{ marginTop: 10, marginBottom: 0 }}>
        Действует со следующего хода и записывается в журнал.
      </p>
    </Modal>
  );
}

export function FormationModal({
  b,
  id,
  onClose,
  iv,
  onEffect,
  onStrike,
}: {
  b: Battle;
  id: string;
  onClose: () => void;
  iv: Iv;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, t: Target) => void;
}) {
  const fs = b.formations.find((x) => x.id === id);
  const rs = b.ruleset;
  const [order, setOrder] = useState('');
  const [comms, setComms] = useState(fs?.comms ?? 100);
  const [supply, setSupply] = useState(fs?.supply ?? 100);
  const [cmd, setCmd] = useState(fs?.commandLevel ?? 0);
  if (!fs) return null;
  return (
    <Modal
      title={fs.name}
      onClose={onClose}
      footer={
        <>
          {!b.finished && (
            <Btn onClick={() => onEffect({ side: fs.side, formationId: fs.id, label: fs.name })} title="Временный эффект на всё формирование">
              Эффект…
            </Btn>
          )}
          {!b.finished && (b.support ?? []).some((a) => a.side !== fs.side && a.left > 0) && (
            <Btn
              onClick={() => onStrike(fs.side === 'A' ? 'B' : 'A', { side: fs.side, formationId: fs.id, label: fs.name })}
              title="Удар огневой поддержки противника по этому формированию"
            >
              Удар…
            </Btn>
          )}
          {!b.finished && (
            <Menu
              label="Ещё…"
              items={[
                (rs.features.ammo || rs.features.fuel || rs.features.equipment) && {
                  label: 'Подвезти…',
                  onClick: () => (onClose(), openDecision({ kind: 'resupply', target: { side: fs.side, formationId: fs.id, label: fs.name } })),
                },
                (b.sectors?.length ?? 0) > 1 && {
                  label: 'Перебросить на участок…',
                  onClick: () => (onClose(), openDecision({ kind: 'transfer', target: { side: fs.side, formationId: fs.id, label: fs.name } })),
                },
                {
                  label: 'Заметка в журнал…',
                  onClick: () => (onClose(), openDecision({ kind: 'note', target: { side: fs.side, formationId: fs.id, label: fs.name } })),
                },
              ]}
            />
          )}
          <span className="grow" />
          {!b.finished && <IvNote width={170} />}
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={b.finished}
            onClick={() => {
              const p: Record<string, unknown> = { formationId: fs.id };
              if (order) p.orderId = order;
              if (comms !== fs.comms) p.comms = comms;
              if (supply !== fs.supply) p.supply = supply;
              if (cmd !== fs.commandLevel) p.commandLevel = cmd;
              if (Object.keys(p).length > 1) iv('setFormation', p);
              onClose();
            }}
          >
            Применить
          </Btn>
        </>
      }
    >
      <div className="fields two">
        <Field label="Приказ всем элементам" hint="Получат все элементы, включая вложенные подразделения.">
          <Sel
            value={order}
            onChange={setOrder}
            options={[{ value: '', label: '— не менять —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: o.description }))]}
          />
        </Field>
        {rs.features.command && (
          <Field label="Командир">
            <Sel
              value={cmd}
              onChange={setCmd}
              options={[{ value: 0, label: 'без командира' }, ...rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))]}
            />
          </Field>
        )}
        {rs.features.comms && (
          <Field label="Связь, %">
            <Num value={comms} onChange={setComms} min={0} max={100} />
          </Field>
        )}
        <Field label="Снабжение, %">
          <Num value={supply} onChange={setSupply} min={0} max={100} />
        </Field>
      </div>
      {fs.hqLost && (
        <div className="note bad" style={{ marginTop: 10 }}>
          Штаб потерян: связь снижена, влияние командира утрачено.
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ графики
