// Проверка сценария и подразделений на ошибки до начала боя.

import { fmtDuration, scenarioHours, scenarioTurns } from './duration';
import { EVENT_KIND_LABELS, MODIFIER_FIELDS } from './labels';
import type { CustomModifier, Id, Ruleset, Scenario, SideDef, UnitNode } from './types';
import { sideUnits, walkUnits } from './units';

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

export function validateUnit(root: UnitNode, rs: Ruleset, path = ''): Issue[] {
  const issues: Issue[] = [];
  const types = new Set(rs.componentTypes.map((t) => t.id));
  const orders = new Set(rs.orders.map((o) => o.id));
  const walk = (n: UnitNode, where: string) => {
    const here = where ? `${where} / ${n.name}` : n.name;
    if (n.order && !orders.has(n.order)) issues.push({ level: 'warning', text: `${here}: приказ «${n.order}» отсутствует в наборе правил.` });
    if (!n.composition.length && !n.children.length) issues.push({ level: 'warning', text: `${here}: нет ни состава, ни подчинённых — в бою не участвует.` });
    for (const c of n.composition) {
      if (!types.has(c.typeId)) issues.push({ level: 'error', text: `${here}: тип «${c.typeId}» отсутствует в наборе правил «${rs.name}».` });
      else if (c.current > c.authorized) issues.push({ level: 'warning', text: `${here}: в строю больше штата.` });
    }
    for (const ch of n.children) walk(ch, here);
  };
  walk(root, path);
  return issues;
}

/**
 * Замечания к своему правилу: ссылки на удалённые приказы, варианты условий, классы целей, дистанции,
 * укрепления и разведданные; теги, которых нет ни у одного типа; пустые условия. Такое условие молча
 * не выполняется — правило не срабатывает (или, в «не / ни одно из», срабатывает всегда).
 */
export function ruleIssues(r: Ruleset, m: CustomModifier): string[] {
  const out: string[] = [];
  const typeTags = new Set(r.componentTypes.flatMap((t) => t.tags));
  if (r.reconTag) typeTags.add(r.reconTag);
  for (const c of m.when) {
    const vals = (Array.isArray(c.value) ? c.value : [c.value]).map(String).filter((x) => x.trim());
    if (c.field.startsWith('cond.')) {
      const cat = r.conditions.find((x) => x.id === c.field.slice(5));
      if (!cat) {
        out.push('условие по удалённой категории условий боя');
        continue;
      }
      const lost = vals.filter((v) => !cat.options.some((o) => o.id === v));
      if (lost.length) out.push(`«${cat.name}»: вариант удалён`);
      else if (!vals.length) out.push(`«${cat.name}»: вариант не выбран`);
      continue;
    }
    const f = MODIFIER_FIELDS.find((x) => x.field === c.field);
    if (!f) {
      out.push(`неизвестное поле «${c.field}»`);
      continue;
    }
    if (f.feature && !r.features[f.feature]) out.push(`«${f.label}»: механика выключена — значение не меняется`);
    if (f.kind === 'number') {
      if (!Number.isFinite(Number(c.value))) out.push(`«${f.label}»: не задано число`);
      continue;
    }
    if (!vals.length) {
      out.push(`«${f.label}»: значение не выбрано`);
      continue;
    }
    const known: Record<string, (v: string) => boolean> = {
      order: (v) => r.orders.some((o) => o.id === v),
      range: (v) => r.rangeBands.some((o) => o.id === v),
      class: (v) => r.targetClasses.some((o) => o.id === v),
      fort: (v) => r.fortifications.some((o) => o.id === v),
      intel: (v) => r.intelLevels.some((o) => o.id === v),
      tag: (v) => typeTags.has(v),
    };
    const ok = known[f.kind];
    const lost = ok ? vals.filter((v) => !ok(v)) : [];
    if (lost.length)
      out.push(
        f.kind === 'tag'
          ? `тег ${lost.map((x) => `«${x}»`).join(', ')} — нет ни у одного типа`
          : `«${f.label}»: ${lost.length > 1 ? 'значения удалены' : 'значение удалено'} из набора правил`,
      );
  }
  if (!Object.values(m.effects).some((v) => v !== undefined && v !== 1)) out.push('нет действия: все множители — 1');
  if (m.byShare && !m.when.some((c) => (c.field === 'tag' || c.field === 'kind') && !['not_has', 'nin', 'neq'].includes(c.op)))
    out.push('«по доле» без условия на свой тег или состав — действует на весь элемент');
  return out;
}

/** Замечания ко всем включённым правилам набора: правило → список. */
export function rulesetIssues(r: Ruleset): { rule: CustomModifier; issues: string[] }[] {
  return r.modifiers
    .filter((m) => m.enabled)
    .map((rule) => ({ rule, issues: ruleIssues(r, rule) }))
    .filter((x) => x.issues.length);
}

export function validateScenario(sc: Scenario, rs: Ruleset | undefined): Issue[] {
  if (!rs) return [{ level: 'error', text: 'Не найден набор правил сценария.' }];
  const issues: Issue[] = [];
  if (!rs.rangeBands.length) issues.push({ level: 'error', text: 'В наборе правил нет ни одной дистанции.' });
  if (!rs.targetClasses.length) issues.push({ level: 'error', text: 'В наборе правил нет ни одного класса целей.' });
  if (!rs.rangeBands.some((b) => b.id === sc.startBand))
    issues.push({ level: 'warning', text: 'Начальная дистанция не найдена — бой начнётся с самой дальней.' });
  for (const cat of rs.conditions) {
    if (!cat.options.some((o) => o.id === sc.conditions[cat.id])) issues.push({ level: 'warning', text: `Не выбрано условие «${cat.name}».` });
  }
  for (const x of rulesetIssues(rs)) issues.push({ level: 'warning', text: `Набор правил, правило «${x.rule.name}»: ${x.issues.join('; ')}.` });
  for (const side of sc.sides) {
    if (!side.formations.length) issues.push({ level: 'error', text: `У стороны «${side.name}» нет подразделений.` });
    else if (!sideUnits(side).length) issues.push({ level: 'error', text: `У стороны «${side.name}» все подразделения исключены из боя.` });
    for (const f of sideUnits(side)) issues.push(...validateUnit(f, rs, side.name));
  }
  // Участки: у каждого — силы обеих сторон, иначе боя там не будет.
  const sectors = sc.sectors ?? [];
  if (sectors.length) {
    const ids = new Set(sectors.map((x) => x.id));
    for (const sec of sectors)
      if (sec.startBand && !rs.rangeBands.some((b) => b.id === sec.startBand))
        issues.push({ level: 'warning', text: `Участок «${sec.name}»: начальная дистанция не найдена — как в сценарии.` });
    for (const sd of sc.sides) {
      for (const [, sid] of Object.entries(sd.sectorOf ?? {}))
        if (!ids.has(sid))
          issues.push({ level: 'warning', text: `У стороны «${sd.name}» подразделение назначено на удалённый участок — оно будет на первом.` });
      const used = new Set(nodeSectors(sd, sectors[0].id).values());
      for (const sec of sectors) if (!used.has(sec.id)) issues.push({ level: 'warning', text: `На участке «${sec.name}» нет сил стороны «${sd.name}».` });
    }
  }
  // Огневая поддержка: тип из каталога, единиц и ударов больше нуля.
  for (const sd of sc.sides)
    for (const a of sd.support ?? []) {
      const t = rs.componentTypes.find((x) => x.id === a.typeId);
      if (!t) issues.push({ level: 'error', text: `Огневая поддержка «${a.name}» (${sd.name}): тип не найден в наборе правил.` });
      else if (!Object.values(t.firepower).some((row) => Object.values(row).some((v) => v > 0)))
        issues.push({ level: 'warning', text: `Огневая поддержка «${a.name}» (${sd.name}): у типа «${t.name}» нет огневой мощи.` });
      if (!(a.count > 0) || !(a.missions > 0))
        issues.push({ level: 'warning', text: `Огневая поддержка «${a.name}» (${sd.name}): нужно хотя бы одно средство и один удар.` });
    }
  // План боя: события должны ссылаться на существующие подразделения, приказы и условия.
  const nodes = new Map<string, Set<string>>(sc.sides.map((sd) => [sd.id, new Set<string>()]));
  for (const sd of sc.sides) for (const f of sideUnits(sd)) walkUnits(f, (n) => void nodes.get(sd.id)!.add(n.id));
  const enemyOf = (side?: string) => (side === 'A' ? 'B' : 'A');
  for (const ev of sc.events ?? []) {
    const at = `План боя, ${ev.trigger ? 'по условию' : `ход ${ev.turn}`}: «${EVENT_KIND_LABELS[ev.kind] ?? ev.kind}»`;
    if (ev.turn < 1) issues.push({ level: 'warning', text: `${at} — ход должен быть не меньше 1.` });
    if (ev.turn > scenarioTurns(sc, rs))
      issues.push({ level: 'warning', text: `${at} — позже конца боя (${scenarioTurns(sc, rs)}-й ход — ${fmtDuration(scenarioHours(sc, rs))}), не наступит.` });
    if (ev.trigger) {
      const tr = ev.trigger;
      if (tr.nodeId && !nodes.get(tr.side)?.has(tr.nodeId))
        issues.push({ level: 'warning', text: `${at} — подразделение в условии удалено из сценария или не участвует в бою.` });
      if (tr.metric === 'band' && !rs.rangeBands.some((b) => b.id === tr.value))
        issues.push({ level: 'warning', text: `${at} — дистанция в условии не выбрана.` });
    }
    if (ev.kind === 'strike') {
      const sd = sc.sides.find((x) => x.id === ev.side);
      if (!sd?.support?.some((a) => a.id === ev.assetId)) issues.push({ level: 'warning', text: `${at} — не выбрано средство огневой поддержки стороны.` });
      if (ev.targetNodeId && !nodes.get(enemyOf(ev.side))?.has(ev.targetNodeId))
        issues.push({ level: 'warning', text: `${at} — цель удалена из сценария или не участвует в бою.` });
    }
    if (ev.kind === 'effect') {
      if (!rs.tempEffects?.some((x) => x.id === ev.effectId))
        issues.push({ level: 'warning', text: `${at} — эффект не выбран или отсутствует в наборе правил.` });
      if (ev.nodeId && (!ev.side || !nodes.get(ev.side)?.has(ev.nodeId)))
        issues.push({ level: 'warning', text: `${at} — подразделение удалено из сценария или не участвует в бою.` });
    }
    if (ev.sectorId && !(sc.sectors ?? []).some((x) => x.id === ev.sectorId)) issues.push({ level: 'warning', text: `${at} — участок удалён из сценария.` });
    if (ev.kind === 'transfer' && !ev.sectorId) issues.push({ level: 'warning', text: `${at} — не выбран участок, куда перебрасывать.` });
    if (ev.kind === 'band' && !rs.rangeBands.some((b) => b.id === ev.bandId)) issues.push({ level: 'warning', text: `${at} — дистанция не выбрана.` });
    if (ev.kind === 'resupply' && !ev.ammo && !ev.fuel && !ev.equipment) issues.push({ level: 'warning', text: `${at} — не задано, что и сколько подвезти.` });
    if (ev.kind === 'fortification' && !ev.fortificationId && !ev.intelId)
      issues.push({ level: 'warning', text: `${at} — не выбраны ни укрепления, ни разведданные.` });
    if (ev.kind === 'arrive' || ev.kind === 'order' || ev.kind === 'command' || ev.kind === 'transfer') {
      if (!ev.side || !ev.nodeId || !nodes.get(ev.side)?.has(ev.nodeId))
        issues.push({ level: 'warning', text: `${at} — подразделение не выбрано, удалено из сценария или не участвует в бою; событие не сработает.` });
    }
    if (ev.kind === 'order' && !rs.orders.some((o) => o.id === ev.orderId))
      issues.push({ level: 'warning', text: `${at} — приказ не выбран или отсутствует в наборе правил.` });
    if (
      ev.kind === 'conditions' &&
      !Object.entries(ev.conditions ?? {}).some(([c, o]) => rs.conditions.find((x) => x.id === c)?.options.some((x) => x.id === o))
    )
      issues.push({ level: 'warning', text: `${at} — не выбрано, какие условия меняются.` });
  }
  // Задачи на участке или подразделении: участок и подразделение должны быть в сценарии.
  for (const sd of sc.sides)
    for (const o of sd.objectives ?? []) {
      if (o.sectorId && !(sc.sectors ?? []).some((x) => x.id === o.sectorId))
        issues.push({ level: 'warning', text: `Задача стороны «${sd.name}»: участок удалён — задача считается по всей стороне.` });
      if (o.nodeId) {
        const own = ['hold', 'preserve', 'noRout'].includes(o.type);
        const side = own ? sd.id : enemyOf(sd.id);
        if (!nodes.get(side)?.has(o.nodeId))
          issues.push({
            level: 'warning',
            text: `Задача стороны «${sd.name}»: подразделение удалено из сценария или не участвует в бою — по нему нечего считать.`,
          });
      }
    }
  return issues;
}

/** Участки подразделений стороны: id узла с составом → участок (с наследованием от старших). */
export function nodeSectors(sd: SideDef, fallback: Id): Map<Id, Id> {
  const out = new Map<Id, Id>();
  const walk = (n: UnitNode, sec: Id) => {
    const own = sd.sectorOf?.[n.id] || sec;
    if (n.composition.length) out.set(n.id, own);
    for (const c of n.children) walk(c, own);
  };
  for (const f of sideUnits(sd)) walk(f, fallback);
  return out;
}

// ------------------------------------------------------------------ проверка импортируемых файлов

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Файл, который собирается импортировать ГМ, — после перевода из прежних форматов: всё ли на месте, чтобы
 * программа не споткнулась о него позже, в бою или редакторе. Возвращает ошибки (не больше `limit`).
 */
export function importIssues(kind: 'ruleset' | 'unit' | 'scenario' | 'battle', data: unknown, limit = 5): string[] {
  const out: string[] = [];
  const add = (t: string) => out.length < limit && out.push(t);
  if (!isObj(data)) return ['не объект JSON'];
  if (kind === 'ruleset') {
    const r = data as unknown as Ruleset;
    if (!isStr(r.id)) add('нет id набора правил');
    if (!isStr(r.name)) add('нет названия набора правил');
    for (const key of ['targetClasses', 'rangeBands', 'componentTypes', 'orders', 'experienceLevels'] as const)
      if (!Array.isArray(r[key])) add(`«${key}» — не список`);
    if (out.length) return out;
    const classes = new Set(r.targetClasses.map((c) => c?.id));
    const ids = new Set<Id>();
    r.componentTypes.forEach((t, i) => {
      const at = `тип №${i + 1}${isStr(t?.name) ? ` «${t.name}»` : ''}`;
      if (!isObj(t)) return add(`${at}: не объект`);
      if (!isStr(t.id)) add(`${at}: нет id`);
      else if (ids.has(t.id)) add(`${at}: id «${t.id}» повторяется`);
      ids.add(t.id);
      if (!['personnel', 'weapon', 'vehicle'].includes(t.kind)) add(`${at}: неизвестный вид «${String(t.kind)}»`);
      if (!classes.has(t.targetClass)) add(`${at}: класс цели «${String(t.targetClass)}» не найден в наборе`);
      for (const f of ['crew', 'value', 'protection'] as const) if (!isNum(t[f])) add(`${at}: «${f}» — не число`);
      if (!isObj(t.firepower)) add(`${at}: нет огневой мощи`);
    });
    return out;
  }
  if (kind === 'unit') {
    let n = 0;
    const walk = (u: unknown, path: string) => {
      if (out.length >= limit || ++n > 100000) return;
      if (!isObj(u)) return add(`${path}: не объект`);
      const node = u as unknown as UnitNode;
      const at = isStr(node.name) ? `${path}«${node.name}»` : path || 'подразделение';
      if (!isStr(node.id)) add(`${at}: нет id`);
      if (!isStr(node.name)) add(`${at}: нет названия`);
      if (!Array.isArray(node.composition)) add(`${at}: состав — не список`);
      else
        node.composition.forEach((c, i) => {
          if (!isObj(c) || !isStr(c.typeId) || !isNum(c.current) || !isNum(c.authorized)) add(`${at}: строка состава №${i + 1} неполная`);
        });
      if (!Array.isArray(node.children)) add(`${at}: подчинённые — не список`);
      else for (const ch of node.children) walk(ch, `${at} → `);
    };
    walk(data, '');
    return out;
  }
  if (kind === 'scenario') {
    const sc = data as unknown as Scenario;
    if (!isStr(sc.id)) add('нет id сценария');
    if (!isStr(sc.name)) add('нет названия сценария');
    if (!isStr(sc.rulesetId)) add('не указан набор правил');
    if (!Array.isArray(sc.sides) || sc.sides.length !== 2) add('сторон должно быть две');
    else
      sc.sides.forEach((sd, i) => {
        if (!isObj(sd)) return add(`сторона ${i + 1}: не объект`);
        if (!Array.isArray(sd.formations) && !Array.isArray(sd.units)) add(`сторона «${sd.name ?? i + 1}»: нет подразделений`);
        for (const f of sd.formations ?? []) out.push(...importIssues('unit', f, limit - out.length).map((t) => `сторона «${sd.name}»: ${t}`));
      });
    if (!Array.isArray(sc.events ?? [])) add('план боя — не список');
    return out.slice(0, limit);
  }
  const b = data as Record<string, unknown>;
  if (!isStr(b.id)) add('нет id боя');
  if (!Array.isArray(b.elements)) add('нет списка элементов');
  if (!Array.isArray(b.log)) add('нет журнала');
  if (!isObj(b.ruleset)) add('нет правил боя');
  if (!isObj(b.sides) || !isObj((b.sides as Record<string, unknown>).A) || !isObj((b.sides as Record<string, unknown>).B)) add('нет сторон A и B');
  if (!isNum(b.turn)) add('не указан ход');
  return out;
}

/** Файл записан более новой версией программы (данные или схема новее, чем знает эта версия). */
export function fromNewerVersion(x: unknown, dataVersion: number, schemaVersion: number): boolean {
  if (!isObj(x)) return false;
  return (isNum(x.dataVersion) && x.dataVersion > dataVersion) || (isNum(x.schemaVersion) && x.schemaVersion > schemaVersion);
}
