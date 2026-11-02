// Доработки: раздел тегов, перебор коэффициента и история прогонов, боевой путь и печать состава, заметка в бою.

import { expect, test } from '@playwright/test';
import { menu, openApp, openFromNav, startBattle } from './helpers';

test('теги: раздел набора правил — где используется, переименование везде', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'Универсальный');
  await page.locator('.vnav button', { hasText: 'Теги' }).click();
  const row = page.locator('.tags-tbl tbody tr', { hasText: 'разведка' }).first();
  await expect(row).toContainText('Разведчик');
  await row.locator('button[aria-haspopup="menu"]').click();
  await menu(page, 'Переименовать…');
  await page.locator('.modal input').fill('дозор');
  await page.locator('.modal').getByRole('button', { name: 'ОК' }).click();
  await expect(page.locator('.tags-tbl tbody tr', { hasText: 'дозор' }).first()).toContainText('Разведчик');
  // Тег разведки переименован вместе с тегом.
  await expect(page.locator('.tags-tbl tbody td:first-child b', { hasText: /^разведка$/ })).toHaveCount(0);
  await expect(page.locator('.tags-tbl tbody tr', { hasText: 'дозор' }).first()).toContainText('· тег разведки');
  // Каталог типов: поиск по #тегу.
  await page.locator('.vnav button', { hasText: 'Каталог типов' }).click();
  await page.getByPlaceholder('Найти тип или #тег…').fill('#дозор');
  await expect(page.locator('.page')).toContainText('Разведчик');
  expect(errors).toEqual([]);
});

test('прогоны: задачи и подразделения, история, перебор коэффициента с выгрузкой', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await page.getByRole('button', { name: 'Прогоны' }).click();
  const n = page.locator('.field', { hasText: 'Число прогонов' }).locator('input');
  await n.fill('12');
  await n.press('Tab');
  await page.getByRole('button', { name: /Запустить/ }).click();
  await expect(page.getByText('Исходы · 12 прогонов')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.card', { hasText: 'Задачи и подразделения' })).toContainText('выполнена');
  await page.getByRole('button', { name: /Запустить/ }).click();
  const hist = page.locator('.section', { hasText: 'Последние прогоны' });
  await expect(hist).toBeVisible({ timeout: 30_000 });
  if (!(await hist.locator('.card-body').count())) await hist.locator('.card-head').click();
  await expect(hist.locator('tbody tr')).toHaveCount(2);

  const cmp = page.locator('.section', { hasText: 'Сравнение вариантов' });
  if (!(await cmp.locator('.card-body').count())) await cmp.locator('.card-head').click();
  await cmp.locator('select').first().selectOption({ label: 'Коэффициент набора правил' });
  await cmp.locator('select').nth(1).selectOption({ label: 'Темп потерь' });
  await cmp.locator('.field', { hasText: 'От' }).locator('input').fill('0,5');
  await cmp.locator('.field', { hasText: 'До' }).locator('input').fill('1,5');
  const step = cmp.locator('.field', { hasText: 'Шаг' }).locator('input');
  await step.fill('0,5');
  await step.blur();
  const runs = cmp.locator('.field', { hasText: 'Прогонов на вариант' }).locator('input');
  await runs.fill('10');
  await runs.blur();
  await cmp.getByRole('button', { name: 'Сравнить', exact: true }).click();
  await expect(cmp.locator('tbody tr')).toHaveCount(3, { timeout: 30_000 });
  await expect(cmp.locator('tbody tr').first()).toContainText('0,5');
  await expect(cmp.getByRole('button', { name: 'Выгрузить' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('силы: своя запись в боевом пути, печать и выгрузка состава в меню', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  const hist = page.locator('.section', { hasText: 'Боевой путь' });
  await hist.getByRole('button', { name: '+ Запись' }).click();
  await page.locator('.modal').getByPlaceholder('Марш к переправе, переформирование…').fill('Марш к переправе');
  await page.locator('.modal').getByRole('button', { name: 'Добавить' }).click();
  if (!(await hist.locator('.card-body').count())) await hist.locator('.card-head').click();
  await expect(hist).toContainText('Марш к переправе');
  await hist.locator('.history-row button[aria-haspopup="menu"]').first().click();
  await expect(page.locator('.menu-pop')).toContainText('Удалить запись');
  await page.keyboard.press('Escape');
  await page.locator('.tb-actions button[aria-haspopup="menu"]').last().click();
  await expect(page.locator('.menu-pop')).toContainText('Печать состава…');
  await expect(page.locator('.menu-pop')).toContainText('Состав таблицей (CSV)…');
  expect(errors).toEqual([]);
});

test('бой: заметка ГМ в журнал', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.locator('.tb-actions button[aria-haspopup="menu"]').last().click();
  await menu(page, 'Заметка в журнал…');
  await page.locator('.modal textarea').fill('игрок отводит роту к опушке');
  await page.locator('.modal').getByRole('button', { name: 'Записать' }).click();
  await expect(page.locator('.battle-log')).toContainText('Заметка ГМ: игрок отводит роту к опушке');
  expect(errors).toEqual([]);
});
