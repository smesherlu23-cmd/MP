import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { flushSaves, initApp, useApp } from './store';
import '@fontsource-variable/inter/opsz.css';
import './styles.css';

function Boot() {
  const loaded = useApp((s) => s.loaded);
  return loaded ? (
    <App />
  ) : (
    <div className="empty" style={{ paddingTop: 120 }}>
      Загрузка данных…
    </div>
  );
}

window.addEventListener('beforeunload', () => {
  void flushSaves();
});

initApp().catch((e) => {
  console.error(e);
  useApp.setState({ loaded: true });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
