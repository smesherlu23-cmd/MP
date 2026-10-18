// Управление боем и новые механики: до события, прогноз, ветка боя, групповые решения, эффекты, удары,
// участки боя, события по условию, силы между боями, перебор параметра, перенос между наборами правил.

import { expect, test } from '@playwright/test';
import { menu, openApp, openFromNav, startBattle } from './helpers';

test('бой: «до события», прогноз и ветка боя', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.getByRole('button', { name: '⏭ До события' }).click();
  await expect(page.locator('.pause-note, .bignum').first()).toBeVisible();
  await page.getByRole('button', { name: 'Прогноз' }).click();
  const modal = page.locator('.modal');
  await expect(modal.locator('table.forecast')).toContainText('Победа: Синие', { timeout: 20000 });
  await modal.getByRole('button', { name: 'Закрыть' }).click();
  await page.locator('.battle-head button[aria-haspopup="menu"]').click();
  await menu(page, 'Ответвить бой');
  await page.locator('.modal .modal-foot').getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.tab.active .tab-title')).toContainText('ветка с хода');
  await expect(page.locator('.battle-head .meta')).toContainText('ветка боя');
  expect(errors).toEqual([]);
});

test('бой: групповой приказ, эффект на выбранных и удар огневой поддержки', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  const blue = page.locator('.tbl.forces').first();
  const checks = blue.locator('tr:not(.group) input.pick-check');
  await checks.nth(0).check();
  await checks.nth(1).check();
  const bar = page.locator('.group-bar');
  await expect(bar).toContainText('Выбрано: 2 элемента');
  await bar.locator('select').selectOption({ label: 'Закрепление' });
  await expect(page.locator('.battle-log')).toContainText('приказ «Закрепление»');
  // Приказ доходит не сразу: под приказом — «в пути».
  await expect(blue.locator('.order-pending', { hasText: 'Закрепление' })).toHaveCount(2);
  await bar.getByRole('button', { name: 'Эффект…' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Наложить' }).click();
  await expect(page.locator('.support-panel')).toContainText('«Дымовая завеса»');
  await expect(blue.locator('.badge', { hasText: 'Дымовая завеса' })).toHaveCount(2);

  // Удар артиллерии Синих — по формированию Красных; наносится в начале следующего хода.
  await page.locator('.support-panel').getByRole('button', { name: 'Удар…' }).click();
  const m = page.locator('.modal');
  await m.locator('select').nth(1).selectOption({ index: 1 });
  await m.getByRole('button', { name: 'Вызвать удар' }).click();
  await expect(page.locator('.support-panel')).toContainText('в начале 1-го хода');
  await expect(page.locator('.support-panel')).toContainText('2 из 3');
  await page.getByRole('button', { name: '▶ Ход' }).click();
  await expect(page.locator('.battle-log')).toContainText('удар «Артдивизион полка»');
  expect(errors).toEqual([]);
});

test('сценарий: участки боя, событие по условию и удар по плану', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  // Длительность — в часах; ходов столько, сколько их укладывается при длине хода набора правил.
  const hours = page.locator('.field', { hasText: 'Длительность боя, ч' }).locator('input');
  await expect(hours).toHaveValue('4');
  await hours.fill('2');
  await hours.blur();
  await expect(page.locator('.field', { hasText: 'Длительность боя, ч' }).locator('.hint-icon')).toHaveAttribute('data-tip', /8 ходов по 15 мин/);
  // Ширина фронта: общая — в «Обстановке»; с участками — у каждого участка.
  const width = page.locator('.field', { hasText: 'Ширина фронта, м' }).locator('input');
  await width.fill('800');
  await width.blur();
  await expect(width).toHaveValue('800');
  const sectors = page.locator('.section', { hasText: 'Участки боя' });
  if (!(await sectors.locator('.card-body').count())) await sectors.locator('.card-head').click();
  // Пояснение раздела — в «?» у заголовка; щелчок по нему раздел не сворачивает.
  await sectors.locator('.card-head .hint-icon').click();
  await expect(sectors.locator('.card-body')).toHaveCount(1);
  await expect(page.locator('.tooltip')).toContainText('Без участков бой идёт на одной общей дистанции');
  await sectors.getByRole('button', { name: '+ Разделить поле боя на участки' }).click();
  await expect(sectors.locator('.sector-row')).toHaveCount(2);
  await expect(page.locator('.field', { hasText: 'Ширина фронта, м' })).toHaveCount(0);
  await sectors.locator('.sector-row').nth(0).locator('.numwrap input').fill('500');
  await sectors.locator('.sector-row').nth(1).locator('select').first().selectOption({ label: 'Средняя' });
  // Оборона Красных — на втором участке.
  const red = page.locator('.side-card').nth(1);
  await red.locator('.side-unit').first().locator('select').nth(1).selectOption({ label: 'Участок 2' });
  const blue = page.locator('.side-card').first();
  await blue.locator('.side-unit').first().locator('select').nth(1).selectOption({ label: 'Участок 2' });

  const plan = page.locator('.section', { hasText: 'План боя' });
  if (!(await plan.locator('.card-body').count())) await plan.locator('.card-head').click();
  await plan.getByRole('button', { name: '+ Удар поддержки' }).click();
  await plan.getByRole('button', { name: '+ Смена приказа' }).click();
  const row = plan.locator('.plan-row').last();
  await row.locator('.plan-extra select').first().selectOption('trigger');
  await expect(row).toContainText('не раньше хода');
  await expect(page.locator('.page')).not.toContainText('нет сил стороны');

  await startBattle(page);
  await expect(page.locator('.battle-head .meta')).toContainText('из 8');
  await expect(page.locator('.battle-head .meta')).toContainText('0 мин из 2 ч');
  await expect(page.locator('.battle-head .meta')).toContainText('Участок 2:');
  await expect(page.locator('.battle-head .meta')).toContainText('Средняя');
  await page.getByRole('button', { name: '▶ Ход' }).click();
  await expect(page.locator('.battle-log')).toContainText('удар «Артдивизион полка»');
  expect(errors).toEqual([]);
});

test('силы между боями: итоги в боевой путь, отдых, пополнение', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await startBattle(page);
  await page.getByRole('button', { name: 'До конца' }).click();
  await page.getByRole('button', { name: 'Записать итоги в силы' }).click();
  await openFromNav(page, '1-й мотострелковый батальон');
  const hist = page.locator('.section', { hasText: 'Боевой путь' });
  await expect(hist).toContainText('боёв: 1');
  await page.locator('.page-head button[aria-haspopup="menu"]').click();
  await menu(page, 'Отдых и восстановление');
  await expect(page.locator('.modal')).toContainText('вернётся в строй');
  await page.locator('.modal').getByRole('button', { name: 'Отдых' }).click();
  await expect(hist).toContainText('Отдых 7 дней');
  await page.locator('.page-head button[aria-haspopup="menu"]').click();
  await menu(page, 'Пополнить до штата');
  await page.locator('.modal').getByRole('button', { name: 'Пополнить' }).click();
  await expect(hist).toContainText('Пополнение до штата');
  expect(errors).toEqual([]);
});

test('прогоны: перебор параметра — по строке на значение', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'атака на высоту');
  await page.getByRole('button', { name: 'Прогоны' }).click();
  const cmp = page.locator('.section', { hasText: 'Сравнение вариантов' });
  if (!(await cmp.locator('.card-body').count())) await cmp.locator('.card-head').click();
  await cmp.locator('select').first().selectOption({ label: 'Разведданные стороны' });
  const runs = cmp.locator('.field', { hasText: 'Прогонов на вариант' }).locator('input');
  await runs.fill('20');
  await runs.blur();
  await cmp.getByRole('button', { name: '▶ Сравнить' }).click();
  await expect(cmp.locator('tbody tr')).toHaveCount(3, { timeout: 30000 });
  await expect(cmp.locator('tbody')).toContainText('Полные');
  expect(errors).toEqual([]);
});

test('набор правил: временные эффекты, перенос из другого набора, сопоставление типов', async ({ page }) => {
  const errors = await openApp(page);
  await openFromNav(page, 'Линейная');
  await page.locator('.vnav button', { hasText: 'Временные эффекты' }).click();
  await expect(page.locator('.kpi')).toHaveCount(4);
  await page.locator('.page-head button[aria-haspopup="menu"]').click();
  await menu(page, 'Перенести из другого набора');
  const m = page.locator('.modal');
  await m.getByRole('checkbox', { name: 'Танк', exact: true }).check();
  await m.getByRole('button', { name: 'Перенести (1)' }).click();
  await expect(page.locator('.vnav button', { hasText: 'Каталог типов' })).toContainText('7');

  // Шаблон переходит на набор, где нет его типов: предлагается сопоставить.
  await openFromNav(page, 'Мотострелковый взвод');
  await page.locator('.inline-select').selectOption({ label: 'Линейная тактика (пример)' });
  await expect(page.locator('.modal')).toContainText('типы состава');
  await page.locator('.modal').getByRole('button', { name: 'Перейти' }).click();
  await expect(page.locator('.inline-select')).toHaveValue('rs-linear');
  expect(errors).toEqual([]);
});
