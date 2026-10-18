// Журнал боя: фильтры, группировка по ходам, раскрываемые факторы («почему так вышло»).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { displayNames, formatFactor, type Battle, type LogEntry, type Phase } from '../../engine';
import { useTabState } from '../hooks';
import { ensureFullLog } from '../store';
import { pressable, Seg } from './ui';

const PHASES: { id: Phase; label: string; icon: string }[] = [
  { id: 'detection', label: 'Обнаружение', icon: '◉' },
  { id: 'initiative', label: 'Инициатива', icon: '⚑' },
  { id: 'fire', label: 'Огонь', icon: '✹' },
  { id: 'losses', label: 'Потери', icon: '✚' },
  { id: 'movement', label: 'Движение', icon: '➜' },
  { id: 'fatigue', label: 'Усталость', icon: '≈' },
  { id: 'morale', label: 'Мораль', icon: '♥' },
  { id: 'checks', label: 'Проверки', icon: '!' },
  { id: 'gm', label: 'ГМ', icon: '✎' },
];
const ICON: Partial<Record<Phase, string>> = Object.fromEntries(PHASES.map((p) => [p.id, p.icon]));
ICON.setup = '•';
ICON.turn = '⏱';
ICON.end = '■';
ICON.supply = '⛽';

export function RichText({ text, b, onElement }: { text: string; b: Battle; onElement?: (id: string) => void }) {
  const parts = text.split(/(\[\[[efs]:[^\]]+\]\])/g);
  const names = displayNames(b);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[\[([efs]):([^\]]+)\]\]$/.exec(p);
        if (!m) return <Fragment key={i}>{p}</Fragment>;
        const [, kind, id] = m;
        if (kind === 'e') {
          const el = b.elements.find((x) => x.id === id);
          if (!el) return <Fragment key={i}>{id}</Fragment>;
          return (
            <a
              key={i}
              href="#"
              style={{ color: b.sides[el.side].color }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onElement?.(id);
              }}
            >
              {names.el.get(id) ?? el.name}
            </a>
          );
        }
        if (kind === 'f') return <b key={i}>{names.f.get(id) ?? id}</b>;
        const side = b.sides[id as 'A' | 'B'];
        return (
          <b key={i} style={{ color: side?.color }}>
            «{side?.name ?? id}»
          </b>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ сводка по формированиям

/** Сколько записей о потерях и морали за ход ещё читаются по одной; больше — сводка по формированиям. */
const SUMMARY_FROM = 12;

interface Summary {
  key: string;
  fid: string;
  side?: 'A' | 'B';
  entries: { e: LogEntry; i: number }[];
  pers: number;
  kia: number;
  wia: number;
  mia: number;
  equip: Map<string, number>;
  down: number;
  up: number;
  minMorale: number;
}

type Item = { kind: 'entry'; e: LogEntry; i: number } | { kind: 'sum'; s: Summary };

/**
 * Формирование, по которому сводятся записи элемента: самый глубокий уровень, на котором у каждой
 * стороны не больше 10 формирований (для дивизии — батальоны или полки).
 */
function groupOf(b: Battle): Map<string, string> {
  const parent = new Map(b.formations.map((f) => [f.id, f.parentId]));
  const chain = (fid: string) => {
    const out: string[] = [];
    for (let f: string | null | undefined = fid; f; f = parent.get(f)) out.unshift(f);
    return out; // от корня к элементу
  };
  const chains = new Map(b.elements.map((el) => [el.id, chain(el.formationId)]));
  let depth = 0;
  for (let d = 0; d < 8; d++) {
    const per = { A: new Set<string>(), B: new Set<string>() };
    for (const el of b.elements) per[el.side].add(chains.get(el.id)![Math.min(d, chains.get(el.id)!.length - 1)]);
    if (per.A.size > 10 || per.B.size > 10) break;
    depth = d;
  }
  return new Map(b.elements.map((el) => [el.id, chains.get(el.id)![Math.min(depth, chains.get(el.id)!.length - 1)]]));
}

/** Записи одного хода: потери и мораль — сводкой по формированиям, остальное — как есть. */
function summarize(items: { e: LogEntry; i: number }[], groups: Map<string, string>): Item[] {
  const out: Item[] = [];
  let turn: { e: LogEntry; i: number }[] = [];
  const flush = () => {
    const pooled = turn.filter(({ e }) => e.level >= 1 && e.data && (e.phase === 'losses' || e.phase === 'morale'));
    if (pooled.length <= SUMMARY_FROM) {
      for (const x of turn) out.push({ kind: 'entry', ...x });
    } else {
      const sums = new Map<string, Summary>();
      let placed = false;
      for (const x of turn) {
        if (!pooled.includes(x)) {
          out.push({ kind: 'entry', ...x });
          continue;
        }
        const fid = groups.get(x.e.refs?.[0] ?? '') ?? '?';
        let s = sums.get(fid);
        if (!s) {
          s = {
            key: `${x.e.turn}:${fid}`,
            fid,
            side: x.e.side,
            entries: [],
            pers: 0,
            kia: 0,
            wia: 0,
            mia: 0,
            equip: new Map(),
            down: 0,
            up: 0,
            minMorale: 100,
          };
          sums.set(fid, s);
        }
        s.entries.push(x);
        const d = x.e.data!;
        if (x.e.phase === 'losses') {
          s.pers += d.pers ?? 0;
          s.kia += d.kia ?? 0;
          s.wia += d.wia ?? 0;
          s.mia += d.mia ?? 0;
          for (const [id, n] of Object.entries(d.equip ?? {})) s.equip.set(id, (s.equip.get(id) ?? 0) + n);
        } else if (d.morale) {
          if (d.morale[1] < d.morale[0]) s.down++;
          else s.up++;
          s.minMorale = Math.min(s.minMorale, d.morale[1]);
        }
        if (!placed) {
          placed = true;
          out.push({ kind: 'sum', s }); // место первой такой записи; остальные сводки — следом
        }
      }
      // Все сводки хода — подряд, на месте первой: сначала одна сторона, потом другая.
      const first = out.findIndex((x) => x.kind === 'sum' && x.s === [...sums.values()][0]);
      const all = [...sums.values()].sort((a, b) => (a.side ?? '').localeCompare(b.side ?? ''));
      out.splice(first, 1, ...all.map((s) => ({ kind: 'sum' as const, s })));
    }
    turn = [];
  };
  for (const x of items) {
    if (x.e.phase === 'turn') {
      flush();
      out.push({ kind: 'entry', ...x });
    } else turn.push(x);
  }
  flush();
  return out;
}

function SummaryRow({ s, b, open, onToggle, onElement }: { s: Summary; b: Battle; open: boolean; onToggle: () => void; onElement?: (id: string) => void }) {
  const names = displayNames(b);
  const typeName = (id: string) => b.ruleset.componentTypes.find((t) => t.id === id)?.name ?? id;
  const kinds = [s.kia && `убито ${s.kia}`, s.wia && `ранено ${s.wia}`, s.mia && `пропало ${s.mia}`].filter(Boolean).join(', ');
  const parts: string[] = [];
  if (s.pers) parts.push(`потери ${s.pers} чел.${kinds ? ` (${kinds})` : ''}`);
  if (s.equip.size) parts.push(`техника: ${[...s.equip].map(([id, n]) => `${typeName(id)} −${n}`).join(', ')}`);
  if (s.down || s.up)
    parts.push(
      `мораль ${s.down ? `↓ у ${s.down}` : ''}${s.down && s.up ? ', ' : ''}${s.up ? `↑ у ${s.up}` : ''}${s.down ? ` (ниже всего ${s.minMorale})` : ''}`,
    );
  const color = s.side ? b.sides[s.side].color : undefined;
  return (
    <>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: роль button и фокус — из pressable() */}
      <div
        className={`log-entry log-sum sev-${s.pers || s.equip.size || s.down ? 'bad' : 'info'}`}
        onClick={onToggle}
        title={open ? 'Свернуть' : 'Показать записи по отдельности'}
        {...pressable(onToggle)}
        aria-expanded={open}
      >
        <span className="ph">{open ? '▾' : '▸'}</span>
        <span>
          <b style={{ color }}>{names.f.get(s.fid) ?? s.fid}</b>: {parts.join(' · ')} <span className="faint small">— записей: {s.entries.length}</span>
        </span>
      </div>
      {open &&
        s.entries.map(({ e, i }) => (
          <div key={i} className={`log-entry log-sub sev-${e.severity} lvl${e.level}`}>
            <span className="ph">{ICON[e.phase] ?? '·'}</span>
            <span>
              <RichText text={e.text} b={b} onElement={onElement} />
            </span>
          </div>
        ))}
    </>
  );
}

/** Потери сторон за ход — справа в заголовке хода. */
function TurnLosses({ b, turn }: { b: Battle; turn: number }) {
  const cur = b.history.find((h) => h.turn === turn);
  const prev = b.history.find((h) => h.turn === turn - 1);
  if (!cur || !prev) return null;
  const sides = (['A', 'B'] as const).map((s) => ({
    s,
    p: Math.max(0, prev.sides[s].personnel - cur.sides[s].personnel),
    v: Math.max(0, prev.sides[s].vehicles - cur.sides[s].vehicles),
  }));
  if (sides.every((x) => !x.p && !x.v)) return null;
  const tip = `Потери за ход:\n${sides.map((x) => `${b.sides[x.s].name}: ${x.p} чел.${x.v ? `, техника ${x.v}` : ''}`).join('\n')}`;
  return (
    <span className="turn-loss" data-tip={tip}>
      {sides.map((x) => (
        <span key={x.s} style={{ color: b.sides[x.s].color, opacity: x.p || x.v ? 1 : 0.45 }}>
          {x.p ? `−${x.p}` : '0'}
          {x.v ? <small> / {x.v} ед.</small> : null}
        </span>
      ))}
    </span>
  );
}

function Factors({ e }: { e: LogEntry }) {
  return (
    <div className="factors">
      {e.factors!.map((f, i) => {
        const dir =
          f.kind === 'mult'
            ? f.value > 1.0001
              ? 'up'
              : f.value < 0.9999
                ? 'down'
                : ''
            : f.kind === 'add'
              ? f.value > 0
                ? 'up'
                : f.value < 0
                  ? 'down'
                  : ''
              : '';
        return (
          <Fragment key={i}>
            <span>{f.label}</span>
            <span className={`fv ${dir}`}>{formatFactor(f.value, f.kind)}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function LogView(props: {
  b: Battle;
  tabKey: string;
  defaultLevel: 0 | 1 | 2;
  focus?: string | null;
  onElement?: (id: string) => void;
  onClearFocus?: () => void;
  rev?: number;
}) {
  const { b } = props;
  const [level, setLevel] = useTabState<0 | 1 | 2>(`${props.tabKey}:logLevel`, props.defaultLevel);
  const [side, setSide] = useTabState<'all' | 'A' | 'B'>(`${props.tabKey}:logSide`, 'all');
  const [phases, setPhases] = useTabState<Phase[]>(`${props.tabKey}:logPhases`, []);
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useTabState(`${props.tabKey}:logFilters`, false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(1500);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    const names = displayNames(b);
    for (const el of b.elements) m.set(`e:${el.id}`, names.el.get(el.id) ?? el.name);
    for (const f of b.formations) m.set(`f:${f.id}`, names.f.get(f.id) ?? f.name);
    m.set('s:A', b.sides.A.name);
    m.set('s:B', b.sides.B.name);
    return m;
  }, [b]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: бой меняется на месте: пересчёт по длине журнала и ревизии боя
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out: { e: LogEntry; i: number }[] = [];
    b.log.forEach((e, i) => {
      if (e.level > level && e.phase !== 'turn') return;
      if (side !== 'all' && e.side && e.side !== side) return;
      if (phases.length && e.phase !== 'turn' && !phases.includes(e.phase)) return;
      if (props.focus && e.phase !== 'turn' && !e.refs?.includes(props.focus)) return;
      if (ql) {
        if (e.phase === 'turn') return;
        const plain = e.text.replace(/\[\[([efs]:[^\]]+)\]\]/g, (_, k) => nameOf.get(k) ?? '').toLowerCase();
        if (!plain.includes(ql)) return;
      }
      out.push({ e, i });
    });
    // убираем заголовки ходов без содержимого
    return out.filter((x, k) => x.e.phase !== 'turn' || (out[k + 1] && out[k + 1].e.phase !== 'turn'));
  }, [b, b.log.length, level, side, phases, q, props.focus, nameOf, props.rev]);

  const shown = filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
  // В обычном режиме большого боя потери и мораль за ход сводятся по формированиям.
  const groups = useMemo(() => groupOf(b), [b, b.elements.length]);
  const summarizing = level === 1 && !q.trim() && !phases.length && !props.focus;
  const items: Item[] = useMemo(
    () => (summarizing ? summarize(shown, groups) : shown.map((x) => ({ kind: 'entry' as const, ...x }))),
    [shown, summarizing, groups],
  );
  const [openSums, setOpenSums] = useState<Set<string>>(new Set());

  // Сохранённый бой хранится без подробностей: при запросе «Всё» они восстанавливаются повтором боя.
  const [restoring, setRestoring] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restoring в зависимостях перезапускал бы эффект и отменял собственный таймер
  useEffect(() => {
    if (level < 2 || !b.logTrimmed || restoring) return;
    setRestoring(true);
    const t = setTimeout(() => {
      if (!ensureFullLog(b)) setLevel(1);
      setRestoring(false);
    }, 30);
    return () => clearTimeout(t);
  }, [level, b, b.logTrimmed]);
  const openEntry = (e: LogEntry, i: number) => {
    if (!e.factors && !e.hadFactors) return;
    const n = new Set(open);
    if (n.has(i)) {
      n.delete(i);
      return setOpen(n);
    }
    if (!e.factors) {
      // Разбор не сохранён на диск — восстановить журнал и раскрыть ту же запись.
      const key = `${e.turn}|${e.phase}|${e.text}`;
      if (!ensureFullLog(b)) return;
      const j = b.log.findIndex((x) => x.level <= 1 && `${x.turn}|${x.phase}|${x.text}` === key);
      if (j >= 0) setOpen(new Set([...n, j]));
      return;
    }
    n.add(i);
    setOpen(n);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка к концу журнала при новых записях
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [b.log.length, filtered.length]);

  const filtersActive = side !== 'all' || phases.length > 0 || !!q;
  return (
    <>
      <div className="log-head">
        <h3 className="grow">Журнал</h3>
        <Seg
          value={String(level) as '0' | '1' | '2'}
          onChange={(v) => setLevel(Number(v) as 0 | 1 | 2)}
          options={[
            { value: '0', label: 'Главное', title: 'Только важнейшие события' },
            { value: '1', label: 'Обычно', title: 'Потери, мораль, проверки' },
            { value: '2', label: 'Всё', title: 'Всё, включая огонь каждого элемента и обнаружение' },
          ]}
        />
        <button
          type="button"
          className={`btn sm${showFilters || filtersActive ? ' active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          title="Фильтры по стороне, фазе и тексту"
        >
          Фильтр{filtersActive ? ' •' : ''}
        </button>
      </div>
      {(showFilters || props.focus) && (
        <div className="log-filters">
          {showFilters && (
            <>
              <Seg
                value={side}
                onChange={setSide}
                options={[
                  { value: 'all', label: 'Обе стороны' },
                  { value: 'A', label: b.sides.A.name },
                  { value: 'B', label: b.sides.B.name },
                ]}
              />
              <input type="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 90 }} />
              <div className="row" style={{ gap: 3, width: '100%' }}>
                {PHASES.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`chip${phases.includes(p.id) ? ' accent' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPhases(phases.includes(p.id) ? phases.filter((x) => x !== p.id) : [...phases, p.id])}
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
                {filtersActive && (
                  <a
                    href="#"
                    className="small"
                    onClick={(e) => {
                      e.preventDefault();
                      setSide('all');
                      setPhases([]);
                      setQ('');
                    }}
                  >
                    сбросить
                  </a>
                )}
              </div>
            </>
          )}
          {props.focus && (
            <button type="button" className="chip accent" style={{ cursor: 'pointer' }} onClick={props.onClearFocus} title="Снять фильтр по элементу">
              только: {b.elements.find((x) => x.id === props.focus)?.name} ×
            </button>
          )}
        </div>
      )}
      <div
        className="log-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {filtered.length > shown.length && (
          <div className="center" style={{ padding: 8 }}>
            <button type="button" className="btn sm" onClick={() => setLimit(limit + 2000)}>
              Показать более ранние записи ({filtered.length - shown.length})
            </button>
          </div>
        )}
        {items.map((it) => {
          if (it.kind === 'sum')
            return (
              <SummaryRow
                key={`s:${it.s.key}`}
                s={it.s}
                b={b}
                open={openSums.has(it.s.key)}
                onElement={props.onElement}
                onToggle={() => {
                  const n = new Set(openSums);
                  if (n.has(it.s.key)) n.delete(it.s.key);
                  else n.add(it.s.key);
                  setOpenSums(n);
                }}
              />
            );
          const { e, i } = it;
          return e.phase === 'turn' ? (
            <div key={i} className="log-turn">
              <span className="grow">{e.text}</span>
              <TurnLosses b={b} turn={e.turn} />
            </div>
          ) : (
            <div
              key={i}
              className={`log-entry sev-${e.severity} lvl${e.level} ph-${e.phase}${e.factors || e.hadFactors ? ' has-f' : ''}`}
              onClick={() => openEntry(e, i)}
              title={e.factors || e.hadFactors ? 'Нажмите, чтобы увидеть расчёт' : undefined}
              {...(e.factors || e.hadFactors ? { ...pressable(() => openEntry(e, i)), 'aria-expanded': open.has(i) } : {})}
            >
              <span className="ph">{ICON[e.phase] ?? '·'}</span>
              <span>
                <RichText text={e.text} b={b} onElement={props.onElement} />
                {(e.factors || e.hadFactors) && !open.has(i) && <span className="fx-hint"> ⓘ</span>}
              </span>
              {open.has(i) && e.factors && <Factors e={e} />}
            </div>
          );
        })}
        {restoring && <div className="empty">Восстанавливаю подробный журнал…</div>}
        {!shown.length && !restoring && <div className="empty">Записей нет. Сделайте ход или ослабьте фильтры.</div>}
      </div>
    </>
  );
}
