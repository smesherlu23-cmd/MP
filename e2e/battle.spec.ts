// Бой: сводка сторон, окно элемента, итоги, хранение без подробностей, удаление боёв, прогоны.

import { expect, test } from '@playwright/test';
import { openApp, openFromNav, startBattle } from './helpers';

test('сводка сторон, окно элемента (просмотр и правка), итоги', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '▶ Ход' }).click();
  await expect(page.locator('.tbl.compare tbody tr').first()).toContainText('Личный состав');

  await page.locator('.tbl a', { hasText: '2-я мотострелковая рота' }).first().click();
  await expect(page.locator('.state-row').first()).toBeVisible();
  await expect(page.locator('.modal .fields input')).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить…' }).click();
  await expect(page.locator('.modal .fields input').first()).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'До конца' }).click();
  await expect(page.locator('.bignum')).toBeVisible();
  await expect(page.locator('.tbl.compare')).toContainText('Боеспособность');
  expect(errors).toEqual([]);
});

test('сохранённый бой хранится без подробностей и восстанавливает их по запросу', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.getByRole('button', { name: 'До конца' }).click();
  await expect(page.locator('.bignum')).toBeVisible();

  // дождаться записи на диск (в браузере — localStorage)
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('warsim:battles:') && localStorage.getItem(k)!.includes('"logTrimmed":true')).length,
      ),
    )
    .toBe(1);
  const stored = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('warsim:battles:'))!;
    const b = JSON.parse(localStorage.getItem(k)!);
    return { levels: [...new Set(b.log.map((e: { level: number }) => e.level))], withFactors: b.log.filter((e: { factors?: unknown }) => e.factors).length };
  });
  expect(stored.levels).not.toContain(2);
  expect(stored.withFactors).toBe(0);

  // после перезапуска разбор и подробный журнал восстанавливаются повтором боя
  await page.reload();
  await expect(page.getByText('Симулятор боя').first())
    .toBeVisible()
    .catch(() => {});
  await page.locator('.nav-item', { hasText: 'Бои' }).click();
  await page.locator('.nav-group .side-item').first().click();
  const entry = page.locator('.log-entry.has-f').first();
  await entry.click();
  await expect(page.locator('.factors').first()).toBeVisible();
  const normal = await page.locator('.log-entry').count();
  await page.locator('.log-head .seg button', { hasText: 'Всё' }).click();
  await expect.poll(() => page.locator('.log-entry').count()).toBeGreaterThan(normal);
  expect(errors).toEqual([]);
});

test('все бои сценария удаляются разом', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.locator('.breadcrumbs a', { hasText: 'атака на высоту' }).click();
  await startBattle(page);
  await expect(page.locator('.nav-group .side-item')).toHaveCount(2);
  await page.locator('.nav-group-title').hover();
  await page.locator('.nav-group-del').click();
  await page.locator('.modal').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.nav-group .side-item')).toHaveCount(0);
  await expect(page.locator('.nav-empty')).toContainText('Боёв пока нет');
  expect(errors).toEqual([]);
});

test('массовые прогоны считают вероятности и открывают прогон как бой', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await page.getByRole('button', { name: 'Прогоны' }).click();
  await expect(page.locator('.field', { hasText: 'сид' })).toHaveCount(0);
  const n = page.locator('.field', { hasText: 'Число прогонов' }).locator('input');
  await n.fill('30');
  await n.press('Tab');
  await page.getByRole('button', { name: /Запустить/ }).click();
  await expect(page.getByText('Исходы · 30 прогонов')).toBeVisible({ timeout: 30_000 });
  await page.locator('.card-head', { hasText: 'Отдельные прогоны' }).click();
  await page.getByRole('button', { name: 'Открыть' }).first().click();
  await expect(page.locator('.bignum')).toBeVisible();
  await expect(page.locator('.tab.active .tab-title')).toContainText('прогон');
  expect(errors).toEqual([]);
});
