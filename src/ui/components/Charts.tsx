// Простые графики на SVG (без внешних библиотек).

import { useLayoutEffect, useRef, useState } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => setW(Math.max(200, Math.floor(es[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

const fmtTick = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart(props: { series: Series[]; labels?: (string | number)[]; height?: number; yMax?: number; yUnit?: string; xTitle?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = props.height ?? 180;
  const pad = { l: 42, r: 10, t: 10, b: 22 };
  const n = Math.max(1, ...props.series.map((s) => s.values.length));
  const maxV = props.yMax ?? niceMax(Math.max(0, ...props.series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / maxV) * (h - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxV);
  const xStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pad.l) / 50))));
  return (
    <div ref={ref}>
      <svg className="chart" width={width} height={h} role="img" aria-label={`График: ${props.series.map((x) => x.name).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end">
              {fmtTick(t)}
              {props.yUnit ?? ''}
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) =>
          i % xStep === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={h - 6} textAnchor={i === n - 1 && n > 1 ? 'end' : 'middle'}>
              {props.labels?.[i] ?? i}
            </text>
          ) : null,
        )}
        {props.series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s.name}>
              <polyline
                points={pts.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
              />
              {s.values.length <= 40 &&
                s.values.map((v, i) =>
                  v === null ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                      <title>{`${s.name}: ${Math.round(v * 10) / 10}`}</title>
                    </circle>
                  ),
                )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {props.series.map((s) => (
          <span key={s.name}>
            <span className="dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        {props.xTitle && <span className="faint">ось X: {props.xTitle}</span>}
      </div>
    </div>
  );
}

/** Гистограмма одной или двух серий значений. */
export function Histogram(props: { series: { name: string; color: string; values: number[] }[]; height?: number; unit?: string; bins?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = props.height ?? 150;
  const pad = { l: 34, r: 8, t: 8, b: 22 };
  const all = props.series.flatMap((s) => s.values);
  if (!all.length) return <div className="faint small">Нет данных</div>;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const integer = all.every((v) => Number.isInteger(v));
  let bins = props.bins ?? Math.min(20, Math.max(5, Math.ceil(Math.sqrt(all.length))));
  if (integer) bins = Math.min(bins, Math.round(max - min) + 1);
  const bw = (max - min) / bins;
  const counts = props.series.map((s) => {
    const c = new Array(bins).fill(0);
    for (const v of s.values) c[Math.min(bins - 1, Math.floor((v - min) / bw))]++;
    return c;
  });
  const top = Math.max(1, ...counts.flat());
  const totals = props.series.map((s) => s.values.length || 1);
  const innerW = width - pad.l - pad.r;
  const groupW = innerW / bins;
  const barW = Math.max(1, (groupW - 2) / props.series.length);
  const y = (c: number) => pad.t + (1 - c / top) * (h - pad.t - pad.b);
  return (
    <div ref={ref}>
      <svg className="chart" width={width} height={h} role="img" aria-label={`График: ${props.series.map((x) => x.name).join(', ')}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(t * top)} y2={y(t * top)} />
            <text x={pad.l - 5} y={y(t * top) + 3} textAnchor="end">
              {Math.round(t * top)}
            </text>
          </g>
        ))}
        {counts.map((c, si) =>
          c.map((v, i) =>
            v > 0 ? (
              <rect
                key={`${si}-${i}`}
                x={pad.l + i * groupW + 1 + si * barW}
                y={y(v)}
                width={barW}
                height={h - pad.b - y(v)}
                fill={props.series[si].color}
                opacity={0.85}
              >
                <title>{`${props.series[si].name}: ${fmtTick(min + i * bw)}–${fmtTick(min + (i + 1) * bw)}${props.unit ?? ''} — ${v} (${Math.round((v / totals[si]) * 100)}%)`}</title>
              </rect>
            ) : null,
          ),
        )}
        {[0, Math.floor(bins / 2), bins].map((i) => (
          <text key={i} x={pad.l + i * groupW} y={h - 6} textAnchor={i === 0 ? 'start' : i === bins ? 'end' : 'middle'}>
            {fmtTick(min + i * bw)}
            {props.unit ?? ''}
          </text>
        ))}
      </svg>
      {props.series.length > 1 && (
        <div className="legend">
          {props.series.map((s) => (
            <span key={s.name}>
              <span className="dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StackBar(props: { parts: { label: string; value: number; color: string; title?: string }[] }) {
  const total = props.parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="stackbar">
      {props.parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.label}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            title={p.title ?? `${p.label}: ${Math.round((p.value / total) * 1000) / 10}%`}
          >
            {(p.value / total) * 100 >= 8 ? `${Math.round((p.value / total) * 100)}%` : ''}
          </div>
        ))}
    </div>
  );
}
