// Загрузка данных, примеры и перенос старых форматов, корзина и резервные копии, импорт и экспорт.

import {
  clone,
  cloneUnit,
  makeBlankRuleset,
  makeDemoBattalion,
  makeDemoDefenders,
  makeDemoScenario,
  makeDemoTemplates,
  migrateUnit,
  makeLinearBrigade,
  makeLinearDefenders,
  makeLinearRuleset,
  makeLinearScenario,
  makeLinearTemplates,
  makeUniversalRuleset,
  walkUnits,
  findUnit,
  newId,
  normalizeRuleset,
  recalibrateRuleset,
  scenarioToHours,
  extractForces,
  rehashCopies,
  toTemplate,
  unitHash,
  type Battle,
  type UnitNode,
  type Id,
  type Ruleset,
  type Scenario,
} from '../../engine';
import { battleMeta, storage, type BattleMeta, type Collection, type TrashItem } from '../storage';
import {
  type AppState,
  type Col,
  type Tab,
  alertDialog,
  confirmDialog,
  flushSaves,
  fmtDate,
  get,
  historyStep,
  loadLocal,
  openTab,
  scheduleSave,
  set,
  tabExists,
  toast,
} from './core';
import { addFormation, replaceRuleset } from './library';
import { addForce, addScenario } from './forces';
import { putBattle } from './battles';

export async function initApp() {
  const [rs, fs, fc, sc, bt] = await Promise.all([
    storage.list('rulesets'),
    storage.list('formations'),
    storage.list('forces'),
    storage.list('scenarios'),
    storage.list('battles'),
  ]);
  // Копия — до любых изменений при загрузке; повреждённые файлы хранилище уже отложило в сторону.
  await storage.backup('auto').catch(() => null);
  const problems = (await storage.problems()).map((p) => `${COL_LABEL[p.col] ?? p.col}: ${p.file} — ${p.error}`);
  const take = <T extends { id?: Id; name?: string }, R>(col: Collection, list: unknown[], fix: (x: T) => R): Record<Id, R> => {
    const out: Record<Id, R> = {};
    for (const x of list as T[]) {
      try {
        if (!x?.id) throw new Error();
        out[x.id] = fix(x);
      } catch {
        problems.push(`${COL_LABEL[col]}: «${x?.name ?? x?.id ?? '?'}» — не распознано`);
      }
    }
    return out;
  };
  const rulesets = take('rulesets', rs, (r: Ruleset) => normalizeRuleset(r));
  // Старые файлы («формирование + элементы») переводятся в дерево подразделений при загрузке.
  const formations = take('formations', fs, (f: UnitNode) => migrateUnit(f));
  const forces = take('forces', fc, (f: UnitNode) => migrateUnit(f));
  const scenarios = take('scenarios', sc, (x: Scenario) => migrateScenario(x));
  const battleIndex = take('battles', bt, (b: BattleMeta) => b);

  const firstRun = !Object.keys(rulesets).length && !localStorage.getItem('warsim-initialized');
  set({ rulesets, formations, forces, scenarios, battleIndex });
  if (firstRun) {
    await installExamples();
    localStorage.setItem('warsim-initialized', '1');
    localStorage.setItem(MODEL_FLAG, '1');
    localStorage.setItem(CALIBRATION_FLAG, '1');
    localStorage.setItem(HOLDFAST_FLAG, '1');
  } else {
    await addLinearExample();
    await migrateToForces();
    recalibrate();
    scenariosToHours();
    holdFastToScenarios();
  }
  if (!Object.keys(get().rulesets).length) {
    // Без набора правил программа бесполезна — создаём пустой.
    const r = makeBlankRuleset('Мой набор правил');
    set((s) => ({ rulesets: { ...s.rulesets, [r.id]: r } }));
    scheduleSave('rulesets', r.id, () => get().rulesets[r.id]);
  }
  const saved = loadLocal<{ tabs: Tab[]; active: string }>('warsim-tabs', { tabs: [], active: '' });
  const valid = saved.tabs.filter((t) => tabExists(t));
  set({
    loaded: true,
    tabs: valid.length ? valid : [{ key: 'home', kind: 'home' }],
    active: valid.some((t) => t.key === saved.active) ? saved.active : (valid[0]?.key ?? 'home'),
  });
  if (problems.length) void reportProblems(problems);
  // Пока программа открыта, копия делается раз в час (если что-то изменилось).
  setInterval(
    () =>
      void flushSaves()
        .then(() => storage.backup('auto'))
        .catch(() => null),
    3600e3,
  );
}

export const COL_LABEL: Record<string, string> = { rulesets: 'Наборы правил', formations: 'Шаблоны', forces: 'Силы', scenarios: 'Сценарии', battles: 'Бои' };

export async function reportProblems(list: string[]) {
  const last = (await storage.backups().catch(() => []))[0];
  const shown = list.slice(0, 8).join('\n') + (list.length > 8 ? `\n… и ещё ${list.length - 8}` : '');
  await alertDialog(
    'Часть данных не удалось прочитать',
    `${shown}\n\nОстальное загружено. Нечитаемые файлы не удалены — они отложены в папку «damaged» внутри папки данных.` +
      (last ? `\nПоследняя резервная копия — ${fmtDate(last.createdAt)}; вернуть из неё можно в Настройках → «Данные».` : ''),
  );
}

/** Вернуть объекты из корзины. */
export async function restoreFromTrash(items: Pick<TrashItem, 'col' | 'key'>[]): Promise<number> {
  let n = 0;
  for (const it of items) {
    const data = (await storage.restoreTrash(it.col, it.key)) as { id?: Id } | null;
    if (!data?.id) continue;
    try {
      if (it.col === 'battles') set((s) => ({ battleIndex: { ...s.battleIndex, [data.id!]: battleMeta(data as Battle) } }));
      else {
        const col = it.col as Col;
        const fix = col === 'rulesets' ? normalizeRuleset : col === 'formations' || col === 'forces' ? migrateUnit : migrateScenario;
        set((s) => ({ [col]: { ...s[col], [data.id!]: fix(data as never) } }) as Partial<AppState>);
      }
      n++;
    } catch {
      toast(`Не удалось вернуть «${it.key}»: объект не распознан.`, 'bad');
    }
  }
  if (!n && items.length) toast('В корзине этого уже нет.', 'bad');
  return n;
}

/** Вернуть наборы правил, шаблоны, силы и сценарии из резервной копии (с перезапуском окна). */
export async function restoreBackup(id: string, label: string) {
  const ok = await confirmDialog(
    `Восстановить данные из копии от ${label}?`,
    'Наборы правил, шаблоны, силы и сценарии из копии заменят текущие версии; созданное позже копии останется. Бои не затрагиваются.\nТекущее состояние перед этим само сохранится в отдельную копию — восстановление можно отменить, вернувшись к ней.',
    'Восстановить',
  );
  if (!ok) return;
  await flushSaves();
  try {
    const n = await storage.restoreBackup(id);
    toast(`Восстановлено объектов: ${n}. Перезапуск…`, 'good');
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    toast(`Не удалось восстановить: ${(e as Error).message}`, 'bad');
  }
}

export function migrateScenario(sc: Scenario): Scenario {
  return { ...sc, sides: sc.sides.map((sd) => ({ ...sd, formations: (sd.formations ?? []).map((f) => migrateUnit(f)) })) as Scenario['sides'] };
}

/** Калибровка правдоподобия исходов проведена: несменённые коэффициенты наборов переведены на новые значения. */
export const CALIBRATION_FLAG = 'warsim-calibration-2';

/**
 * Один раз после калибровки: в наборах правил коэффициенты, которые не меняли, — на новые значения
 * (заданные вручную остаются); пример «Высота 212» начинается с рубежа атаки, как в новых примерах.
 */
export function recalibrate() {
  if (localStorage.getItem(CALIBRATION_FLAG)) return;
  const s = get();
  const names: string[] = [];
  for (const r of Object.values(s.rulesets)) {
    const copy = clone(r);
    if (!recalibrateRuleset(copy).length) continue;
    set((st) => ({ rulesets: { ...st.rulesets, [r.id]: copy } }));
    scheduleSave('rulesets', r.id, () => get().rulesets[r.id]);
    names.push(`«${r.name}»`);
  }
  const demo = s.scenarios['sc-demo'];
  if (demo && demo.startBand === 'long') {
    const copy = { ...demo, startBand: 'medium' };
    set((st) => ({ scenarios: { ...st.scenarios, [demo.id]: copy } }));
    scheduleSave('scenarios', demo.id, () => get().scenarios[demo.id]);
  }
  localStorage.setItem(CALIBRATION_FLAG, '1');
  if (names.length)
    toast(
      `Модель боя откалибрована: в наборах ${names.join(', ')} обновлены «Мораль за 1% потерь» и «Порог отхода (потери)» — там, где их не меняли. Начатые бои идут по своим прежним правилам.`,
      'info',
    );
}

/** «Стоять насмерть» перенесён из шаблонов и сил в сценарий. */
export const HOLDFAST_FLAG = 'warsim-holdfast-scenario';

/**
 * Один раз: отметки «стоять насмерть» у сил переносятся в сценарии, где эти силы воюют (у той же части),
 * а у сил и шаблонов снимаются; копии шаблонов остаются актуальными.
 */
export function holdFastToScenarios() {
  if (localStorage.getItem(HOLDFAST_FLAG)) return;
  const s = get();
  const marked = new Set<Id>();
  const clearIn = (root: UnitNode) => {
    let hit = false;
    walkUnits(root, (n) => {
      if (!n.holdFast) return;
      marked.add(n.id);
      n.holdFast = false;
      hit = true;
    });
    return hit;
  };
  const before = new Map(Object.values(s.formations).map((t) => [t.id, unitHash(t)]));
  const templates = Object.fromEntries(Object.values(s.formations).map((t) => [t.id, clone(t)]));
  const tplHit = Object.values(templates).filter(clearIn).length > 0;
  const forces = Object.fromEntries(Object.values(s.forces).map((f) => [f.id, clone(f)]));
  for (const f of Object.values(forces)) clearIn(f);
  if (tplHit) {
    rehashCopies(Object.values(templates), before, templates);
    rehashCopies(Object.values(forces), before, templates);
  }
  const scenarios: Scenario[] = [];
  if (marked.size)
    for (const sc of Object.values(s.scenarios)) {
      const copy = clone(sc);
      let hit = false;
      for (const sd of copy.sides) {
        const hold = new Set(sd.holdFast ?? []);
        for (const ref of sd.units ?? []) {
          const f = s.forces[ref.forceId];
          const part = f && findUnit(f, ref.nodeId ?? f.id);
          if (part) walkUnits(part, (n) => void (marked.has(n.id) && hold.add(n.id)));
        }
        if (hold.size !== (sd.holdFast?.length ?? 0)) {
          sd.holdFast = [...hold];
          hit = true;
        }
      }
      if (hit) scenarios.push(copy);
    }
  // Сохраняется всё, что изменилось, — в том числе копии, у которых обновился отпечаток шаблона.
  const changedT = Object.values(templates).filter((t) => JSON.stringify(t) !== JSON.stringify(s.formations[t.id]));
  const changedF = Object.values(forces).filter((f) => JSON.stringify(f) !== JSON.stringify(s.forces[f.id]));
  set((st) => ({
    formations: { ...st.formations, ...Object.fromEntries(changedT.map((t) => [t.id, t])) },
    forces: { ...st.forces, ...Object.fromEntries(changedF.map((f) => [f.id, f])) },
    scenarios: { ...st.scenarios, ...Object.fromEntries(scenarios.map((x) => [x.id, x])) },
  }));
  for (const t of changedT) scheduleSave('formations', t.id, () => get().formations[t.id]);
  for (const f of changedF) scheduleSave('forces', f.id, () => get().forces[f.id]);
  for (const x of scenarios) scheduleSave('scenarios', x.id, () => get().scenarios[x.id]);
  localStorage.setItem(HOLDFAST_FLAG, '1');
}

/** Сценарии прежней версии (лимит в ходах) — на часы: длительность боя и «удержать позицию». */
export function scenariosToHours() {
  const s = get();
  for (const sc of Object.values(s.scenarios)) {
    const rs = s.rulesets[sc.rulesetId];
    if (sc.hours !== undefined || !rs) continue;
    const next = scenarioToHours(sc, rs);
    set((st) => ({ scenarios: { ...st.scenarios, [sc.id]: next } }));
    scheduleSave('scenarios', sc.id, () => get().scenarios[sc.id]);
  }
}

export const linearUnits = () => [...makeLinearTemplates(), makeLinearBrigade(), makeLinearDefenders()];

/** Модель «шаблоны + силы» введена: шаблоны очищены, подразделения сценариев перенесены в силы. */
export const MODEL_FLAG = 'warsim-model-forces';

/** Примеры: шаблоны (чертежи) отдельно, силы сторон — отдельно; сценарии ссылаются на силы. */
export function exampleScenario(sc: Scenario, rootIds: [string, string], templates: Record<Id, UnitNode>, before: Map<Id, string>) {
  sc.sides.forEach((sd, i) => sd.formations[0] && (sd.formations[0].id = rootIds[i]));
  rehashCopies(
    sc.sides.flatMap((sd) => sd.formations),
    before,
    templates,
  );
  return extractForces(sc, new Set(), () => newId('u'));
}

export async function installExamples() {
  const universal = makeUniversalRuleset();
  const linear = makeLinearRuleset();
  const named = (u: UnitNode, name: string) => ({ ...u, name });
  const raw = [
    ...[
      ...makeDemoTemplates(),
      named(makeDemoBattalion(), 'Мотострелковый батальон (пример)'),
      named(makeDemoDefenders(), 'Оборонительный узел усиленной роты (пример)'),
    ].map((u) => ({
      ...u,
      rulesetId: universal.id,
    })),
    ...linearUnits(),
  ];
  const before = new Map(raw.map((t) => [t.id, unitHash(t)]));
  const templates = Object.fromEntries(raw.map((t) => [t.id, toTemplate(t)]));
  rehashCopies(Object.values(templates), before, templates);
  const a = exampleScenario(makeDemoScenario(), ['force-demo-bn', 'force-demo-def'], templates, before);
  const b = exampleScenario(makeLinearScenario(), ['force-lin-brig', 'force-lin-def'], templates, before);
  await putExamples([universal, linear], Object.values(templates), [a.scenario, b.scenario], [...a.forces, ...b.forces]);
  localStorage.setItem('warsim-examples-linear', '1');
}

export async function putExamples(rs: Ruleset[], units: UnitNode[], scs: Scenario[], forces: UnitNode[] = []) {
  set((s) => ({
    rulesets: { ...s.rulesets, ...Object.fromEntries(rs.map((r) => [r.id, r])) },
    formations: { ...s.formations, ...Object.fromEntries(units.map((u) => [u.id, u])) },
    forces: { ...s.forces, ...Object.fromEntries(forces.map((u) => [u.id, u])) },
    scenarios: { ...s.scenarios, ...Object.fromEntries(scs.map((x) => [x.id, x])) },
  }));
  for (const r of rs) await storage.save('rulesets', r.id, r);
  for (const f of units) await storage.save('formations', f.id, f);
  for (const f of forces) await storage.save('forces', f.id, f);
  for (const x of scs) await storage.save('scenarios', x.id, x);
}

/**
 * Переход на «шаблоны + силы». Один раз: шаблоны очищаются от приказов и состояния (актуальные копии
 * остаются актуальными), подразделения с потерями сохраняются ещё и как силы. Всегда: сценарий со
 * старыми копиями подразделений (в том числе импортированный) переводится на силы.
 */
export async function migrateToForces() {
  const s = get();
  const first = !localStorage.getItem(MODEL_FLAG);
  let templates = s.formations;
  const extraForces: UnitNode[] = [];
  const before = new Map(Object.values(s.formations).map((t) => [t.id, unitHash(t)]));
  if (first) {
    templates = Object.fromEntries(Object.values(s.formations).map((t) => [t.id, toTemplate(t)]));
    rehashCopies(Object.values(templates), before, templates);
    // Шаблон (бывшее подразделение библиотеки) с потерями — это, по сути, уже конкретные силы: сохраняем и их.
    for (const t of Object.values(s.formations)) {
      if (t.id.startsWith('demo-')) continue;
      let hurt = false;
      walkUnits(t, (n) => n.composition.forEach((c) => (c.current < c.authorized || (c.recoverable ?? 0) > 0) && (hurt = true)));
      if (!hurt) continue;
      const f = cloneUnit(t);
      walkUnits(f, (n) => void (n.order = null));
      f.templateId = t.id;
      f.templateHash = unitHash(templates[t.id]);
      extraForces.push(f);
    }
  }
  const taken = new Set<Id>();
  for (const f of Object.values(s.forces)) walkUnits(f, (n) => void taken.add(n.id));
  const forces: UnitNode[] = [...extraForces];
  const scenarios: Scenario[] = [];
  for (const sc of Object.values(s.scenarios)) {
    if (sc.sides.every((sd) => sd.units)) continue;
    const copy = clone(sc);
    if (first)
      rehashCopies(
        copy.sides.flatMap((sd) => sd.formations),
        before,
        templates,
      );
    const r = extractForces(copy, taken, () => newId('u'));
    forces.push(...r.forces);
    scenarios.push(r.scenario);
  }
  const changedTemplates = first ? Object.values(templates).filter((t) => JSON.stringify(t) !== JSON.stringify(s.formations[t.id])) : [];
  set((st) => ({
    formations: first ? templates : st.formations,
    forces: { ...st.forces, ...Object.fromEntries(forces.map((f) => [f.id, f])) },
    scenarios: { ...st.scenarios, ...Object.fromEntries(scenarios.map((x) => [x.id, x])) },
  }));
  for (const t of changedTemplates) await storage.save('formations', t.id, t);
  for (const f of forces) await storage.save('forces', f.id, f);
  for (const x of scenarios) await storage.save('scenarios', x.id, x);
  localStorage.setItem(MODEL_FLAG, '1');
  if (first && (forces.length || changedTemplates.length))
    queueMicrotask(() =>
      toast(
        `Подразделения теперь делятся на «Шаблоны» (устройство и штат) и «Силы» (конкретные подразделения с потерями). Подразделения сценариев перенесены в «Силы»: ${forces.length}.`,
        'info',
      ),
    );
}

/** Пример боя для «Линейной тактики» появился позже остальных — добавляется один раз тем, у кого этот набор уже есть. */
export async function addLinearExample() {
  if (localStorage.getItem('warsim-examples-linear')) return;
  localStorage.setItem('warsim-examples-linear', '1');
  const s = get();
  const rs = s.rulesets['rs-linear'];
  if (!rs || s.scenarios['sc-demo-linear']) return;
  // Прежние значения примера давали слишком вялый бой; свои настройки ГМ не трогаем.
  const k = rs.coefficients;
  const upd =
    k.casualtyScale === 1 && k.moralePerLossPct === 1.2
      ? [{ ...rs, coefficients: { ...k, ...pickCoefficients(makeLinearRuleset(), ['casualtyScale', 'moralePerLossPct']) } }]
      : [];
  const units = linearUnits().filter((u) => !s.formations[u.id]);
  await putExamples(upd, units, [makeLinearScenario()]);
}

export function pickCoefficients(r: Ruleset, keys: string[]) {
  return Object.fromEntries(keys.map((x) => [x, r.coefficients[x as keyof Ruleset['coefficients']]]));
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export async function exportJson(kind: string, name: string, data: unknown) {
  const ok = await storage.exportFile(`${safeName(name)}.${kind}.json`, JSON.stringify(data, null, 2));
  if (ok) toast('Файл сохранён.', 'good');
}

export async function exportText(name: string, text: string, ext = 'txt') {
  const ok = await storage.exportFile(`${safeName(name)}.${ext}`, text);
  if (ok) toast('Файл сохранён.', 'good');
}

export async function importFile() {
  const file = await storage.importFile();
  if (!file) return;
  let data: any;
  try {
    data = JSON.parse(file.content);
  } catch {
    toast('Файл не является JSON.', 'bad');
    return;
  }
  const s = get();
  if (data?.componentTypes && data?.rangeBands) {
    const r = normalizeRuleset(data as Ruleset);
    if (s.rulesets[r.id]) {
      r.id = newId('rs');
      r.name = `${r.name} (импорт)`;
    }
    replaceRuleset(r);
    openTab('ruleset', r.id);
    toast(`Импортирован набор правил «${r.name}».`, 'good');
  } else if (data?.log && data?.elements && data?.ruleset) {
    const b = data as Battle;
    if (s.battleIndex[b.id]) b.id = newId('bt');
    putBattle(b);
    openTab('battle', b.id);
    toast(`Импортирован бой «${b.name}».`, 'good');
  } else if (data?.sides && data?.rulesetId) {
    let sc = migrateScenario(data as Scenario);
    if (s.rulesets[sc.rulesetId]) sc = scenarioToHours(sc, s.rulesets[sc.rulesetId]);
    if (s.scenarios[sc.id]) {
      sc.id = newId('sc');
      sc.name = `${sc.name} (импорт)`;
    }
    // Файл сценария несёт свои подразделения — они становятся силами, сценарий ссылается на них.
    let n = 0;
    if (sc.sides.some((sd) => !sd.units)) {
      const taken = new Set<Id>();
      for (const f of Object.values(s.forces)) walkUnits(f, (x) => void taken.add(x.id));
      const r = extractForces(sc, taken, () => newId('u'));
      historyStep(`импорт сценария «${sc.name}»`);
      for (const f of r.forces) addForce(f, false);
      n = r.forces.length;
      sc = r.scenario;
    }
    addScenario(sc);
    if (!s.rulesets[sc.rulesetId]) toast('Набор правил сценария не найден — выберите другой в сценарии.', 'bad');
    else toast(`Импортирован сценарий «${sc.name}»${n ? `, в «Силы» добавлено подразделений: ${n}` : ''}.`, 'good');
  } else if ((data?.elements && data?.subunits) || (data?.children && data?.composition)) {
    const f = migrateUnit(data);
    // С принадлежностью — это силы (конкретное подразделение), без неё — шаблон.
    const asForce = typeof data.faction === 'string';
    if ((asForce ? s.forces : s.formations)[f.id]) {
      f.id = newId('fm');
      f.name = `${f.name} (импорт)`;
    }
    if (asForce) addForce(f);
    else addFormation(toTemplate(f));
    toast(`Импортировано: ${asForce ? 'силы' : 'шаблон'} «${f.name}».`, 'good');
  } else {
    toast('Не удалось распознать содержимое файла.', 'bad');
  }
}

// ------------------------------------------------------------------ шаблоны
