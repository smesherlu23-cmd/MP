// Набор правил: приказы, уровни опыта и командиров, условия боя, укрепления, разведданные.

import { BEHAVIOR_LABELS, BEHAVIORS, newId, type Behavior, type LevelDef, type OptionDef, type Ruleset } from '../../../engine';
import { EffectsEditor } from '../../components/EffectsEditor';
import { Btn, Card, Info, Menu, Num, Sel, Txt } from '../../components/ui';
import { confirmDialog } from '../../store';
import type { Upd } from './common';

export function OrdersSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const missing = (['retreat', 'rout'] as Behavior[]).filter((b) => !r.orders.some((o) => o.behavior === b));
  return (
    <>
      {missing.length > 0 && (
        <div className="note warn">
          Нет приказа с поведением: {missing.map((b) => BEHAVIOR_LABELS[b].split(' (')[0]).join(', ')}. Проверки отхода и паники не смогут сменить приказ.
        </div>
      )}
      <Card
        title={
          <>
            Приказы{' '}
            <Info text="Поведение определяет логику движка, эффекты — численные множители. Например, «Штурм» = поведение «атака» с огнём ×1.3 и усталостью ×2." />
          </>
        }
        actions={
          <Btn
            sm
            kind="ghost"
            onClick={() => upd((d) => void d.orders.push({ id: newId('order'), name: 'Новый приказ', behavior: 'defend', exposure: 1, effects: {} }))}
          >
            + Приказ
          </Btn>
        }
      >
        <div className="grid two">
          {r.orders.map((o, i) => (
            <div key={o.id} className="kpi stack" style={{ gap: 8 }}>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <Txt value={o.name} onChange={(v) => upd((d) => void (d.orders[i].name = v))} width="100%" />
                <Menu
                  sm
                  items={[
                    {
                      label: 'Удалить приказ',
                      danger: true,
                      disabled: r.orders.length <= 1,
                      onClick: async () => {
                        if (await confirmDialog(`Удалить приказ «${o.name}»?`, 'Элементы с этим приказом получат приказ своего формирования.', 'Удалить', true))
                          upd((d) => void (d.orders = d.orders.filter((x) => x.id !== o.id)));
                      },
                    },
                  ]}
                />
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <div className="grow">
                  <Sel
                    value={o.behavior}
                    width="100%"
                    onChange={(v) => upd((d) => void (d.orders[i].behavior = v))}
                    options={BEHAVIORS.map((b) => ({ value: b, label: BEHAVIOR_LABELS[b] }))}
                    title="Поведение"
                  />
                </div>
                <Num
                  value={o.exposure}
                  onChange={(v) => upd((d) => void (d.orders[i].exposure = v))}
                  min={0}
                  max={3}
                  step={0.05}
                  width={64}
                  title="Подставленность под огонь: 0 — вне огня, 1 — полностью"
                />
              </div>
              <EffectsEditor value={o.effects} onChange={(v) => upd((d) => void (d.orders[i].effects = v))} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

export function LevelsSection({ title, hint, levels, set }: { title: string; hint: string; levels: LevelDef[]; set: (fn: (l: LevelDef[]) => void) => void }) {
  return (
    <Card
      title={
        <>
          {title} <Info text={hint} />
        </>
      }
      actions={
        <Btn sm kind="ghost" onClick={() => set((l) => void l.push({ name: `Уровень ${l.length + 1}`, effects: {} }))}>
          + Уровень
        </Btn>
      }
    >
      <div className="grid three">
        {levels.map((lv, i) => (
          <div key={i} className="kpi stack" style={{ gap: 6 }}>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
              <span className="faint">{i + 1}.</span>
              <Txt value={lv.name} onChange={(v) => set((l) => void (l[i].name = v))} width="100%" />
              <Menu
                sm
                items={[
                  { label: 'Выше', disabled: i === 0, onClick: () => set((l) => void ([l[i - 1], l[i]] = [l[i], l[i - 1]])) },
                  { label: 'Ниже', disabled: i === levels.length - 1, onClick: () => set((l) => void ([l[i + 1], l[i]] = [l[i], l[i + 1]])) },
                  'sep',
                  { label: 'Удалить', danger: true, disabled: levels.length <= 1, onClick: () => set((l) => void l.splice(i, 1)) },
                ]}
              />
            </div>
            <EffectsEditor value={lv.effects} onChange={(v) => set((l) => void (l[i].effects = v))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function OptionsSection({
  title,
  hint,
  options,
  set,
}: {
  title: string;
  hint: string;
  options: OptionDef[];
  set: (fn: (o: OptionDef[]) => void) => void;
}) {
  return (
    <Card
      title={
        <>
          {title} <Info text={hint} />
        </>
      }
      actions={
        <Btn sm kind="ghost" onClick={() => set((o) => void o.push({ id: newId('opt'), name: 'Новый вариант', effects: {} }))}>
          + Вариант
        </Btn>
      }
    >
      <OptionGrid options={options} set={set} />
    </Card>
  );
}

export function OptionGrid({ options, set }: { options: OptionDef[]; set: (fn: (o: OptionDef[]) => void) => void }) {
  return (
    <div className="grid three">
      {options.map((op, i) => (
        <div key={op.id} className="kpi stack" style={{ gap: 6 }}>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
            <Txt value={op.name} onChange={(v) => set((o) => void (o[i].name = v))} width="100%" />
            <Btn sm kind="ghost" icon disabled={options.length <= 1} onClick={() => set((o) => void o.splice(i, 1))} title="Удалить вариант">
              ×
            </Btn>
          </div>
          <EffectsEditor value={op.effects} onChange={(v) => set((o) => void (o[i].effects = v))} />
        </div>
      ))}
    </div>
  );
}

export function ConditionsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <>
      {r.conditions.map((cat, ci) => (
        <Card
          key={cat.id}
          title={
            <input
              className="title-input"
              style={{ fontSize: 14, minWidth: 180 }}
              value={cat.name}
              onChange={(e) => upd((d) => void (d.conditions[ci].name = e.target.value))}
            />
          }
          actions={
            <div className="row" style={{ gap: 4 }}>
              <Btn sm kind="ghost" onClick={() => upd((d) => void d.conditions[ci].options.push({ id: newId('opt'), name: 'Новый вариант', effects: {} }))}>
                + Вариант
              </Btn>
              <Menu
                sm
                items={[
                  {
                    label: 'Удалить категорию',
                    danger: true,
                    onClick: async () => {
                      if (await confirmDialog(`Удалить категорию «${cat.name}»?`, undefined, 'Удалить', true)) upd((d) => void d.conditions.splice(ci, 1));
                    },
                  },
                ]}
              />
            </div>
          }
        >
          <OptionGrid options={cat.options} set={(fn) => upd((d) => fn(d.conditions[ci].options))} />
        </Card>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <Btn
          kind="ghost"
          onClick={() =>
            upd((d) => void d.conditions.push({ id: newId('cat'), name: 'Новая категория', options: [{ id: newId('opt'), name: 'Обычно', effects: {} }] }))
          }
        >
          + Категория условий
        </Btn>
        <Info text="Кроме местности, времени суток и погоды можно добавить свои категории: сезон, высота, радиационная обстановка… Эффекты варианта действуют на все элементы обеих сторон." />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ свои правила
