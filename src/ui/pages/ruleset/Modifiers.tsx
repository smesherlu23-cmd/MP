// Набор правил: свои правила «если… то характеристика ×N».

import {
  BEHAVIOR_LABELS,
  BEHAVIORS,
  KIND_LABELS,
  MODIFIER_FIELDS,
  OP_LABELS,
  clone,
  newId,
  ruleIssues,
  rulesetTags,
  type ComponentKind,
  type ConditionOp,
  type CustomModifier,
  type ModifierCondition,
  type Ruleset,
} from '../../../engine';
import { EffectsEditor } from '../../components/EffectsEditor';
import { Btn, Card, Check, Info, Menu, Num, Seg, Sel, Txt } from '../../components/ui';
import { moveIn, moveItems, type Upd } from './common';

export type FieldKind = (typeof MODIFIER_FIELDS)[number]['kind'] | 'cond';

const YES_NO = [
  { value: 'yes', label: 'да' },
  { value: 'no', label: 'нет' },
];

export function fieldInfo(r: Ruleset, field: string): { label: string; kind: FieldKind; options?: { value: string; label: string; title?: string }[] } {
  if (field.startsWith('cond.')) {
    const cat = r.conditions.find((c) => c.id === field.slice(5));
    return { label: `Условие: ${cat?.name ?? field}`, kind: 'cond', options: cat?.options.map((o) => ({ value: o.id, label: o.name, title: o.description })) };
  }
  const f = MODIFIER_FIELDS.find((x) => x.field === field);
  const kind = f?.kind ?? 'tag';
  let options: { value: string; label: string; title?: string }[] | undefined;
  switch (kind) {
    case 'order':
      options = r.orders.map((o) => ({ value: o.id, label: o.name, title: o.description }));
      break;
    case 'behavior':
      options = BEHAVIORS.map((b) => ({ value: b, label: BEHAVIOR_LABELS[b].split(' (')[0] }));
      break;
    case 'kind':
      options = (['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }));
      break;
    case 'tag':
      options = rulesetTags(r).map((t) => ({ value: t, label: t, title: r.tagDescriptions?.[t] }));
      break;
    case 'bool':
      options = YES_NO;
      break;
    case 'side':
      options = [
        { value: 'A', label: 'Сторона A' },
        { value: 'B', label: 'Сторона B' },
      ];
      break;
    case 'echelon':
      options = [
        { value: 'front', label: 'Первый эшелон' },
        { value: 'support', label: 'Второй эшелон' },
        { value: 'rear', label: 'Тыл' },
      ];
      break;
    case 'range':
      options = r.rangeBands.map((b) => ({ value: b.id, label: b.name, title: b.description }));
      break;
    case 'class':
      options = r.targetClasses.map((c) => ({ value: c.id, label: c.name, title: c.description }));
      break;
    case 'fort':
      options = r.fortifications.map((o) => ({ value: o.id, label: o.name, title: o.description }));
      break;
    case 'intel':
      options = r.intelLevels.map((o) => ({ value: o.id, label: o.name, title: o.description }));
      break;
  }
  return { label: f?.label ?? field, kind, options };
}

export function opsFor(kind: FieldKind): ConditionOp[] {
  if (kind === 'number') return ['eq', 'neq', 'gte', 'lte'];
  if (kind === 'bool') return ['eq'];
  if (kind === 'tag' || kind === 'kind') return ['has', 'not_has', 'in', 'nin'];
  return ['eq', 'neq', 'in', 'nin'];
}

/** Подпись операции: у тегов и состава — «есть / нет / любой из / ни один из». */
function opLabel(kind: FieldKind, op: ConditionOp): string {
  if (kind === 'tag' || kind === 'kind') return { has: 'есть', not_has: 'нет', in: 'любой из', nin: 'ни один из' }[op as 'has'] ?? OP_LABELS[op];
  return OP_LABELS[op];
}

/** Тег есть у какого-нибудь типа (или это тег разведки): иначе условие по нему не выполнится никогда. */
export const typeTagSet = (r: Ruleset) => new Set([...r.componentTypes.flatMap((t) => t.tags), ...(r.reconTag ? [r.reconTag] : [])]);

export function ConditionRow({
  r,
  c,
  onChange,
  onRemove,
}: {
  r: Ruleset;
  c: ModifierCondition;
  onChange: (c: ModifierCondition) => void;
  onRemove: () => void;
}) {
  const info = fieldInfo(r, c.field);
  const ops = opsFor(info.kind);
  // Поля выключенных механик не предлагаются (выбранное остаётся видно, чтобы его можно было сменить).
  const shown = (f: (typeof MODIFIER_FIELDS)[number]) => !f.feature || r.features[f.feature] || f.field === c.field;
  const fields = [
    // Условия боя — отдельной группой, без приставки «Условие:»: в узком поле видно само название.
    ...r.conditions.map((cat) => ({ value: `cond.${cat.id}`, label: cat.name, group: 'Условия боя' })),
    ...MODIFIER_FIELDS.filter((f) => !f.enemy && shown(f)).map((f) => ({ value: f.field, label: f.label, group: 'Свой элемент и сторона' })),
    ...MODIFIER_FIELDS.filter((f) => f.enemy && shown(f)).map((f) => ({ value: f.field, label: f.label, group: 'Противник и цель' })),
  ];
  const multi = c.op === 'in' || c.op === 'nin';
  const arr = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
  const tagSet = typeTagSet(r);
  // Тег — особенность типа: тег, которого нет ни у одного типа (опечатка, тип удалён), правило не включит никогда.
  const lostTag = info.kind === 'tag' && !multi && !!arr[0]?.trim() && !tagSet.has(arr[0].trim());
  const chipOptions =
    info.options && multi
      ? [
          ...info.options,
          // Выбранные значения, которых нет в списке (удалённый тег), — тоже чипами, чтобы их можно было снять.
          ...arr.filter((v) => v && !info.options!.some((o) => o.value === v)).map((v) => ({ value: v, label: v, title: undefined })),
        ]
      : [];
  return (
    <div className="cond-row">
      <Sel
        value={c.field}
        onChange={(field) => {
          const ni = fieldInfo(r, field);
          const op = opsFor(ni.kind)[0];
          onChange({ field, op, value: ni.kind === 'number' ? 1 : ni.kind === 'tag' ? '' : (ni.options?.[0]?.value ?? '') });
        }}
        options={fields}
      />
      <Sel
        value={c.op}
        onChange={(op) => {
          const m = op === 'in' || op === 'nin';
          onChange({ ...c, op, value: m ? arr.filter(Boolean) : (arr[0] ?? '') });
        }}
        options={ops.map((o) => ({ value: o, label: opLabel(info.kind, o) }))}
      />
      <div style={{ minWidth: 0 }}>
        {info.kind === 'number' ? (
          <Num value={Number(c.value)} onChange={(v) => onChange({ ...c, value: v })} width="100%" />
        ) : multi && chipOptions.length ? (
          <div className="row" style={{ gap: 4 }}>
            {chipOptions.map((o) => {
              const lost = info.kind === 'tag' && !tagSet.has(o.value);
              return (
                <label
                  key={o.value}
                  className={`chip${arr.includes(o.value) ? ' accent' : ''}${lost ? ' bad' : ''}`}
                  style={{ cursor: 'pointer' }}
                  data-tip={lost ? 'Такого тега нет ни у одного типа' : o.title}
                >
                  <input
                    type="checkbox"
                    style={{ display: 'none' }}
                    checked={arr.includes(o.value)}
                    onChange={(e) => onChange({ ...c, value: e.target.checked ? [...arr.filter(Boolean), o.value] : arr.filter((x) => x !== o.value) })}
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
        ) : info.kind === 'tag' ? (
          <>
            <input
              list="mod-tags"
              value={arr[0] ?? ''}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
              placeholder="тег"
              style={{ width: '100%' }}
              className={lostTag ? 'invalid' : undefined}
              data-tip={
                lostTag
                  ? 'Такого тега нет ни у одного типа — условие не выполнится. Теги задаются у типов («Каталог типов»).'
                  : r.tagDescriptions?.[arr[0] ?? '']
              }
            />
            <datalist id="mod-tags">
              {(info.options ?? []).map((t) => (
                <option key={t.value} value={t.value} />
              ))}
            </datalist>
          </>
        ) : info.options ? (
          <Sel value={arr[0] ?? ''} onChange={(v) => onChange({ ...c, value: v })} options={info.options} />
        ) : (
          <Txt value={arr[0] ?? ''} onChange={(v) => onChange({ ...c, value: v })} width="100%" />
        )}
      </div>
      <Btn sm kind="ghost" icon onClick={onRemove} title="Убрать условие">
        ×
      </Btn>
    </div>
  );
}

export function ModifiersSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const um = (i: number, fn: (m: CustomModifier) => void) => upd((d) => fn(d.modifiers[i]));
  const issues = new Map(r.modifiers.map((m) => [m.id, ruleIssues(r, m)] as const).filter(([, x]) => x.length));
  return (
    <>
      <div className="row">
        <Btn
          kind="primary"
          onClick={() => upd((d) => void d.modifiers.push({ id: newId('mod'), name: 'Новое правило', enabled: true, when: [], effects: { fire: 1 } }))}
        >
          + Правило
        </Btn>
        <Info text="«Если условия выполнены — характеристика ×N». Условия о противнике и классе цели проверяются для каждой пары стрелок — цель. Условия на теги: «есть» — все выбранные, «любой из» — хотя бы один." />
      </div>
      {!r.modifiers.length && <div className="empty">Своих правил пока нет.</div>}
      {r.modifiers.map((m, i) => (
        <Card
          key={m.id}
          anchor={`rule-${m.id}`}
          title={
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Check value={m.enabled} onChange={(v) => um(i, (x) => void (x.enabled = v))} title="Включено" />
              <input
                className="title-input"
                style={{ fontSize: 14, minWidth: 200, width: '100%' }}
                value={m.name}
                onChange={(e) => um(i, (x) => void (x.name = e.target.value))}
              />
            </div>
          }
          actions={
            <Menu
              sm
              items={[
                ...moveItems(i, r.modifiers.length, (dir) => upd((d) => moveIn(d.modifiers, i, dir))),
                {
                  label: 'Дублировать',
                  onClick: () => upd((d) => void d.modifiers.splice(i + 1, 0, { ...clone(m), id: newId('mod'), name: `${m.name} (копия)` })),
                },
                'sep',
                { label: 'Удалить правило', danger: true, onClick: () => upd((d) => void d.modifiers.splice(i, 1)) },
              ]}
            />
          }
        >
          {issues.get(m.id) && (
            <div className="note warn small" style={{ marginBottom: 8 }}>
              {issues.get(m.id)!.map((x, j) => (
                <div key={j}>⚠ {x}</div>
              ))}
            </div>
          )}
          <div className="mod-grid">
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <h4>Если</h4>
                {m.when.length > 1 && (
                  <Seg
                    value={m.any ? 'any' : 'all'}
                    onChange={(v) => um(i, (x) => void (v === 'any' ? (x.any = true) : delete x.any))}
                    options={[
                      { value: 'all', label: 'все условия' },
                      { value: 'any', label: 'любое из' },
                    ]}
                  />
                )}
              </div>
              {m.when.map((c, ci) => (
                <ConditionRow
                  key={ci}
                  r={r}
                  c={c}
                  onChange={(nc) => um(i, (x) => void (x.when[ci] = nc))}
                  onRemove={() => um(i, (x) => void x.when.splice(ci, 1))}
                />
              ))}
              {!m.when.length && <span className="faint small">Без условий — правило действует всегда.</span>}
              <Btn
                sm
                onClick={() =>
                  um(
                    i,
                    (x) =>
                      void x.when.push({
                        field: r.conditions[0] ? `cond.${r.conditions[0].id}` : 'tag',
                        op: 'eq',
                        value: r.conditions[0]?.options[0]?.id ?? '',
                      }),
                  )
                }
                className="grow"
              >
                + условие
              </Btn>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h4>То</h4>
              <EffectsEditor value={m.effects} onChange={(v) => um(i, (x) => void (x.effects = v))} />
              {(m.byShare || m.when.some((c) => c.field === 'tag' || c.field === 'kind')) && (
                <span data-tip="Множитель действует не на весь элемент, а по доле боевой ценности типов с этим тегом (составом): 1 + (N − 1) × доля. Один снайпер во взводе даст скрытность почти без изменений, взвод снайперов — полностью.">
                  <Check value={!!m.byShare} onChange={(v) => um(i, (x) => void (v ? (x.byShare = true) : delete x.byShare))}>
                    по доле типов с тегом
                  </Check>
                </span>
              )}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Txt
              value={m.description ?? ''}
              onChange={(v) => um(i, (x) => void (x.description = v))}
              placeholder="Описание (для себя и игроков)"
              width="100%"
            />
          </div>
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ исходы, коэффициенты, JSON
