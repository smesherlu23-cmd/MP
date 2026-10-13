import { Link } from '../components/Link';
import { Btn, Card } from '../components/ui';
import { createFormation, createScenario, openTab, useApp } from '../store';
import { startBattle } from './ScenarioPage';

export function HomePage() {
  const s = useApp();
  const byDate = <T extends { updatedAt?: string }>(a: T, b: T) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  const scenarios = Object.values(s.scenarios).sort(byDate).slice(0, 8);
  const battles = Object.values(s.battleIndex).sort(byDate).slice(0, 8);
  return (
    <div className="page home">
      <div className="page-head">
        <h1 className="grow">Симулятор боя</h1>
        <Btn kind="primary" onClick={() => createScenario()}>
          + Сценарий
        </Btn>
        <Btn onClick={() => createFormation()}>+ Подразделение</Btn>
      </div>

      <div className="grid two">
        <Card title="Сценарии">
          <div className="home-list">
            {scenarios.map((x) => {
              const rs = s.rulesets[x.rulesetId];
              return (
                <div key={x.id} className="row">
                  <Link kind="scenario" refId={x.id} className="grow">
                    {x.name}
                  </Link>
                  <Btn sm kind="ghost" disabled={!rs} onClick={() => rs && startBattle(x, rs, x.seed)} title="Начать бой">
                    ▶
                  </Btn>
                </div>
              );
            })}
            {!scenarios.length && <span className="muted">Сценариев пока нет.</span>}
          </div>
        </Card>
        <Card title="Последние бои">
          <div className="home-list">
            {battles.map((b) => (
              <div key={b.id} className="row">
                <Link kind="battle" refId={b.id} className="grow">
                  {b.name}
                </Link>
                <span className="faint small nowrap">{b.finished ? (b.headline ?? 'окончен') : `ход ${b.turn}`}</span>
              </div>
            ))}
            {!battles.length && <span className="muted">Откройте сценарий и нажмите «Начать бой».</span>}
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
    </div>
  );
}
