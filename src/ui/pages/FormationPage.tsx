// Конструктор подразделения: дерево структуры (формирования → подразделения → элементы),
// состав и состояние каждого элемента, сводка сил.

import {
  BEHAVIOR_LABELS,
  ECHELON_LABELS,
  KIND_LABELS,
  clone,
  copyFormation,
  newElement,
  newFormation,
  newId,
  validateFormation,
  type ComponentKind,
  type ElementDef,
  type Echelon,
  type FormationDef,
  type Ruleset,
} from '../../engine';
import { Link } from '../components/Link';
import { Area, Btn, Card, Check, Field, Menu, Num, Range, Section, Sel, Tags, Txt, fmt0, fmt1 } from '../components/ui';
import { useTabState } from '../hooks';
import {
  addFormation,
  confirmDialog,
  deleteFormation,
  duplicateFormation,
  exportJson,
  openTab,
  resolveFormation,
  toast,
  updateFormationRef,
  useApp,
  type Tab,
} from '../store';

type NodeSel = { t: 'f' | 'e'; id: string };

// ------------------------------------------------------------------ операции над деревом

function findFormation(root: FormationDef, id: string): FormationDef | null {
  if (root.id === id) return root;
  for (const s of root.subunits) {
    const f = findFormation(s, id);
    if (f) return f;
  }
  return null;
}

function parentOf(root: FormationDef, id: string): FormationDef | null {
  if (root.elements.some((e) => e.id === id) || root.subunits.some((s) => s.id === id)) return root;
  for (const s of root.subunits) {
    const p = parentOf(s, id);
    if (p) return p;
  }
  return null;
}

function findElement(root: FormationDef, id: string): ElementDef | null {
  for (const e of root.elements) if (e.id === id) return e;
  for (const s of root.subunits) {
    const e = findElement(s, id);
    if (e) return e;
  }
  return null;
}

function allElements(f: FormationDef): ElementDef[] {
  return [...f.elements, ...f.subunits.flatMap(allElements)];
}

export interface DefSummary {
  persAuth: number;
  persCur: number;
  recoverable: number;
  equip: { id: string; name: string; kind: ComponentKind; auth: number; cur: number; rec: number }[];
  value: number;
  valueAuth: number;
  fire: Record<string, Record<string, number>>;
  elements: number;
  morale: number;
}

export function summarizeDef(els: ElementDef[], rs: Ruleset): DefSummary {
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const out: DefSummary = { persAuth: 0, persCur: 0, recoverable: 0, equip: [], value: 0, valueAuth: 0, fire: {}, elements: els.length, morale: 0 };
  const eq = new Map<string, DefSummary['equip'][number]>();
  let mw = 0;
  for (const e of els) {
    let ev = 0;
    for (const c of e.composition) {
      const t = types.get(c.typeId);
      if (!t) continue;
      const crew = t.kind === 'personnel' ? 1 : t.crew;
      out.persAuth += c.authorized * crew;
      out.persCur += c.current * crew;
      if (t.kind === 'personnel') out.recoverable += c.recoverable ?? 0;
      out.value += c.current * t.value;
      out.valueAuth += c.authorized * t.value;
      ev += c.current * t.value;
      if (t.kind !== 'personnel') {
        const q = eq.get(t.id) ?? { id: t.id, name: t.name, kind: t.kind, auth: 0, cur: 0, rec: 0 };
        q.auth += c.authorized;
        q.cur += c.current;
        q.rec += c.recoverable ?? 0;
        eq.set(t.id, q);
      }
      for (const cls of rs.targetClasses)
        for (const b of rs.rangeBands) {
          out.fire[cls.id] ??= {};
          out.fire[cls.id][b.id] = (out.fire[cls.id][b.id] ?? 0) + (t.firepower[cls.id]?.[b.id] ?? 0) * c.current * ((e.attackMod ?? 100) / 100);
        }
    }
    out.morale += e.morale * ev;
    mw += ev;
  }
  out.morale = mw > 0 ? out.morale / mw : 0;
  out.equip = [...eq.values()];
  return out;
}

export function riskOf(e: ElementDef, rs: Ruleset): { label: string; cls: string } {
  const k = rs.coefficients;
  const panicMult = rs.experienceLevels[e.experience - 1]?.effects.panic ?? 1;
  const m = e.morale / Math.max(0.3, panicMult);
  if (rs.features.panic && m < k.panicMorale) return { label: 'высокий: паника', cls: 'bad' };
  if (rs.features.retreat && m < k.retreatMorale) return { label: 'повышенный: отход', cls: 'warn' };
  if (m < k.retreatMorale + 15) return { label: 'умеренный', cls: 'warn' };
  return { label: 'низкий', cls: 'good' };
}

// ------------------------------------------------------------------ страница

export function FormationPage({ tab }: { tab: Tab }) {
  const ref = tab.ref!;
  const state = useApp();
  const res = resolveFormation(ref);
  const [sel, setSel] = useTabState<NodeSel>(`${tab.key}:sel`, { t: 'f', id: res?.f.id ?? '' });
  if (!res) return <div className="empty">Подразделение не найдено.</div>;
  const root = res.f;
  const rs = state.rulesets[res.rulesetId ?? ''] ?? Object.values(state.rulesets)[0];
  if (!rs) return <div className="empty">Нет ни одного набора правил.</div>;
  const isLib = ref.startsWith('lib:');
  const upd = (fn: (f: FormationDef) => void) => updateFormationRef(ref, fn);
  const selF = sel.t === 'f' ? findFormation(root, sel.id) : null;
  const selE = sel.t === 'e' ? findElement(root, sel.id) : null;
  const current: NodeSel = selF || selE ? sel : { t: 'f', id: root.id };
  const issues = validateFormation(root, rs);
  const hasOriginal = !!root.sourceId && !!state.formations[root.sourceId];

  const rulesetPicker = isLib ? (
    <Field label="Набор правил" hint="Из его каталога берутся типы людей, вооружения и техники.">
      <Sel value={rs.id} onChange={(v) => upd((d) => void (d.rulesetId = v))} options={Object.values(state.rulesets).map((r) => ({ value: r.id, label: r.name }))} />
    </Field>
  ) : null;

  return (
    <div className="page">
      {!isLib && (
        <div className="crumbs">
          Копия в сценарии{' '}
          <Link kind="scenario" refId={res.scenario!.id}>
            «{res.scenario!.name}»
          </Link>{' '}
          · {res.scenario!.sides[res.sideIndex!].name}
        </div>
      )}
      <div className="page-head">
        <input className="title-input" value={root.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <Menu
          items={
            isLib
              ? [
                  { label: 'Дублировать', onClick: () => duplicateFormation(root.id) },
                  { label: 'Сохранить в файл…', onClick: () => exportJson('formation', root.name, root) },
                  'sep',
                  { label: 'Удалить из библиотеки', danger: true, onClick: () => deleteFormation(root.id) },
                ]
              : [
                  {
                    label: 'Сохранить копию в библиотеку',
                    tip: 'С текущим составом и состоянием',
                    onClick: () => {
                      const c = copyFormation(root);
                      c.rulesetId = rs.id;
                      c.name = root.name;
                      delete c.sourceId;
                      addFormation(c);
                      toast('Копия сохранена в библиотеку.', 'good');
                    },
                  },
                  hasOriginal && { label: 'Открыть оригинал из библиотеки', onClick: () => openTab('formation', `lib:${root.sourceId}`) },
                ]
          }
        />
      </div>

      {issues.length > 0 && (
        <div className="muted small" style={{ marginTop: -8, marginBottom: 12 }} data-tip={issues.map((x) => `• ${x.text}`).join('\n')}>
          <span className="warn">⚠</span> Замечаний: {issues.length} — наведите, чтобы прочитать
        </div>
      )}

      <div className="split wide-left">
        <div className="stack">
          <Card title="Структура" tight>
            <div className="tree" style={{ padding: '0 6px' }}>
              <TreeFormation f={root} root={root} rs={rs} sel={current} setSel={setSel} upd={upd} depth={0} />
            </div>
          </Card>
          <SummaryCard els={allElements(root)} rs={rs} />
        </div>
        <div className="stack">
          {current.t === 'f' && (
            <FormationEditor f={selF ?? root} isRoot={(selF ?? root).id === root.id} rs={rs} upd={upd} root={root} rulesetPicker={rulesetPicker} />
          )}
          {current.t === 'e' && selE && <ElementEditor e={selE} rs={rs} upd={upd} root={root} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ дерево

function TreeFormation(props: {
  f: FormationDef;
  root: FormationDef;
  rs: Ruleset;
  sel: NodeSel;
  setSel: (s: NodeSel) => void;
  upd: (fn: (f: FormationDef) => void) => void;
  depth: number;
}) {
  const { f, root, rs, sel, setSel, upd } = props;
  const sum = summarizeDef(allElements(f), rs);
  const isRoot = f.id === root.id;
  const addElement = () => {
    const e = newElement(`Элемент ${f.elements.length + 1}`);
    upd((d) => findFormation(d, f.id)!.elements.push(e));
    setSel({ t: 'e', id: e.id });
  };
  const addSub = () => {
    const s = newFormation(`Подразделение ${f.subunits.length + 1}`, { kind: 'рота', comms: null, supply: null, order: null });
    upd((d) => findFormation(d, f.id)!.subunits.push(s));
    setSel({ t: 'f', id: s.id });
  };
  const moveSub = (dir: -1 | 1) =>
    upd((d) => {
      const p = parentOf(d, f.id);
      if (!p) return;
      const i = p.subunits.findIndex((x) => x.id === f.id);
      const j = i + dir;
      if (j < 0 || j >= p.subunits.length) return;
      [p.subunits[i], p.subunits[j]] = [p.subunits[j], p.subunits[i]];
    });
  return (
    <div>
      <div className={`tree-node${sel.t === 'f' && sel.id === f.id ? ' sel' : ''}`} onClick={() => setSel({ t: 'f', id: f.id })}>
        <span>▦</span>
        <span className="tn-name">
          <b>{f.name}</b> <span className="faint">{f.kind}</span>
        </span>
        <span className="tn-meta">{fmt0(sum.persCur)} чел.</span>
        <span className="tn-actions" onClick={(e) => e.stopPropagation()}>
          <Btn sm kind="ghost" icon title="Добавить элемент" onClick={addElement}>
            +
          </Btn>
          <Btn sm kind="ghost" icon title="Добавить вложенное подразделение" onClick={addSub}>
            ⊞
          </Btn>
          {!isRoot && (
            <>
              <Btn sm kind="ghost" icon title="Выше" onClick={() => moveSub(-1)}>
                ↑
              </Btn>
              <Btn sm kind="ghost" icon title="Ниже" onClick={() => moveSub(1)}>
                ↓
              </Btn>
              <Btn
                sm
                kind="ghost"
                icon
                title="Дублировать"
                onClick={() =>
                  upd((d) => {
                    const p = parentOf(d, f.id)!;
                    const c = copyFormation(f);
                    const strip = (x: FormationDef) => {
                      delete x.sourceId;
                      x.elements.forEach((e) => delete e.sourceId);
                      x.subunits.forEach(strip);
                    };
                    strip(c);
                    c.name = `${f.name} (копия)`;
                    p.subunits.splice(p.subunits.findIndex((x) => x.id === f.id) + 1, 0, c);
                  })
                }
              >
                ⧉
              </Btn>
              <Btn
                sm
                kind="ghost"
                icon
                title="Удалить"
                onClick={async () => {
                  if (!(await confirmDialog(`Удалить «${f.name}» со всеми элементами?`, undefined, 'Удалить', true))) return;
                  upd((d) => {
                    const p = parentOf(d, f.id)!;
                    p.subunits = p.subunits.filter((x) => x.id !== f.id);
                  });
                  setSel({ t: 'f', id: root.id });
                }}
              >
                ✕
              </Btn>
            </>
          )}
        </span>
      </div>
      <div className="tree-children">
        {f.elements.map((e, i) => (
          <TreeElement key={e.id} e={e} i={i} f={f} rs={rs} sel={sel} setSel={setSel} upd={upd} />
        ))}
        {f.subunits.map((s) => (
          <TreeFormation key={s.id} {...props} f={s} depth={props.depth + 1} />
        ))}
        {!f.elements.length && !f.subunits.length && (
          <div className="faint small" style={{ padding: '4px 6px' }}>
            Пусто —{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), addElement())}>
              добавить элемент
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeElement({ e, i, f, rs, sel, setSel, upd }: { e: ElementDef; i: number; f: FormationDef; rs: Ruleset; sel: NodeSel; setSel: (s: NodeSel) => void; upd: (fn: (f: FormationDef) => void) => void }) {
  const sum = summarizeDef([e], rs);
  const risk = riskOf(e, rs);
  const order = e.order ? rs.orders.find((o) => o.id === e.order)?.name : null;
  const move = (dir: -1 | 1) =>
    upd((d) => {
      const p = findFormation(d, f.id)!;
      const j = i + dir;
      if (j < 0 || j >= p.elements.length) return;
      [p.elements[i], p.elements[j]] = [p.elements[j], p.elements[i]];
    });
  return (
    <div className={`tree-node${sel.t === 'e' && sel.id === e.id ? ' sel' : ''}`} onClick={() => setSel({ t: 'e', id: e.id })}>
      <span className={risk.cls} title={`Риск паники/отхода: ${risk.label}`}>
        ●
      </span>
      <span className="tn-name">
        {e.isHQ && <span className="badge warn" style={{ marginRight: 4 }}>штаб</span>}
        {e.name}
        {order && <span className="faint"> · {order}</span>}
      </span>
      <span className="tn-meta">
        {fmt0(sum.persCur)}
        {sum.equip.length ? ` · ${sum.equip.reduce((a, q) => a + q.cur, 0)} ед.` : ''}
      </span>
      <span className="tn-actions" onClick={(ev) => ev.stopPropagation()}>
        <Btn sm kind="ghost" icon title="Выше" onClick={() => move(-1)}>
          ↑
        </Btn>
        <Btn sm kind="ghost" icon title="Ниже" onClick={() => move(1)}>
          ↓
        </Btn>
        <Btn
          sm
          kind="ghost"
          icon
          title="Дублировать"
          onClick={() =>
            upd((d) => {
              const p = findFormation(d, f.id)!;
              const c = { ...clone(e), id: newId('el'), name: `${e.name} (копия)` };
              delete c.sourceId;
              p.elements.splice(i + 1, 0, c);
            })
          }
        >
          ⧉
        </Btn>
        <Btn
          sm
          kind="ghost"
          icon
          title="Удалить"
          onClick={async () => {
            if (!(await confirmDialog(`Удалить элемент «${e.name}»?`, undefined, 'Удалить', true))) return;
            upd((d) => {
              const p = findFormation(d, f.id)!;
              p.elements = p.elements.filter((x) => x.id !== e.id);
            });
            setSel({ t: 'f', id: f.id });
          }}
        >
          ✕
        </Btn>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ сводка

function FireTable({ fire, rs }: { fire: Record<string, Record<string, number>>; rs: Ruleset }) {
  return (
    <table className="tbl compact">
      <thead>
        <tr>
          <th>По классу цели</th>
          {rs.rangeBands.map((b) => (
            <th key={b.id} className="num">
              {b.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rs.targetClasses.map((c) => (
          <tr key={c.id}>
            <td>{c.name}</td>
            {rs.rangeBands.map((b) => (
              <td key={b.id} className="num">
                {fmt1(fire[c.id]?.[b.id] ?? 0)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SummaryCard({ els, rs }: { els: ElementDef[]; rs: Ruleset }) {
  const s = summarizeDef(els, rs);
  const shortage = s.persAuth > 0 ? (1 - s.persCur / s.persAuth) * 100 : 0;
  return (
    <>
      <Card title="Сводка">
        <div className="stat-row">
          <div className="stat">
            <span className="k">Личный состав</span>
            <span className="v">
              {fmt0(s.persCur)} <small>из {fmt0(s.persAuth)}</small>
            </span>
          </div>
          <div className="stat" data-tip="Сумма очков боевой ценности всех единиц">
            <span className="k">Боевая ценность</span>
            <span className="v">{fmt0(s.value)}</span>
          </div>
          {rs.features.morale && (
            <div className="stat">
              <span className="k">Мораль</span>
              <span className="v">{Math.round(s.morale)}</span>
            </div>
          )}
        </div>
        {shortage >= 1 && <div className="faint small" style={{ marginTop: 4 }}>некомплект {fmt1(shortage)}%{s.recoverable ? ` · раненых ${s.recoverable}` : ''}</div>}
        {s.equip.length > 0 && (
          <table className="tbl compact" style={{ marginTop: 10 }}>
            <tbody>
              {s.equip.map((q) => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td className="num">
                    {q.cur} <span className="faint">из {q.auth}</span>
                    {q.rec ? <span className="faint"> (+{q.rec} в ремонте)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Section id="formation-fire" title="Огневая мощь" summary="поражений за ход, без модификаторов" tight>
        <FireTable fire={s.fire} rs={rs} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ редактор формирования

const BULK_FIELDS: { key: keyof ElementDef; label: string; feature?: keyof Ruleset['features'] }[] = [
  { key: 'morale', label: 'Мораль', feature: 'morale' },
  { key: 'cohesion', label: 'Слаженность', feature: 'cohesion' },
  { key: 'readiness', label: 'Готовность', feature: 'readiness' },
  { key: 'ammo', label: 'Боезапас', feature: 'ammo' },
  { key: 'fuel', label: 'Топливо', feature: 'fuel' },
  { key: 'equipment', label: 'Снаряжение', feature: 'equipment' },
  { key: 'fatigue', label: 'Усталость', feature: 'fatigue' },
  { key: 'vehicleCondition', label: 'Состояние техники', feature: 'vehicleCondition' },
  { key: 'experience', label: 'Опыт (уровень)' },
];

function FormationEditor(props: { f: FormationDef; isRoot: boolean; rs: Ruleset; upd: (fn: (f: FormationDef) => void) => void; root: FormationDef; rulesetPicker: React.ReactNode }) {
  const { f, isRoot, rs, upd, root } = props;
  const uf = (fn: (x: FormationDef) => void) => upd((d) => fn(findFormation(d, f.id)!));
  const [bulkKey, setBulkKey] = useTabState<string>(`bulk:${root.id}`, 'morale');
  const [bulkVal, setBulkVal] = useTabState<number>(`bulkv:${root.id}`, 80);
  const parent = isRoot ? null : parentOf(root, f.id);
  const inherit = (v: number | null, parentVal: number | null | undefined) => (v === null ? (parentVal ?? 100) : v);
  const inheritToggle = (key: 'comms' | 'supply') =>
    !isRoot && (
      <Check value={f[key] === null} onChange={(v) => uf((x) => void (x[key] = v ? null : inherit(null, parent?.[key])))} title="Брать значение у вышестоящего подразделения">
        <span className="faint">как у старшего</span>
      </Check>
    );
  return (
    <>
      <Card title={isRoot ? 'Подразделение' : 'Вложенное подразделение'}>
        <div className="fields">
          <Field label="Название">
            <Txt value={f.name} onChange={(v) => uf((x) => void (x.name = v))} />
          </Field>
          <Field label="Тип">
            <Txt value={f.kind} onChange={(v) => uf((x) => void (x.kind = v))} placeholder="батальон, рота, отряд…" />
          </Field>
          <Field label="Командир">
            <Txt value={f.commanderName} onChange={(v) => uf((x) => void (x.commanderName = v))} placeholder="звание, фамилия" />
          </Field>
          {rs.features.command && (
            <Field label="Уровень командира">
              <Sel value={f.commandLevel} onChange={(v) => uf((x) => void (x.commandLevel = v))} options={rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))} />
            </Field>
          )}
          <Field label="Приказ" hint="Элементы без своего приказа выполняют этот.">
            <Sel
              value={f.order ?? ''}
              onChange={(v) => uf((x) => void (x.order = v || null))}
              options={[...(isRoot ? [] : [{ value: '', label: '— как у старшего —' }]), ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: BEHAVIOR_LABELS[o.behavior] }))]}
            />
          </Field>
          {isRoot && props.rulesetPicker}
        </div>
        <div className="fields two" style={{ marginTop: 12 }}>
          {rs.features.comms && (
            <Field label={<>Связь, % {inheritToggle('comms')}</>}>
              <Range value={inherit(f.comms, parent?.comms)} onChange={(v) => uf((x) => void (x.comms = v))} disabled={f.comms === null} />
            </Field>
          )}
          <Field label={<>Снабжение, % {inheritToggle('supply')}</>} hint="Скорость подвоза боезапаса и топлива во время боя.">
            <Range value={inherit(f.supply, parent?.supply)} onChange={(v) => uf((x) => void (x.supply = v))} disabled={f.supply === null} />
          </Field>
        </div>
      </Card>
      <Section id="formation-bulk" title="Массовое изменение" summary="одно значение всем элементам">
        <div className="row">
          <Sel value={bulkKey} onChange={setBulkKey} options={BULK_FIELDS.filter((b) => !b.feature || rs.features[b.feature]).map((b) => ({ value: b.key as string, label: b.label }))} />
          <Num value={bulkVal} onChange={setBulkVal} min={bulkKey === 'experience' ? 1 : 0} max={bulkKey === 'experience' ? rs.experienceLevels.length : 100} />
          <Btn
            onClick={() =>
              uf((x) => {
                for (const e of allElements(x)) (e as unknown as Record<string, number>)[bulkKey] = bulkVal;
              })
            }
          >
            Применить ко всем
          </Btn>
          <Btn
            kind="ghost"
            onClick={() =>
              uf((x) => {
                for (const e of allElements(x)) for (const c of e.composition) c.current = c.authorized;
              })
            }
          >
            Укомплектовать до штата
          </Btn>
        </div>
      </Section>
      <Section id="formation-extra" title="Теги и заметки" summary={[...f.tags, f.notes ? 'есть заметки' : ''].filter(Boolean).join(', ') || undefined}>
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Теги" hint="Используются в своих правилах набора правил.">
            <Tags value={f.tags} onChange={(v) => uf((x) => void (x.tags = v))} />
          </Field>
          <Area value={f.notes ?? ''} onChange={(v) => uf((x) => void (x.notes = v))} rows={2} placeholder="Заметки" />
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ редактор элемента

function ElementEditor({ e, rs, upd, root }: { e: ElementDef; rs: Ruleset; upd: (fn: (f: FormationDef) => void) => void; root: FormationDef }) {
  const ue = (fn: (x: ElementDef) => void) => upd((d) => fn(findElement(d, e.id)!));
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const parent = parentOf(root, e.id);
  const inheritedOrder = (() => {
    let f: FormationDef | null = parent;
    while (f) {
      if (f.order) return rs.orders.find((o) => o.id === f!.order)?.name;
      f = parentOf(root, f.id);
    }
    return undefined;
  })();
  const risk = riskOf(e, rs);
  const ft = rs.features;
  const stateFields: { key: keyof ElementDef; label: string; show: boolean }[] = [
    { key: 'morale', label: 'Мораль', show: ft.morale },
    { key: 'cohesion', label: 'Слаженность', show: ft.cohesion },
    { key: 'readiness', label: 'Готовность', show: ft.readiness },
    { key: 'fatigue', label: 'Усталость, %', show: ft.fatigue },
    { key: 'ammo', label: 'Боезапас, %', show: ft.ammo },
    { key: 'fuel', label: 'Топливо, %', show: ft.fuel },
    { key: 'equipment', label: 'Снаряжение, %', show: ft.equipment },
    { key: 'vehicleCondition', label: 'Состояние техники, %', show: ft.vehicleCondition },
  ];
  const sum = summarizeDef([e], rs);
  const showRecoverable = e.composition.some((c) => (c.recoverable ?? 0) > 0);
  return (
    <>
      <Card title="Элемент" actions={<span className="muted small" data-tip="Оценка по морали и опыту: насколько вероятны паника и отход в бою">риск паники: <b className={risk.cls}>{risk.label}</b></span>}>
        <div className="fields">
          <Field label="Название">
            <Txt value={e.name} onChange={(v) => ue((x) => void (x.name = v))} />
          </Field>
          <Field label="Роль">
            <Txt value={e.role} onChange={(v) => ue((x) => void (x.role = v))} placeholder="рота, штаб, батарея…" />
          </Field>
          <Field label="Эшелон" hint="Насколько элемент подставлен под прямой огонь.">
            <Sel value={e.echelon} onChange={(v) => ue((x) => void (x.echelon = v as Echelon))} options={(Object.keys(ECHELON_LABELS) as Echelon[]).map((k) => ({ value: k, label: ECHELON_LABELS[k] }))} />
          </Field>
          <Field label="Приказ">
            <Sel
              value={e.order ?? ''}
              onChange={(v) => ue((x) => void (x.order = v || null))}
              options={[{ value: '', label: inheritedOrder ? `${inheritedOrder} (как у подразделения)` : '— как у подразделения —' }, ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: BEHAVIOR_LABELS[o.behavior] }))]}
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 18 }}>
          <Check value={e.isHQ} onChange={(v) => ue((x) => void (x.isHQ = v))} title="Потеря штаба снижает связь и лишает формирование влияния командира">
            Штаб
          </Check>
          <Check value={e.holdFast} onChange={(v) => ue((x) => void (x.holdFast = v))} title="Не отходит добровольно; шанс паники вдвое ниже">
            Стоять насмерть
          </Check>
        </div>
      </Card>

      <Card
        title={`Состав · ${fmt0(sum.persCur)} из ${fmt0(sum.persAuth)} чел.`}
        actions={
          <Btn sm kind="ghost" onClick={() => ue((x) => x.composition.forEach((c) => (c.current = c.authorized)))}>
            До штата
          </Btn>
        }
        tight
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl comp-table">
            <thead>
              <tr>
                <th>Тип</th>
                <th className="num">Штат</th>
                <th className="num">В строю</th>
                {showRecoverable && (
                  <th className="num" data-tip="Раненые (люди) или техника в ремонте — могут вернуться в строй">
                    Ран./ремонт
                  </th>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {e.composition.map((c, i) => (
                <tr key={i}>
                  <td>
                    <Sel value={c.typeId} onChange={(v) => ue((x) => void (x.composition[i].typeId = v))} options={rs.componentTypes.map((tt) => ({ value: tt.id, label: tt.name }))} />
                  </td>
                  <td className="num">
                    <Num value={c.authorized} onChange={(v) => ue((x) => void (x.composition[i].authorized = v))} min={0} integer width={80} />
                  </td>
                  <td className="num">
                    <Num value={c.current} onChange={(v) => ue((x) => void (x.composition[i].current = v))} min={0} integer width={80} />
                  </td>
                  {showRecoverable && (
                    <td className="num nowrap">
                      {c.recoverable ? (
                        <>
                          {c.recoverable}{' '}
                          <Btn
                            sm
                            kind="ghost"
                            title="Вернуть в строй"
                            onClick={() =>
                              ue((x) => {
                                const cc = x.composition[i];
                                cc.current += cc.recoverable ?? 0;
                                cc.recoverable = 0;
                              })
                            }
                          >
                            вернуть
                          </Btn>
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  )}
                  <td style={{ width: 30 }}>
                    <Btn sm kind="ghost" icon title="Убрать" onClick={() => ue((x) => void x.composition.splice(i, 1))}>
                      ×
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px 4px' }}>
          {types.size ? (
            <select
              value=""
              onChange={(ev) => {
                const id = ev.target.value;
                if (id) ue((x) => void x.composition.push({ typeId: id, authorized: 10, current: 10 }));
              }}
            >
              <option value="">+ Добавить из каталога…</option>
              {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => (
                <optgroup key={k} label={KIND_LABELS[k]}>
                  {rs.componentTypes
                    .filter((t) => t.kind === k)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="muted">
              Каталог пуст — добавьте типы в{' '}
              <Link kind="ruleset" refId={rs.id} sub="types">
                наборе правил
              </Link>
              .
            </span>
          )}
        </div>
      </Card>

      <Card title="Состояние">
        <div className="fields two">
          <Field label="Опыт">
            <Sel value={e.experience} onChange={(v) => ue((x) => void (x.experience = v))} options={rs.experienceLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))} />
          </Field>
          {stateFields
            .filter((x) => x.show)
            .map((x) => (
              <Field key={x.key} label={x.label}>
                <Range value={e[x.key] as number} onChange={(v) => ue((el) => void ((el as unknown as Record<string, number>)[x.key] = v))} />
              </Field>
            ))}
        </div>
      </Card>

      <Section
        id="element-extra"
        title="Дополнительно"
        summary={[e.attackMod !== 100 && `атака ${e.attackMod}%`, e.defenseMod !== 100 && `защита ${e.defenseMod}%`, ...e.tags].filter(Boolean).join(', ') || 'атака и защита, теги, заметки'}
      >
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <Field label="Атака, %" hint="100% — как в каталоге. Особое вооружение, выучка, тактика.">
              <Num value={e.attackMod} onChange={(v) => ue((x) => void (x.attackMod = v))} min={0} />
            </Field>
            <Field label="Защита, %">
              <Num value={e.defenseMod} onChange={(v) => ue((x) => void (x.defenseMod = v))} min={1} />
            </Field>
          </div>
          <Field label="Теги" hint={`Используются в своих правилах. Тег «${rs.reconTag}» делает элемент разведчиком.`}>
            <Tags value={e.tags} onChange={(v) => ue((x) => void (x.tags = v))} suggestions={[...new Set(rs.componentTypes.flatMap((t) => t.tags).concat(rs.reconTag ? [rs.reconTag] : []))]} />
          </Field>
          <Area value={e.notes ?? ''} onChange={(v) => ue((x) => void (x.notes = v))} rows={2} placeholder="Заметки" />
        </div>
      </Section>
      <Section id="element-fire" title="Огневая мощь элемента" tight>
        <FireTable fire={sum.fire} rs={rs} />
      </Section>
    </>
  );
}
