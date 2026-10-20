// Каталог раздела: все объекты раздела таблицей — с поиском, группами и действиями прямо в строке.

import { useState, type ReactNode } from 'react';
import { resolveScenario, sideUnits, summarizeUnits, type UnitNode } from '../../engine';
import { createIn } from '../components/Navigator';
import { Btn, Menu, fmt0, type MenuItem } from '../components/ui';
import { sectionMeta } from '../nav';
import {
  createForcesFromTemplate,
  createRuleset,
  defaultRulesetId,
  deleteBattle,
  deleteBattles,
  deleteForce,
  deleteFormation,
  deleteRuleset,
  deleteScenario,
  duplicateForce,
  duplicateFormation,
  duplicateScenario,
  exportJson,
  forceUsage,
  importFile,
  openTab,
  useApp,
  type NavSection,
  type Tab,
} from '../store';
import { fmtWhen } from './HomePage';
import { exportScenario, startBattle } from './ScenarioPage';
import { computeStats } from './unit/model';

interface Row {
  id: string;
  name: string;
  open: () => void;
  cells: ReactNode[];
  actions?: ReactNode;
  menu?: (MenuItem | 'sep' | false)[];
}

interface Group {
  title: string;
  rows: Row[];
  action?: ReactNode;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru');

/** Сколько людей в подразделении (по набору правил подразделения). */
function persons(root: UnitNode): string {
  const s = useApp.getState();
  const rs = s.rulesets[root.rulesetId ?? defaultRulesetId() ?? ''];
  if (!rs) return '';
  const st = computeStats(root, rs).get(root.id);
  return st ? `${fmt0(st.pers)} чел.${st.equip ? ` · ${fmt0(st.equip)} ед.` : ''}` : '';
}

/** Группы раздела, заголовки столбцов и подпись для пустого раздела. */
function useCatalog(sec: NavSection, q: string): { head: string[]; groups: Group[]; empty: string } {
  const s = useApp();
  const match = (...xs: (string | undefined)[]) => !q || xs.some((x) => x?.toLowerCase().includes(q));
  if (sec === 'scenarios') {
    const battlesBy = new Map<string, number>();
    for (const b of Object.values(s.battleIndex)) battlesBy.set(b.scenarioId, (battlesBy.get(b.scenarioId) ?? 0) + 1);
    const rows = Object.values(s.scenarios)
      .filter((x) => match(x.name))
      .sort(byName)
      .map((x): Row => {
        const rs = s.rulesets[x.rulesetId];
        const sides = rs ? resolveScenario(x, s.forces).sides.map((sd) => `${sd.name} ${fmt0(summarizeUnits(sideUnits(sd), rs).persCur)}`) : [];
        return {
          id: x.id,
          name: x.name,
          open: () => openTab('scenario', x.id),
          cells: [rs?.name ?? <span className="bad">набор не найден</span>, sides.join(' : '), battlesBy.get(x.id) ?? '—', fmtWhen(x.updatedAt)],
          actions: (
            <>
              <Btn sm kind="primary" disabled={!rs} onClick={() => rs && void startBattle(x, rs)} title="Новый бой по этому сценарию">
                ▶ Бой
              </Btn>
              <Btn sm disabled={!rs} onClick={() => openTab('montecarlo', x.id)} title="Массовые прогоны: вероятности исходов">
                ∑ Прогоны
              </Btn>
            </>
          ),
          menu: [
            { label: 'Дублировать', onClick: () => duplicateScenario(x.id) },
            { label: 'Сохранить в файл…', onClick: () => exportScenario(x) },
            'sep',
            { label: 'Удалить сценарий', danger: true, onClick: () => deleteScenario(x.id) },
          ],
        };
      });
    return {
      head: ['Набор правил', 'Стороны, чел.', 'Боёв', 'Изменён'],
      groups: [{ title: '', rows }],
      empty: 'Сценариев пока нет. Сценарий — это обстановка и две стороны с их подразделениями, задачами и планом боя.',
    };
  }
  if (sec === 'battles') {
    const battles = Object.values(s.battleIndex)
      .filter((x) => match(x.name, x.headline))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const by = new Map<string, typeof battles>();
    for (const b of battles) by.set(b.scenarioId, [...(by.get(b.scenarioId) ?? []), b]);
    const groups = [...by.entries()].map(([scId, items]): Group => {
      const scName = s.scenarios[scId]?.name ?? items[0].name.split(' · ')[0];
      return {
        title: scName,
        action: (
          <Btn
            sm
            kind="ghost"
            title={`Удалить все бои этого сценария (${items.length})`}
            onClick={() =>
              void deleteBattles(
                items.map((b) => b.id),
                `Удалить все бои сценария «${scName}»?`,
              )
            }
          >
            Удалить все
          </Btn>
        ),
        rows: items.map((b) => ({
          id: b.id,
          name: b.name.startsWith(`${scName} · `) ? b.name.slice(scName.length + 3) : b.name,
          open: () => openTab('battle', b.id),
          cells: [
            <span key="st" className={`badge${b.finished ? '' : ' good'}`}>
              {b.finished ? 'окончен' : `идёт · ход ${b.turn}`}
            </span>,
            b.finished ? (b.headline ?? '') : b.maxTurns ? `ход ${b.turn} из ${b.maxTurns}` : '',
            fmtWhen(b.updatedAt),
          ],
          actions: (
            <Btn sm kind={b.finished ? undefined : 'primary'} onClick={() => openTab('battle', b.id)}>
              {b.finished ? 'Открыть' : 'Продолжить ▶'}
            </Btn>
          ),
          menu: [{ label: 'Удалить бой', danger: true, onClick: () => void deleteBattle(b.id) }],
        })),
      };
    });
    return {
      head: ['Состояние', 'Итог', 'Изменён'],
      groups,
      empty: 'Боёв пока нет. Бой начинается со страницы сценария — кнопка «▶ Начать бой».',
    };
  }
  if (sec === 'forces') {
    const list = Object.values(s.forces)
      .filter((x) => match(x.name, x.faction))
      .sort(byName);
    const factions = [...new Set(list.map((u) => u.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));
    const groups = factions.map(
      (f): Group => ({
        title: factions.length > 1 || f ? f || 'Без принадлежности' : '',
        rows: list
          .filter((u) => (u.faction?.trim() || '') === f)
          .map((x) => {
            const tpl = x.templateId ? s.formations[x.templateId] : undefined;
            const used = forceUsage(x.id).length;
            return {
              id: x.id,
              name: x.name,
              open: () => openTab('formation', `force:${x.id}`),
              cells: [tpl?.name ?? '—', persons(x), used || '—', fmtWhen(x.updatedAt)],
              menu: [
                { label: 'Дублировать', onClick: () => duplicateForce(x.id) },
                { label: 'Сохранить в файл…', onClick: () => exportJson('force', x.name, { ...x, faction: x.faction ?? '' }) },
                'sep',
                { label: 'Удалить силы', danger: true, onClick: () => void deleteForce(x.id) },
              ],
            };
          }),
      }),
    );
    return {
      head: ['Шаблон', 'Состав', 'В сценариях', 'Изменены'],
      groups,
      empty: 'Сил пока нет. Силы — конкретные подразделения, созданные по шаблонам: у каждого своё состояние и свои потери после боёв.',
    };
  }
  if (sec === 'units') {
    const list = Object.values(s.formations)
      .filter((x) => match(x.name))
      .sort(byName);
    const rsIds = [...new Set(list.map((u) => u.rulesetId ?? ''))];
    const groups = rsIds.map(
      (id): Group => ({
        title: rsIds.length > 1 ? (s.rulesets[id]?.name ?? 'Без набора правил') : '',
        rows: list
          .filter((u) => (u.rulesetId ?? '') === id)
          .map((x) => ({
            id: x.id,
            name: x.name,
            open: () => openTab('formation', `lib:${x.id}`),
            cells: [persons(x), fmtWhen(x.updatedAt)],
            actions: (
              <Btn sm onClick={() => createForcesFromTemplate(x.id, { open: true })} title="Конкретное подразделение с этим устройством и штатом">
                + Силы
              </Btn>
            ),
            menu: [
              { label: 'Дублировать', onClick: () => duplicateFormation(x.id) },
              { label: 'Сохранить в файл…', onClick: () => exportJson('template', x.name, x) },
              'sep',
              { label: 'Удалить шаблон', danger: true, onClick: () => void deleteFormation(x.id) },
            ],
          })),
      }),
    );
    return {
      head: ['Штат', 'Изменён'],
      groups,
      empty: 'Шаблонов нет. Шаблон — устройство и штат подразделения: по нему создаются силы, из шаблонов собираются и более крупные.',
    };
  }
  const rows = Object.values(s.rulesets)
    .filter((x) => match(x.name, x.era))
    .sort(byName)
    .map((x): Row => {
      const used = Object.values(s.scenarios).filter((sc) => sc.rulesetId === x.id).length;
      return {
        id: x.id,
        name: x.name,
        open: () => openTab('ruleset', x.id),
        cells: [x.era ?? '', x.componentTypes.length, used || '—', fmtWhen(x.updatedAt)],
        menu: [
          { label: 'Дублировать', onClick: () => createRuleset(x.id) },
          { label: 'Сохранить в файл…', onClick: () => exportJson('ruleset', x.name, x) },
          'sep',
          { label: 'Удалить набор правил', danger: true, onClick: () => void deleteRuleset(x.id) },
        ],
      };
    });
  return { head: ['Эпоха', 'Типов', 'Сценариев', 'Изменён'], groups: [{ title: '', rows }], empty: 'Наборов правил нет.' };
}

export function LibraryPage({ tab }: { tab: Tab }) {
  const sec = (tab.ref ?? 'scenarios') as NavSection;
  const meta = sectionMeta(sec);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const { head, groups, empty } = useCatalog(sec, q);
  const count = groups.reduce((a, g) => a + g.rows.length, 0);

  return (
    <div className="page catalog">
      <div className="page-head">
        <span className="page-icon">{meta.icon}</span>
        <div className="grow">
          <h1>{meta.label}</h1>
          <div className="page-sub">{meta.about}</div>
        </div>
        {meta.create && (
          <Btn kind="primary" onClick={() => createIn(sec)}>
            + {meta.create}
          </Btn>
        )}
        <Btn onClick={() => importFile()} title="Набор правил, подразделение, сценарий или бой в формате JSON">
          Импорт…
        </Btn>
      </div>

      <div className="catalog-bar">
        <input type="search" className="catalog-search" placeholder="Поиск по названию…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="faint small">{q ? `найдено: ${count}` : `всего: ${count}`}</span>
      </div>

      {count === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">{meta.icon}</div>
          <div>{q ? 'Ничего не найдено.' : empty}</div>
          {!q && meta.create && (
            <Btn kind="primary" onClick={() => createIn(sec)}>
              + {meta.create}
            </Btn>
          )}
        </div>
      ) : (
        groups
          .filter((g) => g.rows.length)
          .map((g) => (
            <div key={g.title || '_'} className="catalog-group">
              {g.title && (
                <div className="catalog-group-head">
                  <h3 className="grow">{g.title}</h3>
                  <span className="faint small">{g.rows.length}</span>
                  {g.action}
                </div>
              )}
              <div className="card">
                <table className="tbl catalog-tbl">
                  <thead>
                    <tr>
                      <th className="catalog-name">Название</th>
                      {head.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                      <th className="catalog-actions" style={{ width: sec === 'scenarios' ? 230 : 160 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="catalog-row" onDoubleClick={r.open}>
                        <td className="catalog-name">
                          <button type="button" className="link" onClick={r.open} title="Открыть">
                            {r.name}
                          </button>
                        </td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="muted">
                            {c}
                          </td>
                        ))}
                        <td className="catalog-actions">
                          <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            {r.actions}
                            {r.menu && <Menu sm items={r.menu} />}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
      )}
    </div>
  );
}
