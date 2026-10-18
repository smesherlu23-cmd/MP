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

export type Iv = (type: Parameters<typeof applyIntervention>[1]['type'], payload: Record<string, unknown>) => void;

// ------------------------------------------------------------------ силы сторон
