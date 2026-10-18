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
  await page.locator('.side-node', { hasText: '3-я мотострелковая' }).locator('.side-node-name').click();
  await expect(page.locator('.org-box.sel .org-name')).toContainText('3-я мотострелковая');
  await expect(page.locator('.breadcrumbs')).toContainText('Синие');
  expect(errors).toEqual([]);
});

test('вкладки: просмотр из навигатора, закрепление, «закрыть другие»', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('.nav-item', { hasText: 'Шаблоны' }).first().click();
  const items = page.locator('.sidebar .side-item');
  // Щелчок — вкладка-просмотр: следующий щелчок открывает объект на её месте.
  await items.nth(0).click();
  await items.nth(1).click();
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page.locator('.tab.preview')).toHaveCount(1);
  // Двойной щелчок по вкладке — обычная вкладка; следующий объект откроется рядом.
  await page.locator('.tab.preview').dblclick();
  await items.nth(2).click();
  await expect(page.locator('.tab')).toHaveCount(3);
  // Закрепить «Главную» и закрыть остальные, кроме активной.
  await page.locator('.tab', { hasText: 'Главная' }).click({ button: 'right' });
  await page.locator('.menu-pop .menu-item', { hasText: 'Закрепить' }).click();
  await expect(page.locator('.tab.pinned')).toHaveCount(1);
  await page.locator('.tab.active').click({ button: 'right' });
  await page.locator('.menu-pop .menu-item', { hasText: 'Закрыть другие' }).click();
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page.locator('.tab.pinned .tab-title')).toHaveText('Главная');
  expect(errors).toEqual([]);
});
