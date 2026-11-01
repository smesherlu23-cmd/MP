// Проверка настоящего настольного приложения (Electron, файлы данных на диске): npm run test:app.
// Перед запуском — npm run build. ECHELON_EXE — путь к собранному .exe (release/win-unpacked/…):
// тогда проверяется сама упакованная программа, иначе — Electron из node_modules с dist-electron/main.js.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-app',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
