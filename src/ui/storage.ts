// Хранилище данных. В программе (Electron) — JSON-файлы в папке данных;
// в браузере (режим разработки) — localStorage. Интерфейс один и тот же.
// Удалённое попадает в корзину, наборы правил, подразделения и сценарии регулярно копируются,
// а нечитаемые файлы откладываются в сторону и сообщаются (electron/protect.ts).

import type { Battle } from '../engine';

/** formations — шаблоны (имя папки осталось от прежних версий), forces — силы. */
export type Collection = 'rulesets' | 'formations' | 'forces' | 'scenarios' | 'battles';

export interface BattleMeta {
  id: string;
  name: string;
  scenarioId: string;
  seed: string;
  turn: number;
  /** Ходов в бою и минут на ход — чтобы показать, сколько времени боя прошло. */
  maxTurns?: number;
  turnMinutes?: number;
  finished: boolean;
  headline?: string;
  updatedAt?: string;
  /** Окончен, а итоги в силы не записаны: какие силы участвовали. */
  unrecorded?: string[];
}

export type BackupKind = 'auto' | 'manual' | 'restore' | 'examples';

export interface BackupInfo {
  id: string;
  createdAt: string;
  kind: BackupKind;
  counts: Record<string, number>;
  hash: string;
  unchanged?: boolean;
}

export interface TrashItem {
  col: Collection;
  key: string;
  name: string;
  deletedAt: string;
  size: number;
}

export interface DataProblem {
  col: string;
  file: string;
  error: string;
  movedTo?: string;
}

export interface Bridge {
  list(col: Collection): Promise<unknown[]>;
  load(col: Collection, id: string): Promise<unknown | null>;
  save(col: Collection, id: string, data: unknown): Promise<void>;
  /** Перенести в корзину (хранится 30 дней). */
  remove(col: Collection, id: string): Promise<void>;
  exportFile(name: string, content: string): Promise<boolean>;
  importFile(): Promise<{ name: string; content: string } | null>;
  getDataDir(): Promise<string>;
  chooseDataDir(): Promise<string | null>;
  openDataDir(sub?: 'backups' | 'trash' | 'damaged'): Promise<void>;
  /** Файлы, которые не удалось прочитать при загрузке (сообщаются один раз). */
  problems(): Promise<DataProblem[]>;
  trash(): Promise<TrashItem[]>;
  restoreTrash(col: Collection, key: string): Promise<unknown | null>;
  purgeTrash(items?: { col: Collection; key: string }[]): Promise<void>;
  backups(): Promise<BackupInfo[]>;
  /** null — копировать нечего или (для «auto») ничего не изменилось. */
  backup(kind: BackupKind): Promise<BackupInfo | null>;
  restoreBackup(id: string): Promise<number>;
}

/** Окно настольной программы: платформа, цвет кнопок окна, сведения о программе. */
export interface WindowBridge {
  platform: string;
  setWindowTheme(theme: 'dark' | 'light'): void;
  appInfo(): Promise<{ version: string; dataDir: string }>;
}

declare global {
  interface Window {
    warsim?: Bridge & Partial<WindowBridge>;
  }
}

export function battleMeta(b: Battle | BattleMeta): BattleMeta {
  const x = b as Battle;
  return {
    id: x.id,
    name: x.name,
    scenarioId: x.scenarioId,
    seed: x.seed,
    turn: x.turn,
    maxTurns: x.scenario?.maxTurns ?? (b as BattleMeta).maxTurns,
    turnMinutes: x.ruleset?.turnMinutes ?? (b as BattleMeta).turnMinutes,
    finished: x.finished,
    headline: x.result?.headline ?? (b as BattleMeta).headline,
    updatedAt: x.updatedAt,
    unrecorded: x.scenario ? unrecordedForces(x) : (b as BattleMeta).unrecorded,
  };
}

/** Силы окончённого боя, в которые ещё не записаны его итоги (пусто — записывать нечего или уже записано). */
export function unrecordedForces(b: Battle): string[] | undefined {
  if (!b.finished || b.appliedToForces) return undefined;
  const ids = [...new Set(b.scenario.sides.flatMap((sd) => (sd.units ?? []).map((u) => u.forceId)))];
  return ids.length ? ids : undefined;
}

const PREFIX = 'warsim:';
const COLS: Collection[] = ['rulesets', 'formations', 'forces', 'scenarios', 'battles'];
const BACKED_UP: Collection[] = ['rulesets', 'formations', 'forces', 'scenarios'];
const TRASH_DAYS = 30;
/** В браузере место ограничено — копий меньше, чем в программе. */
const BROWSER_BACKUPS = 5;

const keysWith = (prefix: string) => {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(prefix)) out.push(k);
  }
  return out;
};
const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const hashOf = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

let browserProblems: DataProblem[] = [];

const browserBridge: Bridge = {
  async list(col) {
    const out: unknown[] = [];
    for (const key of keysWith(`${PREFIX}${col}:`)) {
      const raw = localStorage.getItem(key)!;
      try {
        const v = JSON.parse(raw);
        out.push(col === 'battles' ? battleMeta(v) : v);
      } catch {
        const id = key.slice(`${PREFIX}${col}:`.length);
        localStorage.setItem(`${PREFIX}damaged:${col}:${id}`, raw);
        localStorage.removeItem(key);
        browserProblems.push({ col, file: id, error: raw.trim() ? 'запись повреждена' : 'запись пуста', movedTo: `${PREFIX}damaged:${col}:${id}` });
      }
    }
    return out;
  },
  async load(col, id) {
    return read(`${PREFIX}${col}:${id}`);
  },
  async save(col, id, data) {
    localStorage.setItem(`${PREFIX}${col}:${id}`, JSON.stringify(data));
    localStorage.removeItem(`${PREFIX}trash:${col}:${id}`);
  },
  async remove(col, id) {
    const raw = localStorage.getItem(`${PREFIX}${col}:${id}`);
    if (raw === null) return;
    localStorage.setItem(`${PREFIX}trash:${col}:${id}`, JSON.stringify({ deletedAt: new Date().toISOString(), raw }));
    localStorage.removeItem(`${PREFIX}${col}:${id}`);
  },
  async problems() {
    const p = browserProblems;
    browserProblems = [];
    return p;
  },
  async trash() {
    const out: TrashItem[] = [];
    const old = Date.now() - TRASH_DAYS * 864e5;
    for (const col of COLS)
      for (const k of keysWith(`${PREFIX}trash:${col}:`)) {
        const t = read<{ deletedAt: string; raw: string }>(k);
        if (!t || Date.parse(t.deletedAt) < old) {
          localStorage.removeItem(k);
          continue;
        }
        const key = k.slice(`${PREFIX}trash:${col}:`.length);
        let name = key;
        try {
          name = JSON.parse(t.raw).name ?? key;
        } catch {
          /* без названия */
        }
        out.push({ col, key, name, deletedAt: t.deletedAt, size: t.raw.length });
      }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  },
  async restoreTrash(col, key) {
    const t = read<{ raw: string }>(`${PREFIX}trash:${col}:${key}`);
    if (!t) return null;
    try {
      const data = JSON.parse(t.raw);
      localStorage.setItem(`${PREFIX}${col}:${key}`, t.raw);
      localStorage.removeItem(`${PREFIX}trash:${col}:${key}`);
      return data;
    } catch {
      return null;
    }
  },
  async purgeTrash(items) {
    if (!items) for (const k of keysWith(`${PREFIX}trash:`)) localStorage.removeItem(k);
    else for (const x of items) localStorage.removeItem(`${PREFIX}trash:${x.col}:${x.key}`);
  },
  async backups() {
    return keysWith(`${PREFIX}backup:`)
      .map((k) => read<{ info: BackupInfo }>(k)?.info)
      .filter((x): x is BackupInfo => !!x)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async backup(kind) {
    const files: Record<string, Record<string, string>> = {};
    let all = '';
    let n = 0;
    for (const col of BACKED_UP) {
      files[col] = {};
      for (const k of keysWith(`${PREFIX}${col}:`).sort()) {
        const id = k.slice(`${PREFIX}${col}:`.length);
        files[col][id] = localStorage.getItem(k)!;
        all += `${col}/${id}\n${files[col][id]}\n`;
        n++;
      }
    }
    if (!n) return null;
    const hash = hashOf(all);
    const list = await browserBridge.backups();
    if (list[0]?.hash === hash) return kind === 'auto' ? null : { ...list[0], unchanged: true };
    const now = new Date();
    let id = stamp(now);
    for (let i = 2; list.some((b) => b.id === id); i++) id = `${stamp(now)}-${i}`;
    const info: BackupInfo = {
      id,
      createdAt: now.toISOString(),
      kind,
      counts: Object.fromEntries(BACKED_UP.map((c) => [c, Object.keys(files[c]).length])),
      hash,
    };
    for (const old of list.slice(BROWSER_BACKUPS - 1)) localStorage.removeItem(`${PREFIX}backup:${old.id}`);
    try {
      localStorage.setItem(`${PREFIX}backup:${id}`, JSON.stringify({ info, files }));
    } catch {
      return null; // места нет — данные важнее копии
    }
    return info;
  },
  async restoreBackup(id) {
    const b = read<{ info: BackupInfo; files: Record<string, Record<string, string>> }>(`${PREFIX}backup:${id}`);
    if (!b) throw new Error('Резервная копия не найдена');
    await browserBridge.backup('restore');
    let n = 0;
    for (const col of BACKED_UP)
      for (const [key, raw] of Object.entries(b.files[col] ?? {})) {
        localStorage.setItem(`${PREFIX}${col}:${key}`, raw);
        localStorage.removeItem(`${PREFIX}trash:${col}:${key}`);
        n++;
      }
    return n;
  },
  async exportFile(name, content) {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  },
  importFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.txt,application/json';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        resolve({ name: f.name, content: await f.text() });
      };
      input.click();
    });
  },
  async getDataDir() {
    return 'Хранилище браузера (localStorage)';
  },
  async chooseDataDir() {
    return null;
  },
  async openDataDir() {},
};

export const storage: Bridge = window.warsim ?? browserBridge;
export const storageKind: 'electron' | 'browser' = window.warsim ? 'electron' : 'browser';
export const desktop: Partial<WindowBridge> | null = window.warsim ?? null;

// Окно без системной шапки: верхняя полоса программы служит заголовком окна.
if (desktop?.platform) {
  document.documentElement.classList.add('desktop');
  document.documentElement.dataset.platform = desktop.platform;
}
