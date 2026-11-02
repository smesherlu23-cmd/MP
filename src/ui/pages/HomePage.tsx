import { useState } from 'react';
import { fmtDuration } from '../../engine';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Btn, Card } from '../components/ui';
import { showSection } from '../nav';
import { openTab, useApp } from '../store';

/** «сегодня, 14:20» / «вчера, 9:05» / «17 окт.» */
export function fmtWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const TIPS_KEY = 'warsim-tips-window-1';

/** Приёмы работы в окне, которых не видно с первого взгляда, — один раз, пока не закроют. */
function WindowTips() {
  const [shown, setShown] = useState(() => !localStorage.getItem(TIPS_KEY));
  if (!shown) return null;
  const close = () => {
    localStorage.setItem(TIPS_KEY, '1');
    setShown(false);
  };
  return (
    <section className="tips-card" aria-label="Приёмы работы">
      <div className="tips-head">
        <h2>Приёмы работы в окне</h2>
        <button type="button" className="btn sm" onClick={close}>
          Понятно
        </button>
      </div>
      <ul className="tips-list">
        <li>
          <b>Правый щелчок</b> по объекту — его действия: открыть, переименовать, дублировать, в избранное, удалить.
        </li>
        <li>
          <b>Пробел</b> на строке боковой панели или каталога — быстрый просмотр без перехода.
        </li>
        <li>
          <b>F2</b> или двойной щелчок по названию — переименовать на месте.
        </li>
        <li>
          <b>
            <Icon name="inspector" size={13} />
          </b>{' '}
          справа вверху — панель свойств выбранного (в бою — журнал).
        </li>
        <li>
          <b>Избранное</b> — перетащите объект в боковую панель; <b>Ctrl+K</b> — найти что угодно; <b>Ctrl+плюс/минус</b> — масштаб.
        </li>
      </ul>
    </section>
  );
}

/**
 * Главная — только то, чего нет в боковой панели: незавершённые бои, незаписанные итоги, первые шаги
 * (пока своих объектов нет) и приёмы работы (пока их не закрыли).
 */
export function HomePage() {
  const s = useApp();
  const byDate = <T extends { updatedAt?: string }>(a: T, b: T) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  const battles = Object.values(s.battleIndex).sort(byDate);
  const unfinished = battles.filter((b) => !b.finished).slice(0, 5);
  const unrecorded = battles.filter((b) => b.unrecorded?.length).slice(0, 5);
  // Своих объектов ещё нет: ничего не правили (у примеров после установки даты изменения нет) и боёв нет.
  const edited = [s.scenarios, s.forces, s.formations, s.rulesets].some((m) => Object.values(m).some((x) => x.updatedAt));
  const fresh = !edited && !battles.length;
  const firstExample = Object.values(s.scenarios).find((x) => x.id === 'sc-demo') ?? Object.values(s.scenarios)[0];

  return (
    <div className="page home">
      <div className="page-head">
        <div className="grow">
          <h1>Главное</h1>
          <div className="page-sub">Echelon Commander · симулятор боя для ГМ варгейма</div>
        </div>
      </div>

      <WindowTips />

      {unrecorded.length > 0 && (
        <Card title="Итоги не записаны в силы" className="home-continue home-unrecorded">
          <div className="home-list">
            {unrecorded.map((b) => (
              <div key={b.id} className="row">
                <span className="home-icon warn">
                  <Icon name="alert" />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Link kind="battle" refId={b.id} className="home-name">
                    {b.name}
                  </Link>
                  <div className="faint small">
                    {b.headline ?? 'окончен'} · {fmtWhen(b.updatedAt)}
                  </div>
                </div>
                <Btn sm onClick={() => openTab('battle', b.id)} title="Открыть итоги боя и записать потери в силы">
                  К итогам
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      {unfinished.length > 0 && (
        <Card title="Продолжить" className="home-continue">
          <div className="home-list">
            {unfinished.map((b) => {
              const tm = b.turnMinutes;
              return (
                <div key={b.id} className="row">
                  <span className="home-icon">
                    <Icon name="battle" />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link kind="battle" refId={b.id} className="home-name">
                      {b.name}
                    </Link>
                    <div className="faint small">
                      ход {b.turn}
                      {b.maxTurns ? ` из ${b.maxTurns}` : ''}
                      {tm && b.maxTurns ? ` (${fmtDuration((b.turn * tm) / 60)} из ${fmtDuration((b.maxTurns * tm) / 60)})` : ''} · {fmtWhen(b.updatedAt)}
                    </div>
                  </div>
                  <Btn sm kind="primary" onClick={() => openTab('battle', b.id)} title="Открыть бой и продолжить с текущего хода">
                    <Icon name="play" size={12} /> Продолжить
                  </Btn>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {fresh && (
        <Card title="С чего начать" className="home-continue">
          <ol className="home-steps">
            <li>
              Откройте пример —{' '}
              {firstExample ? (
                <Link kind="scenario" refId={firstExample.id}>
                  {firstExample.name}
                </Link>
              ) : (
                'сценарий из раздела «Сценарии»'
              )}{' '}
              — и нажмите «Начать бой»: ход за ходом видно, кто по кому стреляет и почему.
            </li>
            <li>
              <a href="#" onClick={(e) => (e.preventDefault(), showSection('units'))}>
                Шаблоны
              </a>{' '}
              — устройство и штат подразделений (от отделения до дивизии);{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), showSection('forces'))}>
                силы
              </a>{' '}
              — конкретные подразделения по шаблонам: потери боёв записываются в них.
            </li>
            <li>Создайте свой сценарий кнопкой «+ Создать» в панели инструментов и поставьте на стороны силы или их части.</li>
          </ol>
        </Card>
      )}

      {!fresh && !unfinished.length && !unrecorded.length && <p className="muted">Незавершённых боёв и незаписанных итогов нет.</p>}
    </div>
  );
}
