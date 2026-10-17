import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataStore } from '../electron/protect';

let dir = '';
let store: DataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warsim-'));
  store = new DataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const exists = (p: string) =>
  fs.stat(path.join(dir, p)).then(
    () => true,
    () => false,
  );

describe('файлы данных', () => {
  it('удаление — в корзину; из корзины объект возвращается', async () => {
    await store.save('scenarios', 'sc-1', { id: 'sc-1', name: 'Бой у моста', sides: [] });
    await store.remove('scenarios', 'sc-1');
    expect(await store.list('scenarios')).toHaveLength(0);
    const trash = await store.trash();
    expect(trash).toMatchObject([{ col: 'scenarios', key: 'sc-1', name: 'Бой у моста' }]);
    const data = (await store.restoreTrash('scenarios', 'sc-1')) as { name: string };
    expect(data.name).toBe('Бой у моста');
    expect(await store.list('scenarios')).toHaveLength(1);
    expect(await store.trash()).toHaveLength(0);
  });

  it('сохранение убирает копию из корзины (отмена удаления); старое удаляется через 30 дней', async () => {
    await store.save('formations', 'f-1', { id: 'f-1', name: 'Рота' });
    await store.remove('formations', 'f-1');
    await store.save('formations', 'f-1', { id: 'f-1', name: 'Рота' });
    expect(await store.trash()).toHaveLength(0);

    await store.save('battles', 'b-1', { id: 'b-1', name: 'Бой' });
    await store.remove('battles', 'b-1');
    const old = new Date(Date.now() - 31 * 864e5);
    await fs.utimes(path.join(dir, 'trash', 'battles', 'b-1.json'), old, old);
    expect(await store.trash()).toHaveLength(0);
    expect(await exists('trash/battles/b-1.json')).toBe(false);
  });

  it('нечитаемый файл откладывается в damaged и сообщается один раз', async () => {
    await store.save('rulesets', 'rs-ok', { id: 'rs-ok', name: 'Целый' });
    await fs.writeFile(path.join(dir, 'rulesets', 'rs-bad.json'), '{"id": "rs-bad", "na');
    await fs.writeFile(path.join(dir, 'rulesets', 'rs-empty.json'), '');
    const list = await store.list('rulesets');
    expect(list).toEqual([{ id: 'rs-ok', name: 'Целый' }]);
    const problems = store.takeProblems();
    expect(problems.map((p) => [p.file, p.error]).sort()).toEqual([
      ['rs-bad.json', 'файл повреждён'],
      ['rs-empty.json', 'файл пуст'],
    ]);
    expect(await exists('rulesets/rs-bad.json')).toBe(false);
    expect((await fs.readdir(path.join(dir, 'damaged', 'rulesets'))).length).toBe(2);
    expect(store.takeProblems()).toHaveLength(0);
    await store.list('rulesets');
    expect(store.takeProblems()).toHaveLength(0);
  });

  it('резервная копия: только при изменениях, без боёв; восстановление поверх текущего', async () => {
    expect(await store.backup('auto')).toBeNull();
    await store.save('rulesets', 'rs-1', { id: 'rs-1', name: 'Правила', v: 1 });
    await store.save('battles', 'b-1', { id: 'b-1', name: 'Бой' });
    const first = await store.backup('auto', new Date(2026, 0, 1, 10));
    expect(first?.counts).toEqual({ rulesets: 1, formations: 0, scenarios: 0 });
    expect(await exists(`backups/${first!.id}/battles`)).toBe(false);
    expect(await store.backup('auto')).toBeNull();
    expect((await store.backup('manual'))?.unchanged).toBe(true);

    await store.save('rulesets', 'rs-1', { id: 'rs-1', name: 'Правила', v: 2 });
    await store.save('scenarios', 'sc-new', { id: 'sc-new', name: 'Новый' });
    await store.remove('rulesets', 'rs-1');
    const n = await store.restoreBackup(first!.id);
    expect(n).toBe(1);
    expect(await store.load('rulesets', 'rs-1')).toMatchObject({ v: 1 });
    expect(await store.load('scenarios', 'sc-new')).toMatchObject({ name: 'Новый' });
    expect(await store.trash()).toHaveLength(0);
    // Состояние до восстановления сохранено отдельной копией.
    const list = await store.backups();
    expect(list[0].kind).toBe('restore');
    expect(list[0].counts).toEqual({ rulesets: 0, formations: 0, scenarios: 1 });
  });

  it('хранятся 10 последних автоматических копий и по одной за прошлые дни', async () => {
    let v = 0;
    const step = async (d: Date) => {
      await store.save('formations', 'f-1', { id: 'f-1', v: ++v });
      await store.backup('auto', d);
    };
    for (const day of [1, 2, 3]) await step(new Date(2026, 0, day, 12));
    for (let h = 0; h < 12; h++) await step(new Date(2026, 0, 10, h));
    await store.save('formations', 'f-1', { id: 'f-1', v: ++v });
    await store.backup('manual', new Date(2026, 0, 10, 23));
    const list = await store.backups();
    const auto = list.filter((b) => b.kind === 'auto');
    expect(auto).toHaveLength(13);
    expect(list.filter((b) => b.kind === 'manual')).toHaveLength(1);
    expect(auto.map((b) => b.id)).toContain('2026-01-01_12-00-00');
    expect(auto.map((b) => b.id)).not.toContain('2026-01-10_00-00-00');
    expect(await fs.readdir(path.join(dir, 'backups'))).toHaveLength(14);
  });
});
