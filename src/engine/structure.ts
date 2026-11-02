// Состав подразделения для печати и выгрузки: структура, штат и в строю по типам, состояние.
// Шаблон — только устройство и штат; силы — ещё в строю, раненые и техника в ремонте, состояние.

import { KIND_LABELS } from './labels';
import type { Ruleset, StateKey, UnitNode } from './types';
import { STATE_KEYS } from './types';
import { resolveTree, STATE_LABELS, summarizeUnits, walkUnits } from './units';

const PERCENT = new Set<StateKey>(['ammo', 'fuel', 'equipment']);

/** Значение показателя состояния: опыт — уровнем, запасы — в процентах. */
function stateText(rs: Ruleset, k: StateKey, v: number): string {
  if (k === 'experience') return rs.experienceLevels[Math.round(v) - 1]?.name ?? String(v);
  return `${Math.round(v)}${PERCENT.has(k) ? '%' : ''}`;
}

/** Что задано у самого узла (а не унаследовано): приказ, атака и защита, «стоять насмерть», своё состояние. */
function ownParams(n: UnitNode, rs: Ruleset, template: boolean): string[] {
  const out: string[] = [];
  if (n.isHQ) out.push('штаб');
  if ((n.attackMod ?? 100) !== 100) out.push(`атака ${n.attackMod}%`);
  if ((n.defenseMod ?? 100) !== 100) out.push(`защита ${n.defenseMod}%`);
  if (template) return out;
  if (n.order) out.push(`приказ «${rs.orders.find((o) => o.id === n.order)?.name ?? n.order}»`);
  if (n.holdFast) out.push('стоять насмерть');
  for (const k of STATE_KEYS) if (n.state[k] !== undefined) out.push(`${STATE_LABELS[k].toLowerCase()} ${stateText(rs, k, n.state[k]!)}`);
  return out;
}

/**
 * Состав текстом: шапка (численность, техника, состояние), затем дерево — по строке на подразделение и
 * строка состава под ним. template — только штат.
 */
export function formatStructure(root: UnitNode, rs: Ruleset, opts: { template?: boolean; templateName?: string } = {}): string {
  const tpl = !!opts.template;
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const sum = summarizeUnits([root], rs);
  const lines: string[] = [root.name];
  lines.push(
    [
      tpl ? 'Шаблон' : 'Силы',
      `набор правил «${rs.name}»`,
      !tpl && opts.templateName ? `по шаблону «${opts.templateName}»` : '',
      !tpl && root.faction ? `команда «${root.faction}»` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  lines.push(
    tpl
      ? `Личный состав по штату: ${sum.persAuth}`
      : `Личный состав: ${sum.persCur} из ${sum.persAuth} по штату${sum.recoverable ? ` (ранено и в ремонте: ${sum.recoverable})` : ''}`,
  );
  if (sum.equip.length)
    lines.push(`Техника и вооружение: ${sum.equip.map((e) => (tpl ? `${e.name} ${e.auth}` : `${e.name} ${e.cur} из ${e.auth}`)).join(', ')}`);
  if (!tpl) {
    const r = resolveTree(root).get(root.id)!;
    lines.push(`Состояние: ${STATE_KEYS.map((k) => `${STATE_LABELS[k].toLowerCase()} ${stateText(rs, k, r.state[k])}`).join(', ')}`);
  }
  lines.push('', 'Структура');
  walkUnits(root, (n, _p, depth) => {
    const pad = '    '.repeat(depth);
    const own = ownParams(n, rs, tpl);
    lines.push(`${pad}${n.name}${own.length ? ` (${own.join(', ')})` : ''}`);
    if (n.composition.length)
      lines.push(
        `${pad}  · ${n.composition
          .map((c) => {
            const name = types.get(c.typeId)?.name ?? c.typeId;
            if (tpl) return `${name} ${c.authorized}`;
            return `${name} ${c.current} из ${c.authorized}${c.recoverable ? ` (+${c.recoverable} вне строя)` : ''}`;
          })
          .join(', ')}`,
      );
  });
  if (!tpl && root.notes?.trim()) lines.push('', 'Заметки', root.notes.trim());
  return lines.join('\n');
}

/**
 * Состав таблицей: строка на тип в составе каждого подразделения (подразделение без своего состава —
 * одна строка без типа). У сил — в строю, вне строя и состояние (с учётом унаследованного).
 */
export function structureRows(root: UnitNode, rs: Ruleset, opts: { template?: boolean } = {}): string[][] {
  const tpl = !!opts.template;
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  const res = tpl ? null : resolveTree(root);
  const head = ['Уровень', 'Подразделение', 'Старшее', 'Штаб', 'Атака, %', 'Защита, %', 'Тип', 'Вид', 'Штат'];
  if (!tpl) head.push('В строю', 'Вне строя', ...STATE_KEYS.map((k) => STATE_LABELS[k]));
  const rows: string[][] = [head];
  walkUnits(root, (n, p, depth) => {
    const base = [String(depth + 1), n.name, p?.name ?? '', n.isHQ ? 'да' : '', String(n.attackMod ?? 100), String(n.defenseMod ?? 100)];
    const state = res
      ? STATE_KEYS.map((k) => (k === 'experience' ? stateText(rs, k, res.get(n.id)!.state[k]) : String(Math.round(res.get(n.id)!.state[k]))))
      : [];
    if (!n.composition.length) {
      rows.push([...base, '', '', '', ...(tpl ? [] : ['', '', ...state])]);
      return;
    }
    for (const c of n.composition) {
      const t = types.get(c.typeId);
      rows.push([
        ...base,
        t?.name ?? c.typeId,
        t ? KIND_LABELS[t.kind] : '',
        String(c.authorized),
        ...(tpl ? [] : [String(c.current), String(c.recoverable ?? 0), ...state]),
      ]);
    }
  });
  return rows;
}

/** CSV для таблиц (Excel): разделитель «;», текст в кавычках, BOM для кириллицы. */
export function toCsvText(rows: string[][]): string {
  const q = (v: string) => (/^-?\d+(?:[.,]\d+)?$/.test(v) ? v : `"${v.replace(/"/g, '""')}"`);
  return `﻿${rows.map((r) => r.map(q).join(';')).join('\n')}`;
}
