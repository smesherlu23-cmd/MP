// Редактор набора правил: всё, что влияет на расчёт, редактируется здесь без изменения кода.

import { useMemo, useState } from 'react';
import {
  BEHAVIOR_LABELS,
  BEHAVIORS,
  COEFFICIENT_GROUPS,
  COEFFICIENTS,
  FEATURE_LABELS,
  KIND_LABELS,
  MODIFIER_FIELDS,
  OP_LABELS,
  clone,
  newId,
  normalizeRuleset,
  type Behavior,
  type ComponentKind,
  type ComponentType,
  type ConditionOp,
  type CustomModifier,
  type Effects,
  type Features,
  type FormationDef,
  type LevelDef,
  type ModifierCondition,
  type OptionDef,
  type Ruleset,
} from '../../engine';
import { EffectsEditor, effectsText } from '../components/EffectsEditor';
import { Area, Btn, Card, Check, Field, Num, Sel, Tags, Txt } from '../components/ui';
import { useTabState } from '../hooks';
import { confirmDialog, createRuleset, deleteRuleset, exportJson, replaceRuleset, setTabSub, toast, updateRuleset, useApp, type Tab } from '../store';

type Upd = (fn: (r: Ruleset) => void) => void;

const SECTIONS: { id: string; label: string }[] = [
  { id: 'general', label: 'Общее' },
  { id: 'features', label: 'Механики' },
  { id: 'types', label: 'Каталог типов' },
  { id: 'classes', label: 'Классы целей' },
  { id: 'bands', label: 'Дистанции' },
  { id: 'orders', label: 'Приказы' },
  { id: 'experience', label: 'Уровни опыта' },
  { id: 'command', label: 'Командиры' },
  { id: 'conditions', label: 'Условия боя' },
  { id: 'fortifications', label: 'Укрепления' },
  { id: 'intel', label: 'Разведданные' },
  { id: 'modifiers', label: 'Свои правила' },
  { id: 'outcomes', label: 'Уровни исхода' },
  { id: 'coefficients', label: 'Коэффициенты и пороги' },
  { id: 'json', label: 'JSON' },
];

export function RulesetPage({ tab }: { tab: Tab }) {
  const r = useApp((s) => s.rulesets[tab.ref!]);
  if (!r) return <div className="empty">Набор правил не найден.</div>;
  const sub = tab.sub ?? 'general';
  const upd: Upd = (fn) => updateRuleset(r.id, fn);
  const counts: Record<string, number> = {
    types: r.componentTypes.length,
    classes: r.targetClasses.length,
    bands: r.rangeBands.length,
    orders: r.orders.length,
    experience: r.experienceLevels.length,
    command: r.commandLevels.length,
    conditions: r.conditions.length,
    fortifications: r.fortifications.length,
    intel: r.intelLevels.length,
    modifiers: r.modifiers.length,
    outcomes: r.outcomeLevels.length,
  };
  return (
    <div className="page">
      <div className="crumbs">Набор правил</div>
      <div className="page-head">
        <input className="title-input" value={r.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <div className="toolbar">
          <Btn onClick={() => createRuleset(r.id)} title="Создать копию для экспериментов">
            Дублировать
          </Btn>
          <Btn onClick={() => exportJson('ruleset', r.name, r)}>Экспорт</Btn>
          <Btn kind="danger" onClick={() => deleteRuleset(r.id)}>
            Удалить
          </Btn>
        </div>
      </div>
      <div className="split" style={{ gridTemplateColumns: '200px minmax(0, 1fr)' }}>
        <nav className="vnav">
          {SECTIONS.map((x) => (
            <button key={x.id} className={sub === x.id ? 'on' : ''} onClick={() => setTabSub(tab.key, x.id)}>
              <span>{x.label}</span>
              {counts[x.id] !== undefined && <span className="faint">{counts[x.id]}</span>}
            </button>
          ))}
        </nav>
        <div className="stack">
          {sub === 'general' && <General r={r} upd={upd} />}
          {sub === 'features' && <FeaturesSection r={r} upd={upd} />}
          {sub === 'types' && <TypesSection r={r} upd={upd} tabKey={tab.key} />}
          {sub === 'classes' && <ClassesSection r={r} upd={upd} />}
          {sub === 'bands' && <BandsSection r={r} upd={upd} />}
          {sub === 'orders' && <OrdersSection r={r} upd={upd} />}
          {sub === 'experience' && (
            <LevelsSection
              title="Уровни опыта"
              hint="Опыт элемента задаётся номером уровня (1 — первый в списке). Эффекты уровня действуют на все характеристики элемента."
              levels={r.experienceLevels}
              set={(fn) => upd((d) => fn(d.experienceLevels))}
            />
          )}
          {sub === 'command' && (
            <LevelsSection
              title="Уровни командиров"
              hint="Командир формирования влияет на все его элементы; влияние вышестоящих командиров ослабевает с каждым уровнем (коэффициент «Влияние вышестоящего командира»)."
              levels={r.commandLevels}
              set={(fn) => upd((d) => fn(d.commandLevels))}
            />
          )}
          {sub === 'conditions' && <ConditionsSection r={r} upd={upd} />}
          {sub === 'fortifications' && (
            <OptionsSection
              title="Уровни укреплений"
              hint="Укрепления стороны действуют только на её элементы с приказами обороны, засады, закрепления или в резерве."
              options={r.fortifications}
              set={(fn) => upd((d) => fn(d.fortifications))}
            />
          )}
          {sub === 'intel' && (
            <OptionsSection
              title="Уровни разведданных"
              hint="Разведданные стороны влияют на все её элементы — обычно на обнаружение и инициативу."
              options={r.intelLevels}
              set={(fn) => upd((d) => fn(d.intelLevels))}
            />
          )}
          {sub === 'modifiers' && <ModifiersSection r={r} upd={upd} />}
          {sub === 'outcomes' && <OutcomesSection r={r} upd={upd} />}
          {sub === 'coefficients' && <CoefficientsSection r={r} upd={upd} />}
          {sub === 'json' && <JsonSection r={r} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ общее

function usage(r: Ruleset) {
  const s = useApp.getState();
  const scenarios = Object.values(s.scenarios).filter((x) => x.rulesetId === r.id);
  const formations = Object.values(s.formations).filter((x) => x.rulesetId === r.id);
  return { scenarios, formations };
}

function General({ r, upd }: { r: Ruleset; upd: Upd }) {
  const { scenarios, formations } = usage(r);
  return (
    <>
      <Card title="Описание">
        <div className="fields two">
          <Field label="Название">
            <Txt value={r.name} onChange={(v) => upd((d) => void (d.name = v))} />
          </Field>
          <Field label="Эпоха / сеттинг">
            <Txt value={r.era ?? ''} onChange={(v) => upd((d) => void (d.era = v))} placeholder="например: Вторая мировая" />
          </Field>
          <Field label="Минут в одном ходу" hint="Для отображения времени боя.">
            <Num value={r.turnMinutes} onChange={(v) => upd((d) => void (d.turnMinutes = v))} min={1} integer />
          </Field>
          <Field label="Тег разведки" hint="Элементы и типы с этим тегом — лучшие наблюдатели (как при приказе «разведка»).">
            <Txt value={r.reconTag} onChange={(v) => upd((d) => void (d.reconTag = v))} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Описание">
            <Area value={r.description ?? ''} onChange={(v) => upd((d) => void (d.description = v))} rows={4} />
          </Field>
        </div>
      </Card>
      <Card title="Использование">
        <p className="muted small">
          Сценариев: {scenarios.length} · подразделений в библиотеке: {formations.length}. Изменения правил сразу действуют на новые бои; уже идущие бои хранят
          собственную копию правил.
        </p>
      </Card>
    </>
  );
}

function FeaturesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const hints: Record<keyof Features, string> = {
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
  return (
    <Card title="Механики">
      <p className="muted small">Выключенная механика не участвует в расчёте, а соответствующие поля скрываются в редакторах. Так можно упростить правила под свою игру.</p>
      <div className="fields two" style={{ marginTop: 10 }}>
        {(Object.keys(FEATURE_LABELS) as (keyof Features)[]).map((k) => (
          <div key={k}>
            <Check value={r.features[k]} onChange={(v) => upd((d) => void (d.features[k] = v))}>
              <b>{FEATURE_LABELS[k]}</b>
            </Check>
            <div className="faint small" style={{ marginLeft: 22 }}>
              {hints[k]}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ каталог типов

function typeUsage(typeId: string): number {
  const s = useApp.getState();
  let n = 0;
  const walk = (f: FormationDef) => {
    for (const e of f.elements) if (e.composition.some((c) => c.typeId === typeId)) n++;
    f.subunits.forEach(walk);
  };
  Object.values(s.formations).forEach(walk);
  Object.values(s.scenarios).forEach((sc) => sc.sides.forEach((sd) => sd.formations.forEach(walk)));
  return n;
}

function TypesSection({ r, upd, tabKey }: { r: Ruleset; upd: Upd; tabKey: string }) {
  const [selId, setSel] = useTabState<string>(`${tabKey}:type`, r.componentTypes[0]?.id ?? '');
  const [view, setView] = useTabState<'edit' | 'table'>(`${tabKey}:typesView`, 'edit');
  const t = r.componentTypes.find((x) => x.id === selId) ?? r.componentTypes[0];
  const add = () => {
    const id = newId('type');
    upd((d) =>
      d.componentTypes.push({
        id,
        name: 'Новый тип',
        kind: 'personnel',
        targetClass: d.targetClasses[0]?.id ?? '',
        crew: 1,
        value: 1,
        protection: 1,
        firepower: {},
        indirect: false,
        suppressive: 1,
        ammoUse: 5,
        fuelUse: 0,
        tags: [],
      }),
    );
    setSel(id);
  };
  const allTags = [...new Set(r.componentTypes.flatMap((x) => x.tags).concat(r.reconTag ? [r.reconTag] : []))];
  return (
    <>
      <div className="row">
        <Btn kind="primary" onClick={add}>
          + Новый тип
        </Btn>
        <div className="grow" />
        <Btn active={view === 'edit'} onClick={() => setView('edit')}>
          Редактор
        </Btn>
        <Btn active={view === 'table'} onClick={() => setView('table')}>
          Сводная таблица
        </Btn>
      </div>
      {view === 'table' ? (
        <TypesTable r={r} onPick={(id) => (setSel(id), setView('edit'))} />
      ) : (
        <div className="split" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>
          <Card tight>
            <div className="tree" style={{ padding: 6 }}>
              {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => (
                <div key={k}>
                  <div className="faint small" style={{ padding: '6px 6px 2px' }}>
                    {KIND_LABELS[k]}
                  </div>
                  {r.componentTypes
                    .filter((x) => x.kind === k)
                    .map((x) => (
                      <div key={x.id} className={`tree-node${x.id === t?.id ? ' sel' : ''}`} onClick={() => setSel(x.id)}>
                        <span className="tn-name">{x.name}</span>
                        <span className="tn-meta">{r.targetClasses.find((c) => c.id === x.targetClass)?.name ?? '?'}</span>
                      </div>
                    ))}
                </div>
              ))}
              {!r.componentTypes.length && <div className="empty">Каталог пуст. Добавьте первый тип: например, «Стрелок» или «Танк».</div>}
            </div>
          </Card>
          {t && <TypeEditor r={r} t={t} upd={upd} allTags={allTags} onSelect={setSel} />}
        </div>
      )}
    </>
  );
}

function TypeEditor({ r, t, upd, allTags, onSelect }: { r: Ruleset; t: ComponentType; upd: Upd; allTags: string[]; onSelect: (id: string) => void }) {
  const ut = (fn: (x: ComponentType) => void) =>
    upd((d) => {
      const x = d.componentTypes.find((y) => y.id === t.id);
      if (x) fn(x);
    });
  const used = typeUsage(t.id);
  return (
    <Card
      title={t.name}
      actions={
        <div className="row">
          <Btn
            sm
            onClick={() => {
              const id = newId('type');
              upd((d) => {
                const i = d.componentTypes.findIndex((y) => y.id === t.id);
                d.componentTypes.splice(i + 1, 0, { ...clone(t), id, name: `${t.name} (копия)` });
              });
              onSelect(id);
            }}
          >
            Дублировать
          </Btn>
          <Btn
            sm
            kind="danger"
            onClick={async () => {
              if (!(await confirmDialog(`Удалить тип «${t.name}»?`, used ? `Он используется в ${used} элементах — там он перестанет учитываться.` : undefined, 'Удалить', true))) return;
              upd((d) => void (d.componentTypes = d.componentTypes.filter((y) => y.id !== t.id)));
            }}
          >
            Удалить
          </Btn>
        </div>
      }
    >
      <div className="fields">
        <Field label="Название">
          <Txt value={t.name} onChange={(v) => ut((x) => void (x.name = v))} />
        </Field>
        <Field label="Вид">
          <Sel
            value={t.kind}
            onChange={(v) =>
              ut((x) => {
                x.kind = v;
                if (v === 'personnel') x.crew = 1;
              })
            }
            options={(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          />
        </Field>
        <Field label="Класс цели" hint="Каким классом этот тип является для огня противника.">
          <Sel value={t.targetClass} onChange={(v) => ut((x) => void (x.targetClass = v))} options={r.targetClasses.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        {t.kind !== 'personnel' && (
          <Field label="Экипаж / расчёт, чел.">
            <Num value={t.crew} onChange={(v) => ut((x) => void (x.crew = v))} min={0} integer />
          </Field>
        )}
        <Field label="Боевая ценность" hint="Очки: вес в боеспособности и потерях.">
          <Num value={t.value} onChange={(v) => ut((x) => void (x.value = v))} min={0} step={0.5} />
        </Field>
        <Field label="Защищённость" hint="1 — как у типичной цели класса.">
          <Num value={t.protection} onChange={(v) => ut((x) => void (x.protection = v))} min={0.05} step={0.1} />
        </Field>
        <Field label="Подавляющее действие">
          <Num value={t.suppressive} onChange={(v) => ut((x) => void (x.suppressive = v))} min={0} step={0.1} />
        </Field>
        {r.features.ammo && (
          <Field label="Расход БК, %/ход">
            <Num value={t.ammoUse} onChange={(v) => ut((x) => void (x.ammoUse = v))} min={0} step={0.5} />
          </Field>
        )}
        {r.features.fuel && t.kind === 'vehicle' && (
          <Field label="Расход топлива, %/ход">
            <Num value={t.fuelUse} onChange={(v) => ut((x) => void (x.fuelUse = v))} min={0} step={0.5} />
          </Field>
        )}
        <Field label="Огонь">
          <Check value={t.indirect} onChange={(v) => ut((x) => void (x.indirect = v))} title="Навесной/непрямой огонь: не требует прямой видимости, достаёт второй эшелон и тыл.">
            с закрытых позиций
          </Check>
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Теги" hint={`Используются в своих правилах. Тег «${r.reconTag}» делает тип разведчиком.`}>
          <Tags value={t.tags} onChange={(v) => ut((x) => void (x.tags = v))} suggestions={allTags} />
        </Field>
      </div>
      <h4 style={{ margin: '16px 0 6px' }}>Огневая мощь (поражений за ход одной единицей)</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl matrix" style={{ width: 'auto' }}>
          <thead>
            <tr>
              <th>По классу цели</th>
              {r.rangeBands.map((b) => (
                <th key={b.id} className="num">
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.targetClasses.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {r.rangeBands.map((b) => (
                  <td key={b.id} className="num">
                    <Num
                      value={t.firepower[c.id]?.[b.id] ?? 0}
                      min={0}
                      step={0.005}
                      width={80}
                      onChange={(v) =>
                        ut((x) => {
                          x.firepower[c.id] = { ...(x.firepower[c.id] ?? {}), [b.id]: v };
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint small" style={{ marginTop: 6 }}>
        Пример: 0,04 — сто таких единиц за ход в идеальных условиях выводят из строя около 4 целей этого класса. Реальный результат умножается на состояние,
        условия, приказы и защищённость цели.
      </p>
      <div style={{ marginTop: 10 }}>
        <Field label="Описание">
          <Area value={t.description ?? ''} onChange={(v) => ut((x) => void (x.description = v))} rows={2} />
        </Field>
      </div>
      <p className="faint small">Используется в элементах: {used}.</p>
    </Card>
  );
}

function TypesTable({ r, onPick }: { r: Ruleset; onPick: (id: string) => void }) {
  return (
    <Card tight>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Вид</th>
              <th>Класс</th>
              <th className="num">Ценн.</th>
              <th className="num">Защ.</th>
              {r.targetClasses.flatMap((c) =>
                r.rangeBands.map((b) => (
                  <th key={`${c.id}-${b.id}`} className="num" title={`${c.name}, ${b.name}`}>
                    {c.name.slice(0, 6)}·{b.name.slice(0, 3)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {r.componentTypes.map((t) => (
              <tr key={t.id}>
                <td>
                  <a href="#" onClick={(e) => (e.preventDefault(), onPick(t.id))}>
                    {t.name}
                  </a>
                  {t.indirect && <span className="badge info" style={{ marginLeft: 6 }}>навесной</span>}
                </td>
                <td className="small">{KIND_LABELS[t.kind]}</td>
                <td className="small">{r.targetClasses.find((c) => c.id === t.targetClass)?.name}</td>
                <td className="num">{t.value}</td>
                <td className="num">{t.protection}</td>
                {r.targetClasses.flatMap((c) =>
                  r.rangeBands.map((b) => (
                    <td key={`${c.id}-${b.id}`} className="num small">
                      {t.firepower[c.id]?.[b.id] || <span className="faint">0</span>}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ классы и дистанции

function ClassesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card
      title="Классы целей"
      actions={
        <Btn sm onClick={() => upd((d) => void d.targetClasses.push({ id: newId('cls'), name: 'Новый класс', lethality: 1 }))}>
          + Класс
        </Btn>
      }
    >
      <p className="muted small">
        Класс цели определяет, каким оружием её эффективно поражать: в каталоге типов огневая мощь задаётся отдельно по каждому классу. Для другой эпохи это
        может быть «пехота / кавалерия / артиллерия» или «пехота / корабли».
      </p>
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Название</th>
            <th className="num" title="Доля воздействия, превращающаяся в потери">
              Летальность
            </th>
            <th>Описание</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.targetClasses.map((c, i) => (
            <tr key={c.id}>
              <td>
                <Txt value={c.name} onChange={(v) => upd((d) => void (d.targetClasses[i].name = v))} />
              </td>
              <td className="num">
                <Num value={c.lethality} onChange={(v) => upd((d) => void (d.targetClasses[i].lethality = v))} min={0} step={0.05} width={80} />
              </td>
              <td>
                <Txt value={c.description ?? ''} onChange={(v) => upd((d) => void (d.targetClasses[i].description = v))} width="100%" />
              </td>
              <td>
                <Btn
                  sm
                  kind="danger"
                  disabled={r.targetClasses.length <= 1}
                  onClick={async () => {
                    if (!(await confirmDialog(`Удалить класс «${c.name}»?`, 'Огневая мощь по этому классу будет удалена из всех типов; типы этого класса перейдут в первый оставшийся класс.', 'Удалить', true))) return;
                    upd((d) => {
                      d.targetClasses = d.targetClasses.filter((x) => x.id !== c.id);
                      const fallback = d.targetClasses[0]?.id ?? '';
                      for (const t of d.componentTypes) {
                        delete t.firepower[c.id];
                        if (t.targetClass === c.id) t.targetClass = fallback;
                      }
                    });
                  }}
                >
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

function BandsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const move = (i: number, dir: -1 | 1) =>
    upd((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.rangeBands.length) return;
      [d.rangeBands[i], d.rangeBands[j]] = [d.rangeBands[j], d.rangeBands[i]];
    });
  return (
    <Card
      title="Дистанции (от дальней к ближней)"
      actions={
        <Btn sm onClick={() => upd((d) => void d.rangeBands.push({ id: newId('band'), name: 'Новая дистанция', detection: 0.8, turnsToClose: 2 }))}>
          + Дистанция
        </Btn>
      }
    >
      <p className="muted small">
        Бой начинается на дистанции, выбранной в сценарии. Пока атакующая сторона давит достаточно сильно, дистанция сокращается к следующей строке. Огневая
        мощь типов задаётся для каждой дистанции.
      </p>
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th />
            <th>Название</th>
            <th className="num">Обнаружение</th>
            <th className="num" title="Сколько ходов полноценного наступления нужно, чтобы перейти на следующую дистанцию">
              Ходов до сближения
            </th>
            <th>Описание</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.rangeBands.map((b, i) => (
            <tr key={b.id}>
              <td className="nowrap">
                <Btn sm kind="ghost" icon disabled={i === 0} onClick={() => move(i, -1)} title="Выше (дальше)">
                  ↑
                </Btn>
                <Btn sm kind="ghost" icon disabled={i === r.rangeBands.length - 1} onClick={() => move(i, 1)} title="Ниже (ближе)">
                  ↓
                </Btn>
              </td>
              <td>
                <Txt value={b.name} onChange={(v) => upd((d) => void (d.rangeBands[i].name = v))} />
              </td>
              <td className="num">
                <Num value={Math.round(b.detection * 100)} onChange={(v) => upd((d) => void (d.rangeBands[i].detection = v / 100))} min={0} max={100} suffix="%" width={80} />
              </td>
              <td className="num">
                <Num value={b.turnsToClose} onChange={(v) => upd((d) => void (d.rangeBands[i].turnsToClose = v))} min={0.25} step={0.5} width={80} disabled={i === r.rangeBands.length - 1} />
              </td>
              <td>
                <Txt value={b.description ?? ''} onChange={(v) => upd((d) => void (d.rangeBands[i].description = v))} width="100%" />
              </td>
              <td>
                <Btn
                  sm
                  kind="danger"
                  disabled={r.rangeBands.length <= 1}
                  onClick={async () => {
                    if (!(await confirmDialog(`Удалить дистанцию «${b.name}»?`, undefined, 'Удалить', true))) return;
                    upd((d) => {
                      d.rangeBands = d.rangeBands.filter((x) => x.id !== b.id);
                      for (const t of d.componentTypes) for (const c of Object.keys(t.firepower)) delete t.firepower[c][b.id];
                    });
                  }}
                >
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

// ------------------------------------------------------------------ приказы, уровни, опции

function OrdersSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const missing = (['retreat', 'rout'] as Behavior[]).filter((b) => !r.orders.some((o) => o.behavior === b));
  return (
    <>
      {missing.length > 0 && (
        <div className="note warn">
          Нет приказа с поведением: {missing.map((b) => BEHAVIOR_LABELS[b].split(' (')[0]).join(', ')}. Проверки отхода и паники не смогут сменить приказ.
        </div>
      )}
      <div className="row">
        <Btn
          kind="primary"
          onClick={() => upd((d) => void d.orders.push({ id: newId('order'), name: 'Новый приказ', behavior: 'defend', exposure: 1, effects: {} }))}
        >
          + Приказ
        </Btn>
        <span className="muted small">Поведение определяет логику движка; эффекты — численные множители. Например, «Штурм» = поведение «атака» с огнём ×1.3 и усталостью ×2.</span>
      </div>
      <div className="grid two">
        {r.orders.map((o, i) => (
          <Card
            key={o.id}
            title={o.name}
            actions={
              <Btn
                sm
                kind="danger"
                disabled={r.orders.length <= 1}
                onClick={async () => {
                  if (await confirmDialog(`Удалить приказ «${o.name}»?`, 'Элементы с этим приказом получат приказ своего формирования.', 'Удалить', true))
                    upd((d) => void (d.orders = d.orders.filter((x) => x.id !== o.id)));
                }}
              >
                Удалить
              </Btn>
            }
          >
            <div className="fields">
              <Field label="Название">
                <Txt value={o.name} onChange={(v) => upd((d) => void (d.orders[i].name = v))} />
              </Field>
              <Field label="Поведение">
                <Sel value={o.behavior} onChange={(v) => upd((d) => void (d.orders[i].behavior = v))} options={BEHAVIORS.map((b) => ({ value: b, label: BEHAVIOR_LABELS[b] }))} />
              </Field>
              <Field label="Подставленность" hint="0 — вне огня, 1 — полностью.">
                <Num value={o.exposure} onChange={(v) => upd((d) => void (d.orders[i].exposure = v))} min={0} max={3} step={0.05} />
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <EffectsEditor value={o.effects} onChange={(v) => upd((d) => void (d.orders[i].effects = v))} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Txt value={o.description ?? ''} onChange={(v) => upd((d) => void (d.orders[i].description = v))} placeholder="Описание" width="100%" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function LevelsSection({ title, hint, levels, set }: { title: string; hint: string; levels: LevelDef[]; set: (fn: (l: LevelDef[]) => void) => void }) {
  return (
    <>
      <div className="row">
        <h3>{title}</h3>
        <Btn kind="primary" onClick={() => set((l) => void l.push({ name: `Уровень ${l.length + 1}`, effects: {} }))}>
          + Уровень
        </Btn>
        <span className="muted small grow">{hint}</span>
      </div>
      <div className="grid two">
        {levels.map((lv, i) => (
          <Card
            key={i}
            title={`${i + 1}. ${lv.name}`}
            actions={
              <div className="row">
                <Btn sm kind="ghost" icon disabled={i === 0} onClick={() => set((l) => void ([l[i - 1], l[i]] = [l[i], l[i - 1]]))} title="Выше">
                  ↑
                </Btn>
                <Btn sm kind="ghost" icon disabled={i === levels.length - 1} onClick={() => set((l) => void ([l[i + 1], l[i]] = [l[i], l[i + 1]]))} title="Ниже">
                  ↓
                </Btn>
                <Btn sm kind="danger" disabled={levels.length <= 1} onClick={() => set((l) => void l.splice(i, 1))}>
                  ×
                </Btn>
              </div>
            }
          >
            <div className="stack" style={{ gap: 8 }}>
              <Txt value={lv.name} onChange={(v) => set((l) => void (l[i].name = v))} />
              <EffectsEditor value={lv.effects} onChange={(v) => set((l) => void (l[i].effects = v))} />
              <Txt value={lv.description ?? ''} onChange={(v) => set((l) => void (l[i].description = v))} placeholder="Описание" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function OptionsSection({ title, hint, options, set }: { title: string; hint: string; options: OptionDef[]; set: (fn: (o: OptionDef[]) => void) => void }) {
  return (
    <>
      <div className="row">
        <Btn kind="primary" onClick={() => set((o) => void o.push({ id: newId('opt'), name: 'Новый вариант', effects: {} }))}>
          + Вариант
        </Btn>
        <span className="muted small">{hint}</span>
      </div>
      <div className="grid two">
        {options.map((op, i) => (
          <Card
            key={op.id}
            title={op.name}
            actions={
              <Btn sm kind="danger" disabled={options.length <= 1} onClick={() => set((o) => void o.splice(i, 1))}>
                ×
              </Btn>
            }
          >
            <div className="stack" style={{ gap: 8 }}>
              <Txt value={op.name} onChange={(v) => set((o) => void (o[i].name = v))} />
              <EffectsEditor value={op.effects} onChange={(v) => set((o) => void (o[i].effects = v))} />
              <Txt value={op.description ?? ''} onChange={(v) => set((o) => void (o[i].description = v))} placeholder="Описание" />
            </div>
          </Card>
        ))}
      </div>
      <span className="faint small">{title}: эффекты действуют как множители характеристик.</span>
    </>
  );
}

function ConditionsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <>
      <div className="row">
        <Btn kind="primary" onClick={() => upd((d) => void d.conditions.push({ id: newId('cat'), name: 'Новая категория', options: [{ id: newId('opt'), name: 'Обычно', effects: {} }] }))}>
          + Категория условий
        </Btn>
        <span className="muted small">Местность, время суток, погода — или свои: сезон, высота, радиационная обстановка… Эффекты варианта действуют на все элементы обеих сторон.</span>
      </div>
      {r.conditions.map((cat, ci) => (
        <Card
          key={cat.id}
          title={
            <input className="title-input" style={{ fontSize: 14, minWidth: 200 }} value={cat.name} onChange={(e) => upd((d) => void (d.conditions[ci].name = e.target.value))} />
          }
          actions={
            <div className="row">
              <Btn sm onClick={() => upd((d) => void d.conditions[ci].options.push({ id: newId('opt'), name: 'Новый вариант', effects: {} }))}>
                + Вариант
              </Btn>
              <Btn
                sm
                kind="danger"
                onClick={async () => {
                  if (await confirmDialog(`Удалить категорию «${cat.name}»?`, undefined, 'Удалить', true)) upd((d) => void d.conditions.splice(ci, 1));
                }}
              >
                Удалить
              </Btn>
            </div>
          }
        >
          <div className="grid three">
            {cat.options.map((op, oi) => (
              <div key={op.id} className="kpi stack" style={{ gap: 6 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <Txt value={op.name} onChange={(v) => upd((d) => void (d.conditions[ci].options[oi].name = v))} />
                  <Btn sm kind="ghost" icon disabled={cat.options.length <= 1} onClick={() => upd((d) => void d.conditions[ci].options.splice(oi, 1))} title="Удалить вариант">
                    ×
                  </Btn>
                </div>
                <EffectsEditor value={op.effects} onChange={(v) => upd((d) => void (d.conditions[ci].options[oi].effects = v))} />
                <span className="faint small mono">id: {op.id}</span>
              </div>
            ))}
          </div>
          <span className="faint small mono">id категории: {cat.id} (для своих правил: поле «cond.{cat.id}»)</span>
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ свои правила

type FieldKind = (typeof MODIFIER_FIELDS)[number]['kind'] | 'cond';

function fieldInfo(r: Ruleset, field: string): { label: string; kind: FieldKind; options?: { value: string; label: string }[] } {
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

function opsFor(kind: FieldKind): ConditionOp[] {
  if (kind === 'number') return ['eq', 'neq', 'gte', 'lte'];
  if (kind === 'tag' || kind === 'kind') return ['has', 'not_has'];
  return ['eq', 'neq', 'in', 'nin'];
}

function ConditionRow({ r, c, onChange, onRemove }: { r: Ruleset; c: ModifierCondition; onChange: (c: ModifierCondition) => void; onRemove: () => void }) {
  const info = fieldInfo(r, c.field);
  const ops = opsFor(info.kind);
  const fields = [...r.conditions.map((cat) => ({ value: `cond.${cat.id}`, label: `Условие: ${cat.name}` })), ...MODIFIER_FIELDS.map((f) => ({ value: f.field, label: f.label }))];
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
          onChange({ ...c, op, value: m ? arr.filter(Boolean) : arr[0] ?? '' });
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
            <input list="mod-tags" value={arr[0] ?? ''} onChange={(e) => onChange({ ...c, value: e.target.value })} placeholder="тег" style={{ width: '100%' }} />
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

function ModifiersSection({ r, upd }: { r: Ruleset; upd: Upd }) {
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
        <span className="muted small">
          «Если все условия выполнены — характеристика ×N». Условия «противника» и «класса цели» проверяются для каждой пары стрелок — цель.
        </span>
      </div>
      {!r.modifiers.length && <div className="empty">Своих правил пока нет.</div>}
      {r.modifiers.map((m, i) => (
        <Card
          key={m.id}
          title={
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Check value={m.enabled} onChange={(v) => um(i, (x) => void (x.enabled = v))} title="Включено" />
              <input className="title-input" style={{ fontSize: 14, minWidth: 200, width: '100%' }} value={m.name} onChange={(e) => um(i, (x) => void (x.name = e.target.value))} />
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
                onClick={() => um(i, (x) => void x.when.push({ field: r.conditions[0] ? `cond.${r.conditions[0].id}` : 'tag', op: 'eq', value: r.conditions[0]?.options[0]?.id ?? '' }))}
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
            <Txt value={m.description ?? ''} onChange={(v) => um(i, (x) => void (x.description = v))} placeholder="Описание (для себя и игроков)" width="100%" />
          </div>
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ исходы, коэффициенты, JSON

function OutcomesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card
      title="Уровни исхода"
      actions={
        <Btn sm onClick={() => upd((d) => void d.outcomeLevels.push({ id: newId('out'), name: 'Новый уровень', minDiff: 0.3 }))}>
          + Уровень
        </Btn>
      }
    >
      <p className="muted small">
        Каждая сторона получает оценку выполнения своих задач от 0 до 100%. Исход определяется разницей оценок: выбирается первый уровень (по убыванию порога),
        порог которого не больше разницы. Уровень с порогом 0 — ничья.
      </p>
      <table className="tbl" style={{ marginTop: 8, width: 'auto' }}>
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
                  <Num value={Math.round(o.minDiff * 100)} onChange={(v) => upd((d) => void (d.outcomeLevels[i].minDiff = v / 100))} min={0} max={100} suffix="%" />
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

function CoefficientsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const [q, setQ] = useState('');
  const changed = COEFFICIENTS.filter((m) => r.coefficients[m.key] !== m.default).length;
  return (
    <>
      <div className="row">
        <input type="search" placeholder="Найти коэффициент…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        <span className="muted small">Изменено относительно стандартных значений: {changed}</span>
        <div className="grow" />
        <Btn
          sm
          disabled={!changed}
          onClick={async () => {
            if (await confirmDialog('Сбросить все коэффициенты к стандартным значениям?', undefined, 'Сбросить', true))
              upd((d) => void (d.coefficients = Object.fromEntries(COEFFICIENTS.map((m) => [m.key, m.default]))));
          }}
        >
          Сбросить все
        </Btn>
      </div>
      {COEFFICIENT_GROUPS.map((g) => {
        const items = COEFFICIENTS.filter((m) => m.group === g && (!q || `${m.label} ${m.description} ${m.key}`.toLowerCase().includes(q.toLowerCase())));
        if (!items.length) return null;
        return (
          <Card key={g} title={g} tight>
            <table className="tbl">
              <tbody>
                {items.map((m) => {
                  const off = m.feature && !r.features[m.feature];
                  const v = r.coefficients[m.key] ?? m.default;
                  return (
                    <tr key={m.key} className={off ? 'dim' : ''} title={off ? `Механика «${FEATURE_LABELS[m.feature!]}» выключена` : undefined}>
                      <td style={{ width: '34%' }}>
                        <div>{m.label}</div>
                        <div className="faint small mono">{m.key}</div>
                      </td>
                      <td style={{ width: 120 }}>
                        <Num value={v} onChange={(x) => upd((d) => void (d.coefficients[m.key] = x))} min={m.min} max={m.max} step={m.step ?? 0.05} width={110} />
                      </td>
                      <td className="small muted">
                        {m.description}
                        {v !== m.default && (
                          <>
                            {' '}
                            <a href="#" onClick={(e) => (e.preventDefault(), upd((d) => void (d.coefficients[m.key] = m.default)))}>
                              сбросить ({m.default})
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })}
    </>
  );
}

function JsonSection({ r }: { r: Ruleset }) {
  const initial = useMemo(() => JSON.stringify(r, null, 2), [r.id]);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  return (
    <Card
      title="Набор правил в формате JSON"
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
      <p className="muted small">Для опытных пользователей: правьте напрямую, затем «Применить». Недостающие поля будут заполнены значениями по умолчанию.</p>
      {err && <div className="note bad">Ошибка: {err}</div>}
      <textarea className="mono" style={{ width: '100%', minHeight: 520, fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <p className="faint small">Эффекты условий: {r.conditions.map((c) => `${c.name}: ${c.options.map((o) => `${o.name} (${effectsText(o.effects as Effects)})`).join('; ')}`).join(' | ')}</p>
    </Card>
  );
}
