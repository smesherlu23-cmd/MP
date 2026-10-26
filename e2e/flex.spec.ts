// Гибкость окна: меню по правому щелчку, переименование на месте, избранное и недавние, быстрый просмотр,
// инспектор свойств, перетаскивание части в другие силы, импорт файла перетаскиванием, настройка окна.

import { expect, test } from '@playwright/test';
import { dnd, menu, navItem, openApp, openFromNav, pageTitle } from './helpers';

test('правый щелчок в боковой панели: переименовать на месте, в избранное, быстрый просмотр', async ({ page }) => {
  const errors = await openApp(page);
  const row = await navItem(page, 'атака на высоту');
  await row.click({ button: 'right' });
  await menu(page, 'Переименовать');
  const input = page.locator('.sidebar .rename-input');
  await expect(input).toBeFocused();
  await input.fill('Высота 212');
  await input.press('Enter');
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'Высота 212' })).toHaveCount(1);
  // Esc отменяет переименование.
  await page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'Высота 212' }).dblclick();
  await page.locator('.sidebar .rename-input').fill('не то');
  await page.locator('.sidebar .rename-input').press('Escape');
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'Высота 212' })).toHaveCount(1);

  // В избранное — блок вверху боковой панели; там же меню «Убрать из избранного».
  await page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'Высота 212' }).click({ button: 'right' });
  await menu(page, 'В избранное');
  const fav = page.locator('.nav-favs .side-item', { hasText: 'Высота 212' });
  await expect(fav).toHaveCount(1);
  await fav.click();
  await expect(pageTitle(page)).toHaveText('Высота 212');

  // Пробел — быстрый просмотр, ещё раз — закрыть.
  await fav.focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.modal .ql-sides')).toContainText('Синие');
  await page.keyboard.press(' ');
  await expect(page.locator('.modal')).toHaveCount(0);

  await fav.click({ button: 'right' });
  await menu(page, 'Убрать из избранного');
  await expect(page.locator('.nav-favs')).toHaveCount(0);

  // Недавние: открытые объекты.
  await openFromNav(page, '1-й мотострелковый батальон');
  await page.locator('.nav-recent .nav-heading-btn').click();
  await expect(page.locator('.nav-recent .side-item').first()).toContainText('1-й мотострелковый батальон');
  expect(errors).toEqual([]);
});

test('удаление из меню — сразу, с «Отменить»; Delete на строке боковой панели', async ({ page }) => {
  const errors = await openApp(page);
  const row = await navItem(page, 'бой у переправы');
  await row.focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'бой у переправы' })).toHaveCount(0);
  await page.locator('.toast-action', { hasText: 'Отменить' }).click();
  await expect(page.locator('.nav-sec[data-sec="scenarios"] .side-item', { hasText: 'бой у переправы' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('свойства подразделения — в инспекторе справа; часть сил перетаскивается на другие силы в боковой панели', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  const tank = page.locator('.org-box', { hasText: 'Танковая рота' });
  await tank.click();
  const insp = page.locator('.inspector');
  await expect(insp.locator('.node-title')).toHaveValue('Танковая рота');
  // Правый щелчок по блоку — действия с ним.
  await tank.click({ button: 'right' });
  await expect(page.locator('.menu-pop')).toContainText('Передать в другое подразделение');
  await page.keyboard.press('Escape');
  // Инспектор скрывается и показывается кнопкой в панели инструментов.
  await page.locator('.tb-actions .tb-icon[aria-pressed]').click();
  await expect(insp).toHaveClass(/hidden/);
  await page.locator('.tb-actions .tb-icon[aria-pressed]').click();
  await expect(insp).not.toHaveClass(/hidden/);

  const target = await navItem(page, 'Оборонительный узел «Высота');
  await dnd(page, tank, target);
  await expect(page.locator('.toast').last()).toContainText('передано в «Оборонительный узел');
  await expect(page.locator('.org-box', { hasText: 'Танковая рота' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('файл JSON, брошенный на окно, импортируется', async ({ page }) => {
  const errors = await openApp(page);
  const tpl = { id: 'u-drop', name: 'Взвод из файла', level: 'взвод', children: [], composition: [], state: {} };
  await page.evaluate((json) => {
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'vzvod.template.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, JSON.stringify(tpl));
  await expect(page.locator('.toast').last()).toContainText('Взвод из файла');
  await expect(pageTitle(page)).toHaveText('Взвод из файла');
  await expect(page.locator('.file-drop')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('настройка окна: кнопки панели инструментов и масштаб', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.tb-global .tb-undo')).toHaveCount(2);
  await page.locator('.toolbar-win').click({ button: 'right', position: { x: 520, y: 26 } });
  await menu(page, 'Отменить и повторить');
  await expect(page.locator('.tb-global .tb-undo')).toHaveCount(0);
  await page.locator('.toolbar-win').click({ button: 'right', position: { x: 520, y: 26 } });
  await menu(page, 'Масштаб');
  await expect(page.locator('.tb-zoom-val')).toHaveText('100%');
  await page.keyboard.press('Control+Equal');
  await expect(page.locator('.tb-zoom-val')).toHaveText('110%');
  await page.keyboard.press('Control+Digit0');
  await expect(page.locator('.tb-zoom-val')).toHaveText('100%');
  // То же — в окне «Настроить окно…».
  await page.locator('.tb-global > .tb-icon[title="Меню"]').click();
  await menu(page, 'Настроить окно…');
  await page.locator('.modal .check', { hasText: 'Отменить и повторить' }).locator('input').check();
  await page.locator('.modal').getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.tb-global .tb-undo')).toHaveCount(2);
  expect(errors).toEqual([]);
});
