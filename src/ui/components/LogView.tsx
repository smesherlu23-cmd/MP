// Журнал боя: фильтры, группировка по ходам, раскрываемые факторы («почему так вышло»).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatFactor, type Battle, type LogEntry, type Phase } from '../../engine';
import { useTabState } from '../hooks';
import { Seg } from './ui';

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
              {el.name}
            </a>
          );
        }
        if (kind === 'f') return <b key={i}>{b.formations.find((x) => x.id === id)?.name ?? id}</b>;
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

function Factors({ e }: { e: LogEntry }) {
  return (
    <div className="factors">
      {e.factors!.map((f, i) => {
        const dir = f.kind === 'mult' ? (f.value > 1.0001 ? 'up' : f.value < 0.9999 ? 'down' : '') : f.kind === 'add' ? (f.value > 0 ? 'up' : f.value < 0 ? 'down' : '') : '';
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

export function LogView(props: { b: Battle; tabKey: string; defaultLevel: 0 | 1 | 2; focus?: string | null; onElement?: (id: string) => void; onClearFocus?: () => void; rev?: number }) {
  const { b } = props;
  const [level, setLevel] = useTabState<0 | 1 | 2>(`${props.tabKey}:logLevel`, props.defaultLevel);
  const [side, setSide] = useTabState<'all' | 'A' | 'B'>(`${props.tabKey}:logSide`, 'all');
  const [phases, setPhases] = useTabState<Phase[]>(`${props.tabKey}:logPhases`, []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(1500);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const el of b.elements) m.set(`e:${el.id}`, el.name);
    for (const f of b.formations) m.set(`f:${f.id}`, f.name);
    m.set('s:A', b.sides.A.name);
    m.set('s:B', b.sides.B.name);
    return m;
  }, [b]);

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

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [b.log.length, filtered.length]);

  return (
    <>
      <div className="log-filters">
        <Seg
          value={String(level) as '0' | '1' | '2'}
          onChange={(v) => setLevel(Number(v) as 0 | 1 | 2)}
          options={[
            { value: '0', label: 'Ключевое', title: 'Только важнейшие события' },
            { value: '1', label: 'Обычное', title: 'Потери, мораль, проверки' },
            { value: '2', label: 'Подробное', title: 'Всё, включая огонь каждого элемента' },
          ]}
        />
        <Seg
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'A', label: b.sides.A.name },
            { value: 'B', label: b.sides.B.name },
          ]}
        />
        <input type="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 90 }} />
        <div className="row" style={{ gap: 3, width: '100%' }}>
          {PHASES.map((p) => (
            <button
              key={p.id}
              className={`chip${phases.includes(p.id) ? ' accent' : ''}`}
              style={{ cursor: 'pointer' }}
              title={`Фильтр: ${p.label}`}
              onClick={() => setPhases(phases.includes(p.id) ? phases.filter((x) => x !== p.id) : [...phases, p.id])}
            >
              {p.icon} {p.label}
            </button>
          ))}
          {props.focus && (
            <button className="chip accent" style={{ cursor: 'pointer' }} onClick={props.onClearFocus} title="Снять фильтр по элементу">
              только: {b.elements.find((x) => x.id === props.focus)?.name} ×
            </button>
          )}
        </div>
      </div>
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
            <button className="btn sm" onClick={() => setLimit(limit + 2000)}>
              Показать более ранние записи ({filtered.length - shown.length})
            </button>
          </div>
        )}
        {shown.map(({ e, i }) =>
          e.phase === 'turn' ? (
            <div key={i} className="log-turn">
              {e.text}
            </div>
          ) : (
            <div
              key={i}
              className={`log-entry ${e.severity} lvl${e.level}${e.factors ? ' has-f' : ''}`}
              onClick={() => {
                if (!e.factors) return;
                const n = new Set(open);
                if (n.has(i)) n.delete(i);
                else n.add(i);
                setOpen(n);
              }}
              title={e.factors ? 'Нажмите, чтобы увидеть расчёт' : undefined}
            >
              <span className="ph">{ICON[e.phase] ?? '·'}</span>
              <span>
                <RichText text={e.text} b={b} onElement={props.onElement} />
                {e.factors && !open.has(i) && <span className="faint"> ⓘ</span>}
              </span>
              {open.has(i) && e.factors && <Factors e={e} />}
            </div>
          ),
        )}
        {!shown.length && <div className="empty">Записей нет. Сделайте ход или ослабьте фильтры.</div>}
      </div>
    </>
  );
}
