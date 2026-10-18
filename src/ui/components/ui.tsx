// Базовые элементы интерфейса.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Btn(props: {
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  kind?: 'primary' | 'danger' | 'ghost';
  sm?: boolean;
  icon?: boolean;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  const cls = ['btn', props.kind, props.sm && 'sm', props.icon && 'icon', props.active && 'active', props.className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={props.onClick} title={props.title} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

/**
 * Для кликабельных элементов, которые не кнопки (строки списков, записи журнала): попадают в порядок
 * Tab и срабатывают по Enter или пробелу — так же, как по щелчку.
 */
export function pressable(onPress: (e: React.KeyboardEvent) => void, label?: string) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      onPress(e);
    },
  };
}

/** Стрелки ↑/↓ (и Home/End) переводят фокус между элементами списка внутри контейнера. */
export function arrowNav(e: React.KeyboardEvent | KeyboardEvent, root: Element | null, selector: string): boolean {
  if (!root || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false;
  const items = [...root.querySelectorAll<HTMLElement>(selector)].filter((x) => !(x as HTMLButtonElement).disabled);
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  items[j].focus();
  return true;
}

/** Числовое поле: значение применяется сразу, если введено корректное число. */
export function Num(props: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  width?: number | string;
  disabled?: boolean;
  integer?: boolean;
  title?: string;
  placeholder?: string;
}) {
  const fmt = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(Math.round(v * 10000) / 10000));
  const [text, setText] = useState(fmt(props.value));
  const focused = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fmt — чистая функция; текст обновляется только при смене значения
  useEffect(() => {
    if (!focused.current) setText(fmt(props.value));
  }, [props.value]);
  const parse = (t: string) => {
    const v = Number(t.replace(',', '.').trim());
    if (t.trim() === '' || !Number.isFinite(v)) return null;
    let x = v;
    if (props.integer) x = Math.round(x);
    if (props.min !== undefined) x = Math.max(props.min, x);
    if (props.max !== undefined) x = Math.min(props.max, x);
    return x;
  };
  return (
    <span className={`numwrap${props.suffix ? (props.suffix.length > 1 ? ' has-suffix long-suffix' : ' has-suffix') : ''}`} style={{ width: props.width ?? 90 }} title={props.title}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={props.disabled}
        placeholder={props.placeholder}
        className={text !== '' && parse(text) === null ? 'invalid' : undefined}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          const v = parse(text);
          if (v !== null && v !== props.value) props.onChange(v);
          setText(fmt(v ?? props.value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value;
          if (/[.,-]$/.test(t)) return;
          const v = parse(t);
          if (v !== null && v !== props.value && String(v) === t.replace(',', '.').trim()) props.onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1);
            const cur = parse(text) ?? props.value ?? 0;
            let v = Math.round((cur + (e.key === 'ArrowUp' ? step : -step)) * 10000) / 10000;
            if (props.min !== undefined) v = Math.max(props.min, v);
            if (props.max !== undefined) v = Math.min(props.max, v);
            setText(fmt(v));
            props.onChange(v);
          }
        }}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </span>
  );
}

/** Ползунок с числом (для процентов 0..100). */
export function Range(props: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  return (
    <div className="range-field">
      <input
        type="range"
        min={min}
        max={max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <Num value={props.value} onChange={props.onChange} min={min} max={max} step={props.step ?? 1} width={64} disabled={props.disabled} />
    </div>
  );
}

export function Txt(props: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; width?: number | string; autoFocus?: boolean }) {
  return (
    <input
      type="text"
      value={props.value ?? ''}
      placeholder={props.placeholder}
      className={props.className}
      style={props.width ? { width: props.width } : undefined}
      autoFocus={props.autoFocus}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function Area(props: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={props.value ?? ''} rows={props.rows ?? 3} placeholder={props.placeholder} style={{ width: '100%' }} onChange={(e) => props.onChange(e.target.value)} />;
}

export function Sel<T extends string | number>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  width?: number | string;
  disabled?: boolean;
  title?: string;
}) {
  const isNum = typeof props.value === 'number';
  return (
    <select
      value={String(props.value)}
      disabled={props.disabled}
      title={props.title}
      style={props.width ? { width: props.width } : undefined}
      onChange={(e) => props.onChange((isNum ? Number(e.target.value) : e.target.value) as T)}
    >
      {!props.options.some((o) => String(o.value) === String(props.value)) && <option value={String(props.value)}>— {String(props.value) || 'не выбрано'} —</option>}
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} title={o.title}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check(props: { value: boolean; onChange: (v: boolean) => void; children?: ReactNode; title?: string }) {
  return (
    <label className="check" title={props.title}>
      <input type="checkbox" checked={!!props.value} onChange={(e) => props.onChange(e.target.checked)} />
      {props.children}
    </label>
  );
}

/** Поле формы. Пояснение (hint) не занимает место — оно во всплывающей подсказке у значка «?». */
export function Field(props: { label: ReactNode; hint?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="field" style={props.style}>
      <div className="label">
        {props.label}
        {props.hint && <Info text={props.hint} />}
      </div>
      {props.children}
    </div>
  );
}

/** Значок «?» с подсказкой (видна при наведении и при переходе на значок клавишей Tab). */
export function Info({ text }: { text: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: значок фокусируется, чтобы подсказка показывалась и при переходе клавишей Tab
    <span className="hint-icon" data-tip={text} tabIndex={0} role="note" aria-label={text}>
      ?
    </span>
  );
}

export interface MenuItem {
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  tip?: string;
  /** Сочетание клавиш — показывается справа. */
  kbd?: string;
}

/**
 * Кнопка «⋯» с выпадающим списком второстепенных действий. С клавиатуры: Enter/пробел или ↓ открывают,
 * ↑/↓ выбирают пункт, Enter выполняет, Esc или Tab закрывают и возвращают фокус на кнопку.
 */
export function Menu(props: { items: (MenuItem | 'sep' | false | null | undefined)[]; label?: ReactNode; title?: string; sm?: boolean }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setPos(null);
    if (refocus) btn.current?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: подписки — на время, пока меню открыто; close не зависит от состояния
  useEffect(() => {
    if (!pos) return;
    // Фокус — на первый доступный пункт: дальше работают стрелки.
    pop.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest?.('.menu-pop') && !btn.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else arrowNav(e, pop.current, '.menu-item');
    };
    const onResize = () => setPos(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [pos]);
  const items = props.items.filter(Boolean) as (MenuItem | 'sep')[];
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`btn ${props.label ? '' : 'icon'} ${props.sm ? 'sm' : ''} ${pos ? 'active' : ''}`}
        title={props.title ?? 'Ещё'}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={() => (pos ? setPos(null) : open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !pos) {
            e.preventDefault();
            open();
          }
        }}
      >
        {props.label ?? '⋯'}
      </button>
      {pos &&
        createPortal(
          <div ref={pop} className="menu-pop" role="menu" style={{ top: pos.top, right: pos.right }}>
            {items.map((it, i) =>
              it === 'sep' ? (
                i > 0 && i < items.length - 1 && items[i - 1] !== 'sep' ? <hr key={i} className="menu-sep" /> : null
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={`menu-item${it.danger ? ' danger' : ''}`}
                  disabled={it.disabled}
                  data-tip={it.tip}
                  onClick={() => {
                    close(true);
                    it.onClick();
                  }}
                >
                  {it.label}
                  {it.kbd && <span className="kbd">{it.kbd}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function readOpen(id: string | undefined, def: boolean): boolean {
  if (!id) return def;
  try {
    const v = localStorage.getItem(`warsim-sec-${id}`);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

/** Сворачиваемый блок: заголовок со сводкой, содержимое — по клику. Состояние запоминается. */
export function Section(props: {
  id?: string;
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  tight?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(props.id, !!props.defaultOpen));
  const isOpen = props.forceOpen || open;
  const toggle = () => {
    setOpen(!isOpen);
    try {
      if (props.id) localStorage.setItem(`warsim-sec-${props.id}`, isOpen ? '0' : '1');
    } catch {
      /* без сохранения */
    }
  };
  return (
    <div className={`card section${isOpen ? ' open' : ''}`}>
      <div className="card-head" onClick={toggle}>
        <span className="chev">{isOpen ? '▾' : '▸'}</span>
        <h3>
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: роль button и фокус — из pressable() */}
          <span {...pressable(toggle)} aria-expanded={isOpen}>
            {props.title}
          </span>
        </h3>
        {props.summary !== undefined && <span className="sec-summary">{props.summary}</span>}
        <span className="grow" />
        {props.actions && <span onClick={(e) => e.stopPropagation()}>{props.actions}</span>}
      </div>
      {isOpen && <div className={`card-body${props.tight ? ' tight' : ''}`}>{props.children}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; tight?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`card ${props.className ?? ''}`} style={props.style}>
      {(props.title || props.actions) && (
        <div className="card-head">
          <h3>{props.title}</h3>
          {props.actions}
        </div>
      )}
      <div className={`card-body${props.tight ? ' tight' : ''}`}>{props.children}</div>
    </div>
  );
}

export function Tags(props: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current;
  const add = () => {
    const t = text.trim();
    if (t && !props.value.includes(t)) props.onChange([...props.value, t]);
    setText('');
  };
  return (
    <div className="tags">
      {props.value.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" title="Убрать" onClick={() => props.onChange(props.value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        list={props.suggestions?.length ? listId : undefined}
        placeholder={props.value.length ? '' : (props.placeholder ?? 'добавить тег…')}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Backspace' && !text && props.value.length) props.onChange(props.value.slice(0, -1));
        }}
      />
      {props.suggestions?.length ? (
        <datalist id={listId}>
          {props.suggestions.filter((s) => !props.value.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button type="button" key={o.value} className={o.value === props.value ? 'on' : ''} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Meter(props: { value: number; max?: number; color?: string; label?: ReactNode; width?: number }) {
  const pct = Math.max(0, Math.min(100, (props.value / (props.max ?? 100)) * 100));
  const color = props.color ?? (pct < 30 ? 'var(--bad)' : pct < 60 ? 'var(--warn)' : 'var(--good)');
  return (
    <div className="meter-cell" style={props.width ? { width: props.width } : undefined}>
      <span className="small right">{props.label ?? Math.round(props.value)}</span>
      <div className="meter">
        <div style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Kpi(props: { k: ReactNode; v: ReactNode; s?: ReactNode; color?: string; title?: string }) {
  return (
    <div className="kpi" title={props.title}>
      <div className="k">{props.k}</div>
      <div className="v" style={props.color ? { color: props.color } : undefined}>
        {props.v}
      </div>
      {props.s !== undefined && <div className="s">{props.s}</div>}
    </div>
  );
}

export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal${props.wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <Btn kind="ghost" icon sm onClick={props.onClose} title="Закрыть (Esc)">
            ×
          </Btn>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export const fmt0 = (v: number) => Math.round(v).toLocaleString('ru-RU');
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');
export const pct = (v: number) => `${Math.round(v)}%`;
