// Человекочитаемый отчёт о бое — для копирования в чат игры, на форум или в документ.

import { STATUS_LABELS } from './labels';
import type { Battle, EquipmentStats, LogEntry, SideResult, UnitSummary } from './types';

/** Заменяет [[e:ID]], [[f:ID]], [[s:A]] на названия. */
export function resolveRefs(text: string, b: Battle): string {
  return text.replace(/\[\[(e|f|s):([^\]]+)\]\]/g, (_, kind: string, id: string) => {
    if (kind === 'e') return b.elements.find((x) => x.id === id)?.name ?? id;
    if (kind === 'f') return b.formations.find((x) => x.id === id)?.name ?? id;
    const side = b.sides[id as 'A' | 'B'];
    return side ? `«${side.name}»` : id;
  });
}

const n0 = (v: number) => Math.round(v).toLocaleString('ru-RU');
const p0 = (v: number) => `${Math.round(v)}%`;

function equipmentLine(q: EquipmentStats): string {
  const parts: string[] = [];
  if (q.destroyed) parts.push(`уничтожено ${q.destroyed}`);
  if (q.damaged) parts.push(`повреждено ${q.damaged}`);
  if (q.abandoned) parts.push(`брошено ${q.abandoned}`);
  return `${q.name}: ${q.current} из ${q.start} (штат ${q.authorized})${q.losses ? ` — потери ${q.losses} (${p0(q.lossPct)}): ${parts.join(', ')}` : ' — без потерь'}`;
}

function unitBlock(u: UnitSummary, indent = ''): string[] {
  const p = u.personnel;
  const lines = [
    `${indent}Личный состав: ${n0(p.current)} из ${n0(p.start)} (штат ${n0(p.authorized)}) — потери ${n0(p.losses)} (${p0(p.lossPct)}): убито ${n0(p.kia)}, ранено ${n0(p.wia)}, пропало без вести ${n0(p.mia)}`,
  ];
  for (const q of u.equipment) lines.push(`${indent}${equipmentLine(q)}`);
  lines.push(
    `${indent}Остаточная боеспособность: ${p0(u.combatEffectiveness)} (боевая ценность ${p0(u.strength)}) · Организация: ${p0(u.organization)} · Мораль: ${Math.round(u.morale)}`,
    `${indent}Снабжение: боезапас ${p0(u.supply.ammo)}, топливо ${p0(u.supply.fuel)}, снаряжение ${p0(u.supply.equipment)}`,
  );
  const st = u.status;
  const statusParts = [
    st.active ? `в бою ${st.active}` : '',
    st.retreating ? `отходят ${st.retreating}` : '',
    st.routing ? `бегут ${st.routing}` : '',
    st.withdrawn ? `${STATUS_LABELS.withdrawn.toLowerCase()} ${st.withdrawn}` : '',
    st.routed ? `${STATUS_LABELS.routed.toLowerCase()} ${st.routed}` : '',
    st.destroyed ? `${STATUS_LABELS.destroyed.toLowerCase()} ${st.destroyed}` : '',
  ].filter(Boolean);
  lines.push(`${indent}Элементы: ${statusParts.join(', ')}`);
  return lines;
}

function sideBlock(r: SideResult): string[] {
  const lines = [`## ${r.name} — выполнение задач ${p0(r.score * 100)}`];
  lines.push(...unitBlock(r));
  lines.push('Задачи:');
  for (const o of r.objectives) lines.push(`  • ${o.label} — ${p0(o.score * 100)}. ${o.explanation}`);
  if (r.formations.length > 1 || r.formations.some((f) => f.depth > 0)) {
    lines.push('По формированиям:');
    for (const f of r.formations) {
      const ind = '  '.repeat(f.depth + 1);
      lines.push(`${ind}▸ ${f.name}`);
      lines.push(...unitBlock(f, ind + '  '));
    }
  }
  return lines;
}

export function formatReport(b: Battle, opts: { includeLog?: boolean; logLevel?: 0 | 1 | 2 } = {}): string {
  const r = b.result;
  const lines: string[] = [];
  lines.push(`# ${b.name}`);
  const cond = b.ruleset.conditions.map((c) => `${c.name}: ${c.options.find((o) => o.id === b.conditions[c.id])?.name ?? '—'}`).join(' · ');
  lines.push(`${cond}. Ходов: ${b.turn} (≈${Math.round((b.turn * b.ruleset.turnMinutes) / 6) / 10} ч).`);
  if (r) {
    lines.push('', `ИТОГ: ${r.headline}. ${r.endReason}.`, `Оценка выполнения задач: ${b.sides.A.name} ${p0(r.sides.A.score * 100)} / ${b.sides.B.name} ${p0(r.sides.B.score * 100)}.`);
    for (const side of ['A', 'B'] as const) lines.push('', ...sideBlock(r.sides[side]));
    if (r.keyEvents.length) {
      lines.push('', '## Ключевые события');
      for (const ev of r.keyEvents.slice(0, 40)) lines.push(`  ${resolveRefs(ev, b)}`);
    }
  } else {
    lines.push('', `Бой продолжается (ход ${b.turn}).`);
  }
  if (opts.includeLog) {
    lines.push('', '## Журнал');
    lines.push(...formatLog(b, b.log, opts.logLevel ?? 1));
  }
  return lines.join('\n');
}

export function formatLog(b: Battle, log: LogEntry[], level: 0 | 1 | 2 = 1, withFactors = false): string[] {
  const out: string[] = [];
  for (const x of log) {
    if (x.level > level) continue;
    out.push(`[${x.turn}] ${resolveRefs(x.text, b)}`);
    if (withFactors && x.factors) for (const f of x.factors) out.push(`      ${f.label}: ${formatFactor(f.value, f.kind)}`);
  }
  return out;
}

export function formatFactor(value: number, kind: 'mult' | 'add' | 'base' | 'chance'): string {
  if (kind === 'mult') return `×${value.toFixed(2)}`;
  if (kind === 'chance') return `${Math.round(value * 100)}%`;
  if (kind === 'add') return `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}`;
  return `${Number(value.toFixed(3))}`;
}
