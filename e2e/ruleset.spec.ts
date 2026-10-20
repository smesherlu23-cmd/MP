// Наборы правил: новый набор на основе существующего или пустой.

import { expect, test } from '@playwright/test';
import { navSec, openApp } from './helpers';

test('новый набор правил предлагает основу и копирует каталог типов', async ({ page }) => {
  const errors = await openApp(page);
  await navSec(page, 'Наборы правил');
  await page.locator('.nav-sec[data-sec="rulesets"] .nav-add').click();
  const options = page.locator('.modal select option');
  await expect(options.first()).toContainText('На основе «Универсальный (пример)»');
  await expect(options.last()).toContainText('Пустой');
  await page.locator('.modal').getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.page-head .title-input')).toHaveValue('Универсальный (копия)');
  await page.locator('.vnav button', { hasText: 'Каталог типов' }).click();
  await expect(page.locator('.vnav button', { hasText: 'Каталог типов' })).toContainText('9');

  // пустой набор — без типов
  await page.locator('.nav-sec[data-sec="rulesets"] .nav-add').click();
  await page.locator('.modal select').selectOption({ index: (await options.count()) - 1 });
  await page.locator('.modal').getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.page-head .title-input')).toHaveValue('Новый набор правил');
  await expect(page.locator('.nav-sec[data-sec="rulesets"] .side-item')).toHaveCount(4);
  expect(errors).toEqual([]);
});
