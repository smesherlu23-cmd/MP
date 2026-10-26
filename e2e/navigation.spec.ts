// Навигация: разделы, «где я», назад / вперёд, нумерация случайных боёв, структура стороны в сценарии.

import { expect, test } from '@playwright/test';
import { pageTitle, navSec, openApp, openFromNav, startBattle } from './helpers';

test('разделы, крошки, назад / вперёд и номера боёв', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await expect(page.locator('.breadcrumbs')).toContainText('Сценарии');
  await expect(page.locator('.field', { hasText: 'Сид' })).toHaveCount(0);

  await startBattle(page);
  await expect(pageTitle(page)).toContainText('бой 1');
  await expect(page.locator('.nav-item.here', { hasText: 'Бои' })).toHaveCount(1);

  await page.locator('.tb-nav button[title^="Назад"]').click();
  await expect(pageTitle(page)).toHaveText('Пример: атака на высоту 212');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pageTitle(page)).toContainText('бой 1');

  await page.locator('.breadcrumbs a', { hasText: 'атака на высоту' }).click();
  await expect(pageTitle(page)).toHaveText('Пример: атака на высоту 212');
  await startBattle(page);
  await expect(pageTitle(page)).toContainText('бой 2');
  await expect(page.locator('.nav-sec[data-sec="battles"] .nav-group-title')).toHaveCount(1);
  await expect(page.locator('.nav-sec[data-sec="battles"] .side-item')).toHaveCount(2);

  // меню боя (в панели инструментов) — без сидов
  await page.locator('.tb-actions .btn.icon').last().click();
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

test('без вкладок: страница сменяет страницу, назад и вперёд, боковая панель', async ({ page }) => {
  const errors = await openApp(page);
  await navSec(page, 'Шаблоны');
  const items = page.locator('.nav-sec[data-sec="units"] .side-item');
  const first = (await items.nth(0).locator('span').first().textContent())!;
  const second = (await items.nth(1).locator('span').first().textContent())!;
  await items.nth(0).click();
  await expect(pageTitle(page)).toHaveText(first);
  await items.nth(1).click();
  await expect(pageTitle(page)).toHaveText(second);
  // Открыта одна страница; прежняя — в истории «назад».
  await expect(page.locator('.content > .page')).toHaveCount(1);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageTitle(page)).toHaveText(first);
  await page.locator('.tb-nav button[title^="Вперёд"]').click();
  await expect(pageTitle(page)).toHaveText(second);
  // Ctrl+B скрывает и показывает боковую панель.
  await page.keyboard.press('Control+B');
  await expect(page.locator('.app')).toHaveClass(/side-hidden/);
  await page.keyboard.press('Control+B');
  await expect(page.locator('.app')).not.toHaveClass(/side-hidden/);
  expect(errors).toEqual([]);
});

test('штаб, каталоги разделов и «+» (создать)', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.wf-step')).toHaveCount(5);
  // Каталог раздела: по щелчку на название раздела, с поиском и действиями в строке.
  await page.locator('.nav-sec[data-sec="scenarios"] .nav-item').click();
  await expect(pageTitle(page)).toHaveText('Сценарии');
  await expect(page.locator('.catalog-row')).toHaveCount(2);
  await page.locator('.catalog-search').fill('переправ');
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await page.locator('.catalog-row').getByRole('button', { name: 'Бой', exact: true }).click();
  await expect(pageTitle(page)).toContainText('бой 1');
  // Крошка раздела открывает его каталог.
  await page.locator('.breadcrumbs a', { hasText: 'Бои' }).click();
  await expect(page.locator('.catalog-row')).toHaveCount(1);
  await expect(page.locator('.catalog-row')).toContainText('идёт');
  // «+» в панели инструментов.
  await page.locator('.tb-create').click();
  await page.locator('.menu-pop .menu-item', { hasText: 'Сценарий' }).click();
  await expect(page.locator('.page-head .title-input')).toHaveValue(/сценарий/i);
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item')).toHaveCount(3);
  expect(errors).toEqual([]);
});
