// Защита данных: корзина, резервные копии, повреждённые записи; пример «Линейной тактики».

import { expect, test } from '@playwright/test';
import { activeTabTitle, menu, openApp, openFromNav, startBattle } from './helpers';

const openSettings = (page: import('@playwright/test').Page) => page.locator('.nav-bottom .nav-item', { hasText: 'Настройки' }).click();

test('удалённый сценарий лежит в корзине и возвращается оттуда', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await page.locator('.page-head .btn.icon').click();
  await menu(page, 'Удалить сценарий');
  await page.locator('.modal-foot .btn.danger').click();
  await expect(page.locator('.toast').last()).toContainText('в корзине');
  await expect(page.locator('.sidebar .side-item', { hasText: 'атака на высоту' })).toHaveCount(0);

  await openSettings(page);
  await page.getByRole('button', { name: 'Открыть корзину…' }).click();
  const row = page.locator('.modal .data-row', { hasText: 'атака на высоту' });
  await expect(row).toContainText('удалено');
  await row.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('.modal')).toContainText('Корзина пуста');
  await page.keyboard.press('Escape');
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  await expect(page.locator('.sidebar .side-item', { hasText: 'атака на высоту' })).toHaveCount(1);

  // Удалённые бои — тоже в корзину, с кнопкой «Вернуть» в уведомлении.
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.locator('.battle-head .btn.icon').last().click();
  await menu(page, 'Удалить бой');
  await page.locator('.modal-foot .btn.danger').click();
  await page.locator('.toast-action', { hasText: 'Вернуть' }).click();
  await page.locator('.nav-item', { hasText: 'Бои' }).first().click();
  await expect(page.locator('.sidebar .side-item')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('резервная копия возвращает прежнее состояние', async ({ page }) => {
  const errors = await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Сделать копию сейчас' }).click();
  await expect(page.locator('.toast').last()).toContainText('Резервная копия сделана');
  await page.getByRole('button', { name: 'Сделать копию сейчас' }).click();
  await expect(page.locator('.toast').last()).toContainText('Изменений нет');

  await openFromNav(page, 'атака на высоту');
  await page.locator('.page-head .title-input').fill('Переименованный сценарий');
  await expect(activeTabTitle(page)).toHaveText('Переименованный сценарий');
  await page.waitForTimeout(600); // отложенное сохранение

  await openSettings(page);
  await page.getByRole('button', { name: 'Восстановить из копии…' }).click();
  await page.locator('.modal .data-row').first().getByRole('button', { name: 'Восстановить' }).click();
  await page.locator('.modal-foot .btn.primary', { hasText: 'Восстановить' }).click();
  await expect(page.getByText('Симулятор боя').first()).toBeVisible();
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  await expect(page.locator('.sidebar .side-item', { hasText: 'атака на высоту' })).toHaveCount(1);
  await expect(page.locator('.sidebar .side-item', { hasText: 'Переименованный' })).toHaveCount(0);
  // Состояние перед восстановлением тоже сохранено.
  await openSettings(page);
  await page.getByRole('button', { name: 'Восстановить из копии…' }).click();
  await expect(page.locator('.modal .data-row', { hasText: 'перед восстановлением' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('о повреждённой записи сообщается один раз, остальное загружается', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => localStorage.setItem('warsim:scenarios:broken', '{"id": "broken", "na'));
  await page.reload();
  const dlg = page.locator('.modal', { hasText: 'Часть данных не удалось прочитать' });
  await expect(dlg).toContainText('Сценарии: broken — запись повреждена');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  await expect(page.locator('.sidebar .side-item')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('warsim:damaged:scenarios:broken'))).toContain('broken');
  await page.reload();
  await expect(page.getByText('Симулятор боя').first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(dlg).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('клавиатура: навигатор, меню «⋯» и подсказки «?»', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  const items = page.locator('.sidebar .side-item');
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(activeTabTitle(page)).toHaveText((await items.nth(1).locator('span').first().textContent())!);

  const more = page.locator('.page-head .btn.icon');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-pop .menu-item').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu-pop .menu-item').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.menu-pop .menu-item').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-pop')).toHaveCount(0);
  await expect(more).toBeFocused();

  // Подсказка значка «?» видна при переходе на него клавишей Tab.
  const icon = page.locator('.hint-icon').first();
  await icon.scrollIntoViewIfNeeded();
  await icon.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(icon).toBeFocused();
  await expect(page.locator('.tooltip')).toHaveText((await icon.getAttribute('data-tip'))!);
  expect(errors).toEqual([]);
});

test('пример «Линейной тактики»: бой у переправы', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'бой у переправы');
  await expect(page.locator('.page-head .title-input')).toHaveValue(/линейная тактика/);
  await startBattle(page);
  await page.getByRole('button', { name: '▶ Ход' }).click();
  await expect(page.locator('.log-turn').first()).toContainText('Ход 1');
  await page.locator('.nav-item', { hasText: 'Подразделения' }).first().click();
  await expect(page.locator('.sidebar .nav-group-title', { hasText: 'Линейная тактика' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('у кого «Линейная тактика» уже была, пример боя добавляется один раз', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('demo-lin') || k.endsWith(':sc-demo-linear')) localStorage.removeItem(k);
    const rs = JSON.parse(localStorage.getItem('warsim:rulesets:rs-linear')!);
    rs.coefficients.casualtyScale = 1;
    rs.coefficients.moralePerLossPct = 1.2;
    localStorage.setItem('warsim:rulesets:rs-linear', JSON.stringify(rs));
    localStorage.removeItem('warsim-examples-linear');
  });
  await page.reload();
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  await expect(page.locator('.sidebar .side-item', { hasText: 'бой у переправы' })).toHaveCount(1);
  const k = await page.evaluate(() => JSON.parse(localStorage.getItem('warsim:rulesets:rs-linear')!).coefficients);
  expect([k.casualtyScale, k.moralePerLossPct]).toEqual([3, 2]);
  // Удалённый пример не возвращается при следующем запуске.
  await openFromNav(page, 'бой у переправы');
  await page.locator('.page-head .btn.icon').click();
  await menu(page, 'Удалить сценарий');
  await page.locator('.modal-foot .btn.danger').click();
  await page.reload();
  await page.locator('.nav-item', { hasText: 'Сценарии' }).first().click();
  await expect(page.locator('.sidebar .side-item')).toHaveCount(1);
  expect(errors).toEqual([]);
});
