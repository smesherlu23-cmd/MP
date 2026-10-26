// Страница команды: как идёт кампания у одной стороны — численность и боеготовность всех её сил,
// потери за всё время, бои с исходами и общий боевой путь.

import { useState } from 'react';
import { plural, type ForceRecord, type UnitNode } from '../../engine';
import { KIND_ICON, LEVEL_LABEL, signed } from '../components/ForceCampaign';
import { Crumbs } from '../components/Crumbs';
import { Icon } from '../components/Icon';
import { Btn, Card, Kpi, fmt0, ToolbarSlot } from '../components/ui';
import { showSection } from '../nav';
import { fmtDate, forceStatus, newForceDialog, openTab, teamColor, useApp } from '../store';
import { ForceCard, TeamModal } from './ForcesPage';

const teamOf = (f: UnitNode) => f.faction?.trim() || '';

export function TeamPage({ team }: { team: string }) {
  const forces = useApp((s) => s.forces);
  const index = useApp((s) => s.battleIndex);
  const [edit, setEdit] = useState(false);
  const mine = Object.values(forces)
    .filter((f) => teamOf(f) === team)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const st = mine.map((f) => forceStatus(f));
  const sum = (k: 'persCur' | 'persAuth' | 'equipCur' | 'equipAuth' | 'wounded' | 'repair') => st.reduce((a, c) => a + c[k], 0);
  const levels = (['ready', 'worn', 'depleted'] as const).map((lv) => ({ lv, n: st.filter((c) => c.level === lv).length })).filter((x) => x.n);

  // Все записи боевого пути сил команды — новыми сверху; бои — по одному на бой (потери всех сил вместе).
  const records = mine.flatMap((f) => (f.history ?? []).map((r) => ({ r, f }))).sort((a, b) => b.r.at.localeCompare(a.r.at));
  const battles = new Map<string, { r: ForceRecord; personnel: number; equipment: number; forces: string[] }>();
  for (const { r, f } of records) {
    if (r.kind !== 'battle') continue;
    const key = r.battleId ?? `${r.title}|${r.at}`;
    const x = battles.get(key) ?? { r, personnel: 0, equipment: 0, forces: [] };
    x.personnel += r.personnel ?? 0;
    x.equipment += r.equipment ?? 0;
    x.forces.push(f.name);
    battles.set(key, x);
  }
  const lostPers = [...battles.values()].reduce((a, x) => a - Math.min(0, x.personnel), 0);
  const lostEquip = [...battles.values()].reduce((a, x) => a - Math.min(0, x.equipment), 0);
  const color = teamColor(team);

  if (!mine.length)
    return (
      <div className="page">
        <div className="empty-card">
          <div>В команде «{team || 'без команды'}» сил нет.</div>
          <Btn onClick={() => showSection('forces')}>К разделу «Силы»</Btn>
        </div>
      </div>
    );

  return (
    <div className="page team-page">
      <Crumbs items={[{ label: 'Силы', section: 'forces' }]} />
      <div className="page-head">
        <span className="team-dot lg" style={{ background: color }} />
        <div className="grow">
          <h1>{team || 'Без команды'}</h1>
          <div className="page-sub">
            {mine.length} {plural(mine.length, 'подразделение', 'подразделения', 'подразделений')} ·{' '}
            {levels.map((x) => `${LEVEL_LABEL[x.lv].text.toLowerCase()}: ${x.n}`).join(', ')}
          </div>
        </div>
        <ToolbarSlot>
          <Btn onClick={() => setEdit(true)} title="Переименовать команду, выбрать цвет">
            <Icon name="pencil" size={14} /> Название и цвет
          </Btn>
          <Btn kind="primary" onClick={() => void newForceDialog(team || undefined)}>
            + Силы
          </Btn>
        </ToolbarSlot>
      </div>

      <div className="team-kpis card">
        <Kpi k="Личный состав" v={`${fmt0(sum('persCur'))} / ${fmt0(sum('persAuth'))}`} s={sum('wounded') ? `раненых ${fmt0(sum('wounded'))}` : 'чел.'} />
        {sum('equipAuth') > 0 && (
          <Kpi k="Техника" v={`${fmt0(sum('equipCur'))} / ${fmt0(sum('equipAuth'))}`} s={sum('repair') ? `в ремонте ${fmt0(sum('repair'))}` : 'ед.'} />
        )}
        <Kpi k="Боёв" v={fmt0(battles.size)} s={battles.size ? `последний — ${fmtDate([...battles.values()][0].r.at)}` : 'итоги ещё не записывались'} />
        <Kpi
          k="Потери за всё время"
          v={`${fmt0(lostPers)} чел.`}
          s={lostEquip ? `техника ${fmt0(lostEquip)} ед.` : undefined}
          color={lostPers ? 'var(--bad)' : undefined}
        />
      </div>

      {battles.size > 0 && (
        <Card title="Бои" tight>
          <table className="tbl team-battles">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Бой</th>
                <th>Исход</th>
                <th className="num">Потери</th>
              </tr>
            </thead>
            <tbody>
              {[...battles.entries()].map(([key, x]) => (
                <tr key={key}>
                  <td className="faint nowrap">{fmtDate(x.r.at)}</td>
                  <td>
                    {x.r.battleId && index[x.r.battleId] ? (
                      <a href="#" onClick={(e) => (e.preventDefault(), openTab('battle', x.r.battleId!))}>
                        {x.r.title}
                      </a>
                    ) : (
                      x.r.title
                    )}
                    <div className="faint small">{x.forces.join(', ')}</div>
                  </td>
                  <td>{x.r.outcome ?? '—'}</td>
                  <td className={`num nowrap ${x.personnel < 0 ? 'bad' : ''}`}>
                    {[signed(x.personnel, 'чел.'), signed(x.equipment, 'ед.')].filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h3 className="team-sub">Подразделения</h3>
      <div className="force-grid">
        {mine.map((f) => (
          <ForceCard key={f.id} f={f} />
        ))}
      </div>

      <Card title="Боевой путь команды" tight>
        {!records.length && <div className="muted">Здесь появятся бои, отдых, лечение, ремонт и пополнения всех сил команды.</div>}
        <div className="stack" style={{ gap: 4 }}>
          {records.slice(0, 60).map(({ r, f }, i) => (
            <div key={i} className="history-row">
              <span className="faint small nowrap">{fmtDate(r.at)}</span>
              <span className="history-icon">
                <Icon name={KIND_ICON[r.kind] ?? 'dot'} size={14} />
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <a href="#" onClick={(e) => (e.preventDefault(), openTab('formation', `force:${f.id}`))}>
                  {f.name}
                </a>
                <span className="faint"> · </span>
                {r.title}
                {r.outcome && <span className="faint"> · {r.outcome}</span>}
                {r.note && <span className="faint"> · {r.note}</span>}
              </span>
              <span className={`small nowrap ${(r.personnel ?? 0) < 0 ? 'bad' : (r.personnel ?? 0) > 0 ? 'good' : 'faint'}`}>
                {[signed(r.personnel, 'чел.'), signed(r.equipment, 'ед.')].filter(Boolean).join(', ') || '—'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {edit && <TeamModal team={team} onClose={() => setEdit(false)} />}
    </div>
  );
}
