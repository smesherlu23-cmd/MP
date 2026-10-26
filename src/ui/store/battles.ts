// Бои: живые объекты в памяти, сохранение без подробного журнала, откат, ветки, удаление.

import { create } from 'zustand';
import { clone, newId, restoreBattleLog, rewindBattle, trimBattleForStorage, undoBattleAction, lastBattleAction, type Battle, type Id } from '../../engine';
import { battleMeta, storage } from '../storage';
import { chooseDialog, closeTabsWhere, flushSave, get, openTab, scheduleSave, set, toast } from './core';
import { restoreFromTrash } from './data';

export interface BattlesState {
  battles: Record<Id, Battle>;
  rev: Record<Id, number>;
}

export const useBattles = create<BattlesState>(() => ({ battles: {}, rev: {} }));

export function putBattle(b: Battle, persist = true) {
  useBattles.setState((s) => ({ battles: { ...s.battles, [b.id]: b }, rev: { ...s.rev, [b.id]: (s.rev[b.id] ?? 0) + 1 } }));
  set((s) => ({ battleIndex: { ...s.battleIndex, [b.id]: battleMeta(b) } }));
  // На диск — без подробного журнала: в 5–10 раз меньше; подробности восстанавливаются повтором.
  if (persist)
    scheduleSave(
      'battles',
      b.id,
      () => {
        const x = useBattles.getState().battles[b.id];
        return x && trimBattleForStorage(x);
      },
      1200,
    );
}

/**
 * Вернуть бою подробный журнал и разборы (после загрузки с диска их нет). Для больших боёв это
 * может занять секунду. false — бой сохранён другой версией программы и повтор с ним разошёлся.
 */
export function ensureFullLog(b: Battle): boolean {
  if (!b.logTrimmed) return true;
  const ok = restoreBattleLog(b);
  if (ok) touchBattle(b.id);
  else toast('Подробности этого боя недоступны: он сохранён другой версией программы. Главное и обычное в журнале остались.', 'bad');
  return ok;
}

/** Удалить несколько боёв сразу; уведомление — с кнопкой «Вернуть» (из корзины). */
export async function deleteBattles(ids: Id[]): Promise<boolean> {
  if (!ids.length) return false;
  for (const id of ids) await deleteBattle(id, true);
  toast(`Удалено боёв: ${ids.length} (они в корзине).`, 'good', {
    label: 'Вернуть',
    run: () => void restoreFromTrash(ids.map((key) => ({ col: 'battles', key }))),
  });
  return true;
}

// Откат в бою: бой повторяется с теми же бросками и решениями ГМ до нужного момента.
// Отменённые состояния хранятся в памяти — «Вернуть» (Ctrl+Y) возвращает их, пока бой не продолжили.
export const battleRedo = new Map<Id, Battle[]>();

export const NOT_REPLAYABLE =
  'Этот бой сохранён другой версией программы — повтор с ним расходится, отменить ход нельзя. Можно «Повторить с решениями ГМ» в меню боя.';

export function replaceBattle(prev: Battle, next: Battle, what: string) {
  battleRedo.set(prev.id, [...(battleRedo.get(prev.id) ?? []), prev]);
  putBattle(next);
  toast(`${what}.`, 'info', { label: 'Вернуть', run: () => redoBattle(prev.id) });
}

/** Отменить последнее в бою: вмешательство ГМ после последнего хода или сам ход (Ctrl+Z на вкладке боя). */
export function undoBattle(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  const a = lastBattleAction(b);
  if (!a) return toast('Отменять нечего: бой в самом начале.');
  const nb = undoBattleAction(b);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  replaceBattle(b, nb, a.kind === 'turn' ? `Отменён ход ${a.turn}` : `Отменено: ${a.label}`);
}

/** Вернуть отменённое в бою (Ctrl+Y на вкладке боя). */
export function redoBattle(id: Id) {
  const stack = battleRedo.get(id);
  const prev = stack?.pop();
  if (!prev) return toast('Возвращать нечего.');
  putBattle(prev);
  toast(`Возвращено: ход ${prev.turn}.`);
}

/** Бой продолжили (ход, вмешательство) — отменённое уже не вернуть. */
export function forgetBattleRedo(id: Id) {
  battleRedo.delete(id);
}

/** Вернуться к концу выбранного хода; решения ГМ после него отбрасываются. */
export async function rewindBattleDialog(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b || b.turn < 1) return;
  const min = b.ruleset.turnMinutes;
  const time = (t: number) => `${Math.floor((t * min) / 60)}:${String((t * min) % 60).padStart(2, '0')}`;
  const options = Array.from({ length: b.turn }, (_, i) => b.turn - 1 - i).map((t) => ({
    value: String(t),
    label: t === 0 ? 'Начало боя (до первого хода)' : `После хода ${t} · ${time(t)}`,
  }));
  const v = await chooseDialog(
    'Вернуться к ходу',
    options,
    'Бой будет повторён с теми же бросками кубиков и вашими решениями до выбранного момента; более поздние ходы и решения отбрасываются. Вернуть их можно сразу после этого (Ctrl+Y).',
  );
  if (v === null) return;
  const t = Number(v);
  const nb = rewindBattle(b, t);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  replaceBattle(b, nb, t === 0 ? 'Бой возвращён к началу' : `Бой возвращён к ходу ${t}`);
}

/**
 * Ответвить бой: новый бой — копия этого до выбранного хода (те же броски и решения ГМ), а исходный
 * остаётся как есть — можно сыграть иначе и сравнить.
 */
export async function branchBattleDialog(id: Id) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  const min = b.ruleset.turnMinutes;
  const time = (t: number) => `${Math.floor((t * min) / 60)}:${String((t * min) % 60).padStart(2, '0')}`;
  const options = Array.from({ length: b.turn + 1 }, (_, i) => b.turn - i).map((t) => ({
    value: String(t),
    label:
      t === b.turn
        ? `С текущего момента (после хода ${t}${b.interventions.some((x) => x.turn === t) ? ', с вашими решениями' : ''})`
        : t === 0
          ? 'С начала боя'
          : `После хода ${t} · ${time(t)}`,
  }));
  const v = await chooseDialog(
    'Ответвить бой',
    options,
    'Новый бой — копия этого до выбранного момента: те же броски и ваши решения. Исходный бой не меняется — можно сыграть иначе и сравнить исходы.',
  );
  if (v === null) return;
  const t = Number(v);
  const nb = t === b.turn ? clone(b) : rewindBattle(b, t);
  if (!nb) return toast(NOT_REPLAYABLE, 'bad');
  const base = b.name.replace(/ — ветка с хода \d+$/, '');
  nb.id = newId('bt');
  nb.name = `${base} — ветка с хода ${t}`;
  nb.branchOf = { battleId: b.id, name: b.name, turn: t };
  nb.createdAt = new Date().toISOString();
  delete nb.appliedToForces;
  putBattle(nb);
  openTab('battle', nb.id);
  toast(`Ветка боя создана: «${nb.name}». Исходный бой не изменился.`, 'good');
}

/** Вызвать после изменения боя движком (ход, вмешательство). */
export function touchBattle(id: Id) {
  const b = useBattles.getState().battles[id];
  if (b) putBattle(b);
}

export async function loadBattle(id: Id): Promise<Battle | null> {
  const live = useBattles.getState().battles[id];
  if (live) return live;
  const b = (await storage.load('battles', id)) as Battle | null;
  if (b) putBattle(b, false);
  return b;
}

export async function deleteBattle(id: Id, quiet = false) {
  const meta = get().battleIndex[id];
  await flushSave('battles', id);
  useBattles.setState((s) => {
    const { [id]: _, ...rest } = s.battles;
    return { battles: rest };
  });
  set((s) => {
    const { [id]: _, ...rest } = s.battleIndex;
    return { battleIndex: rest };
  });
  await storage.remove('battles', id);
  closeTabsWhere((t) => t.kind === 'battle' && t.ref === id);
  if (!quiet)
    toast(`Бой «${meta?.name ?? id}» удалён (он в корзине).`, 'info', { label: 'Вернуть', run: () => void restoreFromTrash([{ col: 'battles', key: id }]) });
}

export function renameBattle(id: Id, name: string) {
  const b = useBattles.getState().battles[id];
  if (!b) return;
  b.name = name;
  touchBattle(id);
}

// ------------------------------------------------------------------ импорт и экспорт
