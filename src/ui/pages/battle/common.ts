// Общее для страницы боя: стороны, копирование отчёта, вмешательство ГМ.

import type { applyIntervention, SideId } from '../../../engine';
import { toast } from '../../store';

export const SIDES: SideId[] = ['A', 'B'];

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Отчёт скопирован в буфер обмена.', 'good');
}

/**
 * Напечатать текст отчёта (в том числе в PDF — «Microsoft Print to PDF» / «Сохранить как PDF» в окне печати):
 * отдельная страница с одним текстом, без интерфейса программы.
 */
export function printText(title: string, text: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title></title></head><body></body></html>');
  doc.close();
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent =
    'body{font:12px/1.45 "Segoe UI",system-ui,sans-serif;color:#000;margin:18mm 16mm}h1{font-size:16px;margin:0 0 10px}pre{white-space:pre-wrap;font:inherit;margin:0}';
  doc.head.appendChild(style);
  const h = doc.createElement('h1');
  h.textContent = title;
  const pre = doc.createElement('pre');
  pre.textContent = text;
  doc.body.append(h, pre);
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 1000);
}

export type Iv = (type: Parameters<typeof applyIntervention>[1]['type'], payload: Record<string, unknown>) => void;

// ------------------------------------------------------------------ силы сторон
