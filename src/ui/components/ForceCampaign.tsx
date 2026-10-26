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
  ROOT_STATE,
  replenishForce,
  restForce,
  resupplyForce,
  STATE_LABELS,
  SUPPLY_LABEL,
  strengthByType,
  transferStrength,
  type ForceCondition,
  type ForceRecord,
  type Id,
  type RestPart,
  type Ruleset,
  type StateKey,
  type SupplyKey,
  type UnitNode,
  walkUnits,
} from '../../engine';
import {
  defaultRulesetId,
  fmtDate,
  healForceStep,
  historyStep,
  openTab,
  prepareForceStep,
  repairForceStep,
  restForceStep,
  resupplyForceStep,
  toastUndoable,
  transferStrengthStep,
  updateForce,
  useApp,
} from '../store';
import { Icon, type IconName } from './Icon';
import { Btn, Check, Field, Modal, Num, Range, Section, Seg, Txt, fmt0 } from './ui';

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

/** Отдых: насколько (в % разницы до нормы) и что восстанавливать; видно, что станет с показателями. */
export function RestModal({ force, onClose }: { force: UnitNode; onClose: () => void }) {
  const rs = useRuleset(force);
  const [pct, setPct] = useState(100);
  const [parts, setParts] = useState<RestPart[]>(REST_PART_IDS);
  const preview = useMemo(() => restForce(force, pct, parts), [force, pct, parts]);
  const before = forceCondition(force, rs).state;
  const after = forceCondition(preview.force, rs).state;
  const keys = REST_PARTS.filter((x) => parts.includes(x.id)).flatMap((x) => x.keys as readonly StateKey[]);
  return (
    <Modal
      title={`Отдых — ${force.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Запишется в боевой путь. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!preview.changed}
            onClick={() => {
              restForceStep(force.id, pct, parts);
              onClose();
            }}
          >
            Отдых {pct}%
          </Btn>
        </>
      }
    >
      <div className="muted small" style={{ marginBottom: 12 }}>
        Восстанавливается состояние бойцов, которые сейчас в строю. Раненые и техника в ремонте не возвращаются — для этого «Лечить» и «Чинить», недостающих —
        «Пополнить», а боезапас и топливо пополняются отдельно.
      </div>
      <Field label="Насколько восстановить, % до нормы">
        <div className="row rest-pct">
          <Range value={pct} onChange={(v) => setPct(Math.max(0, Math.min(100, Math.round(v))))} min={0} max={100} step={5} />
          {[25, 50, 75, 100].map((v) => (
            <Btn key={v} sm kind={pct === v ? 'primary' : 'ghost'} onClick={() => setPct(v)}>
              {v}%
            </Btn>
          ))}
        </div>
      </Field>
      <div className="row" style={{ gap: 16, margin: '10px 0 12px', flexWrap: 'wrap' }}>
        {REST_PARTS.map((x) => (
          <Check key={x.id} value={parts.includes(x.id)} onChange={(v) => setParts((p) => (v ? [...p, x.id] : p.filter((y) => y !== x.id)))}>
            {x.label}
          </Check>
        ))}
      </div>
      {keys.length > 0 && (
        <table className="tbl rest-preview">
          <thead>
            <tr>
              <th />
              <th className="num">Сейчас</th>
              <th className="num">После отдыха</th>
              <th className="num">Норма</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td>{STATE_LABELS[k]}</td>
                <td className="num">{fmtState(k, before[k])}</td>
                <td className={`num${Math.round(after[k]) !== Math.round(before[k]) ? ' good' : ''}`}>
                  <b>{fmtState(k, after[k])}</b>
                </td>
                <td className="num faint">{fmtState(k, ROOT_STATE[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** Пополнение боезапаса или топлива: до какого уровня (у кого больше — не трогается). */
export function SupplyModal({ force, what, onClose }: { force: UnitNode; what: SupplyKey; onClose: () => void }) {
  const rs = useRuleset(force);
  const [level, setLevel] = useState(100);
  const preview = useMemo(() => resupplyForce(force, what, level), [force, what, level]);
  const before = forceCondition(force, rs).state[what];
  const after = forceCondition(preview.force, rs).state[what];
  let low = 0;
  let total = 0;
  walkUnits(force, (n) => {
    total++;
    const v = n.state[what];
    if (typeof v === 'number' && v < level) low++;
  });
  const name = SUPPLY_LABEL[what].name;
  return (
    <Modal
      title={`${name} — ${force.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Запишется в боевой путь. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!preview.changed}
            onClick={() => {
              resupplyForceStep(force.id, what, level);
              onClose();
            }}
          >
            Пополнить до {level}%
          </Btn>
        </>
      }
    >
      <Field label="Пополнить до, %">
        <div className="row rest-pct">
          <Range value={level} onChange={(v) => setLevel(Math.max(0, Math.min(100, Math.round(v))))} min={0} max={100} step={5} />
          {[25, 50, 75, 100].map((v) => (
            <Btn key={v} sm kind={level === v ? 'primary' : 'ghost'} onClick={() => setLevel(v)}>
              {v}%
            </Btn>
          ))}
        </div>
      </Field>
      <div className="note" style={{ marginTop: 12 }}>
        {name}: сейчас в среднем <b>{Math.round(before)}%</b> → после пополнения <b className={after > before ? 'good' : undefined}>{Math.round(after)}%</b>.
        {preview.changed
          ? ` Пополнятся подразделения, у которых меньше ${level}%${total > 1 ? ` (${low} из ${total})` : ''}; у кого больше — останется как есть.`
          : ` Везде уже не меньше ${level}%.`}
      </div>
    </Modal>
  );
}

/** Пополнение: из резерва (до штата) или из другого подразделения — по типам, сколько передать. */
export function ReplenishModal({ force, onClose }: { force: UnitNode; onClose: () => void }) {
  const rs = useRuleset(force);
  const forces = useApp((s) => s.forces);
  const [source, setSource] = useState<'reserve' | 'force'>('reserve');
  const [personnel, setPersonnel] = useState(true);
  const [equipment, setEquipment] = useState(true);
  const [note, setNote] = useState('');
  const reserve = useMemo(() => replenishForce(force, rs, { personnel, equipment }, note || undefined), [force, rs, personnel, equipment, note]);

  // Чего не хватает до штата — по типам; доноры — силы с тем же набором правил, своя команда — первой.
  const need = useMemo(
    () =>
      [...strengthByType(force).entries()]
        .map(([typeId, x]) => ({ typeId, gap: Math.max(0, x.authorized - x.current), rec: x.recoverable }))
        .filter((x) => x.gap > 0),
    [force],
  );
  const team = force.faction?.trim() || '';
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
  const ownTeam = (f: UnitNode) => (f.faction?.trim() || '') === team;
  // По умолчанию — из своей команды (где есть нужное); из чужой — только если выбрать явно.
  const [donorId, setDonorId] = useState<Id>(() => donors.find((d) => ownTeam(d.f) && d.can > 0)?.f.id ?? donors.find((d) => ownTeam(d.f))?.f.id ?? '');
  const donor = donors.find((d) => d.f.id === donorId);
  const [amounts, setAmounts] = useState<Record<Id, number>>({});
  const maxOf = (typeId: Id) => Math.min(need.find((x) => x.typeId === typeId)?.gap ?? 0, donor?.st.get(typeId)?.current ?? 0);
  const amountOf = (typeId: Id) => Math.min(amounts[typeId] ?? Number.POSITIVE_INFINITY, maxOf(typeId));
  const plan = Object.fromEntries(need.map((x) => [x.typeId, amountOf(x.typeId)]));
  const transfer = donor ? transferStrength(force, donor.f, rs, plan) : null;
  const typeName = (id: Id) => rs?.componentTypes.find((t) => t.id === id)?.name ?? id;
  const wounded = need.some((x) => x.rec > 0);

  const apply = () => {
    if (source === 'force') {
      if (donor) transferStrengthStep(force.id, donor.f.id, plan);
    } else {
      historyStep(`пополнение «${force.name}»`);
      updateForce(force.id, (d) => void Object.assign(d, reserve.force));
      toastUndoable(`«${force.name}» пополнено: +${fmt0(reserve.personnel)} чел.${reserve.equipment ? `, +${reserve.equipment} ед.` : ''}`, 'good');
    }
    onClose();
  };
  const ok = source === 'force' ? !!transfer?.changed : reserve.personnel > 0 || reserve.equipment > 0;
  const donorAfter = transfer ? forceCondition(transfer.donor, rs) : null;
  // Личный состав считается вместе с экипажами техники — сколько людей уйдёт у донора всего.
  const donorBefore = donor ? forceCondition(donor.f, rs) : null;
  const withCrews = donorAfter && donorBefore ? donorBefore.persCur - donorAfter.persCur : 0;

  return (
    <Modal
      title={`Пополнить — ${force.name}`}
      onClose={onClose}
      wide={source === 'force'}
      footer={
        <>
          <span className="muted small grow">Запишется в боевой путь. Отменить — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!ok} onClick={apply}>
            Пополнить
          </Btn>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <Seg
          value={source}
          onChange={setSource}
          options={[
            { value: 'reserve', label: 'Из резерва' },
            { value: 'force', label: 'Из другого подразделения', title: 'Люди и техника переходят из другого подразделения сил' },
          ]}
        />
      </div>
      {source === 'reserve' ? (
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
            До штата придёт: <b>{fmt0(reserve.personnel)} чел.</b>
            {reserve.equipment ? (
              <>
                , <b>{fmt0(reserve.equipment)} ед.</b> техники и вооружения
              </>
            ) : null}
            .
            {wounded && ' Раненые и техника в ремонте займут места в штате, только если они останутся свободными, — поэтому сначала лучше «Лечить» и «Чинить».'}
          </div>
        </div>
      ) : !donors.length ? (
        <div className="muted">Других подразделений сил с тем же набором правил нет.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Откуда">
            <select
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
          </Field>
          {!donor && (
            <div className="muted small">
              {donors.some((d) => ownTeam(d.f))
                ? 'Выберите подразделение, из которого перейдут люди и техника.'
                : `В ${team ? `команде «${team}»` : 'этой группе'} нет других подразделений с тем же набором правил — можно взять из другой команды.`}
            </div>
          )}
          {donor && (
            <table className="tbl transfer-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th className="num">Не хватает</th>
                  <th className="num">У донора в строю</th>
                  <th className="num">Передать</th>
                </tr>
              </thead>
              <tbody>
                {need.map((x) => (
                  <tr key={x.typeId}>
                    <td>{typeName(x.typeId)}</td>
                    <td className="num">
                      {fmt0(x.gap)}
                      {x.rec > 0 && <span className="faint small"> (вне строя {fmt0(x.rec)})</span>}
                    </td>
                    <td className="num">{fmt0(donor?.st.get(x.typeId)?.current ?? 0)}</td>
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
          {transfer?.changed && donorAfter && (
            <div className="note">
              Перейдёт: <b>{fmt0(transfer.personnel)} чел.</b>
              {transfer.equipment > 0 && (
                <>
                  , <b>{fmt0(transfer.equipment)} ед.</b> техники и вооружения
                  {withCrews > transfer.personnel && ` (вместе с экипажами — ${fmt0(withCrews)} чел.)`}
                </>
              )}
              . У «{donor?.f.name}» останется {fmt0(donorAfter.persCur)} из {fmt0(donorAfter.persAuth)} чел.
              {donorAfter.equipAuth > 0 && `, техники ${fmt0(donorAfter.equipCur)} из ${fmt0(donorAfter.equipAuth)}`}.
              {wounded &&
                ' Раненые и техника в ремонте займут места в штате, только если они останутся свободными, — поэтому сначала лучше «Лечить» и «Чинить».'}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

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
 * Между боями — всё в одном окне: лечение и ремонт (сколько вернуть), пополнение из резерва, отдых,
 * боезапас и топливо; видно, что станет с подразделением. Одна запись в боевом пути, один шаг отмены.
 */
export function BetweenModal({ force, onClose }: { force: UnitNode; onClose: () => void }) {
  const rs = useRuleset(force);
  const n = betweenNeeds(force, rs);
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
  const [ammo, setAmmo] = useState(100);
  const [fuel, setFuel] = useState(100);
  const plan: BetweenPlan = {
    heal: on.heal ? heal : undefined,
    repair: on.repair ? repair : undefined,
    replenish: on.replenish ? { personnel: true, equipment: true } : undefined,
    rest: on.rest ? { pct: rest } : undefined,
    ammo: on.ammo ? ammo : undefined,
    fuel: on.fuel ? fuel : undefined,
  };
  const preview = prepareForce(force, rs, plan);
  const before = forceCondition(force, rs);
  const after = forceCondition(preview.force, rs);
  const toggle = (k: keyof typeof on) => (v: boolean) => setOn((o) => ({ ...o, [k]: v }));
  const missing = n.personnelMissing + n.equipmentMissing;
  const rows: { key: keyof typeof on; show: boolean; label: string; pct?: [number, (v: number) => void]; hint?: string }[] = [
    { key: 'heal', show: n.heal > 0, label: `Лечить — раненых ${fmt0(n.heal)} чел.`, pct: [heal, setHeal], hint: 'сколько вернуть' },
    {
      key: 'repair',
      show: n.repair > 0 || n.vehicleCondition,
      label: n.repair ? `Чинить — в ремонте ${fmt0(n.repair)} ед.` : 'Чинить — состояние техники',
      pct: [repair, setRepair],
      hint: 'сколько вернуть',
    },
    { key: 'replenish', show: missing > 0, label: 'Пополнить до штата из резерва (после лечения и ремонта)' },
    { key: 'rest', show: n.rest, label: 'Отдых — мораль, усталость, слаженность, готовность, снаряжение', pct: [rest, setRest], hint: '% до нормы' },
    { key: 'ammo', show: n.ammo, label: 'Боезапас', pct: [ammo, setAmmo], hint: 'до уровня' },
    { key: 'fuel', show: n.fuel, label: 'Топливо', pct: [fuel, setFuel], hint: 'до уровня' },
  ];
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
  return (
    <Modal
      title={`Между боями — ${force.name}`}
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
            Выполнить
          </Btn>
        </>
      }
    >
      <div className="between-grid">
        <div className="stack" style={{ gap: 10 }}>
          {rows
            .filter((r) => r.show)
            .map((r) => (
              <div key={r.key} className="between-row">
                <Check value={on[r.key]} onChange={toggle(r.key)}>
                  {r.label}
                </Check>
                {r.pct && (
                  <div className="between-pct">
                    <span className="faint small">{r.hint}</span>
                    <PctPicker value={r.pct[0]} onChange={r.pct[1]} disabled={!on[r.key]} />
                  </div>
                )}
              </div>
            ))}
          {!rows.some((r) => r.show) && <div className="muted">Силы в норме — делать нечего.</div>}
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
 * Действия между боями. На карточке и панели — «Между боями…» и только те действия, для которых есть дело
 * (остальных не видно); compact — одна кнопка «Между боями…» (для заметки в сценарии).
 */
/** quiet — без главной (выделенной) кнопки: в каталоге карточек много, выделенная кнопка должна быть одна на экран. */
export function ForceActions({ force, grid, compact, quiet }: { force: UnitNode; grid?: boolean; compact?: boolean; quiet?: boolean }) {
  const rs = useRuleset(force);
  const [modal, setModal] = useState<'between' | 'rest' | 'replenish' | SupplyKey | null>(null);
  const n = betweenNeeds(force, rs);
  const missing = n.personnelMissing + n.equipmentMissing;
  const any = n.rest || n.heal > 0 || n.repair > 0 || n.vehicleCondition || missing > 0 || n.ammo || n.fuel;
  const kind = grid ? undefined : 'ghost';
  const modals = (
    <>
      {modal === 'between' && createPortal(<BetweenModal force={force} onClose={() => setModal(null)} />, document.body)}
      {modal === 'rest' && createPortal(<RestModal force={force} onClose={() => setModal(null)} />, document.body)}
      {modal === 'replenish' && createPortal(<ReplenishModal force={force} onClose={() => setModal(null)} />, document.body)}
      {(modal === 'ammo' || modal === 'fuel') && createPortal(<SupplyModal force={force} what={modal} onClose={() => setModal(null)} />, document.body)}
    </>
  );
  if (!any) return grid ? <div className="force-actions-ok faint small">Состояние в норме — действия не нужны</div> : null;
  const between = (
    <Btn
      sm
      kind={quiet ? undefined : 'primary'}
      onClick={() => setModal('between')}
      title="Лечить, чинить, пополнить, отдых, боезапас и топливо — в одном окне"
    >
      <Icon name="restore" size={14} /> Между боями…
    </Btn>
  );
  if (compact)
    return (
      <>
        {between}
        {modals}
      </>
    );
  const buttons = (
    <>
      {between}
      {n.rest && (
        <Btn sm kind={kind} onClick={() => setModal('rest')} title="Восстановить мораль, усталость, слаженность, готовность и снаряжение бойцов в строю">
          <Icon name="rest" size={14} /> Отдых…
        </Btn>
      )}
      {n.heal > 0 && (
        <Btn sm kind={kind} onClick={() => healForceStep(force.id)} title={`Вернуть в строй всех раненых: ${fmt0(n.heal)} чел. Часть — в «Между боями…»`}>
          <Icon name="heal" size={14} /> Лечить ({fmt0(n.heal)})
        </Btn>
      )}
      {(n.repair > 0 || n.vehicleCondition) && (
        <Btn
          sm
          kind={kind}
          onClick={() => repairForceStep(force.id)}
          title={n.repair ? `Вернуть в строй всю технику из ремонта: ${fmt0(n.repair)} ед. Часть — в «Между боями…»` : 'Привести состояние техники в норму'}
        >
          <Icon name="wrench" size={14} /> Чинить{n.repair ? ` (${fmt0(n.repair)})` : ''}
        </Btn>
      )}
      {missing > 0 && (
        <Btn sm kind={kind} onClick={() => setModal('replenish')} title="Из резерва или из другого подразделения">
          <Icon name="replenish" size={14} /> Пополнить…
        </Btn>
      )}
      {n.ammo && (
        <Btn sm kind={kind} onClick={() => setModal('ammo')} title="Пополнить боезапас">
          <Icon name="ammo" size={14} /> Боезапас…
        </Btn>
      )}
      {n.fuel && (
        <Btn sm kind={kind} onClick={() => setModal('fuel')} title="Пополнить топливо">
          <Icon name="fuel" size={14} /> Топливо…
        </Btn>
      )}
    </>
  );
  return (
    <>
      {grid ? <div className="force-actions">{buttons}</div> : buttons}
      {modals}
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
};

/** Боевой путь сил: бои (с исходом и потерями), отдых, лечение, ремонт, пополнения. */
export function ForceHistory({ force }: { force: UnitNode }) {
  const list = force.history ?? [];
  const index = useApp((s) => s.battleIndex);
  const battles = list.filter((x) => x.kind === 'battle' && x.battleId).length;
  const lost = list.filter((x) => x.kind === 'battle').reduce((a, x) => a - (x.personnel ?? 0), 0);
  const summary = list.length ? `боёв: ${battles}${lost > 0 ? `, потери за всё время: ${fmt0(lost)} чел.` : ''}` : 'пока пусто';
  return (
    <Section id="force-history" title="Боевой путь" summary={summary} defaultOpen={list.length > 0}>
      {!list.length && <div className="muted">Здесь появятся бои, итоги которых записаны в эти силы, а также отдых, лечение, ремонт и пополнения.</div>}
      <div className="stack" style={{ gap: 4 }}>
        {[...list].reverse().map((x, i) => (
          <div key={i} className="history-row">
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
            <span className={`small nowrap ${(x.personnel ?? 0) < 0 ? 'bad' : (x.personnel ?? 0) > 0 ? 'good' : 'faint'}`}>
              {[signed(x.personnel, 'чел.'), signed(x.equipment, 'ед.')].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
