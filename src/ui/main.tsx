import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary';
import { desktop } from './storage';
import { flushSaves, initApp, toast, useApp } from './store';
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
// В настольной программе окно закрывается только после записи на диск.
desktop?.onBeforeClose?.(flushSaves);

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
