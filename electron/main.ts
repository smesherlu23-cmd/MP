// Главный процесс Electron: окно программы и работа с файлами данных.
// Данные — JSON-файлы в папке: rulesets/, formations/, scenarios/, battles/.

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const COLLECTIONS = new Set(['rulesets', 'formations', 'scenarios', 'battles']);
let dataDir = '';
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
  if (portable) return path.join(portable, 'WarSim-data');
  return path.join(app.getPath('documents'), 'WarSim');
}

function colDir(col: string): string {
  if (!COLLECTIONS.has(col)) throw new Error(`Неизвестная коллекция: ${col}`);
  return path.join(dataDir, col);
}

function filePath(col: string, id: string): string {
  const safe = String(id).replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_');
  if (!safe || safe.startsWith('.')) throw new Error('Некорректный идентификатор');
  return path.join(colDir(col), `${safe}.json`);
}

async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
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
  ipcMain.handle('storage:list', async (_e, col: string) => {
    const dir = colDir(col);
    await fs.mkdir(dir, { recursive: true });
    const out: unknown[] = [];
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        out.push(col === 'battles' ? battleMeta(data) : data);
      } catch {
        /* повреждённый файл пропускаем */
      }
    }
    return out;
  });
  ipcMain.handle('storage:load', async (_e, col: string, id: string) => {
    try {
      return JSON.parse(await fs.readFile(filePath(col, id), 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('storage:save', async (_e, col: string, id: string, data: unknown) => {
    await writeAtomic(filePath(col, id), JSON.stringify(data, null, col === 'battles' ? 0 : 2));
  });
  ipcMain.handle('storage:remove', async (_e, col: string, id: string) => {
    await fs.rm(filePath(col, id), { force: true });
  });
  ipcMain.handle('file:export', async (_e, name: string, content: string) => {
    const ext = path.extname(name).slice(1) || 'txt';
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.writeFile(res.filePath, content, 'utf8');
    return true;
  });
  ipcMain.handle('file:import', async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Все файлы', extensions: ['*'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return { name: path.basename(res.filePaths[0]), content: await fs.readFile(res.filePaths[0], 'utf8') };
  });
  ipcMain.handle('data:dir', () => dataDir);
  ipcMain.handle('data:choose', async () => {
    const res = await dialog.showOpenDialog(win!, { title: 'Папка данных WarSim', properties: ['openDirectory', 'createDirectory'], defaultPath: dataDir });
    if (res.canceled || !res.filePaths[0]) return null;
    dataDir = res.filePaths[0];
    await fs.mkdir(dataDir, { recursive: true });
    await writeSettings({ ...(await readSettings()), dataDir });
    return dataDir;
  });
  ipcMain.handle('data:open', async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await shell.openPath(dataDir);
  });
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Открыть папку данных', click: () => shell.openPath(dataDir) },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Перезагрузить', role: 'reload' },
        { label: 'Полноэкранный режим', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Крупнее', role: 'zoomIn' },
        { label: 'Мельче', role: 'zoomOut' },
        { label: 'Обычный масштаб', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () =>
            dialog.showMessageBox(win!, {
              type: 'info',
              title: 'WarSim',
              message: `WarSim ${app.getVersion()}`,
              detail: `Модульный симулятор боя для варгейма.\nПапка данных: ${dataDir}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0d1115',
    title: 'WarSim — симулятор боя',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
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
    await fs.mkdir(dataDir, { recursive: true });
    registerIpc();
    buildMenu();
    await createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
