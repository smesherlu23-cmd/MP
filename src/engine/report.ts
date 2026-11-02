// Человекочитаемый отчёт о бое — для копирования в чат игры, на форум или в документ.

import { fmtDuration } from './duration';
import { dec, STATUS_LABELS } from './labels';
import { explainResult } from './outcome';
import { displayNames } from './names';
import { Rng } from './rng';
import type { Battle, EquipmentStats, LogEntry, SideId, SideResult, UnitSummary } from './types';

/** Заменяет [[e:ID]], [[f:ID]], [[s:A]] на названия. */
export function resolveRefs(text: string, b: Battle): string {
  const names = displayNames(b);
  return text.replace(/\[\[(e|f|s):([^\]]+)\]\]/g, (_, kind: string, id: string) => {
    if (kind === 'e') return names.el.get(id) ?? id;
    if (kind === 'f') return names.f.get(id) ?? id;
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
    st.pending ? `не подошли ${st.pending}` : '',
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
      lines.push(...unitBlock(f, `${ind}  `));
    }
  }
  return lines;
}

export function formatReport(b: Battle, opts: { includeLog?: boolean; logLevel?: 0 | 1 | 2 } = {}): string {
  const r = b.result;
  const lines: string[] = [];
  lines.push(`# ${b.name}`);
  const cond = b.ruleset.conditions.map((c) => `${c.name}: ${c.options.find((o) => o.id === b.conditions[c.id])?.name ?? '—'}`).join(' · ');
  lines.push(`${cond}. Длительность: ${fmtDuration((b.turn * b.ruleset.turnMinutes) / 60)} (${b.turn} ход.).`);
  if (r) {
    lines.push(
      '',
      `ИТОГ: ${r.headline}. ${r.endReason}.`,
      explainResult(r),
      `Оценка выполнения задач: ${b.sides.A.name} ${p0(r.sides.A.score * 100)} / ${b.sides.B.name} ${p0(r.sides.B.score * 100)}.`,
    );
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

// ------------------------------------------------------------------ донесение для стороны (туман войны)

/** Число «по-человечески»: мелкие — точно, крупные — до 5, 10, 50. */
function nice(v: number): number {
  const a = Math.max(0, v);
  if (a < 20) return Math.round(a);
  if (a < 100) return Math.round(a / 5) * 5;
  if (a < 1000) return Math.round(a / 10) * 10;
  return Math.round(a / 50) * 50;
}

/**
 * Насколько точно сторона знает о противнике: 0.1 (полные разведданные, противник на виду) …
 * 0.9 (разведданных нет, противника почти не видели). Уровни разведданных идут от худшего к лучшему.
 */
export function intelError(b: Battle, side: SideId, spottedPct: number): number {
  const levels = b.ruleset.intelLevels;
  const idx = Math.max(
    0,
    levels.findIndex((x) => x.id === b.sides[side].intel),
  );
  const q = levels.length > 1 ? idx / (levels.length - 1) : 0.5;
  const base = 0.45 - 0.35 * q;
  return Math.min(0.9, base * (1 + (1 - Math.min(100, spottedPct) / 100)));
}

/**
 * Донесение для игроков одной стороны: свои силы, потери и задачи — точно; противник — оценкой
 * (диапазон тем шире, чем хуже разведданные и чем меньше противника видели). Решений ГМ и чужих
 * событий в донесении нет. Оценки устойчивы: одно и то же донесение при каждом копировании.
 */
export function formatSideReport(b: Battle, side: SideId): string {
  const r = b.result;
  const own = r?.sides[side];
  const foeId: SideId = side === 'A' ? 'B' : 'A';
  const foe = r?.sides[foeId];
  const lines: string[] = [];
  lines.push(`# ${b.name} — донесение для стороны «${b.sides[side].name}»`);
  const cond = b.ruleset.conditions.map((c) => `${c.name}: ${c.options.find((o) => o.id === b.conditions[c.id])?.name ?? '—'}`).join(' · ');
  lines.push(`${cond}. Длительность: ${fmtDuration((b.turn * b.ruleset.turnMinutes) / 60)} (${b.turn} ход.).`);
  if (!r || !own || !foe) {
    lines.push('', `Бой продолжается (ход ${b.turn}).`);
    return lines.join('\n');
  }
  lines.push('', `ИТОГ: ${r.headline}.`);

  lines.push('', `## Наши силы — выполнение задач ${p0(own.score * 100)}`);
  lines.push(...unitBlock(own));
  if (own.objectives.length) {
    lines.push('Задачи:');
    // Точные потери противника своей стороне неизвестны — у задачи «нанести потери» только оценка выполнения.
    for (const o of own.objectives) lines.push(`  • ${o.label} — ${p0(o.score * 100)}.${o.objective.type === 'inflict' ? '' : ` ${o.explanation}`}`);
  }
  const top = own.formations.filter((f) => f.depth === 1 && f.personnel.start > 0);
  if (top.length) {
    lines.push('По подразделениям:');
    for (const f of top)
      lines.push(
        `  ▸ ${f.name}: ${n0(f.personnel.current)} из ${n0(f.personnel.start)} чел., потери ${n0(f.personnel.losses)} (убито ${n0(f.personnel.kia)}, ранено ${n0(f.personnel.wia)}, пропало ${n0(f.personnel.mia)})`,
      );
  }

  // Противник — оценкой
  const err = intelError(b, side, own.enemySpottedPct);
  const rng = Rng.fromSeed(`${b.seed}:донесение:${side}`);
  const range = (v: number) => {
    const c = v * (1 + (rng.next() * 2 - 1) * err * 0.5);
    const lo = nice(c * (1 - err));
    const hi = Math.max(lo, nice(c * (1 + err)));
    return lo === hi ? `около ${lo}` : `${lo}–${hi}`;
  };
  lines.push('', `## Противник — «${b.sides[foeId].name}» (оценка)`);
  if (own.enemySpottedPct < 10) {
    lines.push('Сведений почти нет: противника почти не видели, его силы и потери неизвестны.');
  } else {
    lines.push(`Видели примерно ${p0(Math.round(own.enemySpottedPct / 10) * 10)} сил противника; точность оценок — ±${p0(err * 100)}.`);
    lines.push(`Силы в начале боя: ${range(foe.personnel.start)} чел.`);
    lines.push(`Потери: ${range(foe.personnel.losses)} чел.`);
    const seen = b.elements.filter((x) => x.side === foeId && x.everSpotted);
    const byType = new Map<string, number>();
    for (const el of seen)
      for (const c of el.comps) {
        const t = b.ruleset.componentTypes.find((x) => x.id === c.typeId);
        if (!t || t.kind === 'personnel') continue;
        const lost = c.destroyed + c.damaged + c.abandoned;
        if (lost > 0) byType.set(t.name, (byType.get(t.name) ?? 0) + lost);
      }
    for (const [name, n] of byType) lines.push(`${name}: выведено из строя ${range(n)}.`);
    const state =
      foe.status.routed + foe.status.routing > foe.status.active
        ? 'большей частью бежал'
        : foe.status.withdrawn + foe.status.retreating > foe.status.active
          ? 'большей частью отошёл'
          : 'сохранил порядок';
    lines.push(`Состояние к концу боя: ${state}.`);
  }

  // Свои события и обстановка — без решений ГМ и без того, что видно только противнику
  const events = b.log.filter(
    (x) =>
      x.level === 0 &&
      x.phase !== 'turn' &&
      x.phase !== 'setup' &&
      x.phase !== 'end' &&
      x.phase !== 'gm' &&
      (x.side === side || (!x.side && x.phase === 'plan')),
  );
  if (events.length) {
    lines.push('', '## Ключевые события');
    for (const ev of events.slice(0, 40)) lines.push(`  Ход ${ev.turn}: ${resolveRefs(ev.text, b)}`);
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
  if (kind === 'mult') return `×${dec(value, 2)}`;
  if (kind === 'chance') return `${Math.round(value * 100)}%`;
  if (kind === 'add') return `${value > 0 ? '+' : ''}${String(Number(value.toFixed(2))).replace('.', ',')}`;
  return String(Number(value.toFixed(3))).replace('.', ',');
}
