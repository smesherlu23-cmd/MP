// Стороны сценария: несколько подразделений и их части; командиры — в сценарии; главная; узкое окно.

import { expect, test } from '@playwright/test';
import { openApp, openFromNav, startBattle } from './helpers';

test('на сторону — силы целиком и частями, новые силы из шаблона; лишние части не воюют', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  const blue = page.locator('.side-card').first();
  const red = page.locator('.side-card').nth(1);
  // Вместо батальона целиком — только его 2-я рота.
  await blue.locator('.side-unit').first().locator('button[title^="Убрать из сценария"]').click();
  await blue.getByRole('button', { name: '+ Добавить на сторону…' }).click();
  const modal = page.locator('.modal');
  await expect(modal.locator('.pick-row', { hasText: 'Оборонительный узел' }).first()).toContainText('уже в сценарии');
  await expect(modal.locator('.pick-row', { hasText: 'Пехотная бригада' })).toHaveCount(0);
  await modal.locator('.pick-row', { hasText: '1-й мотострелковый батальон' }).locator('.side-fold').click();
  await modal.locator('.pick-row', { hasText: '2-я мотострелковая рота' }).locator('input[type=checkbox]').check();
  await modal.getByRole('button', { name: 'Добавить (1)' }).click();
  await expect(
    blue.locator('.side-unit', { hasText: '2-я мотострелковая рота · 1-й мотострелковый батальон' }).locator('.badge', { hasText: 'часть' }),
  ).toHaveCount(1);

  // Новые силы по шаблону ×2 — сразу на сторону и в «Силы».
  await blue.getByRole('button', { name: '+ Добавить на сторону…' }).click();
  await modal.locator('.seg button', { hasText: 'Новые из шаблона' }).click();
  const platoon = modal.locator('.pick-row', { hasText: 'Мотострелковый взвод' });
  await platoon.locator('input[type=checkbox]').check();
  await platoon.locator('input:not([type=checkbox])').last().fill('2');
  await platoon.locator('input:not([type=checkbox])').last().blur();
  await modal.getByRole('button', { name: 'Добавить (2)' }).click();
  await expect(blue.locator('.side-unit')).toHaveCount(3);
  await expect(blue).toContainText('Всего на стороне: 3 подразделения');

  // У Красных — без 3-го взвода.
  await red.locator('.side-unit').first().locator('.side-fold').click();
  await red.locator('.side-node', { hasText: '3-й взвод' }).locator('input[type=checkbox]').uncheck();
  await expect(red.locator('.side-unit').first()).toContainText('без 1 части');

  await startBattle(page);
  const forces = page.locator('.tbl.forces');
  await expect(forces.first()).toContainText('2-я мотострелковая рота · 1-й мотострелковый батальон');
  await expect(forces.first()).toContainText('Мотострелковый взвод 2');
  await expect(forces.first()).not.toContainText('3-я мотострелковая рота');
  await expect(forces.nth(1)).not.toContainText('3-й взвод');
  expect(errors).toEqual([]);
});

test('командира в конструкторе нет; в сценарии — у каждого формирования, можно «без командира»', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотостр');
  await expect(page.locator('.field .label', { hasText: /^Командир/ })).toHaveCount(0);
  await expect(page.getByText('свой командир')).toHaveCount(0);

  await openFromNav(page, 'атака на высоту');
  const blue = page.locator('.side-card').first();
  await blue.locator('.sec-toggle', { hasText: 'Командиры в начале боя' }).click();
  const row = blue.locator('.cmd-row').first();
  await expect(row).toContainText('1-й мотострелковый батальон');
  await row.locator('select').selectOption('0');
  await expect(blue.locator('.sec-toggle', { hasText: 'Командиры в начале боя' }).locator('..')).toContainText('без командира');
  await startBattle(page);
  await expect(page.locator('.tbl.forces tr.group select').first()).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('главная: «продолжить» незавершённый бой и недавно изменённое', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.card', { hasText: 'С чего начать' })).toBeVisible();
  await openFromNav(page, 'атака на высоту');
  await page.locator('.page-head .title-input').fill('Высота 212 — мой вариант');
  await startBattle(page);
  await page.getByRole('button', { name: '▶ Ход' }).click();
  await page.locator('.nav-home .nav-item').click();
  const cont = page.locator('.card', { hasText: 'Продолжить' });
  await expect(cont).toContainText('ход 1');
  await expect(page.locator('.card', { hasText: 'С чего начать' })).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'Недавно изменено' })).toContainText('Высота 212 — мой вариант');
  await cont.getByRole('button', { name: 'Продолжить ▶' }).click();
  await expect(page.getByRole('button', { name: '▶ Ход' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('узкое окно: панель инструментов помещается, поиск раскрывается по Ctrl+F', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  // Кнопки боя и общие кнопки — в пределах окна, без наложения.
  const bar = (await page.locator('.toolbar-win').boundingBox())!;
  const actions = (await page.locator('.tb-actions').boundingBox())!;
  const global = (await page.locator('.tb-global').boundingBox())!;
  expect(actions.x + actions.width).toBeLessThanOrEqual(global.x + 1);
  expect(global.x + global.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  // Поле поиска свёрнуто до значка; Ctrl+F раскрывает его, ввод фильтрует боковую панель.
  const search = page.locator('.tb-search');
  expect((await search.boundingBox())!.width).toBeLessThan(40);
  await page.keyboard.press('Control+F');
  await expect(page.locator('.tb-search input')).toBeFocused();
  await page.keyboard.type('Танковая');
  await expect(page.locator('.nav-sec[data-sec="units"] .side-item')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tb-search input')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('неполный состав: из взвода в бой идут трое, остальные остаются в силах', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  const red = page.locator('.side-card').nth(1);
  await red.locator('.side-unit').first().locator('.side-fold').click();
  const row = red.locator('.side-node', { hasText: '1-й взвод' });
  await row.locator('.partial-stats').click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Кто идёт в бой — «1-й взвод»');
  const typeRow = (name: string) => modal.locator('tr', { hasText: name });
  await typeRow('Стрелок').locator('input').fill('3');
  await typeRow('Стрелок').locator('input').blur();
  for (const name of ['Пулемёт', 'Противотанк']) {
    const r = typeRow(name);
    if (await r.count()) await r.getByRole('button', { name: '0' }).click();
  }
  await expect(modal).toContainText('В бою: 3 из');
  await modal.getByRole('button', { name: 'Готово' }).click();
  await expect(row.locator('.partial-btn')).toContainText('в бою 3 из');
  await expect(red.locator('.side-unit').first()).toContainText('неполный состав: 1 часть');

  await startBattle(page);
  const forces = page.locator('.tbl.forces').nth(1);
  await expect(forces.locator('tr', { hasText: '1-й взвод' }).locator('td.num').first()).toHaveText('3/3');
  await expect(page.locator('.battle-log')).toContainText('В бою не весь состав');
  expect(errors).toEqual([]);
});
