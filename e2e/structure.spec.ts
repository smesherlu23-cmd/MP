// Структура войск: оргсхема, наследование, шаблоны и их обновление, перетаскивание, придание.

import { expect, test } from '@playwright/test';
import { dnd, menu, navItem, openApp, openFromNav } from './helpers';

test('оргсхема, наследование и список', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  await expect(page.locator('.org-box')).toHaveCount(8);

  await page.locator('.org-box', { hasText: '2-я мотострелковая рота' }).click();
  await expect(page.locator('.section .sec-summary', { hasText: 'всё как у старшего' })).toHaveCount(1);
  await page.locator('.section .card-head', { hasText: 'Состояние' }).click();
  await expect(page.locator('.field', { hasText: 'Мораль' }).locator('.faint', { hasText: 'как у старшего' })).toHaveCount(1);

  await page.locator('.seg button', { hasText: 'Список' }).click();
  await expect(page.locator('.unit-row')).toHaveCount(8);
  await page.locator('.seg button', { hasText: 'Схема' }).click();
  expect(errors).toEqual([]);
});

test('шаблон: вставка ×3 с номерами и обновление всех копий', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'Мотострелковая рота');
  await page.locator('.org-box').first().click();
  await page.locator('.org-box').first().locator('.org-menu button').click();
  await menu(page, 'Вставить из библиотеки');
  await page.locator('.insert-item', { hasText: 'Мотострелковый взвод' }).click();
  const cnt = page.locator('.modal-foot input').first();
  await cnt.fill('3');
  await cnt.press('Tab');
  await page.locator('.modal').getByRole('button', { name: /Вставить/ }).click();
  await expect(page.locator('.org-name', { hasText: 'Мотострелковый взвод 3' })).toHaveCount(1);

  // шаблон изменился — копии в батальоне помечены
  await openFromNav(page, '1-й мотострелковый батальон');
  await expect(page.locator('.badge', { hasText: 'шаблон ⟳' })).toHaveCount(3);
  await openFromNav(page, 'Мотострелковая рота');
  await page.locator('.meta a', { hasText: 'обновить все' }).click();
  await openFromNav(page, '1-й мотострелковый батальон');
  await expect(page.locator('.badge', { hasText: 'шаблон ⟳' })).toHaveCount(0);
  await expect(page.locator('.org-box')).toHaveCount(17);
  expect(errors).toEqual([]);
});

test('перетаскивание в схеме, из навигатора и придание в сценарии', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  await dnd(page, page.locator('.org-box', { hasText: 'Миномётная батарея' }), page.locator('.org-box', { hasText: '1-я мотострелковая рота' }));
  await page.locator('.seg button', { hasText: 'Список' }).click();
  const rows = await page.locator('.unit-row').allTextContents();
  const i = rows.findIndex((r) => r.includes('1-я мотострелковая рота'));
  expect(rows.slice(i + 1, i + 3).some((r) => r.includes('Миномётная'))).toBe(true);

  await dnd(page, await navItem(page, 'Танковая рота'), page.locator('.unit-row').first());
  await expect(page.locator('.unit-row', { hasText: 'Танковая рота' })).toHaveCount(2);

  await openFromNav(page, 'атака на высоту');
  const side = page.locator('.side-card').first();
  await dnd(page, await navItem(page, 'Танковая рота'), side.locator('.side-drop'));
  await expect(side.locator('.side-unit')).toHaveCount(2);
  await dnd(page, side.locator('.side-unit').nth(1), side.locator('.side-unit').nth(0));
  await expect(side.locator('.side-unit')).toHaveCount(1);
  await expect(side.getByText('придано: 2')).toHaveCount(1);

  await page.getByRole('button', { name: /Начать бой/ }).click();
  await page.getByRole('button', { name: 'До конца' }).click();
  await expect(page.locator('.bignum')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('пустое подразделение: подсказка, набор правил и его смена', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('.nav-item', { hasText: 'Подразделения' }).click();
  await page.locator('.nav-create').click();
  await expect(page.locator('.empty-start')).toBeVisible();
  await expect(page.locator('.inline-select')).toHaveValue('rs-universal');
  await page.locator('.empty-start-actions button', { hasText: 'Подчинённое' }).click();
  await expect(page.locator('.empty-start')).toHaveCount(0);
  await expect(page.locator('.org-box')).toHaveCount(2);
  await page.locator('.inline-select').selectOption({ label: 'Линейная тактика (пример)' });
  await expect(page.locator('.nav-group-title')).toHaveCount(2);
  expect(errors).toEqual([]);
});
