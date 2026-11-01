// Ошибка отрисовки страницы не должна оставлять пустое окно: показываем, что случилось,
// и даём уйти на «Главное», скопировать отчёт для разработчика или перезагрузить окно.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { openTab, useApp } from '../store';
import { desktop } from '../storage';

/** Текст отчёта об ошибке: версия, страница, сообщение и стек. */
export async function errorReport(error: unknown, where: string, componentStack?: string): Promise<string> {
  const e = error instanceof Error ? error : new Error(String(error));
  let version = '?';
  try {
    if (desktop?.appInfo) version = (await desktop.appInfo()).version;
  } catch {
    // в браузере версии может не быть
  }
  const s = useApp.getState();
  const tab = s.tabs.find((t) => t.key === s.active);
  return [
    `Echelon Commander ${version}`,
    `Время: ${new Date().toISOString()}`,
    `Где: ${where}${tab ? ` (страница ${tab.kind}${tab.ref ? ` · ${tab.ref}` : ''})` : ''}`,
    `Ошибка: ${e.message}`,
    '',
    e.stack ?? '',
    componentStack ? `\nКомпоненты:${componentStack}` : '',
  ].join('\n');
}

async function copyReport(error: unknown, where: string, componentStack?: string) {
  const text = await errorReport(error, where, componentStack);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function ErrorScreen(props: {
  title: string;
  error: unknown;
  where: string;
  componentStack?: string;
  /** Уйти на «Главное» (у ошибки страницы); без него — только перезагрузка. */
  onHome?: () => void;
  extra?: ReactNode;
}) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <div className="error-screen" role="alert">
      <h2>{props.title}</h2>
      <p className="muted">Данные не пострадали: всё, что уже сохранено, на месте. Скопируйте отчёт, если хотите сообщить об ошибке.</p>
      <pre className="error-message">{message}</pre>
      <div className="row gap">
        {props.onHome && (
          <button type="button" className="btn primary" onClick={props.onHome}>
            На «Главное»
          </button>
        )}
        <button type="button" className="btn" onClick={() => void copyReport(props.error, props.where, props.componentStack)}>
          Скопировать отчёт
        </button>
        <button type="button" className={props.onHome ? 'btn' : 'btn primary'} onClick={() => window.location.reload()}>
          Перезагрузить окно
        </button>
        {props.extra}
      </div>
    </div>
  );
}

interface State {
  error: unknown;
  componentStack?: string;
}

/**
 * Ловит ошибки отрисовки. `scope="page"` — у одной страницы (остальное окно работает, можно уйти на «Главное»);
 * `scope="app"` — у всего окна (последний рубеж). Сбрасывается сменой `key`.
 */
export class ErrorBoundary extends Component<{ scope: 'page' | 'app'; children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('Неизвестная ошибка') };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const page = this.props.scope === 'page';
    return (
      <ErrorScreen
        title={page ? 'Ошибка на этой странице' : 'Ошибка в окне программы'}
        error={this.state.error}
        where={page ? 'страница' : 'окно'}
        componentStack={this.state.componentStack}
        onHome={
          page
            ? () => {
                this.setState({ error: null, componentStack: undefined });
                openTab('home');
              }
            : undefined
        }
      />
    );
  }
}
