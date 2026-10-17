// Навигация: разделы, «где я», назад / вперёд, нумерация случайных боёв, структура стороны в сценарии.

import { expect, test } from '@playwright/test';
import { activeTabTitle, openApp, openFromNav, startBattle } from './helpers';

test('разделы, крошки, назад / вперёд и номера боёв', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await expect(page.locator('.breadcrumbs')).toContainText('Сценарии');
  await expect(page.locator('.field', { hasText: 'Сид' })).toHaveCount(0);

  await startBattle(page);
  await expect(activeTabTitle(page)).toContainText('бой 1');
  await expect(page.locator('.nav-item.selected', { hasText: 'Бои' })).toHaveCount(1);

  await page.locator('.nav-arrows button[title^="Назад"]').click();
  await expect(activeTabTitle(page)).toHaveText('Пример: атака на высоту 212');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(activeTabTitle(page)).toContainText('бой 1');

  await page.locator('.breadcrumbs a', { hasText: 'атака на высоту' }).click();
  await expect(activeTabTitle(page)).toHaveText('Пример: атака на высоту 212');
  await startBattle(page);
  await expect(activeTabTitle(page)).toContainText('бой 2');
  await expect(page.locator('.nav-group-title')).toHaveCount(1);
  await expect(page.locator('.nav-group .side-item')).toHaveCount(2);

  // меню боя — без сидов
  await page.locator('.battle-head .btn.icon').last().click();
  const items = await page.locator('.menu-pop .menu-item').allTextContents();
  expect(items.some((x) => /сид/i.test(x))).toBe(false);
  expect(items).toContain('Повторить этот же бой');
  expect(errors).toEqual([]);
});

test('структура стороны в сценарии открывает узел в конструкторе', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await page.locator('.side-fold').first().click();
  await expect(page.locator('.side-node')).toHaveCount(7);
  await page.locator('.side-node', { hasText: '3-я мотострелковая' }).click();
  await expect(page.locator('.org-box.sel .org-name')).toContainText('3-я мотострелковая');
  await expect(page.locator('.breadcrumbs')).toContainText('Синие');
  expect(errors).toEqual([]);
});
