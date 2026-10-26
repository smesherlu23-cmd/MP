// Мост между окном и главным процессом: только операции с данными, без доступа к Node.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('warsim', {
  list: (col: string) => ipcRenderer.invoke('storage:list', col),
  load: (col: string, id: string) => ipcRenderer.invoke('storage:load', col, id),
  save: (col: string, id: string, data: unknown) => ipcRenderer.invoke('storage:save', col, id, data),
  remove: (col: string, id: string) => ipcRenderer.invoke('storage:remove', col, id),
  exportFile: (name: string, content: string) => ipcRenderer.invoke('file:export', name, content),
  importFile: () => ipcRenderer.invoke('file:import'),
  getDataDir: () => ipcRenderer.invoke('data:dir'),
  chooseDataDir: () => ipcRenderer.invoke('data:choose'),
  openDataDir: (sub?: string) => ipcRenderer.invoke('data:open', sub),
  problems: () => ipcRenderer.invoke('storage:problems'),
  trash: () => ipcRenderer.invoke('trash:list'),
  restoreTrash: (col: string, key: string) => ipcRenderer.invoke('trash:restore', col, key),
  purgeTrash: (items?: { col: string; key: string }[]) => ipcRenderer.invoke('trash:purge', items),
  backups: () => ipcRenderer.invoke('backup:list'),
  backup: (kind: string) => ipcRenderer.invoke('backup:make', kind),
  restoreBackup: (id: string) => ipcRenderer.invoke('backup:restore', id),
  platform: process.platform,
  /** Системный материал окна (Mica на Windows 11) — тогда боковая панель полупрозрачная. */
  material: process.argv.includes('--material=mica') ? 'mica' : '',
  setWindowTheme: (theme: 'dark' | 'light') => ipcRenderer.send('window:theme', theme),
  appInfo: () => ipcRenderer.invoke('app:info'),
});
