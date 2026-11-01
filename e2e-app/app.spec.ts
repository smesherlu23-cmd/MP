// Настоящее приложение: первый запуск создаёт папку данных с примерами, следующий — резервную копию;
// правка, сделанная прямо перед закрытием окна, доходит до диска и видна после перезапуска.

import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const profile = mkdtempSync(path.join(tmpdir(), 'echelon-app-'));
const dataDir = path.join(profile, 'data');

async function launch(): Promise<ElectronApplication> {
  const exe = process.env.ECHELON_EXE;
  return electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }),
    env: { ...process.env, ECHELON_PROFILE_DIR: profile },
  });
}

/** Закрыть окно так же, как кнопкой «×», и дождаться выхода программы. */
async function closeLikeUser(app: ElectronApplication) {
  const exited = new Promise<void>((r) => app.process().once('exit', () => r()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await exited;
}

const scenarioNames = () =>
  readdirSync(path.join(dataDir, 'scenarios'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dataDir, 'scenarios', f), 'utf8')).name as string);

test.afterAll(() => rmSync(profile, { recursive: true, force: true }));

test('файлы данных: первый запуск, правка перед закрытием, перезапуск', async () => {
  let app = await launch();
  let win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await expect(win.getByText('Симулятор боя').first()).toBeVisible();

  // Первый запуск: примеры записаны в папку данных.
  await expect.poll(() => scenarioNames().some((n) => n.includes('атака на высоту'))).toBe(true);

  // Переименование и сразу закрытие окна — запись не должна потеряться.
  const sec = win.locator('.nav-sec[data-sec="scenarios"]');
  if (!(await sec.evaluate((e) => e.classList.contains('open')))) await sec.locator('.nav-chev').click();
  await sec.locator('.side-item', { hasText: 'атака на высоту' }).first().click({ button: 'right' });
  await win.locator('.menu-pop .menu-item', { hasText: 'Переименовать' }).first().click();
  await win.locator('.sidebar .rename-input').fill('Высота 212 перед закрытием');
  await win.locator('.sidebar .rename-input').press('Enter');
  await closeLikeUser(app);
  expect(scenarioNames()).toContain('Высота 212 перед закрытием');
  expect(errors).toEqual([]);

  // Перезапуск: данные на месте.
  app = await launch();
  win = await app.firstWindow();
  await expect(win.locator('.nav-sec[data-sec="scenarios"]')).toBeVisible();
  const sec2 = win.locator('.nav-sec[data-sec="scenarios"]');
  if (!(await sec2.evaluate((e) => e.classList.contains('open')))) await sec2.locator('.nav-chev').click();
  await expect(sec2.locator('.side-item', { hasText: 'Высота 212 перед закрытием' })).toHaveCount(1);
  // При запуске с данными — резервная копия.
  expect(readdirSync(path.join(dataDir, 'backups')).length).toBeGreaterThan(0);
  await closeLikeUser(app);
});
