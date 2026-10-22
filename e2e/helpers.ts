// Общие действия для проверок интерфейса.

import { expect, type Locator, type Page } from '@playwright/test';

/** Открыть программу с примерами (каждая проверка — с чистого хранилища). */
export async function openApp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByText('Симулятор боя').first()).toBeVisible();
  return errors;
}

const SECTION_OF: [string, string][] = [
  ['атака на высоту', 'Сценарии'],
  ['бой у переправы', 'Сценарии'],
  ['Универсальный', 'Наборы правил'],
  ['Линейная', 'Наборы правил'],
  // Силы примеров (конкретные подразделения); остальное — шаблоны.
  ['1-й мотострелковый батальон', 'Силы'],
  ['1-й мотостр', 'Силы'],
  ['Оборонительный узел «Высота', 'Силы'],
];

const SEC_ID: Record<string, string> = { Сценарии: 'scenarios', Бои: 'battles', Силы: 'forces', Шаблоны: 'units', 'Наборы правил': 'rulesets' };

/** Раздел навигатора (дерево): разворачивается, если свёрнут. */
export async function navSec(page: Page, label: string): Promise<Locator> {
  // Поле поиска навигатора могло остаться заполненным — тогда видны только совпадения.
  const search = page.locator('.nav-search input');
  if (await search.inputValue()) await search.fill('');
  const sec = page.locator(`.nav-sec[data-sec="${SEC_ID[label]}"]`);
  if (!(await sec.evaluate((e) => e.classList.contains('open')))) await sec.locator('.nav-chev').click();
  await expect(sec).toHaveClass(/open/);
  return sec;
}

/** Пункт навигатора: раздел разворачивается, объект — в его списке. */
export async function navItem(page: Page, text: string, section?: string): Promise<Locator> {
  const label = section ?? SECTION_OF.find(([t]) => text.includes(t))?.[1] ?? 'Шаблоны';
  const sec = await navSec(page, label);
  const item = sec.locator('.side-item', { hasText: text }).first();
  if (await item.count()) return item;
  // В длинном разделе видны не все — остальные находятся полем поиска навигатора.
  await page.locator('.nav-search input').fill(text);
  return page.locator(`.nav-sec[data-sec="${SEC_ID[label]}"] .side-item`, { hasText: text }).first();
}

export async function openFromNav(page: Page, text: string, section?: string) {
  await (await navItem(page, text, section)).click();
  await page.locator('.nav-search input').fill('');
}

/** Пункт открытого меню «⋯». */
export async function menu(page: Page, label: string) {
  await page.locator('.menu-pop .menu-item', { hasText: label }).first().click();
}

/** Перетаскивание (HTML5 drag and drop) одного элемента на другой. */
export async function dnd(page: Page, src: Locator, dst: Locator) {
  await src.waitFor();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await src.dispatchEvent('dragstart', { dataTransfer: dt });
  await dst.dispatchEvent('dragover', { dataTransfer: dt });
  await dst.dispatchEvent('drop', { dataTransfer: dt });
}

export const activeTabTitle = (page: Page) => page.locator('.tab.active .tab-title');

/** Начать бой со страницы открытого сценария и дождаться экрана боя. */
export async function startBattle(page: Page) {
  await page.getByRole('button', { name: /Начать бой/ }).click();
  await expect(page.getByRole('button', { name: '▶ Ход' })).toBeVisible();
}
