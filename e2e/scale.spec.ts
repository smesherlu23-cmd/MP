// Большие силы: дивизия на дивизию — свёрнутые схема и таблица сил, различимые имена,
// сводка журнала по формированиям, командир прямо в бою.

import { expect, test, type Page } from '@playwright/test';
import { instantiate, makeDemoTemplates, makeUniversalRuleset, newRootUnit, newScenario, newUnit, type UnitNode } from '../src/engine';
import { openApp } from './helpers';

function army(name: string, regiments: number, battalions: number, companies: number, order: string): UnitNode {
  const rs = makeUniversalRuleset();
  const platoon = makeDemoTemplates().find((t) => t.name === 'Мотострелковый взвод')!;
  const root = newRootUnit(name, { order, rulesetId: rs.id });
  for (let r = 0; r < regiments; r++) {
    const reg = newUnit(`${r + 1}-й полк`);
    for (let b = 0; b < battalions; b++) {
      const bn = newUnit(`${b + 1}-й батальон`);
      for (let c = 0; c < companies; c++) {
        const co = newUnit(`${c + 1}-я рота`);
        for (let p = 0; p < 3; p++) co.children.push(instantiate(platoon, { name: `${p + 1}-й взвод` }));
        bn.children.push(co);
      }
      reg.children.push(bn);
    }
    root.children.push(reg);
  }
  return root;
}

async function loadDivisions(page: Page) {
  const a = army('1-я дивизия', 3, 3, 4, 'attack');
  const b = army('2-я дивизия', 3, 3, 3, 'defend');
  const sc = newScenario(makeUniversalRuleset(), 'Дивизия на дивизию', 'x');
  sc.sides[0].formations = [JSON.parse(JSON.stringify(a))];
  sc.sides[1].formations = [JSON.parse(JSON.stringify(b))];
  await page.evaluate(
    ({ unit, scenario }) => {
      localStorage.setItem(`warsim:formations:${unit.id}`, JSON.stringify(unit));
      localStorage.setItem(`warsim:scenarios:${scenario.id}`, JSON.stringify(scenario));
    },
    { unit: a, scenario: sc },
  );
  await page.reload();
  await expect(page.getByText('Симулятор боя').first()).toBeVisible();
}

test('дивизия: схема и список удобны на 157 подразделениях', async ({ page }) => {
  const errors = await openApp(page);
  await loadDivisions(page);
  await page.locator('.nav-item', { hasText: 'Шаблоны' }).click();
  await page.locator('.side-item', { hasText: '1-я дивизия' }).click();
  // с третьего уровня свёрнуто: дивизия, 3 полка, 9 батальонов
  await expect(page.locator('.org-box')).toHaveCount(13);
  await page.locator('.seg button', { hasText: 'Список' }).click();
  await page.locator('.page-head button[title="Ещё"]').click();
  await page.locator('.menu-pop .menu-item', { hasText: 'Развернуть всё' }).click();
  await expect(page.locator('.unit-row')).toHaveCount(157);
  // имя взвода видно целиком (не обрезано многоточием)
  const name = page.locator('.unit-row', { hasText: '1-й взвод' }).first().locator('.unit-name');
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('.seg button', { hasText: 'Схема' }).click();
  expect(errors).toEqual([]);
});

test('бой дивизий: свёрнутая таблица сил, сводка журнала, различимые имена, командир в бою', async ({ page }) => {
  const errors = await openApp(page);
  await loadDivisions(page);
  await page.locator('.nav-item', { hasText: 'Сценарии' }).click();
  await page.locator('.side-item', { hasText: 'Дивизия на дивизию' }).click();
  await page.getByRole('button', { name: /Начать бой/ }).click();
  await page.getByRole('button', { name: '▶ Ход' }).click();

  // таблица сил: батальоны свёрнуты, у групп — итоги
  await expect(page.locator('.tbl.forces tr.group')).toHaveCount(26);
  await expect(page.locator('.tbl.forces tr.group.folded')).toHaveCount(18);
  const division = page.locator('.tbl.forces tr.group', { hasText: '1-я дивизия' });
  await expect(division.locator('td.num').first()).toContainText('/4 104');

  // журнал: потери и мораль сведены по формированиям, имена различимы
  await expect(page.locator('.log-sum').first()).toBeVisible();
  await expect(page.locator('.log-sum').first()).toContainText(' · ');
  await page.locator('.log-sum').first().click();
  await expect(page.locator('.log-sub').first()).toBeVisible();

  // командир дивизии: ГМ меняет компетентность по обстановке
  const cmd = division.locator('.cmd-select');
  await expect(cmd).toHaveValue('3');
  await cmd.selectOption({ label: 'Выдающийся' });
  await expect(cmd).toHaveClass(/better/);
  await page.locator('.log-head .seg button', { hasText: 'Главное' }).click();
  await expect(page.locator('.log-entry', { hasText: 'командир: Выдающийся' })).toHaveCount(1);
  await cmd.selectOption({ label: 'Слабый' });
  await expect(cmd).toHaveClass(/worse/);
  await expect(page.locator('.log-entry', { hasText: 'командир: Слабый' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
