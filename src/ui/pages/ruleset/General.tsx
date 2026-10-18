// Набор правил: общее, механики, временные эффекты, исходы, коэффициенты, JSON.

import { useMemo, useState } from 'react';
import { COEFFICIENT_GROUPS, COEFFICIENTS, FEATURE_LABELS, newId, normalizeRuleset, type Features, type Ruleset } from '../../../engine';
import { EffectsEditor } from '../../components/EffectsEditor';
import { Area, Btn, Card, Check, Field, Info, Menu, Num, Section, Tags, Txt } from '../../components/ui';
import { confirmDialog, replaceRuleset, toast, useApp } from '../../store';
import type { Upd } from './common';

export const FEATURE_HINTS: Record<keyof Features, string> = {
  detection: 'Без неё все элементы всегда видны противнику.',
  initiative: 'Без неё стороны стреляют одновременно и без бонусов.',
  suppression: 'Подавление снижает огонь, движение и мораль.',
  ammo: 'Расход и подвоз боезапаса, падение огня при нехватке.',
  fuel: 'Расход топлива техникой, неподвижность без топлива.',
  equipment: 'Износ снаряжения и его влияние на огонь.',
  fatigue: 'Накопление усталости и её влияние на огонь и мораль.',
  morale: 'Изменение морали, её влияние на огонь и проверки.',
  cohesion: 'Слаженность снижается от потерь и влияет на огонь и мораль.',
  readiness: 'Готовность элемента влияет на его огонь.',
  vehicleCondition: 'Техсостояние влияет на огонь техники и поломки.',
  comms: 'Связь влияет на огонь, инициативу и слаженность.',
  command: 'Уровни командиров влияют на элементы формирований.',
  breakdowns: 'Небоевые поломки техники при движении.',
  panic: 'Проверка паники при низкой морали.',
  retreat: 'Проверка отхода при низкой морали и больших потерях.',
};

export function General({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card title="Описание">
      <div className="fields">
        <Field label="Название">
          <Txt value={r.name} onChange={(v) => upd((d) => void (d.name = v))} />
        </Field>
        <Field label="Эпоха">
          <Txt value={r.era ?? ''} onChange={(v) => upd((d) => void (d.era = v))} placeholder="например: Вторая мировая" />
        </Field>
        <Field label="Минут в ходу" hint="Только для отображения времени боя.">
          <Num value={r.turnMinutes} onChange={(v) => upd((d) => void (d.turnMinutes = v))} min={1} integer width="100%" />
        </Field>
        <Field label="Тег разведки" hint="Элементы и типы с этим тегом — лучшие наблюдатели, как при приказе «разведка».">
          <Txt value={r.reconTag} onChange={(v) => upd((d) => void (d.reconTag = v))} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field
          label="Уровни подразделений"
          hint="Подсказки для поля «Уровень» в конструкторе, от младшего к старшему. «Добавить подчинённое» предлагает уровень на ступень ниже."
        >
          <Tags value={r.unitLevels} onChange={(v) => upd((d) => void (d.unitLevels = v))} placeholder="отделение, взвод, рота…" />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Area value={r.description ?? ''} onChange={(v) => upd((d) => void (d.description = v))} rows={3} placeholder="Описание (необязательно)" />
      </div>
    </Card>
  );
}

export function FeaturesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card
      title={
        <>
          Механики <Info text="Выключенная механика не участвует в расчёте, а её поля скрываются в редакторах — так правила упрощаются под вашу игру." />
        </>
      }
    >
      <div className="feature-grid">
        {(Object.keys(FEATURE_LABELS) as (keyof Features)[]).map((k) => (
          <span key={k} data-tip={FEATURE_HINTS[k]}>
            <Check value={r.features[k]} onChange={(v) => upd((d) => void (d.features[k] = v))}>
              {FEATURE_LABELS[k]}
            </Check>
          </span>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ каталог типов

export function TempEffectsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const list = r.tempEffects ?? [];
  return (
    <Card
      title={
        <>
          Временные эффекты{' '}
          <Info text="Заготовки для боя: ГМ накладывает эффект на сторону, формирование или выбранные элементы на несколько ходов (в бою — кнопка «Эффект…», в плане боя — событие «Временный эффект»). Множители действуют, как у приказов и условий." />
        </>
      }
      actions={
        <Btn
          sm
          kind="ghost"
          onClick={() => upd((d) => void (d.tempEffects ??= []).push({ id: newId('fx'), name: 'Новый эффект', turns: 2, effects: { fire: 1.2 } }))}
        >
          + Эффект
        </Btn>
      }
    >
      {!list.length && <div className="muted">Заготовок нет — добавьте, чтобы накладывать их в бою одним щелчком.</div>}
      <div className="grid two">
        {list.map((x, i) => (
          <div key={x.id} className="kpi stack" style={{ gap: 8 }}>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
              <Txt value={x.name} onChange={(v) => upd((d) => void (d.tempEffects[i].name = v))} width="100%" />
              <Num
                value={x.turns}
                onChange={(v) => upd((d) => void (d.tempEffects[i].turns = Math.max(1, Math.round(v))))}
                min={1}
                max={50}
                integer
                suffix="ход"
                width={78}
                title="Сколько ходов действует по умолчанию"
              />
              <Menu sm items={[{ label: 'Удалить эффект', danger: true, onClick: () => upd((d) => void d.tempEffects.splice(i, 1)) }]} />
            </div>
            <Txt
              value={x.description ?? ''}
              onChange={(v) => upd((d) => void (d.tempEffects[i].description = v || undefined))}
              placeholder="описание (необязательно)"
              width="100%"
            />
            <EffectsEditor value={x.effects} onChange={(v) => upd((d) => void (d.tempEffects[i].effects = v))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ общее

export function OutcomesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card
      title={
        <>
          Уровни исхода{' '}
          <Info text="Каждая сторона получает оценку выполнения своих задач от 0 до 100%. Исход определяется разницей оценок: выбирается первый уровень (по убыванию порога), порог которого не больше разницы. Уровень с порогом 0 — ничья." />
        </>
      }
      actions={
        <Btn sm kind="ghost" onClick={() => upd((d) => void d.outcomeLevels.push({ id: newId('out'), name: 'Новый уровень', minDiff: 0.3 }))}>
          + Уровень
        </Btn>
      }
    >
      <table className="tbl" style={{ width: 'auto' }}>
        <thead>
          <tr>
            <th>Название</th>
            <th className="num">Порог разницы, %</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...r.outcomeLevels]
            .map((o, i) => ({ o, i }))
            .sort((a, b) => b.o.minDiff - a.o.minDiff)
            .map(({ o, i }) => (
              <tr key={o.id}>
                <td>
                  <Txt value={o.name} onChange={(v) => upd((d) => void (d.outcomeLevels[i].name = v))} width={260} />
                </td>
                <td className="num">
                  <Num
                    value={Math.round(o.minDiff * 100)}
                    onChange={(v) => upd((d) => void (d.outcomeLevels[i].minDiff = v / 100))}
                    min={0}
                    max={100}
                    suffix="%"
                  />
                </td>
                <td>
                  <Btn sm kind="danger" disabled={r.outcomeLevels.length <= 1} onClick={() => upd((d) => void d.outcomeLevels.splice(i, 1))}>
                    ×
                  </Btn>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </Card>
  );
}

export function CoefficientsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const [q, setQ] = useState('');
  const isChanged = (key: string, def: number) => (r.coefficients[key] ?? def) !== def;
  const changed = COEFFICIENTS.filter((m) => isChanged(m.key, m.default)).length;
  const query = q.trim().toLowerCase();
  return (
    <>
      <div className="row">
        <input type="search" placeholder="Найти коэффициент…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        {changed > 0 && <span className="muted small">изменено: {changed}</span>}
        <div className="grow" />
        {changed > 0 && (
          <Btn
            sm
            kind="ghost"
            onClick={async () => {
              if (await confirmDialog('Сбросить все коэффициенты к стандартным значениям?', undefined, 'Сбросить', true))
                upd((d) => void (d.coefficients = Object.fromEntries(COEFFICIENTS.map((m) => [m.key, m.default]))));
            }}
          >
            Сбросить все
          </Btn>
        )}
      </div>
      {COEFFICIENT_GROUPS.map((g) => {
        const items = COEFFICIENTS.filter((m) => m.group === g && (!query || `${m.label} ${m.description} ${m.key}`.toLowerCase().includes(query)));
        if (!items.length) return null;
        const groupChanged = items.filter((m) => isChanged(m.key, m.default)).length;
        return (
          <Section key={g} id={`coef-${g}`} title={g} summary={groupChanged ? `изменено: ${groupChanged}` : String(items.length)} forceOpen={!!query} tight>
            <table className="tbl">
              <tbody>
                {items.map((m) => {
                  const off = m.feature && !r.features[m.feature];
                  const v = r.coefficients[m.key] ?? m.default;
                  return (
                    <tr key={m.key} className={off ? 'dim' : ''}>
                      <td>
                        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          {m.label}
                          <Info
                            text={`${m.description ? `${m.description}\n` : ''}${off ? `Механика «${FEATURE_LABELS[m.feature!]}» выключена.\n` : ''}Ключ: ${m.key} · по умолчанию ${m.default}`}
                          />
                        </span>
                      </td>
                      <td style={{ width: 120 }}>
                        <Num
                          value={v}
                          onChange={(x) => upd((d) => void (d.coefficients[m.key] = x))}
                          min={m.min}
                          max={m.max}
                          step={m.step ?? 0.05}
                          width={100}
                        />
                      </td>
                      <td style={{ width: 90 }} className="small">
                        {v !== m.default && (
                          <a href="#" onClick={(e) => (e.preventDefault(), upd((d) => void (d.coefficients[m.key] = m.default)))}>
                            сбросить
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        );
      })}
    </>
  );
}

export function JsonSection({ r }: { r: Ruleset }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: исходный JSON — при открытии набора; правки в поле не перезаписываются
  const initial = useMemo(() => JSON.stringify(r, null, 2), [r.id]);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  return (
    <Card
      title={
        <>
          JSON <Info text="Для опытных пользователей: правьте напрямую, затем «Применить». Недостающие поля будут заполнены значениями по умолчанию." />
        </>
      }
      actions={
        <div className="row">
          <Btn sm onClick={() => setText(JSON.stringify(useApp.getState().rulesets[r.id], null, 2))}>
            Обновить из редактора
          </Btn>
          <Btn
            sm
            kind="primary"
            onClick={() => {
              try {
                const data = JSON.parse(text) as Ruleset;
                if (!data.componentTypes || !data.rangeBands) throw new Error('это не набор правил');
                replaceRuleset(normalizeRuleset({ ...data, id: r.id }));
                setErr('');
                toast('Изменения применены.', 'good');
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Применить
          </Btn>
        </div>
      }
    >
      {err && <div className="note bad">Ошибка: {err}</div>}
      <textarea
        className="mono"
        style={{ width: '100%', minHeight: 520, fontSize: 12 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
    </Card>
  );
}
