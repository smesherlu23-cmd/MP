// Хранилище данных. В программе (Electron) — JSON-файлы в папке данных;
// в браузере (режим разработки) — localStorage. Интерфейс один и тот же.

import type { Battle } from '../engine';

export type Collection = 'rulesets' | 'formations' | 'scenarios' | 'battles';

export interface BattleMeta {
  id: string;
  name: string;
  scenarioId: string;
  seed: string;
  turn: number;
  finished: boolean;
  headline?: string;
  updatedAt?: string;
}

export interface Bridge {
  list(col: Collection): Promise<unknown[]>;
  load(col: Collection, id: string): Promise<unknown | null>;
  save(col: Collection, id: string, data: unknown): Promise<void>;
  remove(col: Collection, id: string): Promise<void>;
  exportFile(name: string, content: string): Promise<boolean>;
  importFile(): Promise<{ name: string; content: string } | null>;
  getDataDir(): Promise<string>;
  chooseDataDir(): Promise<string | null>;
  openDataDir(): Promise<void>;
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
    finished: x.finished,
    headline: x.result?.headline ?? (b as BattleMeta).headline,
    updatedAt: x.updatedAt,
  };
}

const PREFIX = 'warsim:';

const browserBridge: Bridge = {
  async list(col) {
    const out: unknown[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(`${PREFIX}${col}:`)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(key)!);
        out.push(col === 'battles' ? battleMeta(v) : v);
      } catch {
        /* повреждённая запись — пропускаем */
      }
    }
    return out;
  },
  async load(col, id) {
    const raw = localStorage.getItem(`${PREFIX}${col}:${id}`);
    return raw ? JSON.parse(raw) : null;
  },
  async save(col, id, data) {
    localStorage.setItem(`${PREFIX}${col}:${id}`, JSON.stringify(data));
  },
  async remove(col, id) {
    localStorage.removeItem(`${PREFIX}${col}:${id}`);
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
