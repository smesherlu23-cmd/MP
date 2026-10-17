// Правка: отмена и повтор, быстрый переход (Ctrl+K), клавиатура в конструкторе.

import { expect, test } from '@playwright/test';
import { menu, openApp, openFromNav } from './helpers';

const selName = (page: import('@playwright/test').Page) => page.locator('.org-box.sel .org-name, .unit-row.sel .unit-name').first();

test('удаление без подтверждения, «Отменить» в уведомлении, Ctrl+Z / Ctrl+Y', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  await expect(page.locator('.org-box')).toHaveCount(8);
  await page.locator('.org-box', { hasText: 'Разведвзвод' }).click();
  await page.locator('.org-box', { hasText: 'Разведвзвод' }).locator('.org-menu button').click();
  await menu(page, 'Удалить');
  await expect(page.locator('.org-box')).toHaveCount(7);
  await page.locator('.toast-action', { hasText: 'Отменить' }).click();
  await expect(page.locator('.org-box')).toHaveCount(8);

  // ввод текста отменяется одним шагом
  const title = page.locator('.page-head .title-input');
  const before = await title.inputValue();
  await title.click();
  await title.press('End');
  await title.pressSequentially(' X', { delay: 20 });
  await expect(title).toHaveValue(`${before} X`);
  await page.keyboard.press('Control+z');
  await expect(title).toHaveValue(before);
  await page.keyboard.press('Control+y');
  await expect(title).toHaveValue(`${before} X`);

  // подразделение, убранное из сценария, возвращается
  await openFromNav(page, 'атака на высоту');
  const units = page.locator('.side-unit');
  const n = await units.count();
  await units.first().locator('button[title="Убрать из сценария"]').click();
  await expect(units).toHaveCount(n - 1);
  await page.keyboard.press('Control+z');
  await expect(units).toHaveCount(n);
  expect(errors).toEqual([]);
});

test('быстрый переход открывает вложенное подразделение и тип набора правил', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('миномётный взвод');
  await expect(page.locator('.pal-item').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.org-box.sel .org-name')).toHaveText('Миномётный взвод');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('танк тип');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-head', { hasText: 'Танк' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('клавиатура в конструкторе: стрелки, Ctrl+D, Del, Ins, F2', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  await page.locator('.org-box', { hasText: 'Штаб батальона' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(selName(page)).toContainText('1-я мотострелковая');
  await page.keyboard.press('ArrowUp');
  await expect(selName(page)).toContainText('батальон');
  await page.keyboard.press('ArrowDown');
  await expect(selName(page)).toContainText('Штаб');

  const boxes = page.locator('.org-box');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+d');
  await expect(boxes).toHaveCount(9);
  await expect(selName(page)).toHaveText('4-я мотострелковая рота');
  await page.keyboard.press('Delete');
  await expect(boxes).toHaveCount(8);
  await page.keyboard.press('Insert');
  await expect(boxes).toHaveCount(9);
  await page.keyboard.press('F2');
  await page.keyboard.type('Взвод связи');
  await page.keyboard.press('Enter');
  await expect(selName(page)).toHaveText('Взвод связи');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(boxes).toHaveCount(8);

  await page.locator('.seg button', { hasText: 'Список' }).click();
  await page.locator('.unit-row', { hasText: 'Штаб батальона' }).click();
  await page.keyboard.press('ArrowDown');
  await expect(selName(page)).toContainText('1-я мотострелковая');
  await page.keyboard.press('ArrowLeft');
  await expect(selName(page)).toContainText('батальон');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.unit-row')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.unit-row')).toHaveCount(8);
  expect(errors).toEqual([]);
});
