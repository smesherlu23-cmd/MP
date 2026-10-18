// Стороны сценария: несколько подразделений и их части; командиры — в сценарии; главная; вкладки.

import { expect, test } from '@playwright/test';
import { openApp, openFromNav, startBattle } from './helpers';

test('на сторону — несколько подразделений и отдельные части; лишние части не воюют', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  const blue = page.locator('.side-card').first();
  await blue.getByRole('button', { name: '+ Добавить подразделения…' }).click();
  const modal = page.locator('.modal');
  // Другие наборы правил скрыты, пока их не попросили.
  await expect(modal.locator('.pick-row', { hasText: 'Гусарский эскадрон' })).toHaveCount(0);
  await modal.locator('.pick-row', { hasText: '1-й мотострелковый батальон' }).locator('.side-fold').click();
  const company = modal.locator('.pick-row', { hasText: '2-я мотострелковая рота' });
  await company.locator('input[type=checkbox]').check();
  await company.locator('input[type=text], input:not([type])').last().fill('2');
  await company.locator('input[type=text], input:not([type])').last().blur();
  await modal.locator('.pick-row', { hasText: 'Мотострелковый взвод' }).locator('input[type=checkbox]').check();
  await expect(modal.getByRole('button', { name: 'Добавить (3)' })).toBeVisible();
  await modal.getByRole('button', { name: 'Добавить (3)' }).click();
  await expect(blue.locator('.side-unit')).toHaveCount(4);
  await expect(blue).toContainText('Всего на стороне: 4 подразделения');

  // Без 3-й роты: галочка в структуре батальона.
  await blue.locator('.side-unit').first().locator('.side-fold').click();
  await blue.locator('.side-node', { hasText: '3-я мотострелковая рота' }).locator('input[type=checkbox]').uncheck();
  await expect(blue.locator('.side-unit').first()).toContainText('без 1 части');

  await startBattle(page);
  const forces = page.locator('.tbl.forces').first();
  await expect(forces).toContainText('2-я мотострелковая рота · 1-й мотострелковый батальон');
  await expect(forces).toContainText('Мотострелковый взвод');
  await expect(forces).not.toContainText('3-я мотострелковая рота');
  expect(errors).toEqual([]);
});

test('командира в конструкторе нет; в сценарии — у каждого формирования, можно «без командира»', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотостр');
  await expect(page.locator('.field .label', { hasText: /^Командир/ })).toHaveCount(0);
  await expect(page.getByText('свой командир')).toHaveCount(0);

  await openFromNav(page, 'атака на высоту');
  const blue = page.locator('.side-card').first();
  await blue.locator('.sec-toggle', { hasText: 'Командиры в начале боя' }).click();
  const row = blue.locator('.cmd-row').first();
  await expect(row).toContainText('1-й мотострелковый батальон');
  await row.locator('select').selectOption('0');
  await expect(blue.locator('.sec-toggle').locator('..')).toContainText('без командира');
  await startBattle(page);
  await expect(page.locator('.tbl.forces tr.group select').first()).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('главная: «продолжить» незавершённый бой и недавно изменённое', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.card', { hasText: 'С чего начать' })).toBeVisible();
  await openFromNav(page, 'атака на высоту');
  await page.locator('.page-head .title-input').fill('Высота 212 — мой вариант');
  await startBattle(page);
  await page.getByRole('button', { name: '▶ Ход' }).click();
  await page.locator('.nav-item', { hasText: 'Главная' }).click();
  const cont = page.locator('.card', { hasText: 'Продолжить' });
  await expect(cont).toContainText('ход 1');
  await expect(page.locator('.card', { hasText: 'С чего начать' })).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'Недавно изменено' })).toContainText('Высота 212 — мой вариант');
  await cont.getByRole('button', { name: 'Продолжить ▶' }).click();
  await expect(page.getByRole('button', { name: '▶ Ход' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('узкое окно: вкладки сжимаются, лишние — в списке «▾»', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const errors = await openApp(page);
  await page.locator('.nav-item', { hasText: 'Подразделения' }).first().click();
  const items = page.locator('.sidebar .side-item');
  const n = await items.count();
  for (let i = 0; i < n; i++) await items.nth(i).click();
  const more = page.locator('.tabs-more .btn');
  await expect(more).toBeVisible();
  // Кнопки справа не перекрывают полосу вкладок.
  const tabs = (await page.locator('.tabs').boundingBox())!;
  const right = (await page.locator('.topbar-right').boundingBox())!;
  expect(tabs.x + tabs.width).toBeLessThanOrEqual(right.x + 1);
  await more.click();
  await expect(page.locator('.menu-pop .menu-item')).toHaveCount(n + 1);
  await page.locator('.menu-pop .menu-item', { hasText: 'Главная' }).click();
  await expect(page.locator('.tab.active .tab-title')).toHaveText('Главная');
  expect(errors).toEqual([]);
});
