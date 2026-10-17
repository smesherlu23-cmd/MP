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
  ['Универсальный', 'Наборы правил'],
  ['Линейная', 'Наборы правил'],
];

/** Пункт навигатора: сначала выбирается нужный раздел, потом объект в его списке. */
export async function navItem(page: Page, text: string): Promise<Locator> {
  const sec = SECTION_OF.find(([t]) => text.includes(t))?.[1] ?? 'Подразделения';
  await page.locator('.nav-item', { hasText: sec }).first().click();
  return page.locator('.sidebar .side-item', { hasText: text }).first();
}

export async function openFromNav(page: Page, text: string) {
  await (await navItem(page, text)).click();
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
