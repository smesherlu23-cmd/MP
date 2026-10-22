// Справка: оглавление по группам, поиск по тексту, переход к разделу из Ctrl+K и из каталога типов.

import { expect, test } from '@playwright/test';
import { openApp, openFromNav } from './helpers';

test('справка: оглавление, поиск и руководство ГМ', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('.nav-item', { hasText: 'Справка' }).click();
  const toc = page.locator('.help-toc');
  await expect(toc.locator('.help-toc-title', { hasText: 'Руководство ГМ' })).toBeVisible();
  await expect(page.locator('.help-body section')).toHaveCount(await toc.locator('a').count());

  // Поиск сужает оглавление и текст до разделов, где встречаются все слова.
  await toc.locator('input').fill('снайпер маскировка');
  await expect(page.locator('#help-gm-samples')).toBeVisible();
  await expect(page.locator('#help-nav')).toHaveCount(0);
  await expect(toc.locator('.help-found')).toContainText('Найдено разделов');
  await page.screenshot({ path: 'test-results/help-search.png' });
  await toc.locator('input').press('Escape');
  await expect(page.locator('#help-nav')).toBeVisible();

  // Ctrl+K находит раздел справки и открывает его.
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('ценность как подобрать');
  await page.locator('.pal-item', { hasText: 'Ценность: как подобрать' }).first().click();
  await expect(toc.locator('a.on')).toHaveText('Ценность: как подобрать');
  await expect(page.locator('#help-gm-value')).toBeInViewport();
  await page.screenshot({ path: 'test-results/help-value.png' });

  // Из каталога типов — к разделу о числах типа.
  await openFromNav(page, 'Универсальный');
  await page.locator('.vnav button', { hasText: 'Каталог типов' }).click();
  await page.getByRole('button', { name: 'Как подобрать числа' }).click();
  await expect(page.locator('#help-gm-type-fields')).toBeInViewport();
  expect(errors).toEqual([]);
});
