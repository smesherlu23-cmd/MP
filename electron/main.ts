// Главный процесс Electron: окно программы и работа с файлами данных.
// Данные — JSON-файлы в папке: rulesets/, formations/ (шаблоны), forces/ (силы), scenarios/, battles/; резервные копии,
// корзина и повреждённые файлы — в backups/, trash/, damaged/ (см. protect.ts).

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { DataStore, type BackupKind } from './protect';

// Прежнее название программы — WarSim. Её папки остаются в ходу, чтобы после переименования
// не потерялись данные, настройки и открытые вкладки.
const APP_NAME = 'Echelon Commander';
const LEGACY_NAME = 'WarSim';
const legacyUserData = path.join(app.getPath('appData'), LEGACY_NAME);
if (existsSync(legacyUserData)) app.setPath('userData', legacyUserData);

let dataDir = '';
let store = new DataStore('');
let win: BrowserWindow | null = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function readSettings(): Promise<{ dataDir?: string }> {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(s: { dataDir?: string }) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}

function defaultDataDir(): string {
  // Портативная версия хранит данные рядом с .exe, установленная — в «Документах».
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const base = portable || app.getPath('documents');
  const legacy = path.join(base, portable ? `${LEGACY_NAME}-data` : LEGACY_NAME);
  if (existsSync(legacy)) return legacy;
  return path.join(base, portable ? `${APP_NAME}-data` : APP_NAME);
}

function battleMeta(b: any) {
  return {
    id: b.id,
    name: b.name,
    scenarioId: b.scenarioId,
    seed: b.seed,
    turn: b.turn,
    finished: b.finished,
    headline: b.result?.headline,
    updatedAt: b.updatedAt ?? b.createdAt,
  };
}

function registerIpc() {
  ipcMain.on('window:theme', (_e, theme: 'dark' | 'light') => {
    if (process.platform !== 'darwin' && win) win.setTitleBarOverlay(OVERLAY[theme === 'light' ? 'light' : 'dark']);
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir }));
  ipcMain.handle('storage:list', (_e, col: string) => store.list(col, col === 'battles' ? battleMeta : undefined));
  ipcMain.handle('storage:load', (_e, col: string, id: string) => store.load(col, id));
  ipcMain.handle('storage:save', (_e, col: string, id: string, data: unknown) => store.save(col, id, data));
  ipcMain.handle('storage:remove', (_e, col: string, id: string) => store.remove(col, id));
  ipcMain.handle('storage:problems', () => store.takeProblems());
  ipcMain.handle('trash:list', () => store.trash());
  ipcMain.handle('trash:restore', (_e, col: string, key: string) => store.restoreTrash(col, key));
  ipcMain.handle('trash:purge', (_e, items?: { col: string; key: string }[]) => store.purgeTrash(items));
  ipcMain.handle('backup:list', () => store.backups());
  ipcMain.handle('backup:make', (_e, kind: BackupKind) => store.backup(kind));
  ipcMain.handle('backup:restore', (_e, id: string) => store.restoreBackup(id));
  ipcMain.handle('file:export', async (_e, name: string, content: string) => {
    const ext = path.extname(name).slice(1) || 'txt';
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.writeFile(res.filePath, content, 'utf8');
    return true;
  });
  ipcMain.handle('file:import', async () => {
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { name: path.basename(res.filePaths[0]), content: await fs.readFile(res.filePaths[0], 'utf8') };
  });
  ipcMain.handle('data:dir', () => dataDir);
  ipcMain.handle('data:choose', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: `Папка данных ${APP_NAME}`,
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: dataDir,
    });
    if (res.canceled || !res.filePaths[0]) return null;
    dataDir = res.filePaths[0];
    store = new DataStore(dataDir);
    await fs.mkdir(dataDir, { recursive: true });
    await writeSettings({ ...(await readSettings()), dataDir });
    return dataDir;
  });
  ipcMain.handle('data:open', async (_e, sub?: string) => {
    const dir = sub && ['backups', 'trash', 'damaged'].includes(sub) ? path.join(dataDir, sub) : dataDir;
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
}

// Своей шапки и меню у окна нет: вкладки и меню программы нарисованы в самом окне.
// Меню остаётся скрытым — только ради сочетаний клавиш (масштаб, полный экран, буфер обмена).
// Отмены и повтора в нём нет: Ctrl+Z / Ctrl+Y обрабатывает сама программа.
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Правка',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const OVERLAY = {
  dark: { color: '#0f151c', symbolColor: '#e4eaf0', height: 44 },
  light: { color: '#e8edf2', symbolColor: '#17212b', height: 44 },
};

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0b1016',
    title: APP_NAME,
    icon: process.platform === 'linux' ? path.join(__dirname, '..', 'dist', 'favicon.ico') : undefined,
    // Без системной шапки: кнопки «свернуть / развернуть / закрыть» рисуются поверх верхней полосы программы.
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : OVERLAY.dark,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win?.show());
  // Ссылки наружу — в системный браузер, переходы внутри окна запрещены.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    const s = await readSettings();
    dataDir = s.dataDir || defaultDataDir();
    store = new DataStore(dataDir);
    await fs.mkdir(dataDir, { recursive: true });
    await store.purgeOldTrash().catch(() => undefined);
    registerIpc();
    buildMenu();
    await createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
