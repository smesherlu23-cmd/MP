// Адаптив под экран: в узком окне боковая панель и инспектор выезжают поверх страницы, на большом экране
// (4K при масштабе Windows 100%) интерфейс сам становится крупнее.

import { expect, test } from '@playwright/test';
import { openApp, pageTitle } from './helpers';

test('узкое окно: боковая панель и инспектор поверх страницы, страница не сжимается', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 560 });
  const errors = await openApp(page);
  const app = page.locator('.app');
  // Боковая панель скрыта, страница — во всю ширину окна.
  await expect(app).toHaveClass(/side-hidden/);
  expect((await page.locator('.main-col').boundingBox())!.width).toBeGreaterThan(710);
  const show = page.locator('.toolbar-win > button.tb-icon[title^="Показать боковую"]');
  await show.click();
  await expect(app).not.toHaveClass(/side-hidden/);
  await expect(page.locator('.sidebar-col')).toBeInViewport();
  expect((await page.locator('.main-col').boundingBox())!.width).toBeGreaterThan(710);

  // Открыли объект — панель уехала.
  const sec = page.locator('.nav-sec[data-sec="forces"]');
  if (!(await sec.evaluate((e) => e.classList.contains('open')))) await sec.locator('.nav-chev').click();
  await sec.locator('.side-item', { hasText: '1-й мотострелковый батальон' }).first().click();
  await expect(app).toHaveClass(/side-hidden/);
  await expect(pageTitle(page)).toContainText('1-й мотострелковый');

  // Escape, щелчок мимо и Ctrl+B тоже закрывают.
  await show.click();
  await page.keyboard.press('Escape');
  await expect(app).toHaveClass(/side-hidden/);
  await page.keyboard.press('Control+b');
  await expect(app).not.toHaveClass(/side-hidden/);
  await page.locator('.side-scrim').click({ position: { x: 600, y: 300 } });
  await expect(app).toHaveClass(/side-hidden/);

  // Инспектор свойств скрыт; по кнопке выезжает поверх схемы, схема своей ширины не теряет.
  const insp = page.locator('aside.inspector');
  await expect(insp).toHaveClass(/hidden/);
  const before = (await page.locator('.split-main').boundingBox())!.width;
  await page.locator('.tb-icon[title*="свойства"]').click();
  await expect(insp).not.toHaveClass(/hidden/);
  await expect(insp.locator('.field', { hasText: 'Эшелон' })).toBeInViewport();
  expect((await page.locator('.split-main').boundingBox())!.width).toBe(before);

  // Окно шире — панели снова рядом со страницей, как были (сохранённые настройки не тронуты).
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(app).not.toHaveClass(/side-hidden/);
  await expect(insp).not.toHaveClass(/hidden/);
  expect((await page.locator('.split-main').boundingBox())!.width).toBeLessThan(1440 - 260 - 300);
  expect(errors).toEqual([]);
});

test.describe('большой экран', () => {
  test.use({ viewport: { width: 3840, height: 2160 }, screen: { width: 3840, height: 2160 } });

  test('автомасштаб: на 4K всё крупнее, свой масштаб — Ctrl+плюс/минус, Ctrl+0 — снова авто', async ({ page }) => {
    const errors = await openApp(page);
    const app = page.locator('.app');
    await expect(app).toHaveAttribute('style', /zoom: 1\.5/);
    await page.keyboard.press('Control+Minus');
    await expect(app).toHaveAttribute('style', /zoom: 1\.4/);
    await page.keyboard.press('Control+Digit0');
    await expect(app).toHaveAttribute('style', /zoom: 1\.5/);
    await page.keyboard.press('Control+Comma');
    const sel = page.locator('.field', { hasText: 'Масштаб' }).locator('select').first();
    await expect(sel).toHaveValue('auto');
    await expect(sel.locator('option:checked')).toHaveText('Авто — 150%');
    await sel.selectOption('1');
    await expect(app).not.toHaveAttribute('style', /zoom/);
    expect(errors).toEqual([]);
  });
});
