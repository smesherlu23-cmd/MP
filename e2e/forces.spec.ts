// Шаблоны и силы: шаблон — устройство и штат, силы — конкретные подразделения; итоги боя — в силы.

import { expect, test, type Page } from '@playwright/test';
import { makeDemoBattalion, makeDemoScenario } from '../src/engine';
import { menu, navSec, openApp, openFromNav, startBattle } from './helpers';

const blueStart = async (page: Page) =>
  Number((await page.locator('.tbl.compare tr', { hasText: 'Личный состав' }).locator('td').nth(1).locator('b').first().textContent())!.replace(/\s/g, ''));

test('итоги боя записываются в силы, а не в шаблон; следующий бой — с этими потерями', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  const before = await blueStart(page);
  await page.getByRole('button', { name: 'До конца' }).click();
  const card = page.locator('.forces-note');
  await expect(card).toContainText('1-й мотострелковый батальон');
  await card.getByRole('button', { name: 'Записать итоги в силы' }).click();
  await expect(card).toContainText('Итоги записаны в силы');
  // Повторная запись — только с подтверждением.
  await card.getByRole('button', { name: 'Записать ещё раз…' }).click();
  await expect(page.locator('.modal')).toContainText('Потери вычтутся повторно');
  await page.keyboard.press('Escape');

  await openFromNav(page, '1-й мотострелковый батальон');
  const pers = Number((await page.locator('.stat', { hasText: 'Личный состав' }).locator('.v').textContent())!.split('из')[0].replace(/\s/g, ''));
  expect(pers).toBeLessThan(before);
  await openFromNav(page, 'Мотострелковый батальон (пример)');
  await expect(page.locator('.stat', { hasText: 'По штату' })).toContainText('489');

  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  expect(await blueStart(page)).toBe(pers);
  expect(errors).toEqual([]);
});

test('шаблон без приказа и состояния; силы по шаблону; в сценарии нет вводной', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'Мотострелковая рота');
  await expect(page.locator('.field .label', { hasText: /^Приказ/ })).toHaveCount(0);
  await expect(page.locator('.field .label', { hasText: /^Уровень/ })).toHaveCount(0);
  await expect(page.locator('.card-head', { hasText: 'Состояние' })).toHaveCount(0);
  await expect(page.locator('.comp-table th', { hasText: 'В строю' })).toHaveCount(0);

  await page.locator('.page-head .btn.icon').last().click();
  await page.locator('.menu-pop .menu-item', { hasText: 'Создать силы по шаблону' }).click();
  await page.locator('.modal input').fill('2');
  await page.locator('.modal-foot .btn.primary').click();
  await expect(page.locator('.toast').last()).toContainText('Создано сил: 2');
  await navSec(page, 'Силы');
  await expect(page.locator('.nav-sec[data-sec="forces"] .side-item', { hasText: 'Мотострелковая рота' })).toHaveCount(2);
  await page.locator('.nav-sec[data-sec="forces"] .side-item', { hasText: 'Мотострелковая рота 2' }).click();
  await expect(page.locator('.breadcrumbs')).toContainText('Силы');
  await expect(page.locator('.card-head', { hasText: 'Состояние' })).toHaveCount(1);
  await expect(page.locator('.comp-table th', { hasText: 'В строю' }).first()).toBeVisible();
  await expect(page.locator('.field .label', { hasText: /^Приказ/ })).toHaveCount(0);

  await openFromNav(page, 'атака на высоту');
  await expect(page.getByPlaceholder('Вводная (необязательно)')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('данные прежней версии: копии в сценарии становятся силами, шаблоны очищаются', async ({ page }) => {
  const errors = await openApp(page);
  // Как было до «сил»: сценарий хранит копии подразделений, у шаблона — приказы и состояние.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('warsim:forces:')) localStorage.removeItem(k);
    localStorage.removeItem('warsim-model-forces');
  });
  const legacy = makeDemoScenario();
  legacy.id = 'sc-legacy';
  legacy.name = 'Старый сценарий';
  const tpl = { ...makeDemoBattalion(), id: 'old-bn', name: 'Старый батальон', rulesetId: 'rs-universal' };
  await page.evaluate(
    ({ sc, t }) => {
      localStorage.setItem(`warsim:scenarios:${sc.id}`, JSON.stringify(sc));
      localStorage.setItem(`warsim:formations:${t.id}`, JSON.stringify(t));
    },
    { sc: legacy, t: tpl },
  );
  await page.reload();
  await expect(page.locator('.toast').first()).toContainText('перенесены в «Силы»');
  await navSec(page, 'Силы');
  await expect(page.locator('.nav-sec[data-sec="forces"] .side-item', { hasText: '1-й мотострелковый батальон' })).toHaveCount(1);
  await openFromNav(page, 'Старый сценарий', 'Сценарии');
  const blue = page.locator('.side-card').first();
  await expect(blue.locator('.side-unit')).toContainText('1-й мотострелковый батальон');
  await blue.locator('.side-fold').first().click();
  await expect(blue.locator('.side-node', { hasText: '3-я мотострелковая рота' }).locator('select')).toHaveValue('reserve');
  await openFromNav(page, 'Старый батальон');
  await expect(page.locator('.card-head', { hasText: 'Состояние' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('часть сил передаётся в другое подразделение и возвращается на место', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, '1-й мотострелковый батальон');
  const tank = page.locator('.org-box', { hasText: 'Танковая рота' });
  await tank.click();
  await expect(page.locator('.field', { hasText: 'Стоять насмерть' })).toHaveCount(0);
  await expect(page.getByText('Придано', { exact: true })).toHaveCount(0);
  await tank.locator('.org-menu button').click();
  await menu(page, 'Передать в другое подразделение');
  const modal = page.locator('.modal');
  await modal.locator('.pick-row', { hasText: 'Оборонительный узел' }).locator('input[type=radio]').check();
  await modal.getByRole('button', { name: 'Передать' }).click();
  // Открылись силы, куда передано: рота там с отметкой «передано».
  await expect(page.locator('.tab.active .tab-title')).toContainText('Оборонительный узел');
  const moved = page.locator('.org-box', { hasText: 'Танковая рота' });
  await expect(moved.locator('.badge', { hasText: 'передано' })).toHaveCount(1);
  await moved.locator('.org-menu button').click();
  await menu(page, 'Вернуть в «1-й мотострелковый батальон');
  await expect(page.locator('.org-box', { hasText: 'Танковая рота' })).toHaveCount(0);
  await openFromNav(page, '1-й мотострелковый батальон');
  await expect(page.locator('.org-box', { hasText: 'Танковая рота' }).locator('.badge', { hasText: 'передано' })).toHaveCount(0);
  await expect(page.locator('.org-box', { hasText: 'Танковая рота' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('раздел «Силы»: что пострадало в бою — видно сразу, восстанавливается одной кнопкой', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.getByRole('button', { name: 'До конца' }).click();
  await page.getByRole('button', { name: 'Записать итоги в силы' }).click();

  // В сценарии — напоминание, что силы не восстановлены.
  await openFromNav(page, 'атака на высоту');
  const worn = page.locator('.worn-forces');
  await expect(worn).toHaveCount(2);
  await expect(worn.first()).toContainText('не восстановлены');

  // Раздел «Силы»: сводка, фильтр, кнопка «Восстановить всех».
  await (await navSec(page, 'Силы')).locator('.nav-item').first().click();
  await expect(page.locator('.page-head h1')).toHaveText('Силы');
  const summary = page.locator('.forces-summary');
  await expect(summary).toContainText('раненых ждут возвращения');
  await page
    .locator('.catalog-bar')
    .getByRole('button', { name: /^Ниже нормы/ })
    .click();
  await expect(page.locator('.force-card')).toHaveCount(2);
  await expect(page.locator('.force-card .badge').first()).not.toHaveText('Боеготовы');
  await summary.getByRole('button', { name: /Восстановить всех/ }).click();
  await expect(page.locator('.force-card')).toHaveCount(0);
  await page
    .locator('.catalog-bar')
    .getByRole('button', { name: /^Боеготовы/ })
    .click();
  await expect(page.locator('.force-card')).toHaveCount(4);
  await expect(summary.getByRole('button', { name: /Восстановить всех/ })).toBeDisabled();

  // Ctrl+Z возвращает потери; в сценарии напоминание исчезает после восстановления.
  await page.keyboard.press('Control+z');
  await expect(summary.getByRole('button', { name: /Восстановить всех/ })).toBeEnabled();
  await openFromNav(page, 'атака на высоту');
  await expect(worn).toHaveCount(2);
  await worn
    .first()
    .getByRole('button', { name: /Восстановить/ })
    .click();
  await expect(worn).toHaveCount(1);
  expect(errors).toEqual([]);
});
