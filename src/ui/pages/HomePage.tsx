import { Link } from '../components/Link';
import { Btn } from '../components/ui';
import { createFormation, createRuleset, createScenario, importFile, openTab, useApp } from '../store';

export function HomePage() {
  const s = useApp();
  const scenarios = Object.values(s.scenarios).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 8);
  const battles = Object.values(s.battleIndex).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 8);
  const formations = Object.values(s.formations).slice(0, 8);
  const rulesets = Object.values(s.rulesets);
  return (
    <div className="page">
      <div className="home-hero">
        <div className="grow" style={{ minWidth: 300 }}>
          <h1>Симулятор боя для ГМ</h1>
          <p className="muted" style={{ marginTop: 6, maxWidth: 760 }}>
            Соберите подразделения из элементов, задайте условия и задачи сторон — программа пошагово рассчитает столкновение, объяснит каждое изменение
            в журнале и выдаст итог: потери, остаточную боеспособность, организацию и снабжение. Массовые прогоны покажут вероятности исходов для балансировки.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <Btn kind="primary" onClick={() => createScenario()}>
              + Новый сценарий
            </Btn>
            <Btn onClick={() => createFormation()}>+ Новое подразделение</Btn>
            <Btn onClick={() => createRuleset()}>+ Новый набор правил</Btn>
            <Btn kind="ghost" onClick={() => importFile()}>
              Импорт из файла…
            </Btn>
          </div>
        </div>
      </div>

      <div className="steps" style={{ marginBottom: 18 }}>
        <div className="step">
          <span className="n">ШАГ 1 · ПРАВИЛА</span>
          <b>Набор правил под эпоху</b>
          <span className="muted small">Классы целей, дистанции, каталог типов (люди, вооружение, техника), приказы, условия и все коэффициенты.</span>
          {rulesets.map((r) => (
            <Link key={r.id} kind="ruleset" refId={r.id}>
              § {r.name}
            </Link>
          ))}
        </div>
        <div className="step">
          <span className="n">ШАГ 2 · ПОДРАЗДЕЛЕНИЯ</span>
          <b>Конструктор подразделений</b>
          <span className="muted small">Батальон из рот, штаба и поддержки; численность, опыт, мораль, слаженность, снабжение каждого элемента.</span>
          {formations.map((f) => (
            <Link key={f.id} kind="formation" refId={`lib:${f.id}`}>
              ▦ {f.name}
            </Link>
          ))}
          {!formations.length && <span className="faint small">Библиотека пуста</span>}
        </div>
        <div className="step">
          <span className="n">ШАГ 3 · СЦЕНАРИЙ</span>
          <b>Стороны, условия, задачи</b>
          <span className="muted small">Местность, время суток, погода, укрепления, разведданные, приказы и задачи сторон, сид случайности.</span>
          {scenarios.map((x) => (
            <Link key={x.id} kind="scenario" refId={x.id}>
              ◈ {x.name}
            </Link>
          ))}
          {!scenarios.length && <span className="faint small">Сценариев нет</span>}
        </div>
        <div className="step">
          <span className="n">ШАГ 4 · БОЙ</span>
          <b>Пошаговый бой или массовые прогоны</b>
          <span className="muted small">Ход за ходом с вмешательством ГМ, журнал с причинами, итоговый отчёт; 100–1000 прогонов для оценки вероятностей.</span>
          {battles.map((b) => (
            <Link key={b.id} kind="battle" refId={b.id}>
              ⚔ {b.name} <span className="faint">· {b.finished ? (b.headline ?? 'итог') : `ход ${b.turn}`}</span>
            </Link>
          ))}
          {!battles.length && <span className="faint small">Откройте сценарий и нажмите «Начать бой»</span>}
        </div>
      </div>

      <div className="note">
        Вкладки работают как окна браузера: любая ссылка открывает объект во вкладке, <b>Ctrl+клик</b> или средняя кнопка — в фоне. <b>Ctrl+W</b> — закрыть
        вкладку, <b>Ctrl+Tab</b> — следующая, <b>Ctrl+1…9</b> — по номеру, <b>Ctrl+B</b> — скрыть навигатор. Вкладки можно перетаскивать. Подробности о
        механиках — в{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), openTab('help'))}>
          справке
        </a>
        .
      </div>
    </div>
  );
}
