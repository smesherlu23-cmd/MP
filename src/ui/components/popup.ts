// Размещение всплывающих блоков (подсказки, меню) у элемента так, чтобы они не выходили за край окна.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Где поставить блок размером w×h у прямоугольника r: под ним, если помещается; иначе над ним;
 * иначе с той стороны, где места больше (и прижать к краю окна). По горизонтали — по центру r
 * (align: 'center'), от его левого края ('start') или от правого ('end'), но не за краем окна.
 */
export function placeNear(
  r: Box,
  w: number,
  h: number,
  opts: { align?: 'center' | 'start' | 'end'; gap?: number; margin?: number } = {},
): { left: number; top: number; above: boolean } {
  const { align = 'center', gap = 6, margin = 8 } = opts;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const x = align === 'start' ? r.left : align === 'end' ? r.right - w : (r.left + r.right) / 2 - w / 2;
  const left = clamp(x, margin, W - w - margin);
  const below = r.bottom + gap;
  const above = r.top - gap - h;
  if (below + h <= H - margin) return { left, top: below, above: false };
  if (above >= margin) return { left, top: above, above: true };
  const up = r.top > H - r.bottom;
  return { left, top: clamp(up ? above : below, margin, H - h - margin), above: up };
}

/** Где поставить меню у точки (x, y): вправо-вниз от неё, у краёв окна — влево и/или вверх. */
export function placeAtPoint(x: number, y: number, w: number, h: number, margin = 8): { left: number; top: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const left = x + w <= W - margin ? x : clamp(x - w, margin, W - w - margin);
  const top = y + h <= H - margin ? y : clamp(y - h, margin, H - h - margin);
  return { left, top };
}
