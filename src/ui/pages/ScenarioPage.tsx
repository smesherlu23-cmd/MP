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
import { Area, Btn, Card, Field, Num, Sel, Seg, Txt, fmt0, fmt1 } from '../components/ui';
import { useTabState } from '../hooks';
import {
  confirmDialog,
  deleteScenario,
  duplicateScenario,
  exportJson,
  openTab,
  putBattle,
  updateScenario,
  useApp,
  type Tab,
} from '../store';
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

export function ScenarioPage({ tab }: { tab: Tab }) {
  const st = useApp();
  const sc = st.scenarios[tab.ref!];
  const [seedMode, setSeedMode] = useTabState<'fixed' | 'random'>(`${tab.key}:seedMode`, 'fixed');
  if (!sc) return <div className="empty">Сценарий не найден.</div>;
  const rs = st.rulesets[sc.rulesetId];
  const upd = (fn: (s: Scenario) => void) => updateScenario(sc.id, fn);
  const issues = validateScenario(sc, rs);

  const start = () => {
    if (!rs) return;
    let seed = sc.seed;
    if (seedMode === 'random') {
      seed = randomSeed();
      upd((d) => void (d.seed = seed));
    }
    startBattle(sc, rs, seed);
  };

  return (
    <div className="page">
      <div className="crumbs">Сценарий</div>
      <div className="page-head">
        <input className="title-input" value={sc.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <div className="toolbar">
          <Btn kind="primary" onClick={start} disabled={!rs}>
            ▶ Начать бой
          </Btn>
          <Btn onClick={() => openTab('montecarlo', sc.id)} disabled={!rs}>
            ∑ Массовое моделирование
          </Btn>
          <span className="sep" />
          <Btn onClick={() => duplicateScenario(sc.id)}>Дублировать</Btn>
          <Btn onClick={() => exportJson('scenario', sc.name, sc)}>Экспорт</Btn>
          <Btn kind="danger" onClick={() => deleteScenario(sc.id)}>
            Удалить
          </Btn>
        </div>
      </div>

      {issues.length > 0 && (
        <div className={`note ${issues.some((x) => x.level === 'error') ? 'bad' : 'warn'}`} style={{ marginBottom: 14 }}>
          {issues.slice(0, 8).map((x, i) => (
            <div key={i}>
              {x.level === 'error' ? '✖' : '⚠'} {x.text}
            </div>
          ))}
        </div>
      )}

      <div className="grid two" style={{ marginBottom: 14 }}>
        <Card title="Общее">
          <div className="fields">
            <Field label="Набор правил">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Sel
                  value={sc.rulesetId}
                  onChange={async (v) => {
                    if (await confirmDialog('Сменить набор правил?', 'Типы, приказы и условия должны существовать в новом наборе — проверьте предупреждения после смены.')) {
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
                    }
                  }}
                  options={Object.values(st.rulesets).map((r) => ({ value: r.id, label: r.name }))}
                />
                {rs && (
                  <Link kind="ruleset" refId={rs.id} title="Открыть набор правил">
                    ↗
                  </Link>
                )}
              </div>
            </Field>
            <Field label="Начальная дистанция">
              <Sel value={sc.startBand} onChange={(v) => upd((d) => void (d.startBand = v))} options={(rs?.rangeBands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
            <Field label="Лимит ходов" hint={rs ? `≈ ${fmt1((sc.maxTurns * rs.turnMinutes) / 60)} ч` : undefined}>
              <Num value={sc.maxTurns} onChange={(v) => upd((d) => void (d.maxTurns = v))} min={1} max={500} integer />
            </Field>
            <Field label="Сид случайности" hint="Один и тот же сид даёт тот же бой.">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Txt value={sc.seed} onChange={(v) => upd((d) => void (d.seed = v))} />
                <Btn icon title="Новый случайный сид" onClick={() => upd((d) => void (d.seed = randomSeed()))}>
                  🎲
                </Btn>
              </div>
            </Field>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">При старте боя:</span>
            <Seg
              value={seedMode}
              onChange={setSeedMode}
              options={[
                { value: 'fixed', label: 'сид сценария', title: 'Повторяемый бой' },
                { value: 'random', label: 'новый сид каждый раз', title: 'Каждый бой — со своим сидом (он сохраняется в бою)' },
              ]}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Описание / вводная">
              <Area value={sc.description ?? ''} onChange={(v) => upd((d) => void (d.description = v))} rows={3} />
            </Field>
          </div>
        </Card>
        <Card title="Условия боя">
          {!rs && <div className="note bad">Набор правил не найден.</div>}
          <div className="fields two">
            {rs?.conditions.map((cat) => {
              const opt = cat.options.find((o) => o.id === sc.conditions[cat.id]);
              return (
                <Field key={cat.id} label={cat.name} hint={opt ? effectsText(opt.effects) : undefined}>
                  <Sel value={sc.conditions[cat.id] ?? ''} onChange={(v) => upd((d) => void (d.conditions[cat.id] = v))} options={cat.options.map((o) => ({ value: o.id, label: o.name }))} />
                </Field>
              );
            })}
          </div>
          {rs && (
            <p className="faint small" style={{ marginTop: 10 }}>
              Варианты и их эффекты настраиваются в{' '}
              <Link kind="ruleset" refId={rs.id} sub="conditions">
                наборе правил
              </Link>
              ; там же можно добавить свои категории условий.
            </p>
          )}
        </Card>
      </div>

      <div className="grid two" style={{ marginBottom: 14 }}>
        {[0, 1].map((i) => rs && <SideEditor key={i} sc={sc} i={i} rs={rs} />)}
      </div>

      {rs && <ForceRatio sc={sc} rs={rs} />}
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
        <input className="title-input" style={{ fontSize: 15, minWidth: 120 }} value={side.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <span className="badge">сторона {side.id}</span>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="fields">
          <Field label="Укрепления" hint="Действуют на элементы в обороне, засаде, закреплении.">
            <Sel value={side.fortification} onChange={(v) => upd((d) => void (d.fortification = v))} options={rs.fortifications.map((o) => ({ value: o.id, label: o.name, title: effectsText(o.effects) }))} />
          </Field>
          <Field label="Разведданные">
            <Sel value={side.intel} onChange={(v) => upd((d) => void (d.intel = v))} options={rs.intelLevels.map((o) => ({ value: o.id, label: o.name, title: effectsText(o.effects) }))} />
          </Field>
        </div>

        <div>
          <h4 style={{ marginBottom: 6 }}>Подразделения</h4>
          <table className="tbl">
            <tbody>
              {side.formations.map((f, fi) => {
                const s = summarizeDef(allEls(f), rs);
                return (
                  <tr key={f.id}>
                    <td>
                      <Link kind="formation" refId={`sc:${sc.id}:${f.id}`}>
                        {f.name}
                      </Link>
                      <div className="faint small">
                        {f.kind} · {fmt0(s.persCur)} чел.{s.equip.length ? ` · ${s.equip.map((q) => `${q.name} ${q.cur}`).join(', ')}` : ''}
                      </div>
                    </td>
                    <td style={{ width: 150 }}>
                      <Sel value={f.order ?? ''} onChange={(v) => upd((d) => void (d.formations[fi].order = v))} options={rs.orders.map((o) => ({ value: o.id, label: o.name }))} title="Приказ подразделению" />
                    </td>
                    <td style={{ width: 30 }}>
                      <Btn
                        sm
                        kind="ghost"
                        icon
                        title="Убрать из сценария"
                        onClick={async () => {
                          if (await confirmDialog(`Убрать «${f.name}» из сценария?`, 'Изменения этой копии будут потеряны (в библиотеке подразделение останется).', 'Убрать', true))
                            upd((d) => void d.formations.splice(fi, 1));
                        }}
                      >
                        ×
                      </Btn>
                    </td>
                  </tr>
                );
              })}
              {!side.formations.length && (
                <tr>
                  <td className="faint">Нет подразделений</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <select
              value=""
              onChange={(e) => {
                const f = st.formations[e.target.value];
                if (!f) return;
                upd((d) => void d.formations.push(copyFormation(f)));
              }}
            >
              <option value="">+ из библиотеки…</option>
              {library.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.rulesetId && f.rulesetId !== sc.rulesetId ? ' (другой набор правил)' : ''}
                </option>
              ))}
            </select>
            <Btn
              sm
              onClick={() => {
                const f = newFormation('Новое подразделение', { rulesetId: rs.id, order: i === 0 ? 'attack' : 'defend' });
                upd((d) => void d.formations.push(f));
                openTab('formation', `sc:${sc.id}:${f.id}`);
              }}
            >
              + новое
            </Btn>
          </div>
          <p className="faint small" style={{ marginTop: 6 }}>
            В сценарий добавляется копия: её можно менять, не трогая библиотеку. Результаты боя потом можно вернуть в библиотеку.
          </p>
        </div>

        <div>
          <h4 style={{ marginBottom: 6 }}>Задачи стороны</h4>
          {!side.objectives.length && <p className="faint small">Задачи не заданы — будут выведены из приказов (атака → захватить позицию; оборона → удержать).</p>}
          {side.objectives.map((o, oi) => (
            <div key={o.id} className="row" style={{ flexWrap: 'nowrap', marginBottom: 4 }}>
              <Sel
                value={o.type}
                onChange={(v) =>
                  upd((d) => {
                    const t = v as ObjectiveType;
                    d.objectives[oi].type = t;
                    d.objectives[oi].value = { hold: sc.maxTurns, inflict: 20, preserve: 30, recon: 50, take: 0, noRout: 0 }[t];
                  })
                }
                options={OBJECTIVE_TYPES.map((t) => ({ value: t, label: OBJECTIVE_LABELS[t] }))} width={240} />
              {OBJECTIVE_HAS_VALUE[o.type] ? <Num value={o.value} onChange={(v) => upd((d) => void (d.objectives[oi].value = v))} min={0} width={70} /> : <span style={{ width: 70 }} />}
              <span className="faint small" title="Вес задачи в итоговой оценке">
                вес
              </span>
              <Num value={o.weight} onChange={(v) => upd((d) => void (d.objectives[oi].weight = v))} min={0} step={0.5} width={56} />
              <Txt value={o.label ?? ''} onChange={(v) => upd((d) => void (d.objectives[oi].label = v))} placeholder="своя формулировка" />
              <Btn sm kind="ghost" icon onClick={() => upd((d) => void d.objectives.splice(oi, 1))}>
                ×
              </Btn>
            </div>
          ))}
          <Btn sm onClick={() => upd((d) => void d.objectives.push(newObjective(i === 0 ? 'take' : 'hold', i === 0 ? 0 : sc.maxTurns, 1)))}>
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
  const bands = rs.rangeBands;
  const ratio = (a: number, b: number) => (a <= 0 && b <= 0 ? '—' : b <= 0 ? '∞' : a <= 0 ? '0' : a >= b ? `${fmt1(a / b)} : 1` : `1 : ${fmt1(b / a)}`);
  const rows: { label: string; a: number; b: number; fmt?: (v: number) => string }[] = [
    { label: 'Личный состав', a: sums[0].persCur, b: sums[1].persCur },
    { label: 'Боевая ценность', a: sums[0].value, b: sums[1].value },
    ...rs.targetClasses.map((c) => ({
      label: `Огонь по «${c.name}» (${bands.find((x) => x.id === band)?.name ?? ''})`,
      a: sums[0].fire[c.id]?.[band] ?? 0,
      b: sums[1].fire[c.id]?.[band] ?? 0,
      fmt: fmt1,
    })),
  ];
  const typeIds = [...new Set(sums.flatMap((s) => s.equip.map((q) => q.id)))];
  for (const id of typeIds) {
    const name = rs.componentTypes.find((t) => t.id === id)?.name ?? id;
    rows.push({ label: name, a: sums[0].equip.find((q) => q.id === id)?.cur ?? 0, b: sums[1].equip.find((q) => q.id === id)?.cur ?? 0 });
  }
  return (
    <Card title="Соотношение сил (до боя, без учёта модификаторов)" tight>
      <table className="tbl">
        <thead>
          <tr>
            <th>Показатель</th>
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
    </Card>
  );
}
