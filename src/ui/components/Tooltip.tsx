// Одна всплывающая подсказка на всё окно. Показывается у элементов с data-tip, а также с обычным
// title: системную подсказку на время наведения снимаем, чтобы во всём окне был один вид подсказок.
// Подсказка встаёт по центру элемента, под ним или над ним — смотря где хватает места.
// data-tip-at="<селектор>" — ставить подсказку у ближайшего такого предка, а не у самого элемента.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeNear } from './popup';

const TIPPED = '[data-tip],[title],[data-tip-title]';

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, el: Element): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** title повторяет видимый текст элемента, и тот не обрезан — подсказывать нечего. */
function redundant(el: Element, text: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const shown = el.selectedOptions[0]?.text ?? '';
    if (squash(shown) !== squash(text)) return false;
    const cs = getComputedStyle(el);
    return textWidth(shown, el) <= el.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
  }
  if (el instanceof HTMLInputElement) return el.value === text && el.scrollWidth <= el.clientWidth;
  if (squash(el.textContent ?? '') !== squash(text)) return false;
  const nodes = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 40)];
  return !nodes.some((n) => (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) && getComputedStyle(n).display !== 'inline');
}

export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; box: DOMRect } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Размер подсказки известен только после отрисовки: ставим её на место до того, как она станет видна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    // Мерить — от левого края окна: у правого края ширина подсказки ужалась бы до оставшегося места.
    el.style.left = '0px';
    el.style.top = '0px';
    const p = placeNear(tip.box, el.offsetWidth, el.offsetHeight);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    el.style.visibility = 'visible';
  }, [tip]);
  useEffect(() => {
    let cur: Element | null = null;
    let taken: { el: Element; title: string; aria: boolean } | null = null;
    const giveBack = () => {
      if (!taken) return;
      const { el, title, aria } = taken;
      if (!el.hasAttribute('title')) el.setAttribute('title', title);
      el.removeAttribute('data-tip-title');
      if (aria) el.removeAttribute('aria-label');
      taken = null;
    };
    // У кнопки-значка title — её имя для экранного диктора: на время наведения переносим его в aria-label.
    const take = (el: Element) => {
      const title = el.getAttribute('title');
      if (!title) return;
      const aria = !el.hasAttribute('aria-label') && !squash(el.textContent ?? '');
      el.setAttribute('data-tip-title', title);
      el.removeAttribute('title');
      if (aria) el.setAttribute('aria-label', title);
      taken = { el, title, aria };
    };
    const show = (t: Element | null, mouse: boolean) => {
      if (t === cur) return;
      cur = t;
      if (mouse && taken && taken.el !== t) giveBack();
      if (!t) return setTip(null);
      const own = t.getAttribute('data-tip');
      const text = own || t.getAttribute('title') || t.getAttribute('data-tip-title') || '';
      if (mouse) take(t);
      if (!text || (!own && redundant(t, text))) return setTip(null);
      const at = t.getAttribute('data-tip-at');
      setTip({ text, box: ((at && t.closest(at)) || t).getBoundingClientRect() });
    };
    const over = (e: MouseEvent) => show((e.target as Element)?.closest?.(TIPPED) ?? null, true);
    const out = (e: MouseEvent) => !e.relatedTarget && show(null, true);
    // С клавиатуры подсказка показывается, когда на элемент переходят клавишей Tab (не по щелчку);
    // у значка «?» — и по щелчку: его для того и нажимают.
    const focus = (e: FocusEvent) => {
      const t = e.target as Element;
      if (t?.matches?.(':focus-visible, .hint-icon')) show(t.closest(TIPPED), false);
    };
    const hide = () => {
      cur = null;
      setTip(null);
    };
    const down = (e: MouseEvent) => (e.target as Element)?.closest?.('.hint-icon') || hide();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', down);
    return () => {
      giveBack();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', down);
    };
  }, []);
  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>
  );
}
