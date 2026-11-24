// Набор правил: каталог типов (карточки и таблица), классы целей и дистанции.

import {
  KIND_LABELS,
  clone,
  convertToWeapons,
  newId,
  rulesetTags,
  typeFire,
  usesWeapons,
  walkUnits,
  weaponTypeMap,
  type ComponentKind,
  type ComponentType,
  type Ruleset,
  type UnitNode,
  type WeaponType,
} from '../../../engine';
import { Btn, Card, Check, Field, Info, Menu, Num, ScrollX, Sel, Seg, Tags, Txt, pressable } from '../../components/ui';
import { useTabState } from '../../hooks';
import { openTab, toastUndoable, useApp } from '../../store';
import { moveIn, moveItems, type Upd } from './common';
import { EffectsEditor } from '../../components/EffectsEditor';
import { FireTable } from '../unit/Summary';

export function typeUsage(typeId: string): number {
  const s = useApp.getState();
  let n = 0;
  const walk = (root: UnitNode) =>
    walkUnits(root, (u) => {
      if (u.composition.some((c) => c.typeId === typeId)) n++;
    });
  Object.values(s.formations).forEach(walk);
  Object.values(s.forces).forEach(walk);
  return n;
}

const KIND_OWN: Record<ComponentKind, string> = { personnel: 'у людей', weapon: 'у оружия', vehicle: 'у техники' };

export function TypesSection({ r, upd, tabKey }: { r: Ruleset; upd: Upd; tabKey: string }) {
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
        weapons: [],
        indirect: false,
        suppressive: 1,
        ammoUse: 5,
        fuelUse: 0,
        tags: [],
      }),
    );
    setSel(id);
  };
  const allTags = rulesetTags(r);
  // Поиск по названию и по тегу: «танк», «#кавалерия» (решётка — только теги).
  const [q, setQ] = useTabState<string>(`${tabKey}:typeQ`, '');
  const query = q.trim().toLowerCase().replace(/ё/g, 'е');
  const fits = (x: ComponentType) => {
    if (!query) return true;
    const norm = (v: string) => v.toLowerCase().replace(/ё/g, 'е');
    if (query.startsWith('#')) return x.tags.some((tg) => norm(tg).includes(query.slice(1)));
    return norm(x.name).includes(query) || x.tags.some((tg) => norm(tg).includes(query));
  };
  return (
    <>
      <div className="row">
        <Btn kind="primary" onClick={add}>
          + Тип
        </Btn>
        <input type="search" placeholder="Найти тип или #тег…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <Btn
          kind="ghost"
          onClick={() => openTab('help', undefined, { sub: 'gm-type-fields' })}
          title="Руководство ГМ: что делает каждое число типа и как его подобрать"
        >
          Как подобрать числа
        </Btn>
        <div className="grow" />
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'edit', label: 'Карточки' },
            { value: 'table', label: 'Таблица', title: 'Все типы и их средний огонь за ход в одной таблице' },
          ]}
        />
      </div>
      {view === 'table' ? (
        <TypesTable r={r} onPick={(id) => (setSel(id), setView('edit'))} />
      ) : (
        <div className="split types-split">
          <Card tight>
            <div className="tree" style={{ padding: 6 }}>
              {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => (
                <div key={k}>
                  <div className="faint small" style={{ padding: '6px 6px 2px' }}>
                    {KIND_LABELS[k]}
                  </div>
                  {r.componentTypes
                    .filter((x) => x.kind === k && fits(x))
                    .map((x) => (
                      <div key={x.id} className={`tree-node${x.id === t?.id ? ' sel' : ''}`} onClick={() => setSel(x.id)} {...pressable(() => setSel(x.id))}>
                        <span className="tn-name" title={x.name}>
                          {x.name}
                        </span>
                        <span className="tn-meta" title={r.targetClasses.find((c) => c.id === x.targetClass)?.name}>
                          {r.targetClasses.find((c) => c.id === x.targetClass)?.name ?? '?'}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
              {!r.componentTypes.length && <div className="empty">Каталог пуст. Добавьте первый тип: например, «Стрелок» или «Танк».</div>}
              {r.componentTypes.length > 0 && !r.componentTypes.some(fits) && <div className="empty">Ничего не найдено.</div>}
            </div>
          </Card>
          {t && <TypeEditor r={r} t={t} upd={upd} allTags={allTags} onSelect={setSel} />}
        </div>
      )}
    </>
  );
}

export function TypeEditor({ r, t, upd, allTags, onSelect }: { r: Ruleset; t: ComponentType; upd: Upd; allTags: string[]; onSelect: (id: string) => void }) {
  const ut = (fn: (x: ComponentType) => void) =>
    upd((d) => {
      const x = d.componentTypes.find((y) => y.id === t.id);
      if (x) fn(x);
    });
  const used = typeUsage(t.id);
  // Подпись под полем: разброс значения у типов того же вида в этом наборе.
  const same = r.componentTypes.filter((x) => x.kind === t.kind && x.id !== t.id);
  const refLine = (get: (x: ComponentType) => number) => {
    const vs = same.map(get);
    if (vs.length < 2) return null;
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return <div className="ref-line">{`${KIND_OWN[t.kind]} в наборе ${lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`}`}</div>;
  };
  // Соседи по списку — типы того же вида (в каталоге они сгруппированы по виду).
  const sameKind = r.componentTypes.filter((x) => x.kind === t.kind).map((x) => x.id);
  return (
    <Card
      title={t.name}
      actions={
        <Menu
          sm
          items={[
            ...moveItems(sameKind.indexOf(t.id), sameKind.length, (dir) =>
              upd((d) => {
                const i = d.componentTypes.findIndex((y) => y.id === t.id);
                const j = d.componentTypes.findIndex((y) => y.id === sameKind[sameKind.indexOf(t.id) + dir]);
                if (i < 0 || j < 0) return;
                [d.componentTypes[i], d.componentTypes[j]] = [d.componentTypes[j], d.componentTypes[i]];
              }),
            ),
            {
              label: 'Дублировать',
              onClick: () => {
                const id = newId('type');
                upd((d) => {
                  const i = d.componentTypes.findIndex((y) => y.id === t.id);
                  d.componentTypes.splice(i + 1, 0, { ...clone(t), id, name: `${t.name} (копия)` });
                });
                onSelect(id);
              },
            },
            'sep',
            {
              label: 'Удалить тип',
              danger: true,
              onClick: () => {
                upd((d) => void (d.componentTypes = d.componentTypes.filter((y) => y.id !== t.id)));
                toastUndoable(`Тип «${t.name}» удалён${used ? ` — в элементах (${used}) он больше не учитывается` : ''}.`);
              },
            },
          ]}
        />
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
          <Sel
            value={t.targetClass}
            onChange={(v) => ut((x) => void (x.targetClass = v))}
            options={r.targetClasses.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        {t.kind !== 'personnel' && (
          <Field label="Экипаж / расчёт, чел.">
            <Num value={t.crew} onChange={(v) => ut((x) => void (x.crew = v))} min={0} integer />
            {refLine((x) => x.crew)}
          </Field>
        )}
        <Field label="Боевая ценность" hint="Очки: вес в боеспособности и потерях.">
          <Num value={t.value} onChange={(v) => ut((x) => void (x.value = v))} min={0} step={0.5} />
          {refLine((x) => x.value)}
          {t.value <= 0 && (
            <div className="ref-line" style={{ color: 'var(--warn)' }}>
              ⚠ Ценность 0: подразделение только из таких типов в бой не попадает, даже если у типа есть огонь.
            </div>
          )}
        </Field>
        <Field label="Защищённость" hint="1 — как у типичной цели класса.">
          <Num value={t.protection} onChange={(v) => ut((x) => void (x.protection = v))} min={0.05} step={0.1} />
          {refLine((x) => x.protection)}
        </Field>
        <Field label="Подавляющее действие">
          <Num value={t.suppressive} onChange={(v) => ut((x) => void (x.suppressive = v))} min={0} step={0.1} />
          {refLine((x) => x.suppressive)}
        </Field>
        {r.features.ammo && !usesWeapons(t) && (
          <Field label="Расход БК, %/ход">
            <Num value={t.ammoUse} onChange={(v) => ut((x) => void (x.ammoUse = v))} min={0} step={0.5} />
            {refLine((x) => x.ammoUse)}
          </Field>
        )}
        {r.features.fuel && t.kind === 'vehicle' && (
          <Field label="Расход топлива, %/ход">
            <Num value={t.fuelUse} onChange={(v) => ut((x) => void (x.fuelUse = v))} min={0} step={0.5} />
            {refLine((x) => x.fuelUse)}
          </Field>
        )}
        <Field label="Огонь">
          <Check
            value={t.indirect}
            onChange={(v) => ut((x) => void (x.indirect = v))}
            title="Навесной/непрямой огонь: не требует прямой видимости, достаёт второй эшелон и тыл."
          >
            с закрытых позиций
          </Check>
        </Field>
      </div>
      <div style={{ marginTop: 12 }}></div>
      <div style={{ marginTop: 12 }}>
        <Field
          label="Теги"
          hint={`Особенности типа: «кавалерия», «ночное видение», «сапёр». Подразделение получает теги всех типов своего состава, по ним работают свои правила.${r.reconTag ? ` Тег «${r.reconTag}» делает тип разведчиком.` : ''}`}
        >
          <Tags value={t.tags} onChange={(v) => ut((x) => void (x.tags = v))} suggestions={allTags} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <h4>Множители типа</h4>
          <Info text="Свои особенности типа без отдельного правила: скрытность снайпера, наблюдение разведчика, подвижность танка. В элементе действуют по доле боевой ценности типа в его составе: 1 + (N − 1) × доля — один снайпер во взводе почти ничего не меняет, взвод снайперов — полностью." />
        </div>
        <EffectsEditor value={t.effects ?? {}} onChange={(v) => ut((x) => void (Object.keys(v).length ? (x.effects = v) : delete x.effects))} />
      </div>
      <WeaponsEditor r={r} t={t} upd={upd} />
      {used > 0 && (
        <p className="faint small" style={{ margin: '8px 0 0' }}>
          Используется в элементах: {used}
        </p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ вооружение типа

/** Новый тип вооружения: точность 100% на всех дистанциях, нужен боезапас. */
export const newWeaponType = (r: Ruleset, name = 'Новое вооружение'): WeaponType => ({
  id: newId('wpn'),
  name,
  accuracy: Object.fromEntries(r.rangeBands.map((b) => [b.id, 1])),
  ammo: true,
});

function WeaponsEditor({ r, t, upd }: { r: Ruleset; t: ComponentType; upd: Upd }) {
  const ut = (fn: (x: ComponentType) => void) =>
    upd((d) => {
      const x = d.componentTypes.find((y) => y.id === t.id);
      if (x) fn(x);
    });
  const wts = weaponTypeMap(r);
  const head = (
    <div className="row" style={{ margin: '16px 0 6px', gap: 6 }}>
      <h4>Вооружение</h4>
      <Info text="Урон одной единицы за ход по классу цели: каждый ход выпадает случайное число от мин. до макс. (0,04 — сто таких единиц выводят из строя около 4 целей). Дистанция влияет на точность — она задаётся у типа вооружения (раздел «Вооружение»). Боезапас у каждого типа вооружения в элементе свой: кончились выстрелы гранатомёта — автоматы стреляют дальше." />
    </div>
  );
  if (!usesWeapons(t))
    return (
      <>
        {head}
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Огонь этого типа задан таблицей по дистанциям (прежняя версия программы).
        </p>
        <Btn
          onClick={() => {
            upd((d) => void convertToWeapons(d));
            toastUndoable('Огонь типов набора переведён на вооружение.');
          }}
        >
          Перевести на вооружение
        </Btn>
      </>
    );
  const addItems = [
    ...(r.weaponTypes ?? []).map((w) => ({
      label: w.name,
      onClick: () => ut((x) => void x.weapons!.push({ weaponType: w.id, damage: {}, ammoUse: w.ammo ? 5 : 0 })),
    })),
    ...((r.weaponTypes ?? []).length ? (['sep'] as const) : []),
    {
      label: 'Новый тип вооружения…',
      onClick: () =>
        upd((d) => {
          const w = newWeaponType(d);
          (d.weaponTypes ??= []).push(w);
          d.componentTypes.find((y) => y.id === t.id)?.weapons?.push({ weaponType: w.id, damage: {}, ammoUse: 5 });
        }),
      tip: 'Добавить тип вооружения в набор и дать его этому типу; точность по дистанциям — в разделе «Вооружение»',
    },
  ];
  return (
    <>
      {head}
      {!t.weapons.length && <p className="faint small">Нет вооружения — тип не стреляет (грузовик, тягач, штаб).</p>}
      <div className="stack" style={{ gap: 10 }}>
        {t.weapons.map((w, wi) => {
          const wt = wts.get(w.weaponType);
          return (
            <div key={`${w.weaponType}-${wi}`} className="weapon-box">
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Sel
                  value={w.weaponType}
                  onChange={(v) => ut((x) => void (x.weapons![wi].weaponType = v))}
                  options={[
                    ...(wt ? [] : [{ value: w.weaponType, label: '— не найдено —' }]),
                    ...(r.weaponTypes ?? []).map((x) => ({ value: x.id, label: x.name })),
                  ]}
                />
                {r.features.ammo && wt?.ammo !== false && (
                  <span className="row" style={{ gap: 4 }}>
                    <span className="muted small">Расход БК, %/ход</span>
                    <Num value={w.ammoUse} onChange={(v) => ut((x) => void (x.weapons![wi].ammoUse = v))} min={0} step={0.5} width={72} />
                  </span>
                )}
                {wt?.ammo === false && <span className="faint small">без боезапаса</span>}
                <div className="grow" />
                <Menu
                  sm
                  items={[
                    ...moveItems(wi, t.weapons.length, (dir) => ut((x) => moveIn(x.weapons!, wi, dir))),
                    'sep',
                    { label: 'Убрать вооружение', danger: true, onClick: () => ut((x) => void x.weapons!.splice(wi, 1)) },
                  ]}
                />
              </div>
              <table className="tbl compact" style={{ width: 'auto' }}>
                <thead>
                  <tr>
                    <th>По классу цели</th>
                    <th className="num">Урон мин.</th>
                    <th className="num">Урон макс.</th>
                  </tr>
                </thead>
                <tbody>
                  {r.targetClasses.map((c) => {
                    const d = w.damage[c.id] ?? [0, 0];
                    const set = (i: 0 | 1, v: number) =>
                      ut((x) => {
                        const dm = x.weapons![wi].damage;
                        const next: [number, number] = [...(dm[c.id] ?? [0, 0])] as [number, number];
                        next[i] = v;
                        // Мин. не больше макс.: ввели мин. больше — макс. подтягивается, и наоборот.
                        if (i === 0 && next[1] < v) next[1] = v;
                        if (i === 1 && next[0] > v) next[0] = v;
                        if (next[0] <= 0 && next[1] <= 0) delete dm[c.id];
                        else dm[c.id] = next;
                      });
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="num">
                          <Num value={d[0]} onChange={(v) => set(0, v)} min={0} step={0.005} width={80} />
                        </td>
                        <td className="num">
                          <Num value={d[1]} onChange={(v) => set(1, v)} min={0} step={0.005} width={80} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Menu sm alignLeft label="+ Вооружение" items={addItems} />
      </div>
      {t.weapons.length > 0 && (
        <>
          <div className="row" style={{ margin: '14px 0 6px', gap: 6 }}>
            <h4>В среднем за ход</h4>
            <Info text="Средний урон (между мин. и макс.) × точность на дистанции — сумма по всему вооружению одной единицы. Без состояния, условий и приказов." />
          </div>
          <FireTable fire={typeFireTable(r, t)} rs={r} fmt={(v) => (v ? num(Math.round(v * 1000) / 1000) : '0')} />
        </>
      )}
    </>
  );
}

/** Средний огонь одной единицы типа: [класс цели][дистанция]. */
export function typeFireTable(r: Ruleset, t: ComponentType): Record<string, Record<string, number>> {
  const wts = weaponTypeMap(r);
  return Object.fromEntries(r.targetClasses.map((c) => [c.id, Object.fromEntries(r.rangeBands.map((b) => [b.id, typeFire(r, t, c.id, b.id, wts)]))]));
}

// ------------------------------------------------------------------ типы вооружения

export function WeaponTypesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const list = r.weaponTypes ?? [];
  const usedBy = (id: string) => r.componentTypes.filter((t) => t.weapons?.some((w) => w.weaponType === id));
  return (
    <Card
      title={
        <>
          Вооружение{' '}
          <Info text="Типы вооружения: автомат, пулемёт, гранатомёт, танковая пушка. Точность — доля попаданий на дистанции: урон оружия умножается на неё. У каждого типа вооружения в элементе свой боезапас; без боезапаса — холодное оружие, оно не кончается. Урон задаётся у типа единиц (каталог типов)." />
        </>
      }
      actions={
        <Btn sm kind="ghost" onClick={() => upd((d) => void (d.weaponTypes ??= []).push(newWeaponType(d)))}>
          + Вооружение
        </Btn>
      }
      tight
    >
      {!list.length ? (
        <div className="empty">Типов вооружения нет. Добавьте первый: например, «Автомат» или «Гранатомёт».</div>
      ) : (
        <ScrollX>
          <table className="tbl">
            <thead>
              <tr>
                <th>Название</th>
                {r.rangeBands.map((b) => (
                  <th key={b.id} className="num" data-tip={`Точность на дистанции «${b.name}»`}>
                    {b.name}
                  </th>
                ))}
                {r.features.ammo && <th data-tip="Нужен боезапас: кончился — оружие молчит. Нет — холодное оружие">Боезапас</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((w, i) => {
                const users = usedBy(w.id);
                return (
                  <tr key={w.id}>
                    <td>
                      <Txt value={w.name} onChange={(v) => upd((d) => void (d.weaponTypes![i].name = v))} width="100%" />
                      {users.length > 0 && <div className="faint small">{users.map((t) => t.name).join(', ')}</div>}
                    </td>
                    {r.rangeBands.map((b) => (
                      <td key={b.id} className="num" style={{ width: 100 }}>
                        <Num
                          value={Math.round((w.accuracy?.[b.id] ?? 1) * 100)}
                          onChange={(v) => upd((d) => void ((d.weaponTypes![i].accuracy ??= {})[b.id] = v / 100))}
                          min={0}
                          max={1000}
                          suffix="%"
                          width={80}
                        />
                      </td>
                    ))}
                    {r.features.ammo && (
                      <td>
                        <Check value={w.ammo} onChange={(v) => upd((d) => void (d.weaponTypes![i].ammo = v))}>
                          нужен
                        </Check>
                      </td>
                    )}
                    <td style={{ width: 36 }}>
                      <Menu
                        sm
                        items={[
                          ...moveItems(i, list.length, (dir) => upd((d) => moveIn(d.weaponTypes!, i, dir))),
                          'sep',
                          {
                            label: 'Удалить',
                            danger: true,
                            onClick: () => {
                              toastUndoable(`Вооружение «${w.name}» удалено${users.length ? ` — и у типов: ${users.map((t) => t.name).join(', ')}` : ''}.`);
                              upd((d) => {
                                d.weaponTypes = d.weaponTypes!.filter((x) => x.id !== w.id);
                                for (const t of d.componentTypes) if (t.weapons) t.weapons = t.weapons.filter((x) => x.weaponType !== w.id);
                              });
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      )}
    </Card>
  );
}

/** Число из набора правил как есть, но с запятой: 0,035. */
const num = (v: number | undefined) => String(v ?? 0).replace('.', ',');

export function TypesTable({ r, onPick }: { r: Ruleset; onPick: (id: string) => void }) {
  const wts = weaponTypeMap(r);
  const fire = (t: ComponentType, cls: string, band: string) => typeFire(r, t, cls, band, wts);
  return (
    <Card tight>
      <ScrollX>
        <table className="tbl compact types-tbl">
          <thead>
            {/* Огневая мощь — по классу цели, под ним дистанции: подписи целиком, а не «Живая·Дал». */}
            <tr>
              <th rowSpan={2}>Тип</th>
              <th rowSpan={2}>Вид</th>
              <th rowSpan={2}>Класс</th>
              <th rowSpan={2} className="num">
                Ценн.
              </th>
              <th rowSpan={2} className="num">
                Защ.
              </th>
              {r.targetClasses.map((c) => (
                <th key={c.id} colSpan={r.rangeBands.length} className="center fp-class">
                  {c.name}
                </th>
              ))}
            </tr>
            <tr>
              {r.targetClasses.flatMap((c) =>
                r.rangeBands.map((b, bi) => (
                  <th key={`${c.id}-${b.id}`} className={`num fp-band${bi === 0 ? ' first' : ''}`}>
                    {b.name}
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
                  {t.indirect && (
                    <span className="badge info" style={{ marginLeft: 6 }}>
                      навесной
                    </span>
                  )}
                  {t.tags.length > 0 && <div className="faint small">{t.tags.join(', ')}</div>}
                  {!!t.weapons?.length && <div className="faint small">{t.weapons.map((w) => wts.get(w.weaponType)?.name ?? '?').join(' + ')}</div>}
                </td>
                <td className="small">{KIND_LABELS[t.kind]}</td>
                <td className="small">{r.targetClasses.find((c) => c.id === t.targetClass)?.name}</td>
                <td className="num">{num(t.value)}</td>
                <td className="num">{num(t.protection)}</td>
                {r.targetClasses.flatMap((c) =>
                  r.rangeBands.map((b, bi) => (
                    <td key={`${c.id}-${b.id}`} className={`num small${bi === 0 ? ' fp-first' : ''}`}>
                      {fire(t, c.id, b.id) ? num(Math.round(fire(t, c.id, b.id) * 10000) / 10000) : <span className="faint">0</span>}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

// ------------------------------------------------------------------ классы и дистанции

export function ClassesSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  return (
    <Card
      title={
        <>
          Классы целей{' '}
          <Info text="Класс определяет, каким оружием цель эффективно поражать: огневая мощь типов задаётся отдельно по каждому классу. Для другой эпохи это может быть «пехота / кавалерия / артиллерия» или «пехота / корабли»." />
        </>
      }
      actions={
        <Btn sm kind="ghost" onClick={() => upd((d) => void d.targetClasses.push({ id: newId('cls'), name: 'Новый класс', lethality: 1 }))}>
          + Класс
        </Btn>
      }
      tight
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>Название</th>
            <th className="num" data-tip="Доля воздействия, превращающаяся в потери">
              Летальность
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.targetClasses.map((c, i) => (
            <tr key={c.id}>
              <td>
                <div className="stack" style={{ gap: 4 }}>
                  <Txt value={c.name} onChange={(v) => upd((d) => void (d.targetClasses[i].name = v))} width="100%" />
                </div>
              </td>
              <td className="num" style={{ width: 110 }}>
                <Num value={c.lethality} onChange={(v) => upd((d) => void (d.targetClasses[i].lethality = v))} min={0} step={0.05} width={80} />
              </td>
              <td style={{ width: 36 }}>
                <Menu
                  sm
                  items={[
                    ...moveItems(i, r.targetClasses.length, (dir) => upd((d) => moveIn(d.targetClasses, i, dir))),
                    'sep',
                    {
                      label: 'Удалить класс',
                      danger: true,
                      disabled: r.targetClasses.length <= 1,
                      onClick: () => {
                        toastUndoable(`Класс «${c.name}» удалён: его огневая мощь убрана из типов, типы этого класса перешли в первый оставшийся.`);
                        upd((d) => {
                          d.targetClasses = d.targetClasses.filter((x) => x.id !== c.id);
                          const fallback = d.targetClasses[0]?.id ?? '';
                          for (const t of d.componentTypes) {
                            delete t.firepower?.[c.id];
                            for (const w of t.weapons ?? []) delete w.damage[c.id];
                            if (t.targetClass === c.id) t.targetClass = fallback;
                          }
                        });
                      },
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function BandsSection({ r, upd }: { r: Ruleset; upd: Upd }) {
  const move = (i: number, dir: -1 | 1) =>
    upd((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.rangeBands.length) return;
      [d.rangeBands[i], d.rangeBands[j]] = [d.rangeBands[j], d.rangeBands[i]];
    });
  return (
    <Card
      title={
        <>
          Дистанции{' '}
          <Info text="Список — от дальней к ближней. Бой начинается с дистанции из сценария; пока атакующие давят достаточно сильно, дистанция сокращается к следующей строке." />
        </>
      }
      actions={
        <Btn
          sm
          kind="ghost"
          onClick={() => upd((d) => void d.rangeBands.push({ id: newId('band'), name: 'Новая дистанция', detection: 0.8, turnsToClose: 2 }))}
        >
          + Дистанция
        </Btn>
      }
      tight
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>Название</th>
            <th className="num" data-tip="Базовый шанс обнаружить противника на этой дистанции">
              Обнаружение
            </th>
            <th className="num" data-tip="Сколько ходов полноценного наступления нужно, чтобы перейти на следующую дистанцию">
              Ходов до сближения
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.rangeBands.map((b, i) => (
            <tr key={b.id}>
              <td>
                <div className="stack" style={{ gap: 4 }}>
                  <Txt value={b.name} onChange={(v) => upd((d) => void (d.rangeBands[i].name = v))} width="100%" />
                </div>
              </td>
              <td className="num" style={{ width: 120 }}>
                <Num
                  value={Math.round(b.detection * 100)}
                  onChange={(v) => upd((d) => void (d.rangeBands[i].detection = v / 100))}
                  min={0}
                  max={100}
                  suffix="%"
                  width={80}
                />
              </td>
              <td className="num" style={{ width: 140 }}>
                {i < r.rangeBands.length - 1 ? (
                  <Num value={b.turnsToClose} onChange={(v) => upd((d) => void (d.rangeBands[i].turnsToClose = v))} min={0.25} step={0.5} width={80} />
                ) : (
                  <span className="faint">—</span>
                )}
              </td>
              <td style={{ width: 36 }}>
                <Menu
                  sm
                  items={[
                    { label: 'Выше (дальше)', disabled: i === 0, onClick: () => move(i, -1) },
                    { label: 'Ниже (ближе)', disabled: i === r.rangeBands.length - 1, onClick: () => move(i, 1) },
                    'sep',
                    {
                      label: 'Удалить',
                      danger: true,
                      disabled: r.rangeBands.length <= 1,
                      onClick: () => {
                        toastUndoable(`Дистанция «${b.name}» удалена.`);
                        upd((d) => {
                          d.rangeBands = d.rangeBands.filter((x) => x.id !== b.id);
                          for (const t of d.componentTypes) for (const c of Object.keys(t.firepower ?? {})) delete t.firepower[c][b.id];
                          for (const w of d.weaponTypes ?? []) delete w.accuracy?.[b.id];
                        });
                      },
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ------------------------------------------------------------------ приказы, уровни, опции
