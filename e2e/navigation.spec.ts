// Навигация: разделы, «где я», назад / вперёд, нумерация случайных боёв, структура стороны в сценарии.

import { expect, test } from '@playwright/test';
import { activeTabTitle, navSec, openApp, openFromNav, startBattle } from './helpers';

test('разделы, крошки, назад / вперёд и номера боёв', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await expect(page.locator('.breadcrumbs')).toContainText('Сценарии');
  await expect(page.locator('.field', { hasText: 'Сид' })).toHaveCount(0);

  await startBattle(page);
  await expect(activeTabTitle(page)).toContainText('бой 1');
  await expect(page.locator('.nav-item.here', { hasText: 'Бои' })).toHaveCount(1);

  await page.locator('.nav-arrows button[title^="Назад"]').click();
  await expect(activeTabTitle(page)).toHaveText('Пример: атака на высоту 212');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(activeTabTitle(page)).toContainText('бой 1');

  await page.locator('.breadcrumbs a', { hasText: 'атака на высоту' }).click();
  await expect(activeTabTitle(page)).toHaveText('Пример: атака на высоту 212');
  await startBattle(page);
  await expect(activeTabTitle(page)).toContainText('бой 2');
  await expect(page.locator('.nav-sec[data-sec="battles"] .nav-group-title')).toHaveCount(1);
  await expect(page.locator('.nav-sec[data-sec="battles"] .side-item')).toHaveCount(2);

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
  await navSec(page, 'Шаблоны');
  const items = page.locator('.nav-sec[data-sec="units"] .side-item');
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
  await page.locator('.tab', { hasText: 'Штаб' }).click({ button: 'right' });
  await page.locator('.menu-pop .menu-item', { hasText: 'Закрепить' }).click();
  await expect(page.locator('.tab.pinned')).toHaveCount(1);
  await page.locator('.tab.active').click({ button: 'right' });
  await page.locator('.menu-pop .menu-item', { hasText: 'Закрыть другие' }).click();
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page.locator('.tab.pinned .tab-title')).toHaveText('Штаб');
  expect(errors).toEqual([]);
});

test('штаб, каталоги разделов и «+ Создать»', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.wf-step')).toHaveCount(5);
  // Каталог раздела: по щелчку на название раздела, с поиском и действиями в строке.
  await page.locator('.nav-sec[data-sec="scenarios"] .nav-item').click();
  await expect(activeTabTitle(page)).toHaveText('Сценарии');
  await expect(page.locator('.catalog-row')).toHaveCount(2);
  await page.locator('.catalog-search').fill('переправ');
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await page.locator('.catalog-row').getByRole('button', { name: '▶ Бой' }).click();
  await expect(activeTabTitle(page)).toContainText('бой 1');
  // Крошка раздела открывает его каталог.
  await page.locator('.breadcrumbs a', { hasText: 'Бои' }).click();
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await expect(page.locator('.catalog-row')).toContainText('идёт');
  // «+ Создать» в навигаторе.
  await page.locator('.nav-tools .nav-create').click();
  await page.locator('.menu-pop .menu-item', { hasText: 'Сценарий' }).click();
  await expect(page.locator('.page-head .title-input')).toHaveValue(/сценарий/i);
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item')).toHaveCount(3);
  expect(errors).toEqual([]);
});
