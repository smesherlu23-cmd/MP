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
import { Area, Btn, Card, Check, Field, Kpi, Num, Range, Sel, Tags, Txt, fmt0, fmt1 } from '../components/ui';
import { useTabState } from '../hooks';
import {
  addFormation,
  confirmDialog,
  deleteFormation,
  duplicateFormation,
  exportJson,
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

  return (
    <div className="page">
      <div className="crumbs">
        {isLib ? (
          'Библиотека подразделений'
        ) : (
          <>
            Подразделение в сценарии{' '}
            <Link kind="scenario" refId={res.scenario!.id}>
              «{res.scenario!.name}»
            </Link>{' '}
            · сторона «{res.scenario!.sides[res.sideIndex!].name}»
          </>
        )}
      </div>
      <div className="page-head">
        <input className="title-input" value={root.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <div className="toolbar">
          {isLib && (
            <Field label="Набор правил (каталог)">
              <Sel
                value={rs.id}
                onChange={(v) => upd((d) => void (d.rulesetId = v))}
                options={Object.values(state.rulesets).map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
          )}
          {isLib ? (
            <>
              <Btn onClick={() => duplicateFormation(root.id)}>Дублировать</Btn>
              <Btn onClick={() => exportJson('formation', root.name, root)}>Экспорт</Btn>
              <Btn kind="danger" onClick={() => deleteFormation(root.id)}>
                Удалить
              </Btn>
            </>
          ) : (
            <>
              <Btn
                onClick={() => {
                  const c = copyFormation(root);
                  c.rulesetId = rs.id;
                  c.name = root.name;
                  delete c.sourceId;
                  addFormation(c);
                  toast('Копия сохранена в библиотеку.', 'good');
                }}
                title="Сохранить копию этого подразделения (с текущим состоянием) в библиотеку"
              >
                Сохранить в библиотеку
              </Btn>
              {root.sourceId && state.formations[root.sourceId] && (
                <Link kind="formation" refId={`lib:${root.sourceId}`}>
                  оригинал в библиотеке
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="note warn" style={{ marginBottom: 12 }}>
          {issues.slice(0, 6).map((x, i) => (
            <div key={i}>• {x.text}</div>
          ))}
        </div>
      )}

      <div className="split wide-left">
        <div className="stack">
          <Card title="Структура" tight>
            <div className="tree" style={{ padding: 6 }}>
              <TreeFormation f={root} root={root} rs={rs} sel={current} setSel={setSel} upd={upd} depth={0} />
            </div>
          </Card>
          <SummaryCard els={allElements(root)} rs={rs} title="Сводка подразделения" />
        </div>
        <div className="stack">
          {current.t === 'f' && (selF ?? root) && <FormationEditor f={selF ?? root} isRoot={(selF ?? root).id === root.id} rs={rs} upd={upd} root={root} />}
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

export function SummaryCard({ els, rs, title }: { els: ElementDef[]; rs: Ruleset; title: string }) {
  const s = summarizeDef(els, rs);
  const lossPct = s.persAuth > 0 ? (1 - s.persCur / s.persAuth) * 100 : 0;
  return (
    <Card title={title}>
      <div className="kpis">
        <Kpi k="Личный состав" v={fmt0(s.persCur)} s={`штат ${fmt0(s.persAuth)} · некомплект ${fmt1(lossPct)}%`} />
        <Kpi k="Боевая ценность" v={fmt0(s.value)} s={`штат ${fmt0(s.valueAuth)}`} />
        <Kpi k="Элементов" v={s.elements} s={s.recoverable ? `раненых ${s.recoverable}` : undefined} />
        {rs.features.morale && <Kpi k="Средняя мораль" v={Math.round(s.morale)} />}
      </div>
      {s.equip.length > 0 && (
        <table className="tbl compact" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Техника и вооружение</th>
              <th className="num">В строю</th>
              <th className="num">Штат</th>
              <th className="num">Некомпл.</th>
            </tr>
          </thead>
          <tbody>
            {s.equip.map((q) => (
              <tr key={q.id}>
                <td title={KIND_LABELS[q.kind]}>{q.name}</td>
                <td className="num">
                  {q.cur}
                  {q.rec ? <span className="faint"> (+{q.rec} в ремонте)</span> : null}
                </td>
                <td className="num">{q.auth}</td>
                <td className="num">{q.auth ? `${Math.round((1 - q.cur / q.auth) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4 style={{ margin: '12px 0 4px' }}>Огневая мощь (поражений за ход, без модификаторов)</h4>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>По классу</th>
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
                  {fmt1(s.fire[c.id]?.[b.id] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
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

function FormationEditor({ f, isRoot, rs, upd, root }: { f: FormationDef; isRoot: boolean; rs: Ruleset; upd: (fn: (f: FormationDef) => void) => void; root: FormationDef }) {
  const uf = (fn: (x: FormationDef) => void) => upd((d) => fn(findFormation(d, f.id)!));
  const [bulkKey, setBulkKey] = useTabState<string>(`bulk:${root.id}`, 'morale');
  const [bulkVal, setBulkVal] = useTabState<number>(`bulkv:${root.id}`, 80);
  const parent = isRoot ? null : parentOf(root, f.id);
  const inherit = (v: number | null, parentVal: number | null | undefined) => (v === null ? (parentVal ?? 100) : v);
  return (
    <>
      <Card title={isRoot ? 'Подразделение' : 'Вложенное подразделение'}>
        <div className="fields">
          <Field label="Название">
            <Txt value={f.name} onChange={(v) => uf((x) => void (x.name = v))} />
          </Field>
          <Field label="Тип" hint="батальон, рота, отряд…">
            <Txt value={f.kind} onChange={(v) => uf((x) => void (x.kind = v))} />
          </Field>
          <Field label="Командир">
            <Txt value={f.commanderName} onChange={(v) => uf((x) => void (x.commanderName = v))} placeholder="звание, фамилия" />
          </Field>
          {rs.features.command && (
            <Field label="Влияние командира">
              <Sel value={f.commandLevel} onChange={(v) => uf((x) => void (x.commandLevel = v))} options={rs.commandLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))} />
            </Field>
          )}
          <Field label="Приказ по умолчанию" hint="Элементы без своего приказа выполняют этот.">
            <Sel
              value={f.order ?? ''}
              onChange={(v) => uf((x) => void (x.order = v || null))}
              options={[...(isRoot ? [] : [{ value: '', label: '— как у вышестоящего —' }]), ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: BEHAVIOR_LABELS[o.behavior] }))]}
            />
          </Field>
        </div>
        <div className="fields two" style={{ marginTop: 12 }}>
          {rs.features.comms && (
            <Field label={<>Уровень связи, % {!isRoot && <Check value={f.comms === null} onChange={(v) => uf((x) => void (x.comms = v ? null : inherit(null, parent?.comms)))}>как у вышестоящего</Check>}</>}>
              <Range value={inherit(f.comms, parent?.comms)} onChange={(v) => uf((x) => void (x.comms = v))} disabled={f.comms === null} />
            </Field>
          )}
          <Field label={<>Уровень снабжения, % {!isRoot && <Check value={f.supply === null} onChange={(v) => uf((x) => void (x.supply = v ? null : inherit(null, parent?.supply)))}>как у вышестоящего</Check>}</>} hint="Скорость подвоза боезапаса и топлива во время боя.">
            <Range value={inherit(f.supply, parent?.supply)} onChange={(v) => uf((x) => void (x.supply = v))} disabled={f.supply === null} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Теги">
            <Tags value={f.tags} onChange={(v) => uf((x) => void (x.tags = v))} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Заметки">
            <Area value={f.notes ?? ''} onChange={(v) => uf((x) => void (x.notes = v))} rows={2} />
          </Field>
        </div>
      </Card>
      <Card title="Массовое изменение">
        <div className="row">
          <span className="muted">Установить всем элементам «{f.name}» (включая вложенные):</span>
          <Sel value={bulkKey} onChange={setBulkKey} options={BULK_FIELDS.filter((b) => !b.feature || rs.features[b.feature]).map((b) => ({ value: b.key as string, label: b.label }))} />
          <Num value={bulkVal} onChange={setBulkVal} min={bulkKey === 'experience' ? 1 : 0} max={bulkKey === 'experience' ? rs.experienceLevels.length : 100} />
          <Btn
            onClick={() =>
              uf((x) => {
                for (const e of allElements(x)) (e as unknown as Record<string, number>)[bulkKey] = bulkVal;
              })
            }
          >
            Применить
          </Btn>
          <Btn
            onClick={() =>
              uf((x) => {
                for (const e of allElements(x)) for (const c of e.composition) c.current = c.authorized;
              })
            }
            title="Довести численность всех элементов до штата"
          >
            Укомплектовать до штата
          </Btn>
        </div>
      </Card>
      {!isRoot && <SummaryCard els={allElements(f)} rs={rs} title={`Сводка: ${f.name}`} />}
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
  const stateFields: { key: keyof ElementDef; label: string; show: boolean; hint?: string }[] = [
    { key: 'morale', label: 'Моральное состояние', show: ft.morale },
    { key: 'cohesion', label: 'Слаженность', show: ft.cohesion },
    { key: 'readiness', label: 'Готовность', show: ft.readiness },
    { key: 'fatigue', label: 'Усталость, %', show: ft.fatigue },
    { key: 'ammo', label: 'Боезапас, %', show: ft.ammo },
    { key: 'fuel', label: 'Топливо, %', show: ft.fuel },
    { key: 'equipment', label: 'Снаряжение, %', show: ft.equipment },
    { key: 'vehicleCondition', label: 'Состояние техники, %', show: ft.vehicleCondition },
  ];
  const sum = summarizeDef([e], rs);
  return (
    <>
      <Card title="Элемент">
        <div className="fields">
          <Field label="Название">
            <Txt value={e.name} onChange={(v) => ue((x) => void (x.name = v))} />
          </Field>
          <Field label="Роль / тип" hint="рота, штаб, батарея…">
            <Txt value={e.role} onChange={(v) => ue((x) => void (x.role = v))} />
          </Field>
          <Field label="Эшелон" hint="Насколько элемент подставлен под прямой огонь.">
            <Sel value={e.echelon} onChange={(v) => ue((x) => void (x.echelon = v as Echelon))} options={(Object.keys(ECHELON_LABELS) as Echelon[]).map((k) => ({ value: k, label: ECHELON_LABELS[k] }))} />
          </Field>
          <Field label="Приказ">
            <Sel
              value={e.order ?? ''}
              onChange={(v) => ue((x) => void (x.order = v || null))}
              options={[{ value: '', label: `— как у подразделения${inheritedOrder ? ` (${inheritedOrder})` : ''} —` }, ...rs.orders.map((o) => ({ value: o.id, label: o.name, title: BEHAVIOR_LABELS[o.behavior] }))]}
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
          <span className="muted small">
            Риск паники/отхода: <b className={risk.cls}>{risk.label}</b>
          </span>
        </div>
      </Card>

      <Card
        title={`Состав · ${fmt0(sum.persCur)} из ${fmt0(sum.persAuth)} чел.`}
        actions={
          <div className="row">
            <Btn sm onClick={() => ue((x) => x.composition.forEach((c) => (c.current = c.authorized)))} title="Довести до штата">
              До штата
            </Btn>
          </div>
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
              <th className="num" title="Раненые (люди) или техника в ремонте — могут вернуться в строй">
                Ран./ремонт
              </th>
              <th className="num">Некомпл.</th>
              <th className="num">Людей</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {e.composition.map((c, i) => {
              const t = types.get(c.typeId);
              const crew = t ? (t.kind === 'personnel' ? 1 : t.crew) : 0;
              return (
                <tr key={i}>
                  <td>
                    <Sel
                      value={c.typeId}
                      onChange={(v) => ue((x) => void (x.composition[i].typeId = v))}
                      options={rs.componentTypes.map((tt) => ({ value: tt.id, label: `${tt.name} (${KIND_LABELS[tt.kind].toLowerCase()})` }))}
                    />
                  </td>
                  <td className="num">
                    <Num value={c.authorized} onChange={(v) => ue((x) => void (x.composition[i].authorized = v))} min={0} integer width={80} />
                  </td>
                  <td className="num">
                    <Num value={c.current} onChange={(v) => ue((x) => void (x.composition[i].current = v))} min={0} integer width={80} />
                  </td>
                  <td className="num">
                    <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end', gap: 4 }}>
                      <Num value={c.recoverable ?? 0} onChange={(v) => ue((x) => void (x.composition[i].recoverable = v))} min={0} integer width={64} />
                      <Btn
                        sm
                        kind="ghost"
                        icon
                        disabled={!c.recoverable}
                        title="Вернуть в строй"
                        onClick={() =>
                          ue((x) => {
                            const cc = x.composition[i];
                            cc.current += cc.recoverable ?? 0;
                            cc.recoverable = 0;
                          })
                        }
                      >
                        ↩
                      </Btn>
                    </div>
                  </td>
                  <td className="num">{c.authorized ? `${Math.round((1 - c.current / c.authorized) * 100)}%` : '—'}</td>
                  <td className="num">{fmt0(c.current * crew)}</td>
                  <td>
                    <Btn sm kind="ghost" icon title="Убрать" onClick={() => ue((x) => void x.composition.splice(i, 1))}>
                      ×
                    </Btn>
                  </td>
                </tr>
              );
            })}
            {!types.size && (
              <tr>
                <td colSpan={7} className="faint">
                  В наборе правил нет ни одного типа — добавьте их в{' '}
                  <Link kind="ruleset" refId={rs.id} sub="types">
                    каталоге типов
                  </Link>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="row" style={{ padding: 8 }}>
          <select
            value=""
            onChange={(ev) => {
              const id = ev.target.value;
              if (!id) return;
              ue((x) => void x.composition.push({ typeId: id, authorized: 10, current: 10 }));
            }}
          >
            <option value="">+ добавить из каталога…</option>
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
          <Link kind="ruleset" refId={rs.id} sub="types" className="small">
            открыть каталог типов
          </Link>
        </div>
      </Card>

      <Card title="Состояние">
        <div className="fields two">
          <Field label="Уровень опыта">
            <Sel value={e.experience} onChange={(v) => ue((x) => void (x.experience = v))} options={rs.experienceLevels.map((l, i) => ({ value: i + 1, label: `${i + 1}. ${l.name}` }))} />
          </Field>
          <Field label="Атака / защита, %" hint="100% — как в каталоге. Особое вооружение, выучка, тактика.">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Num value={e.attackMod} onChange={(v) => ue((x) => void (x.attackMod = v))} min={0} suffix="%" title="Атака" />
              <Num value={e.defenseMod} onChange={(v) => ue((x) => void (x.defenseMod = v))} min={1} suffix="%" title="Защита" />
            </div>
          </Field>
          {stateFields
            .filter((x) => x.show)
            .map((x) => (
              <Field key={x.key} label={x.label}>
                <Range value={e[x.key] as number} onChange={(v) => ue((el) => void ((el as unknown as Record<string, number>)[x.key] = v))} />
              </Field>
            ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Теги" hint={`Используются в своих правилах. «${rs.reconTag}» — разведчик.`}>
            <Tags value={e.tags} onChange={(v) => ue((x) => void (x.tags = v))} suggestions={[...new Set(rs.componentTypes.flatMap((t) => t.tags).concat(rs.reconTag ? [rs.reconTag] : []))]} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Заметки">
            <Area value={e.notes ?? ''} onChange={(v) => ue((x) => void (x.notes = v))} rows={2} />
          </Field>
        </div>
      </Card>
      <SummaryCard els={[e]} rs={rs} title="Огневая мощь элемента" />
    </>
  );
}
