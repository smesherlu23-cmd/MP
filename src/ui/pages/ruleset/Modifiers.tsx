// Набор правил: свои правила «если… то характеристика ×N».

import {
  BEHAVIOR_LABELS,
  BEHAVIORS,
  KIND_LABELS,
  MODIFIER_FIELDS,
  OP_LABELS,
  clone,
  newId,
  type ComponentKind,
  type ConditionOp,
  type CustomModifier,
  type ModifierCondition,
  type Ruleset,
} from '../../../engine';
import { EffectsEditor } from '../../components/EffectsEditor';
import { Btn, Card, Check, Info, Num, Sel, Txt } from '../../components/ui';
import type { Upd } from './common';

export type FieldKind = (typeof MODIFIER_FIELDS)[number]['kind'] | 'cond';

export function fieldInfo(r: Ruleset, field: string): { label: string; kind: FieldKind; options?: { value: string; label: string }[] } {
  if (field.startsWith('cond.')) {
    const cat = r.conditions.find((c) => c.id === field.slice(5));
    return { label: `Условие: ${cat?.name ?? field}`, kind: 'cond', options: cat?.options.map((o) => ({ value: o.id, label: o.name })) };
  }
  const f = MODIFIER_FIELDS.find((x) => x.field === field);
  const kind = f?.kind ?? 'tag';
  let options: { value: string; label: string }[] | undefined;
  switch (kind) {
    case 'order':
      options = r.orders.map((o) => ({ value: o.id, label: o.name }));
      break;
    case 'behavior':
      options = BEHAVIORS.map((b) => ({ value: b, label: BEHAVIOR_LABELS[b].split(' (')[0] }));
      break;
    case 'kind':
      options = (['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }));
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
      options = r.rangeBands.map((b) => ({ value: b.id, label: b.name }));
      break;
    case 'class':
      options = r.targetClasses.map((c) => ({ value: c.id, label: c.name }));
      break;
    case 'fort':
      options = r.fortifications.map((o) => ({ value: o.id, label: o.name }));
      break;
    case 'intel':
      options = r.intelLevels.map((o) => ({ value: o.id, label: o.name }));
      break;
  }
  return { label: f?.label ?? field, kind, options };
}

export function opsFor(kind: FieldKind): ConditionOp[] {
  if (kind === 'number') return ['eq', 'neq', 'gte', 'lte'];
  if (kind === 'tag' || kind === 'kind') return ['has', 'not_has'];
  return ['eq', 'neq', 'in', 'nin'];
}

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
  const fields = [
    ...r.conditions.map((cat) => ({ value: `cond.${cat.id}`, label: `Условие: ${cat.name}` })),
    ...MODIFIER_FIELDS.map((f) => ({ value: f.field, label: f.label })),
  ];
  const multi = c.op === 'in' || c.op === 'nin';
  const arr = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
  const allTags = [...new Set(r.componentTypes.flatMap((t) => t.tags))];
  return (
    <div className="cond-row">
      <Sel
        value={c.field}
        onChange={(field) => {
          const ni = fieldInfo(r, field);
          const op = opsFor(ni.kind)[0];
          onChange({ field, op, value: ni.kind === 'number' ? 1 : (ni.options?.[0]?.value ?? '') });
        }}
        options={fields}
      />
      <Sel
        value={c.op}
        onChange={(op) => {
          const m = op === 'in' || op === 'nin';
          onChange({ ...c, op, value: m ? arr.filter(Boolean) : (arr[0] ?? '') });
        }}
        options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))}
      />
      <div style={{ minWidth: 0 }}>
        {info.kind === 'number' ? (
          <Num value={Number(c.value)} onChange={(v) => onChange({ ...c, value: v })} width="100%" />
        ) : info.options && multi ? (
          <div className="row" style={{ gap: 4 }}>
            {info.options.map((o) => (
              <label key={o.value} className={`chip${arr.includes(o.value) ? ' accent' : ''}`} style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ display: 'none' }}
                  checked={arr.includes(o.value)}
                  onChange={(e) => onChange({ ...c, value: e.target.checked ? [...arr.filter(Boolean), o.value] : arr.filter((x) => x !== o.value) })}
                />
                {o.label}
              </label>
            ))}
          </div>
        ) : info.options ? (
          <Sel value={arr[0] ?? ''} onChange={(v) => onChange({ ...c, value: v })} options={info.options} />
        ) : (
          <>
            <input
              list="mod-tags"
              value={arr[0] ?? ''}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
              placeholder="тег"
              style={{ width: '100%' }}
            />
            <datalist id="mod-tags">
              {allTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </>
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
  return (
    <>
      <div className="row">
        <Btn
          kind="primary"
          onClick={() => upd((d) => void d.modifiers.push({ id: newId('mod'), name: 'Новое правило', enabled: true, when: [], effects: { fire: 1 } }))}
        >
          + Правило
        </Btn>
        <Info text="«Если все условия выполнены — характеристика ×N». Условия о противнике и классе цели проверяются для каждой пары стрелок — цель." />
      </div>
      {!r.modifiers.length && <div className="empty">Своих правил пока нет.</div>}
      {r.modifiers.map((m, i) => (
        <Card
          key={m.id}
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
            <div className="row">
              <Btn sm onClick={() => upd((d) => void d.modifiers.splice(i + 1, 0, { ...clone(m), id: newId('mod'), name: `${m.name} (копия)` }))}>
                Дублировать
              </Btn>
              <Btn sm kind="danger" onClick={() => upd((d) => void d.modifiers.splice(i, 1))}>
                Удалить
              </Btn>
            </div>
          }
        >
          <div className="mod-grid">
            <div className="stack" style={{ gap: 6 }}>
              <h4>Если</h4>
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
