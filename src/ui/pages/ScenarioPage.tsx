// Сценарий: условия боя, стороны, их подразделения, укрепления, разведданные и задачи.

import {
  OBJECTIVE_HAS_VALUE,
  OBJECTIVE_LABELS,
  OBJECTIVE_TYPES,
  copyFormation,
  createBattle,
  newFormation,
  newId,
  newObjective,
  randomSeed,
  validateScenario,
  type FormationDef,
  type ObjectiveType,
  type Ruleset,
  type Scenario,
} from '../../engine';
import { effectsText } from '../components/EffectsEditor';
import { Link } from '../components/Link';
import { Area, Btn, Card, Field, Info, Menu, Num, Section, Sel, Txt, fmt0, fmt1 } from '../components/ui';
import { useTabState } from '../hooks';
import { confirmDialog, deleteScenario, duplicateScenario, exportJson, openTab, putBattle, updateScenario, useApp, type Tab } from '../store';
import { summarizeDef } from './FormationPage';

function allEls(f: FormationDef): FormationDef['elements'] {
  return [...f.elements, ...f.subunits.flatMap(allEls)];
}

export async function startBattle(sc: Scenario, rs: Ruleset, seed: string) {
  const issues = validateScenario(sc, rs);
  const errors = issues.filter((x) => x.level === 'error');
  if (errors.length && !(await confirmDialog('В сценарии есть ошибки', `${errors.map((x) => `• ${x.text}`).join('\n')}\n\nВсё равно начать бой?`, 'Начать'))) return;
  const b = createBattle(sc, rs, { seed, id: newId('bt'), name: `${sc.name} · ${seed}` });
  putBattle(b);
  openTab('battle', b.id);
}

const DEFAULT_OBJECTIVE_VALUE: Record<ObjectiveType, (maxTurns: number) => number> = {
  hold: (t) => t,
  take: () => 0,
  inflict: () => 20,
  preserve: () => 30,
  recon: () => 50,
  noRout: () => 0,
};

export function ScenarioPage({ tab }: { tab: Tab }) {
  const st = useApp();
  const sc = st.scenarios[tab.ref!];
  const [randomSeedMode, setRandomSeedMode] = useTabState(`${tab.key}:randomSeed`, false);
  if (!sc) return <div className="empty">Сценарий не найден.</div>;
  const rs = st.rulesets[sc.rulesetId];
  const upd = (fn: (s: Scenario) => void) => updateScenario(sc.id, fn);
  const issues = validateScenario(sc, rs);
  const errors = issues.filter((x) => x.level === 'error');
  const warnings = issues.filter((x) => x.level === 'warning');

  const start = () => {
    if (!rs) return;
    let seed = sc.seed;
    if (randomSeedMode) {
      seed = randomSeed();
      upd((d) => void (d.seed = seed));
    }
    startBattle(sc, rs, seed);
  };

  const changeRuleset = async (v: string) => {
    if (!(await confirmDialog('Сменить набор правил?', 'Типы, приказы и условия должны существовать в новом наборе — проверьте замечания после смены.'))) return;
    const nr = st.rulesets[v];
    upd((d) => {
      d.rulesetId = v;
      d.conditions = {};
      for (const cat of nr.conditions) d.conditions[cat.id] = cat.options[0]?.id ?? '';
      d.startBand = nr.rangeBands[0]?.id ?? '';
      for (const side of d.sides) {
        side.fortification = nr.fortifications[0]?.id ?? '';
        side.intel = nr.intelLevels[Math.min(1, nr.intelLevels.length - 1)]?.id ?? '';
      }
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <input className="title-input" value={sc.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <Btn kind="primary" onClick={start} disabled={!rs}>
          ▶ Начать бой
        </Btn>
        <Btn onClick={() => openTab('montecarlo', sc.id)} disabled={!rs} title="Сотни прогонов для оценки вероятностей исходов">
          Прогоны
        </Btn>
        <Menu
          items={[
            {
              label: `${randomSeedMode ? '✓ ' : ''}Новый сид при каждом старте`,
              onClick: () => setRandomSeedMode(!randomSeedMode),
              tip: 'Иначе каждый бой начинается с сида сценария и повторяется',
            },
            'sep',
            { label: 'Дублировать', onClick: () => duplicateScenario(sc.id) },
            { label: 'Сохранить в файл…', onClick: () => exportJson('scenario', sc.name, sc) },
            'sep',
            { label: 'Удалить сценарий', danger: true, onClick: () => deleteScenario(sc.id) },
          ]}
        />
      </div>

      {errors.length > 0 && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          {errors.map((x, i) => (
            <div key={i}>{x.text}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="muted small" style={{ marginTop: -8, marginBottom: 12 }} data-tip={warnings.map((x) => `• ${x.text}`).join('\n')}>
          <span className="warn">⚠</span> Замечаний: {warnings.length} — наведите, чтобы прочитать
        </div>
      )}

      <div className="stack">
        <Card title="Обстановка">
          <div className="fields">
            {rs?.conditions.map((cat) => {
              const opt = cat.options.find((o) => o.id === sc.conditions[cat.id]);
              return (
                <Field key={cat.id} label={cat.name} hint={opt ? effectsText(opt.effects) : undefined}>
                  <Sel value={sc.conditions[cat.id] ?? ''} onChange={(v) => upd((d) => void (d.conditions[cat.id] = v))} options={cat.options.map((o) => ({ value: o.id, label: o.name }))} />
                </Field>
              );
            })}
            <Field label="Начальная дистанция">
              <Sel value={sc.startBand} onChange={(v) => upd((d) => void (d.startBand = v))} options={(rs?.rangeBands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
            <Field label="Лимит ходов" hint={rs ? `≈ ${fmt1((sc.maxTurns * rs.turnMinutes) / 60)} ч боя` : undefined}>
              <Num value={sc.maxTurns} onChange={(v) => upd((d) => void (d.maxTurns = v))} min={1} max={500} integer width="100%" />
            </Field>
            <Field label="Сид" hint="Один и тот же сид даёт тот же бой.">
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <Txt value={sc.seed} onChange={(v) => upd((d) => void (d.seed = v))} />
                <Btn icon kind="ghost" title="Случайный сид" onClick={() => upd((d) => void (d.seed = randomSeed()))}>
                  🎲
                </Btn>
              </div>
            </Field>
            <Field label="Набор правил">
              <Sel value={sc.rulesetId} onChange={changeRuleset} options={Object.values(st.rulesets).map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Area value={sc.description ?? ''} onChange={(v) => upd((d) => void (d.description = v))} rows={2} placeholder="Вводная (необязательно)" />
          </div>
        </Card>

        {rs ? (
          <div className="grid two">
            {[0, 1].map((i) => (
              <SideEditor key={i} sc={sc} i={i} rs={rs} />
            ))}
          </div>
        ) : (
          <div className="note bad">Набор правил сценария не найден — выберите другой.</div>
        )}

        {rs && <ForceRatio sc={sc} rs={rs} />}
      </div>
    </div>
  );
}

function SideEditor({ sc, i, rs }: { sc: Scenario; i: number; rs: Ruleset }) {
  const st = useApp();
  const side = sc.sides[i];
  const upd = (fn: (s: Scenario['sides'][number]) => void) => updateScenario(sc.id, (d) => fn(d.sides[i]));
  const library = Object.values(st.formations).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return (
    <div className="card side-card" style={{ ['--side' as string]: side.color }}>
      <div className="card-head">
        <input type="color" value={side.color} onChange={(e) => upd((d) => void (d.color = e.target.value))} title="Цвет стороны" />
        <input className="title-input" style={{ fontSize: 15, fontWeight: 600, minWidth: 100, flex: 1 }} value={side.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <div>
          {side.formations.map((f, fi) => {
            const s = summarizeDef(allEls(f), rs);
            return (
              <div key={f.id} className="row" style={{ flexWrap: 'nowrap', padding: '3px 0' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Link kind="formation" refId={`sc:${sc.id}:${f.id}`}>
                    {f.name}
                  </Link>
                  <span className="faint small" data-tip={s.equip.length ? s.equip.map((q) => `${q.name}: ${q.cur}`).join('\n') : undefined}>
                    {' '}
                    · {fmt0(s.persCur)} чел.
                  </span>
                </div>
                <Sel value={f.order ?? ''} width={130} onChange={(v) => upd((d) => void (d.formations[fi].order = v))} options={rs.orders.map((o) => ({ value: o.id, label: o.name }))} title="Приказ подразделению" />
                <Btn
                  sm
                  kind="ghost"
                  icon
                  title="Убрать из сценария"
                  onClick={async () => {
                    if (await confirmDialog(`Убрать «${f.name}» из сценария?`, 'Копия в сценарии будет удалена; в библиотеке подразделение останется.', 'Убрать', true))
                      upd((d) => void d.formations.splice(fi, 1));
                  }}
                >
                  ×
                </Btn>
              </div>
            );
          })}
          {!side.formations.length && <div className="muted">Нет подразделений</div>}
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            <select
              value=""
              style={{ flex: 1 }}
              onChange={(e) => {
                const f = st.formations[e.target.value];
                if (f) upd((d) => void d.formations.push(copyFormation(f)));
              }}
              title="В сценарий добавляется копия — её можно менять, не трогая библиотеку"
            >
              <option value="">+ Добавить из библиотеки…</option>
              {library.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.rulesetId && f.rulesetId !== sc.rulesetId ? ' (другой набор правил)' : ''}
                </option>
              ))}
            </select>
            <Btn
              kind="ghost"
              onClick={() => {
                const f = newFormation('Новое подразделение', { rulesetId: rs.id, order: i === 0 ? 'attack' : 'defend' });
                upd((d) => void d.formations.push(f));
                openTab('formation', `sc:${sc.id}:${f.id}`);
              }}
            >
              + Новое
            </Btn>
          </div>
        </div>

        <div className="fields two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Укрепления" hint="Действуют на элементы в обороне, засаде, закреплении и резерве.">
            <Sel value={side.fortification} onChange={(v) => upd((d) => void (d.fortification = v))} options={rs.fortifications.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
          <Field label="Разведданные">
            <Sel value={side.intel} onChange={(v) => upd((d) => void (d.intel = v))} options={rs.intelLevels.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        </div>

        <div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <h4>Задачи</h4>
            <Info text="По задачам считается итог боя. Если задач нет, они выводятся из приказов: атака — захватить позицию, оборона — удержать. Вес — важность задачи в итоговой оценке." />
          </div>
          {!side.objectives.length && <div className="faint small">По приказам (автоматически)</div>}
          {side.objectives.map((o, oi) => (
            <div key={o.id} className="row" style={{ flexWrap: 'nowrap', marginBottom: 4, gap: 6 }}>
              <div className="grow">
                <Sel
                  value={o.type}
                  width="100%"
                  onChange={(v) =>
                    upd((d) => {
                      d.objectives[oi].type = v;
                      d.objectives[oi].value = DEFAULT_OBJECTIVE_VALUE[v](sc.maxTurns);
                    })
                  }
                  options={OBJECTIVE_TYPES.map((t) => ({ value: t, label: OBJECTIVE_LABELS[t] }))}
                />
              </div>
              {OBJECTIVE_HAS_VALUE[o.type] && (
                <Num value={o.value} onChange={(v) => upd((d) => void (d.objectives[oi].value = v))} min={0} width={78} suffix={o.type === 'hold' ? 'ход' : '%'} />
              )}
              <span className="faint small" data-tip="Вес задачи в итоговой оценке">
                вес
              </span>
              <Num value={o.weight} onChange={(v) => upd((d) => void (d.objectives[oi].weight = v))} min={0} step={0.5} width={48} />
              <Btn sm kind="ghost" icon onClick={() => upd((d) => void d.objectives.splice(oi, 1))} title="Убрать задачу">
                ×
              </Btn>
            </div>
          ))}
          <Btn sm kind="ghost" onClick={() => upd((d) => void d.objectives.push(newObjective(i === 0 ? 'take' : 'hold', i === 0 ? 0 : sc.maxTurns, 1)))}>
            + задача
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ForceRatio({ sc, rs }: { sc: Scenario; rs: Ruleset }) {
  const sums = sc.sides.map((s) => summarizeDef(s.formations.flatMap(allEls), rs));
  const band = sc.startBand;
  const ratio = (a: number, b: number) => (a <= 0 && b <= 0 ? '—' : b <= 0 ? '∞' : a <= 0 ? '0' : a >= b ? `${fmt1(a / b)} : 1` : `1 : ${fmt1(b / a)}`);
  const rows: { label: string; a: number; b: number; fmt?: (v: number) => string }[] = [
    { label: 'Личный состав', a: sums[0].persCur, b: sums[1].persCur },
    { label: 'Боевая ценность', a: sums[0].value, b: sums[1].value },
    ...rs.targetClasses.map((c) => ({
      label: `Огонь по «${c.name}»`,
      a: sums[0].fire[c.id]?.[band] ?? 0,
      b: sums[1].fire[c.id]?.[band] ?? 0,
      fmt: fmt1,
    })),
  ];
  for (const id of [...new Set(sums.flatMap((s) => s.equip.map((q) => q.id)))]) {
    rows.push({
      label: rs.componentTypes.find((t) => t.id === id)?.name ?? id,
      a: sums[0].equip.find((q) => q.id === id)?.cur ?? 0,
      b: sums[1].equip.find((q) => q.id === id)?.cur ?? 0,
    });
  }
  return (
    <Section
      id="scenario-ratio"
      title="Соотношение сил"
      summary={`люди ${ratio(sums[0].persCur, sums[1].persCur)} · боевая ценность ${ratio(sums[0].value, sums[1].value)}`}
      tight
    >
      <table className="tbl">
        <thead>
          <tr>
            <th />
            <th className="num" style={{ color: sc.sides[0].color }}>
              {sc.sides[0].name}
            </th>
            <th className="num" style={{ color: sc.sides[1].color }}>
              {sc.sides[1].name}
            </th>
            <th className="num">Соотношение</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{(r.fmt ?? fmt0)(r.a)}</td>
              <td className="num">{(r.fmt ?? fmt0)(r.b)}</td>
              <td className="num">{ratio(r.a, r.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint small" style={{ margin: '6px 14px 4px' }}>
        Огонь — на начальной дистанции, без учёта условий и состояния.
      </p>
    </Section>
  );
}
