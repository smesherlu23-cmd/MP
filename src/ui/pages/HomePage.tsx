import { resolveScenario, sideUnits, summarizeUnits } from '../../engine';
import { Link } from '../components/Link';
import { openPalette } from '../components/Palette';
import { Btn, Card, fmt0 } from '../components/ui';
import { createScenario, newForceDialog, openTab, updateSettings, useApp, type TabKind } from '../store';
import { startBattle } from './ScenarioPage';

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

interface Recent {
  key: string;
  kind: TabKind;
  ref: string;
  icon: string;
  what: string;
  name: string;
  at: string;
}

export function HomePage() {
  const s = useApp();
  const byDate = <T extends { updatedAt?: string }>(a: T, b: T) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  const scenarios = Object.values(s.scenarios).sort(byDate).slice(0, 8);
  const battles = Object.values(s.battleIndex).sort(byDate);
  const unfinished = battles.filter((b) => !b.finished).slice(0, 5);
  const finished = battles.filter((b) => b.finished).slice(0, 6);
  // Недавно изменённое — только то, что правили (у примеров после установки даты изменения нет).
  const recent: Recent[] = [
    ...Object.values(s.scenarios).map((x) => ({ key: `sc:${x.id}`, kind: 'scenario' as TabKind, ref: x.id, icon: '◈', what: 'сценарий', name: x.name, at: x.updatedAt ?? '' })),
    ...Object.values(s.forces).map((x) => ({ key: `fc:${x.id}`, kind: 'formation' as TabKind, ref: `force:${x.id}`, icon: '⚑', what: 'силы', name: x.name, at: x.updatedAt ?? '' })),
    ...Object.values(s.formations).map((x) => ({ key: `fm:${x.id}`, kind: 'formation' as TabKind, ref: `lib:${x.id}`, icon: '▦', what: 'шаблон', name: x.name, at: x.updatedAt ?? '' })),
    ...Object.values(s.rulesets).map((x) => ({ key: `rs:${x.id}`, kind: 'ruleset' as TabKind, ref: x.id, icon: '§', what: 'набор правил', name: x.name, at: x.updatedAt ?? '' })),
  ]
    .filter((x) => x.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  const fresh = !recent.length && !battles.length;
  const firstExample = Object.values(s.scenarios).find((x) => x.id === 'sc-demo') ?? Object.values(s.scenarios)[0];

  return (
    <div className="page home">
      <div className="page-head">
        <h1 className="grow">Симулятор боя</h1>
        <Btn kind="primary" onClick={() => createScenario()}>
          + Сценарий
        </Btn>
        <Btn onClick={() => void newForceDialog()} title="Конкретное подразделение по шаблону">
          + Силы
        </Btn>
      </div>

      {unfinished.length > 0 && (
        <Card title="Продолжить" className="home-continue">
          <div className="home-list">
            {unfinished.map((b) => {
              const sc = s.scenarios[b.scenarioId];
              return (
                <div key={b.id} className="row">
                  <span className="home-icon">⚔</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link kind="battle" refId={b.id} className="home-name">
                      {b.name}
                    </Link>
                    <div className="faint small">
                      ход {b.turn}
                      {sc ? ` из ${sc.maxTurns}` : ''} · {fmtWhen(b.updatedAt)}
                    </div>
                  </div>
                  <Btn sm kind="primary" onClick={() => openTab('battle', b.id)} title="Открыть бой и продолжить с текущего хода">
                    Продолжить ▶
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
              Откройте пример — {firstExample ? <Link kind="scenario" refId={firstExample.id}>{firstExample.name}</Link> : 'сценарий из раздела «Сценарии»'} — и нажмите
              «▶ Начать бой»: ход за ходом видно, кто по кому стреляет и почему.
            </li>
            <li>
              <a href="#" onClick={(e) => (e.preventDefault(), updateSettings({ navSection: 'units' }))}>
                Шаблоны
              </a>{' '}
              — устройство и штат подразделений (от отделения до дивизии);{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), updateSettings({ navSection: 'forces' }))}>
                силы
              </a>{' '}
              — конкретные подразделения по шаблонам: потери боёв записываются в них.
            </li>
            <li>Создайте свой сценарий кнопкой «+ Сценарий» и поставьте на стороны силы или их части.</li>
          </ol>
        </Card>
      )}

      <div className="grid two">
        <div className="stack">
          <Card title="Сценарии">
            <div className="home-list">
              {scenarios.map((x) => {
                const rs = s.rulesets[x.rulesetId];
                const forces = rs ? resolveScenario(x, s.forces).sides.map((sd) => fmt0(summarizeUnits(sideUnits(sd), rs).persCur)).join(' : ') : '';
                return (
                  <div key={x.id} className="row">
                    <Link kind="scenario" refId={x.id} className="grow">
                      {x.name}
                    </Link>
                    {forces && (
                      <span className="faint small nowrap" data-tip={`Личный состав сторон: ${x.sides.map((sd) => sd.name).join(' : ')}`}>
                        {forces} чел.
                      </span>
                    )}
                    <Btn sm kind="ghost" onClick={() => openTab('montecarlo', x.id)} title="Массовые прогоны">
                      ∑
                    </Btn>
                    <Btn sm kind="ghost" disabled={!rs} onClick={() => rs && startBattle(x, rs)} title="Начать бой">
                      ▶
                    </Btn>
                  </div>
                );
              })}
              {!scenarios.length && <span className="muted">Сценариев пока нет.</span>}
            </div>
          </Card>
          {finished.length > 0 && (
            <Card title="Завершённые бои">
              <div className="home-list">
                {finished.map((b) => (
                  <div key={b.id} className="row">
                    <Link kind="battle" refId={b.id} className="grow home-name">
                      {b.name}
                    </Link>
                    <span className="faint small nowrap home-sub" title={b.headline}>
                      {b.headline ?? 'окончен'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <Card title="Недавно изменено">
          <div className="home-list">
            {recent.map((x) => (
              <div key={x.key} className="row">
                <span className="home-icon" title={x.what}>
                  {x.icon}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Link kind={x.kind} refId={x.ref} className="home-name">
                    {x.name}
                  </Link>
                  <div className="faint small">
                    {x.what} · {fmtWhen(x.at)}
                  </div>
                </div>
              </div>
            ))}
            {!recent.length && <span className="muted">Здесь появятся сценарии, подразделения и наборы правил, которые вы правили.</span>}
          </div>
        </Card>
      </div>

      <p className="muted small" style={{ marginTop: 18 }}>
        Порядок работы: набор правил → подразделения → сценарий → бой. Как устроен расчёт —{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), openTab('help'))}>
          в справке
        </a>
        .
      </p>
      <p className="faint small">
        <a href="#" onClick={(e) => (e.preventDefault(), openPalette())}>
          Ctrl+K
        </a>{' '}
        — найти любое подразделение, сценарий или команду · Alt+← / Alt+→ — назад / вперёд · Ctrl+Z / Ctrl+Y — отменить / повторить · Ctrl+B — навигатор
      </p>
    </div>
  );
}
