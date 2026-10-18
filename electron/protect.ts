// Файлы данных и их защита: резервные копии, корзина, повреждённые файлы.
// Без Electron — только папка на диске, поэтому проверяется обычными тестами.
//
//   <папка данных>/rulesets|formations|scenarios|battles/<id>.json — сами данные;
//   backups/<дата_время>/… — копии наборов правил, подразделений и сценариев (без боёв);
//   trash/<коллекция>/<id>.json — удалённое (хранится 30 дней);
//   damaged/<коллекция>/… — файлы, которые не удалось прочитать как JSON.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = ['rulesets', 'formations', 'forces', 'scenarios', 'battles'];
/** Бои в копии не входят: они большие и воспроизводятся из сценария. Силы входят: в них потери после боёв. */
export const BACKED_UP = ['rulesets', 'formations', 'forces', 'scenarios'];
export const KEEP_BACKUPS = 10;
export const KEEP_DAILY = 14;
export const TRASH_DAYS = 30;

export type BackupKind = 'auto' | 'manual' | 'restore' | 'examples';

export interface BackupInfo {
  id: string;
  createdAt: string;
  kind: BackupKind;
  counts: Record<string, number>;
  hash: string;
  /** Изменений с прошлой копии не было — новая не создана. */
  unchanged?: boolean;
}

export interface TrashItem {
  col: string;
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

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const dayOf = (iso: string) => stamp(new Date(iso)).slice(0, 10);

async function readdir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

export class DataStore {
  private problemList: DataProblem[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  colDir(col: string): string {
    if (!COLLECTIONS.includes(col)) throw new Error(`Неизвестная коллекция: ${col}`);
    return path.join(this.dir, col);
  }

  key(id: string): string {
    const safe = String(id).replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_');
    if (!safe || safe.startsWith('.')) throw new Error('Некорректный идентификатор');
    return safe;
  }

  filePath(col: string, id: string): string {
    return path.join(this.colDir(col), `${this.key(id)}.json`);
  }

  private trashFile(col: string, key: string) {
    this.colDir(col);
    return path.join(this.dir, 'trash', col, `${this.key(key)}.json`);
  }

  private get backupsDir() {
    return path.join(this.dir, 'backups');
  }

  /** Резервное копирование и восстановление — по очереди, без гонок. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---------------------------------------------------------------- чтение и запись

  /** Все объекты коллекции. Файл, который не читается как JSON, откладывается в damaged/ и попадает в список проблем. */
  async list(col: string, map: (x: any) => unknown = (x) => x): Promise<unknown[]> {
    const dir = this.colDir(col);
    await fs.mkdir(dir, { recursive: true });
    const out: unknown[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (e) {
        this.problemList.push({ col, file: name, error: `не удалось прочитать (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` });
        continue;
      }
      try {
        out.push(map(JSON.parse(text)));
      } catch {
        const movedTo = path.join(this.dir, 'damaged', col, `${name.slice(0, -5)}.${stamp(new Date())}.json`);
        try {
          await fs.mkdir(path.dirname(movedTo), { recursive: true });
          await fs.rename(file, movedTo);
          this.problemList.push({ col, file: name, error: text.trim() ? 'файл повреждён' : 'файл пуст', movedTo });
        } catch {
          this.problemList.push({ col, file: name, error: 'файл повреждён' });
        }
      }
    }
    return out;
  }

  /** Проблемы, найденные с прошлого вызова (каждая сообщается один раз). */
  takeProblems(): DataProblem[] {
    const p = this.problemList;
    this.problemList = [];
    return p;
  }

  async load(col: string, id: string): Promise<unknown | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(col, id), 'utf8'));
    } catch {
      return null;
    }
  }

  async save(col: string, id: string, data: unknown) {
    await writeAtomic(this.filePath(col, id), JSON.stringify(data, null, col === 'battles' ? 0 : 2));
    // Сохранённое снова живое — его копия в корзине больше не нужна.
    await fs.rm(this.trashFile(col, id), { force: true });
  }

  // ---------------------------------------------------------------- корзина

  /** Удаление — перенос в корзину; дата удаления — время изменения файла в корзине. */
  async remove(col: string, id: string) {
    const src = this.filePath(col, id);
    const dst = this.trashFile(col, id);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    try {
      await fs.rename(src, dst);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const now = new Date();
    await fs.utimes(dst, now, now);
  }

  async trash(): Promise<TrashItem[]> {
    await this.purgeOldTrash();
    const out: TrashItem[] = [];
    for (const col of COLLECTIONS) {
      const dir = path.join(this.dir, 'trash', col);
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(dir, name);
        try {
          const st = await fs.stat(file);
          out.push({ col, key: name.slice(0, -5), name: (await readName(file)) ?? name.slice(0, -5), deletedAt: st.mtime.toISOString(), size: st.size });
        } catch {
          /* файл исчез — пропускаем */
        }
      }
    }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  /** Вернуть из корзины; возвращает сам объект (null — не найден или не читается). */
  async restoreTrash(col: string, key: string): Promise<unknown | null> {
    const src = this.trashFile(col, key);
    let data: unknown;
    try {
      data = JSON.parse(await fs.readFile(src, 'utf8'));
    } catch {
      return null;
    }
    const dst = path.join(this.colDir(col), `${this.key(key)}.json`);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return data;
  }

  async purgeTrash(items?: { col: string; key: string }[]) {
    if (!items) {
      await fs.rm(path.join(this.dir, 'trash'), { recursive: true, force: true });
      return;
    }
    for (const x of items) await fs.rm(this.trashFile(x.col, x.key), { force: true });
  }

  async purgeOldTrash(days = TRASH_DAYS, now = Date.now()) {
    for (const col of COLLECTIONS) {
      const dir = path.join(this.dir, 'trash', col);
      for (const name of await readdir(dir)) {
        const file = path.join(dir, name);
        try {
          if (now - (await fs.stat(file)).mtimeMs > days * 864e5) await fs.rm(file, { force: true });
        } catch {
          /* уже удалён */
        }
      }
    }
  }

  // ---------------------------------------------------------------- резервные копии

  async backups(): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (const id of await readdir(this.backupsDir)) {
      try {
        out.push({ ...JSON.parse(await fs.readFile(path.join(this.backupsDir, id, 'manifest.json'), 'utf8')), id });
      } catch {
        /* незавершённая копия — без описи */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Копия наборов правил, подразделений и сценариев. Если с прошлой копии ничего не изменилось,
   * новая не создаётся: для «auto» — null, для остальных — прошлая с отметкой unchanged.
   */
  backup(kind: BackupKind, now = new Date()): Promise<BackupInfo | null> {
    return this.serial(() => this.backupNow(kind, now));
  }

  private async backupNow(kind: BackupKind, now: Date): Promise<BackupInfo | null> {
    const files: { col: string; name: string; content: Buffer }[] = [];
    for (const col of BACKED_UP) {
      const dir = this.colDir(col);
      for (const name of (await readdir(dir)).sort()) {
        if (!name.endsWith('.json')) continue;
        try {
          files.push({ col, name, content: await fs.readFile(path.join(dir, name)) });
        } catch {
          /* файл занят или исчез — в эту копию не попадёт */
        }
      }
    }
    if (!files.length) return null;
    const h = createHash('sha1');
    for (const f of files) h.update(`${f.col}/${f.name}\n`).update(f.content).update('\n');
    const hash = h.digest('hex');
    const last = (await this.backups())[0];
    if (last?.hash === hash) return kind === 'auto' ? null : { ...last, unchanged: true };

    let id = stamp(now);
    const existing = new Set(await readdir(this.backupsDir));
    for (let n = 2; existing.has(id); n++) id = `${stamp(now)}-${n}`;
    const root = path.join(this.backupsDir, id);
    for (const f of files) {
      await fs.mkdir(path.join(root, f.col), { recursive: true });
      await fs.writeFile(path.join(root, f.col, f.name), f.content);
    }
    const counts = Object.fromEntries(BACKED_UP.map((c) => [c, files.filter((f) => f.col === c).length]));
    const info: BackupInfo = { id, createdAt: now.toISOString(), kind, counts, hash };
    // Опись пишется последней: копия без неё считается незавершённой.
    await writeAtomic(path.join(root, 'manifest.json'), JSON.stringify(info, null, 2));
    await this.pruneBackups();
    return info;
  }

  /** Хранятся 10 последних автоматических копий и по одной за каждый из 14 последних дней, плюс 10 последних прочих. */
  private async pruneBackups() {
    const all = await this.backups();
    const keep = new Set<string>();
    const auto = all.filter((b) => b.kind === 'auto');
    auto.slice(0, KEEP_BACKUPS).forEach((b) => keep.add(b.id));
    const days = new Set<string>();
    for (const b of auto) {
      const d = dayOf(b.createdAt);
      if (days.has(d) || days.size >= KEEP_DAILY) continue;
      days.add(d);
      keep.add(b.id);
    }
    all
      .filter((b) => b.kind !== 'auto')
      .slice(0, KEEP_BACKUPS)
      .forEach((b) => keep.add(b.id));
    for (const id of await readdir(this.backupsDir)) {
      // Незавершённые копии (без описи) тоже убираются; чужие файлы в папке не трогаются.
      if (keep.has(id) || !/^\d{4}-\d\d-\d\d_/.test(id)) continue;
      await fs.rm(path.join(this.backupsDir, id), { recursive: true, force: true });
    }
  }

  /**
   * Вернуть наборы правил, подразделения и сценарии из копии поверх текущих. Созданное после копии
   * остаётся. Перед этим текущее состояние само сохраняется в копию «перед восстановлением».
   */
  restoreBackup(id: string): Promise<number> {
    return this.serial(async () => {
      if (!(await this.backups()).some((b) => b.id === id)) throw new Error('Резервная копия не найдена');
      await this.backupNow('restore', new Date());
      let n = 0;
      for (const col of BACKED_UP) {
        const dir = path.join(this.backupsDir, id, col);
        for (const name of await readdir(dir)) {
          if (!name.endsWith('.json')) continue;
          await writeAtomic(path.join(this.colDir(col), name), await fs.readFile(path.join(dir, name), 'utf8'));
          await fs.rm(this.trashFile(col, name.slice(0, -5)), { force: true });
          n++;
        }
      }
      return n;
    });
  }
}

/** Название объекта по началу файла — без разбора всего (бои бывают большими). */
async function readName(file: string): Promise<string | null> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const m = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buf.subarray(0, bytesRead).toString('utf8'));
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
