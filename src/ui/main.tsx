import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary';
import { desktop } from './storage';
import { flushBeforeClose, flushSaves, initApp, openDialog, toast, useApp } from './store';
import '@fontsource-variable/inter/opsz.css';
import './styles.css';

function Boot() {
  const loaded = useApp((s) => s.loaded);
  const loadError = useApp((s) => s.loadError);
  if (loadError)
    return (
      <ErrorScreen
        title="Не удалось загрузить данные"
        error={loadError}
        where="загрузка данных"
        extra={
          <button type="button" className="btn" onClick={() => useApp.setState({ loadError: undefined })}>
            Открыть программу всё равно
          </button>
        }
      />
    );
  return loaded ? (
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  ) : (
    <div className="empty" style={{ paddingTop: 120 }}>
      Загрузка данных…
    </div>
  );
}

window.addEventListener('beforeunload', () => {
  void flushSaves();
});
// В настольной программе окно закрывается только после записи на диск. Не записалось и после повторов —
// окно остаётся, ГМ решает: повторить или закрыть без сохранения.
desktop?.onBeforeClose?.(async () => {
  const ok = await flushBeforeClose();
  if (!ok) void askCloseUnsaved();
  return ok;
});

async function askCloseUnsaved() {
  const list = Object.entries(useApp.getState().unsaved);
  const v = await openDialog({
    title: 'Не всё сохранено',
    text: `Не удалось записать на диск: ${list.length} ${list.length === 1 ? 'объект' : 'объекта(ов)'} (${list[0]?.[1] ?? ''}). Если закрыть сейчас, последние правки в них пропадут. Проверьте папку данных (место на диске, синхронизация OneDrive, антивирус) и повторите.`,
    options: [
      { value: 'retry', label: 'Повторить запись и закрыть' },
      { value: 'close', label: 'Закрыть без сохранения' },
    ],
    okText: 'Выбрать',
    danger: true,
  });
  if (v === 'close') desktop?.closeAnyway?.();
  else if (v === 'retry') {
    if (await flushBeforeClose()) desktop?.closeAnyway?.();
    else void askCloseUnsaved();
  }
}

// Ошибки вне отрисовки (в обработчиках кнопок, таймерах) — сообщением, а не молча.
const BENIGN = /ResizeObserver loop/;
window.addEventListener('error', (e) => {
  const msg = e.error instanceof Error ? e.error.message : e.message;
  if (msg && !BENIGN.test(msg)) toast(`Ошибка: ${msg}`, 'bad');
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  if (!BENIGN.test(msg)) toast(`Ошибка: ${msg}`, 'bad');
});

initApp().catch((e) => {
  console.error(e);
  useApp.setState({ loaded: true, loadError: e instanceof Error ? e.message : String(e) });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
