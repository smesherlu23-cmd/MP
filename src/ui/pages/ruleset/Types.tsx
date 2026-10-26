// Набор правил: каталог типов (карточки и таблица), классы целей и дистанции.

import { KIND_LABELS, clone, newId, walkUnits, type ComponentKind, type ComponentType, type UnitNode, type Ruleset } from '../../../engine';
import { Btn, Card, Check, Field, Info, Menu, Num, Sel, Seg, Tags, Txt, pressable } from '../../components/ui';
import { useTabState } from '../../hooks';
import { openTab, toastUndoable, useApp } from '../../store';
import type { Upd } from './common';

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
          + Тип
        </Btn>
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
            { value: 'table', label: 'Таблица', title: 'Все типы и их огневая мощь в одной таблице' },
          ]}
        />
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
                      <div key={x.id} className={`tree-node${x.id === t?.id ? ' sel' : ''}`} onClick={() => setSel(x.id)} {...pressable(() => setSel(x.id))}>
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

export function TypeEditor({ r, t, upd, allTags, onSelect }: { r: Ruleset; t: ComponentType; upd: Upd; allTags: string[]; onSelect: (id: string) => void }) {
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
        <Menu
          sm
          items={[
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
          <Check
            value={t.indirect}
            onChange={(v) => ut((x) => void (x.indirect = v))}
            title="Навесной/непрямой огонь: не требует прямой видимости, достаёт второй эшелон и тыл."
          >
            с закрытых позиций
          </Check>
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Теги" hint={`Используются в своих правилах. Тег «${r.reconTag}» делает тип разведчиком.`}>
          <Tags value={t.tags} onChange={(v) => ut((x) => void (x.tags = v))} suggestions={allTags} />
        </Field>
      </div>
      <div className="row" style={{ margin: '16px 0 6px', gap: 6 }}>
        <h4>Огневая мощь одной единицы за ход</h4>
        <Info text="Пример: 0,04 — сто таких единиц за ход в идеальных условиях выводят из строя около 4 целей этого класса. Реальный результат умножается на состояние, условия, приказы и защищённость цели." />
      </div>
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
      {used > 0 && (
        <p className="faint small" style={{ margin: '8px 0 0' }}>
          Используется в элементах: {used}
        </p>
      )}
    </Card>
  );
}

export function TypesTable({ r, onPick }: { r: Ruleset; onPick: (id: string) => void }) {
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
                  {t.indirect && (
                    <span className="badge info" style={{ marginLeft: 6 }}>
                      навесной
                    </span>
                  )}
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
                <Txt value={c.name} onChange={(v) => upd((d) => void (d.targetClasses[i].name = v))} width="100%" />
              </td>
              <td className="num" style={{ width: 110 }}>
                <Num value={c.lethality} onChange={(v) => upd((d) => void (d.targetClasses[i].lethality = v))} min={0} step={0.05} width={80} />
              </td>
              <td style={{ width: 36 }}>
                <Btn
                  sm
                  kind="ghost"
                  icon
                  title="Удалить класс"
                  disabled={r.targetClasses.length <= 1}
                  onClick={() => {
                    toastUndoable(`Класс «${c.name}» удалён: его огневая мощь убрана из типов, типы этого класса перешли в первый оставшийся.`);
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
                <Txt value={b.name} onChange={(v) => upd((d) => void (d.rangeBands[i].name = v))} width="100%" />
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
                          for (const t of d.componentTypes) for (const c of Object.keys(t.firepower)) delete t.firepower[c][b.id];
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
