// Бой: откат ходов, план боя (подкрепления), объяснение итога, донесения для игроков, список боёв.

import { expect, test, type Page } from '@playwright/test';
import { navSec, openApp, openFromNav, startBattle } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const turnMeta = (page: Page) => page.locator('.battle-head .meta');
const stepBtn = (page: Page) => page.getByRole('button', { name: 'Ход', exact: true });

test('откат: кнопка ↶, Ctrl+Z / Ctrl+Y и «Вернуться к ходу…»', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await expect(page.locator('.tb-actions button[title^="Отменить"]')).toHaveCount(0);
  for (let i = 0; i < 3; i++) await stepBtn(page).click();
  await expect(turnMeta(page)).toContainText('Ход 3 из');

  await page.locator('.tb-actions button[title^="Отменить: ход 3"]').click();
  await expect(turnMeta(page)).toContainText('Ход 2 из');
  await expect(page.locator('.toast').last()).toContainText('Отменён ход 3');
  await page.keyboard.press('Control+z');
  await expect(turnMeta(page)).toContainText('Ход 1 из');
  await page.keyboard.press('Control+y');
  await expect(turnMeta(page)).toContainText('Ход 2 из');

  await stepBtn(page).click();
  await stepBtn(page).click();
  await expect(turnMeta(page)).toContainText('Ход 4 из');
  await page.locator('.tb-actions .btn.icon').last().click();
  await page.locator('.menu-pop .menu-item', { hasText: 'Вернуться к ходу' }).click();
  await page.locator('.modal select').selectOption('1');
  await page.locator('.modal').getByRole('button', { name: 'Выбрать' }).click();
  await expect(turnMeta(page)).toContainText('Ход 1 из');
  expect(errors).toEqual([]);
});

test('план боя: подкрепление подходит в свой ход или раньше по решению ГМ', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  const plan = page.locator('.card', { has: page.locator('.card-head', { hasText: 'План боя' }) });
  await plan.locator('.card-head').click();
  await plan.getByRole('button', { name: '+ Подход подкреплений' }).click();
  const row = plan.locator('.plan-row').first();
  await row.locator('input').first().fill('3');
  await row.locator('input').first().blur();
  const nodeSel = row.locator('select').nth(2);
  const tank = await nodeSel.locator('option', { hasText: 'Танковая' }).getAttribute('value');
  await nodeSel.selectOption(tank!);
  await expect(page.locator('.note', { hasText: 'План боя' })).toHaveCount(0);

  await startBattle(page);
  const tankRow = page.locator('tr', { hasText: 'Танковая рота' });
  await expect(tankRow).toContainText('Подойдёт на 3-м ходу');
  await stepBtn(page).click();
  await stepBtn(page).click();
  await expect(tankRow).toContainText('Подойдёт на 3-м ходу');
  await stepBtn(page).click();
  await expect(tankRow).not.toContainText('Подойдёт');
  await expect(page.locator('.log-entry', { hasText: 'Подходят подкрепления' })).toHaveCount(1);

  // Новый бой: ГМ вводит танки раньше плана.
  await page.locator('.breadcrumbs a', { hasText: 'атака' }).click();
  await startBattle(page);
  await page.locator('tr', { hasText: 'Танковая рота' }).getByRole('button', { name: 'ввести сейчас' }).click();
  await expect(page.locator('tr', { hasText: 'Танковая рота' })).not.toContainText('Подойдёт');
  await expect(page.locator('.log-entry', { hasText: 'раньше плана' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('итог с объяснением, донесения для игроков и название в списке боёв', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.getByRole('button', { name: 'До конца' }).click();
  await expect(page.locator('.result-why')).toContainText(/Решило\.|поровну/);

  await page.getByRole('button', { name: 'донесение для «Синие»' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('донесение для стороны «Синие»');
  expect(text).toContain('(оценка)');
  expect(text).not.toContain('ГМ:');

  // Длинный итог не вытесняет название боя в навигаторе.
  await navSec(page, 'Бои');
  const name = page.locator('.nav-sec[data-sec="battles"] .side-item > span').first();
  await expect(name).toHaveText('бой 1');
  expect((await name.boundingBox())!.width).toBeGreaterThan(25);
  expect(errors).toEqual([]);
});
