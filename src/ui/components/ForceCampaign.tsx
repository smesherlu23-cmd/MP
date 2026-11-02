// Силы между боями: отдых (состояние бойцов в строю — к норме на N%), лечение раненых, ремонт техники,
// пополнение — из резерва или из другого подразделения — и боевой путь подразделения.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  betweenNeeds,
  prepareForce,
  type BetweenPlan,
  forceCondition,
  REST_PART_IDS,
  REST_PARTS,
  STATE_LABELS,
  strengthByType,
  type ForceCondition,
  type ForceRecord,
  type Id,
  type RestPart,
  type Ruleset,
  type StateKey,
  type UnitNode,
} from '../../engine';
import { confirmDialog, defaultRulesetId, fmtDate, openTab, prepareForceStep, promptDialog, toastUndoable, updateForce, useApp } from '../store';
import { Icon, type IconName } from './Icon';
import { Area, Btn, Check, Field, Menu, Modal, Num, Range, Section, Seg, Txt, fmt0 } from './ui';

/** Боеготовность сил — подпись и цвет. */
export const LEVEL_LABEL: Record<ForceCondition['level'], { text: string; cls: string }> = {
  ready: { text: 'Боеготовы', cls: 'good' },
  worn: { text: 'Потрёпаны', cls: 'warn' },
  depleted: { text: 'Обескровлены', cls: 'bad' },
};

export const signed = (v: number | undefined, unit: string) => (v ? `${v > 0 ? '+' : '−'}${fmt0(Math.abs(v))} ${unit}` : '');
const rulesetIdOf = (f: UnitNode) => f.rulesetId ?? defaultRulesetId() ?? '';
const useRuleset = (f: UnitNode): Ruleset | undefined => useApp((s) => s.rulesets[rulesetIdOf(f)]);
const PERCENT_KEYS = new Set<StateKey>(['ammo', 'fuel', 'equipment']);
const fmtState = (k: StateKey, v: number) => `${Math.round(v)}${PERCENT_KEYS.has(k) ? '%' : ''}`;

/** Процент: ползунок, поле и быстрые 25 / 50 / 75 / 100. */
function PctPicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="row rest-pct">
      <Range value={value} onChange={(v) => onChange(Math.max(0, Math.min(100, Math.round(v))))} min={0} max={100} step={5} disabled={disabled} />
      {[25, 50, 75, 100].map((v) => (
        <Btn key={v} sm kind={value === v ? 'primary' : 'ghost'} disabled={disabled} onClick={() => onChange(v)}>
          {v}%
        </Btn>
      ))}
    </div>
  );
}

/**
 * «Восстановить» — всё между боями в одном окне: лечение и ремонт (сколько вернуть), пополнение до штата из резерва
 * или из другого подразделения, отдых (что восстанавливать), боезапас и топливо; справа видно, что станет.
 * Одна запись в боевом пути, один шаг отмены (вместе с донором).
 */
export function BetweenModal({ force, onClose }: { force: UnitNode; onClose: () => void }) {
  const rs = useRuleset(force);
  const forces = useApp((s) => s.forces);
  const n = betweenNeeds(force, rs);
  const missing = n.personnelMissing + n.equipmentMissing;
  const [on, setOn] = useState({
    heal: n.heal > 0,
    repair: n.repair > 0 || n.vehicleCondition,
    replenish: false,
    rest: n.rest,
    ammo: n.ammo,
    fuel: n.fuel,
  });
  const [heal, setHeal] = useState(100);
  const [repair, setRepair] = useState(100);
  const [rest, setRest] = useState(100);
  const [restParts, setRestParts] = useState<RestPart[]>(REST_PART_IDS);
  const [ammo, setAmmo] = useState(100);
  const [fuel, setFuel] = useState(100);
  const [source, setSource] = useState<'reserve' | 'force'>('reserve');
  const [repPers, setRepPers] = useState(true);
  const [repEquip, setRepEquip] = useState(true);
  const [note, setNote] = useState('');

  // Чего не хватает до штата — по типам, после лечения и ремонта (если они отмечены).
  const healPct = on.heal ? heal : undefined;
  const repairPct = on.repair ? repair : undefined;
  const healed = useMemo(() => prepareForce(force, rs, { heal: healPct, repair: repairPct }).force, [force, rs, healPct, repairPct]);
  const need = useMemo(
    () =>
      [...strengthByType(healed).entries()]
        .map(([typeId, x]) => ({ typeId, gap: Math.max(0, x.authorized - x.current), rec: x.recoverable }))
        .filter((x) => x.gap > 0),
    [healed],
  );
  // Доноры — силы с тем же набором правил, своя команда — первой.
  const team = force.faction?.trim() || '';
  const ownTeam = (f: UnitNode) => (f.faction?.trim() || '') === team;
  const donors = useMemo(
    () =>
      Object.values(forces)
        .filter((f) => f.id !== force.id && rulesetIdOf(f) === rulesetIdOf(force))
        .map((f) => {
          const st = strengthByType(f);
          return { f, st, can: need.reduce((a, x) => a + Math.min(x.gap, st.get(x.typeId)?.current ?? 0), 0) };
        })
        .sort(
          (a, b) =>
            Number((b.f.faction?.trim() || '') === team) - Number((a.f.faction?.trim() || '') === team) ||
            b.can - a.can ||
            a.f.name.localeCompare(b.f.name, 'ru'),
        ),
    [forces, force, need, team],
  );
  // По умолчанию — из своей команды (где есть нужное); из чужой — только если выбрать явно.
  const [donorId, setDonorId] = useState<Id>(() => donors.find((d) => ownTeam(d.f) && d.can > 0)?.f.id ?? donors.find((d) => ownTeam(d.f))?.f.id ?? '');
  const donor = donors.find((d) => d.f.id === donorId);
  const [amounts, setAmounts] = useState<Record<Id, number>>({});
  const maxOf = (typeId: Id) => Math.min(need.find((x) => x.typeId === typeId)?.gap ?? 0, donor?.st.get(typeId)?.current ?? 0);
  const amountOf = (typeId: Id) => Math.min(amounts[typeId] ?? Number.POSITIVE_INFINITY, maxOf(typeId));
  const typeName = (id: Id) => rs?.componentTypes.find((t) => t.id === id)?.name ?? id;

  const fromForce = on.replenish && source === 'force';
  const plan: BetweenPlan = {
    heal: healPct,
    repair: repairPct,
    transfer: fromForce && donor ? { donor: donor.f, amounts: Object.fromEntries(need.map((x) => [x.typeId, amountOf(x.typeId)])) } : undefined,
    replenish: on.replenish && source === 'reserve' ? { personnel: repPers, equipment: repEquip, note: note.trim() || undefined } : undefined,
    rest: on.rest && restParts.length ? { pct: rest, parts: restParts } : undefined,
    ammo: on.ammo ? ammo : undefined,
    fuel: on.fuel ? fuel : undefined,
  };
  const preview = prepareForce(force, rs, plan);
  const before = forceCondition(force, rs);
  const after = forceCondition(preview.force, rs);
  const donorBefore = fromForce && donor ? forceCondition(donor.f, rs) : null;
  const donorAfter = fromForce && preview.donor ? forceCondition(preview.donor, rs) : null;
  const toggle = (k: keyof typeof on) => (v: boolean) => setOn((o) => ({ ...o, [k]: v }));
  const pct = (value: number, set: (v: number) => void, k: keyof typeof on, hint: string) => (
    <div className="between-pct">
      <span className="faint small">{hint}</span>
      <PctPicker value={value} onChange={set} disabled={!on[k]} />
    </div>
  );

  const cmp: { label: string; b: string; a: string; better: boolean }[] = [
    { label: 'Личный состав', b: `${fmt0(before.persCur)} / ${fmt0(before.persAuth)}`, a: fmt0(after.persCur), better: after.persCur > before.persCur },
    ...(before.equipAuth > 0
      ? [{ label: 'Техника', b: `${fmt0(before.equipCur)} / ${fmt0(before.equipAuth)}`, a: fmt0(after.equipCur), better: after.equipCur > before.equipCur }]
      : []),
    ...(['morale', 'fatigue', 'cohesion', 'ammo', 'fuel'] as const).map((k) => ({
      label: STATE_LABELS[k],
      b: fmtState(k, before.state[k]),
      a: fmtState(k, after.state[k]),
      better: k === 'fatigue' ? after.state[k] < before.state[k] : after.state[k] > before.state[k],
    })),
  ];
  const anything = n.heal > 0 || n.repair > 0 || n.vehicleCondition || missing > 0 || n.rest || n.ammo || n.fuel;

  return (
    <Modal
      title={`Восстановить — ${force.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small grow">Одна запись в боевом пути. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!preview.changed}
            onClick={() => {
              prepareForceStep(force.id, plan);
              onClose();
            }}
          >
            Восстановить
          </Btn>
        </>
      }
    >
      <div className="between-grid">
        <div className="stack" style={{ gap: 10 }}>
          {n.heal > 0 && (
            <div className="between-row">
              <Check value={on.heal} onChange={toggle('heal')}>
                Лечить — раненых {fmt0(n.heal)} чел.
              </Check>
              {pct(heal, setHeal, 'heal', 'сколько вернуть в строй')}
            </div>
          )}
          {(n.repair > 0 || n.vehicleCondition) && (
            <div className="between-row">
              <Check value={on.repair} onChange={toggle('repair')}>
                {n.repair ? `Чинить — в ремонте ${fmt0(n.repair)} ед.` : 'Чинить — состояние техники'}
              </Check>
              {pct(repair, setRepair, 'repair', 'сколько вернуть в строй')}
            </div>
          )}
          {missing > 0 && (
            <div className="between-row">
              <Check value={on.replenish} onChange={toggle('replenish')}>
                Пополнить до штата{on.heal || on.repair ? ' (после лечения и ремонта)' : ''}
              </Check>
              {on.replenish && (
                <div className="between-pct">
                  <Seg
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: 'reserve', label: 'Из резерва' },
                      { value: 'force', label: 'Из другого подразделения', title: 'Люди и техника переходят из другого подразделения сил' },
                    ]}
                  />
                  {source === 'reserve' ? (
                    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                        <Check value={repPers} onChange={setRepPers}>
                          личный состав
                        </Check>
                        <Check value={repEquip} onChange={setRepEquip}>
                          техника и вооружение
                        </Check>
                      </div>
                      <Txt value={note} onChange={setNote} placeholder="Откуда пополнение: маршевая рота, из резерва…" />
                    </div>
                  ) : !donors.length ? (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      Других подразделений сил с тем же набором правил нет.
                    </div>
                  ) : (
                    <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                      <select
                        aria-label="Из какого подразделения"
                        value={donorId}
                        onChange={(e) => {
                          setDonorId(e.target.value);
                          setAmounts({});
                        }}
                      >
                        {!donor && <option value="">— выберите подразделение —</option>}
                        {[true, false].map((own) => {
                          const list = donors.filter((d) => ownTeam(d.f) === own);
                          return list.length ? (
                            <optgroup key={String(own)} label={own ? (team ? `Команда «${team}»` : 'Без команды') : 'Другие команды'}>
                              {list.map((d) => (
                                <option key={d.f.id} value={d.f.id}>
                                  {d.f.name}
                                  {!own && d.f.faction ? ` · ${d.f.faction}` : ''}
                                  {d.can ? '' : ' — нужного нет'}
                                </option>
                              ))}
                            </optgroup>
                          ) : null;
                        })}
                      </select>
                      {!need.length && <div className="muted small">После лечения и ремонта пополнять нечего.</div>}
                      {donor && need.length > 0 && (
                        <table className="tbl transfer-table">
                          <thead>
                            <tr>
                              <th>Тип</th>
                              <th className="num">Не хватает</th>
                              <th className="num">У донора</th>
                              <th className="num">Передать</th>
                            </tr>
                          </thead>
                          <tbody>
                            {need.map((x) => (
                              <tr key={x.typeId}>
                                <td>{typeName(x.typeId)}</td>
                                <td className="num">{fmt0(x.gap)}</td>
                                <td className="num">{fmt0(donor.st.get(x.typeId)?.current ?? 0)}</td>
                                <td className="num">
                                  <Num
                                    value={amountOf(x.typeId)}
                                    onChange={(v) => setAmounts((a) => ({ ...a, [x.typeId]: Math.max(0, Math.round(v)) }))}
                                    min={0}
                                    max={maxOf(x.typeId)}
                                    integer
                                    width={72}
                                    disabled={!maxOf(x.typeId)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {donor && donorBefore && donorAfter && (
                        <div className="muted small">
                          У «{donor.f.name}» останется {fmt0(donorAfter.persCur)} из {fmt0(donorAfter.persAuth)} чел.
                          {donorAfter.equipAuth > 0 && `, техники ${fmt0(donorAfter.equipCur)} из ${fmt0(donorAfter.equipAuth)}`}
                          {donorBefore.persCur - donorAfter.persCur > 0 && ` (уйдёт ${fmt0(donorBefore.persCur - donorAfter.persCur)} чел. вместе с экипажами)`}
                          .
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {n.rest && (
            <div className="between-row">
              <Check value={on.rest} onChange={toggle('rest')}>
                Отдых — состояние бойцов в строю
              </Check>
              {pct(rest, setRest, 'rest', '% до нормы')}
              <div className="between-pct row" style={{ gap: 14, flexWrap: 'wrap', flexDirection: 'row' }}>
                {REST_PARTS.map((x) => (
                  <Check key={x.id} value={restParts.includes(x.id)} onChange={(v) => setRestParts((p) => (v ? [...p, x.id] : p.filter((y) => y !== x.id)))}>
                    {x.label}
                  </Check>
                ))}
              </div>
            </div>
          )}
          {n.ammo && (
            <div className="between-row">
              <Check value={on.ammo} onChange={toggle('ammo')}>
                Боезапас
              </Check>
              {pct(ammo, setAmmo, 'ammo', 'до уровня (у кого больше — как есть)')}
            </div>
          )}
          {n.fuel && (
            <div className="between-row">
              <Check value={on.fuel} onChange={toggle('fuel')}>
                Топливо
              </Check>
              {pct(fuel, setFuel, 'fuel', 'до уровня (у кого больше — как есть)')}
            </div>
          )}
          {!anything && <div className="muted">Силы в норме — делать нечего.</div>}
        </div>
        <table className="tbl rest-preview">
          <thead>
            <tr>
              <th />
              <th className="num">Сейчас</th>
              <th className="num">Станет</th>
            </tr>
          </thead>
          <tbody>
            {cmp.map((x) => (
              <tr key={x.label}>
                <td>{x.label}</td>
                <td className="num">{x.b}</td>
                <td className={`num${x.better ? ' good' : ''}`}>
                  <b>{x.a}</b>
                </td>
              </tr>
            ))}
            <tr>
              <td>Боеготовность</td>
              <td className="num">
                <span className={`badge ${LEVEL_LABEL[before.level].cls}`}>{LEVEL_LABEL[before.level].text}</span>
              </td>
              <td className="num">
                <span className={`badge ${LEVEL_LABEL[after.level].cls}`}>{LEVEL_LABEL[after.level].text}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/**
 * Действие между боями — одна кнопка «Восстановить…» (окно со всем сразу); её нет, когда делать нечего.
 * quiet — не выделенная: в каталоге карточек много, выделенная кнопка должна быть одна на экран.
 */
export function ForceActions({ force, grid, quiet }: { force: UnitNode; grid?: boolean; compact?: boolean; quiet?: boolean }) {
  const rs = useRuleset(force);
  const [open, setOpen] = useState(false);
  const n = betweenNeeds(force, rs);
  const any = n.rest || n.heal > 0 || n.repair > 0 || n.vehicleCondition || n.personnelMissing + n.equipmentMissing > 0 || n.ammo || n.fuel;
  if (!any) return grid ? <div className="force-actions-ok faint small">Состояние в норме — действия не нужны</div> : null;
  const btn = (
    <Btn sm kind={quiet ? undefined : 'primary'} onClick={() => setOpen(true)} title="Лечить, чинить, пополнить, отдых, боезапас и топливо — в одном окне">
      <Icon name="restore" size={14} /> Восстановить…
    </Btn>
  );
  return (
    <>
      {grid ? <div className="force-actions">{btn}</div> : btn}
      {open && createPortal(<BetweenModal force={force} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export const KIND_ICON: Record<ForceRecord['kind'], IconName> = {
  battle: 'battle',
  rest: 'rest',
  heal: 'heal',
  repair: 'wrench',
  supply: 'package',
  replenish: 'replenish',
  transfer: 'transfer',
  restore: 'restore',
  experience: 'star',
  note: 'pencil',
};

/** Потери людей в бою по видам — для подсказки; в записях прежних версий разбивки нет. */
export const lossBreakdown = (x: Pick<ForceRecord, 'killed' | 'wounded' | 'missing'>) =>
  x.wounded === undefined ? undefined : `убито ${fmt0(x.killed ?? 0)}, ранено ${fmt0(x.wounded)}, пропало без вести ${fmt0(x.missing ?? 0)}`;

/** Боевой путь сил: бои (с исходом и потерями), отдых, лечение, ремонт, пополнения, свои записи ГМ. */
export function ForceHistory({ force }: { force: UnitNode }) {
  const list = force.history ?? [];
  const index = useApp((s) => s.battleIndex);
  const [adding, setAdding] = useState(false);
  const battles = list.filter((x) => x.kind === 'battle' && x.battleId).length;
  const lost = list.filter((x) => x.kind === 'battle').reduce((a, x) => a - (x.personnel ?? 0), 0);
  const wounded = list.reduce((a, x) => a + (x.kind === 'battle' ? (x.wounded ?? 0) : 0), 0);
  const summary = list.length
    ? `боёв: ${battles}${lost > 0 ? `, потери за всё время: ${fmt0(lost)} чел.${wounded ? `, из них ранено ${fmt0(wounded)}` : ''}` : ''}`
    : 'пока пусто';
  // Запись ищется по месту в списке и по времени — на случай, если список успел измениться.
  const edit = (i: number, fn: (h: ForceRecord[], at: number) => void) =>
    updateForce(force.id, (d) => {
      const h = d.history ?? [];
      const at = h[i]?.at === list[i]?.at ? i : h.findIndex((x) => x.at === list[i]?.at && x.title === list[i]?.title);
      if (at >= 0) fn(h, at);
      d.history = h;
    });
  const editNote = async (i: number) => {
    const x = list[i];
    const v = await promptDialog(x.kind === 'note' ? 'Запись боевого пути' : 'Заметка к записи', x.kind === 'note' ? x.title : (x.note ?? ''));
    if (v === null || v === undefined) return;
    edit(i, (h, at) => {
      if (x.kind === 'note') h[at].title = v.trim() || h[at].title;
      else if (v.trim()) h[at].note = v.trim();
      else delete h[at].note;
    });
  };
  const remove = async (i: number) => {
    const x = list[i];
    const battle = x.kind === 'battle' && x.battleId;
    if (
      !(await confirmDialog(
        'Удалить запись?',
        `«${x.title}» уберётся из боевого пути. Численность и состояние сил не изменятся.${battle ? ' Рост опыта считается по записям боёв — этот бой больше не будет учтён.' : ''}`,
        'Удалить',
        true,
      ))
    )
      return;
    edit(i, (h, at) => void h.splice(at, 1));
    toastUndoable('Запись удалена.');
  };
  return (
    <>
      <Section
        id="force-history"
        title="Боевой путь"
        summary={summary}
        defaultOpen={list.length > 0}
        actions={
          <Btn sm kind="ghost" onClick={() => setAdding(true)} title="Своя запись: марш, переформирование, награждение…">
            + Запись
          </Btn>
        }
      >
        {!list.length && (
          <div className="muted">Здесь появятся бои, итоги которых записаны в эти силы, а также отдых, лечение, ремонт, пополнения и свои записи.</div>
        )}
        <div className="stack" style={{ gap: 4 }}>
          {list
            .map((x, i) => ({ x, i }))
            .reverse()
            .map(({ x, i }) => (
              <div key={`${x.at}-${i}`} className="history-row">
                <span className="faint small nowrap">{fmtDate(x.at)}</span>
                <span className="history-icon">
                  <Icon name={KIND_ICON[x.kind] ?? 'dot'} size={14} />
                </span>
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
                <span className={`small nowrap ${(x.personnel ?? 0) < 0 ? 'bad' : (x.personnel ?? 0) > 0 ? 'good' : 'faint'}`} data-tip={lossBreakdown(x)}>
                  {[signed(x.personnel, 'чел.'), signed(x.equipment, 'ед.')].filter(Boolean).join(', ') || '—'}
                </span>
                <Menu
                  sm
                  items={[
                    { label: x.kind === 'note' ? 'Изменить текст…' : x.note ? 'Изменить заметку…' : 'Добавить заметку…', onClick: () => void editNote(i) },
                    { label: 'Удалить запись', danger: true, onClick: () => void remove(i) },
                  ]}
                />
              </div>
            ))}
        </div>
      </Section>
      {/* Окно — вне раздела: добавить запись можно и в свёрнутом. */}
      {adding && createPortal(<RecordModal force={force} onClose={() => setAdding(false)} />, document.body)}
    </>
  );
}

/** Своя запись в боевой путь: дата и текст. */
function RecordModal({ force, onClose }: { force: UnitNode; onClose: () => void }) {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(iso(today));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const save = () => {
    const at = date === iso(today) ? today.toISOString() : new Date(`${date}T12:00`).toISOString();
    updateForce(force.id, (d) => {
      const h = d.history ?? [];
      const rec: ForceRecord = { at, kind: 'note', title: title.trim(), ...(note.trim() ? { note: note.trim() } : {}) };
      // По дате: запись задним числом встаёт на своё место.
      const pos = h.findIndex((x) => x.at > at);
      if (pos < 0) h.push(rec);
      else h.splice(pos, 0, rec);
      d.history = h;
    });
    onClose();
  };
  return (
    <Modal
      title="Запись в боевой путь"
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">На численность и состояние сил не влияет.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!title.trim() || !date} onClick={save}>
            Добавить
          </Btn>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="fields two">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Что было">
            <Txt value={title} onChange={setTitle} placeholder="Марш к переправе, переформирование…" width="100%" />
          </Field>
        </div>
        <Field label="Подробности">
          <Area value={note} onChange={setNote} rows={3} placeholder="необязательно" />
        </Field>
      </div>
    </Modal>
  );
}
