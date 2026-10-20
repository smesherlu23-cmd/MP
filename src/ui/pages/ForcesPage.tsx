// Раздел «Силы»: подразделения сил по командам (у команды — свой цвет и название), боеготовность с первого
// взгляда — численность, раненые и ремонт, мораль, усталость, боезапас — и действия между боями на карточке.

import { useState } from 'react';
import { plural, ROOT_STATE, type ForceCondition, type UnitNode } from '../../engine';
import { ForceActions, LEVEL_LABEL } from '../components/ForceCampaign';
import { Icon } from '../components/Icon';
import { Btn, Check, Field, Menu, Modal, Seg, Txt, fmt0 } from '../components/ui';
import { sectionMeta } from '../nav';
import {
  canRestore,
  deleteForce,
  duplicateForce,
  editTeam,
  exportJson,
  forceStatus,
  forceUsage,
  importFile,
  newForceDialog,
  openTab,
  restoreForces,
  TEAM_PALETTE,
  teamColor,
  teamSides,
  useApp,
} from '../store';
import { fmtWhen } from './HomePage';

type Filter = 'all' | 'need' | 'ready';

/** Полоса численности: в строю, а за ней — те, кто может вернуться (раненые, техника в ремонте). */
export function StrengthBar(props: { label: string; cur: number; auth: number; back: number; backText: string; unit: string }) {
  const { cur, auth, back } = props;
  const pct = auth > 0 ? Math.min(100, (cur / auth) * 100) : 100;
  const backPct = auth > 0 ? Math.min(100 - pct, (back / auth) * 100) : 0;
  const cls = pct >= 95 ? 'good' : pct >= 70 ? 'warn' : 'bad';
  return (
    <div className="fc-meter">
      <div className="fc-meter-top">
        <span className="muted">{props.label}</span>
        <span className="num">
          <b>{fmt0(cur)}</b>
          <span className="faint"> / {fmt0(auth)}</span>
          {back > 0 && <span className="faint"> · {props.backText}</span>}
        </span>
      </div>
      <div className="fc-bar" title={`${Math.round(pct)}% штата`}>
        <div className={`fc-bar-cur ${cls}`} style={{ width: `${pct}%` }} />
        {backPct > 0 && <div className="fc-bar-back" style={{ width: `${backPct}%` }} />}
      </div>
    </div>
  );
}

/** Показатели состояния: отклонения от нормы подсвечены. */
export function StateLine({ c }: { c: ForceCondition }) {
  const st = c.state;
  const items: { k: string; v: string; bad: boolean; warn: boolean }[] = [
    { k: 'Мораль', v: String(st.morale), bad: st.morale < 40, warn: st.morale < ROOT_STATE.morale - 5 },
    { k: 'Усталость', v: String(st.fatigue), bad: st.fatigue > 60, warn: st.fatigue > ROOT_STATE.fatigue + 10 },
    { k: 'Боезапас', v: `${st.ammo}%`, bad: st.ammo < 35, warn: st.ammo < 90 },
    { k: 'Топливо', v: `${st.fuel}%`, bad: st.fuel < 35, warn: st.fuel < 90 },
  ];
  return (
    <div className="fc-stats">
      {items.map((x) => (
        <span key={x.k} className={x.bad ? 'bad' : x.warn ? 'warn' : undefined}>
          <span className="faint">{x.k}</span> {x.v}
        </span>
      ))}
    </div>
  );
}

/** Команда: название и цвет; переименование меняет принадлежность всех её сил. */
function TeamModal({ team, onClose }: { team: string; onClose: () => void }) {
  const [name, setName] = useState(team);
  const [color, setColor] = useState(() => (team ? teamColor(team) : TEAM_PALETTE[0]));
  const sides = teamSides(team);
  const [renameSides, setRenameSides] = useState(true);
  const renamed = name.trim() !== team;
  return (
    <Modal
      title={team ? `Команда «${team}»` : 'Силы без команды'}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Отменить переименование — Ctrl+Z.</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn
            kind="primary"
            disabled={!name.trim() && !team}
            onClick={() => {
              editTeam(team, { name, color, renameSides });
              onClose();
            }}
          >
            Сохранить
          </Btn>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Название">
          <Txt value={name} onChange={setName} placeholder="Синие, 1-я армия, отряд «Север»…" />
        </Field>
        <Field label="Цвет">
          <div className="team-swatches">
            {TEAM_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`team-swatch${color.toLowerCase() === c ? ' on' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
            <label className="team-swatch custom" title="Свой цвет" style={{ background: TEAM_PALETTE.includes(color.toLowerCase()) ? undefined : color }}>
              <input type="color" value={color.startsWith('#') ? color : '#888888'} onChange={(e) => setColor(e.target.value)} />
              <Icon name="plus" size={13} />
            </label>
          </div>
        </Field>
        {team && renamed && sides.length > 0 && (
          <Check value={renameSides} onChange={setRenameSides}>
            переименовать и стороны «{team}» в сценариях ({sides.length}) — чтобы новые силы со стороны попадали в эту команду
          </Check>
        )}
      </div>
    </Modal>
  );
}

export function ForcesPage() {
  const s = useApp();
  const meta = sectionMeta('forces');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [teamEdit, setTeamEdit] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const all = Object.values(s.forces)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((f) => ({ f, c: forceStatus(f), can: canRestore(f) }));
  // «Ниже нормы» — всё, что можно восстановить: потери, некомплект против штата, мораль, боезапас…
  const restorable = all.filter((x) => x.can).length;
  const ready = all.filter((x) => x.c.level === 'ready').length;

  const shown = all.filter(
    (x) =>
      (!q || x.f.name.toLowerCase().includes(q) || (x.f.faction ?? '').toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'need' ? x.can : x.c.level === 'ready')),
  );
  const teams = [...new Set(shown.map((x) => x.f.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));

  const card = ({ f, c, can }: (typeof all)[number]) => {
    const lv = LEVEL_LABEL[c.level];
    const tpl = f.templateId ? s.formations[f.templateId] : undefined;
    const used = forceUsage(f.id);
    const last = [...(f.history ?? [])].reverse().find((h) => h.kind === 'battle' && h.battleId);
    const open = () => openTab('formation', `force:${f.id}`);
    return (
      <div key={f.id} className="force-card" style={{ borderLeftColor: teamColor(f.faction ?? '') }}>
        <div className="fc-head">
          <button type="button" className="link fc-name" onClick={open} title="Открыть подразделение">
            {f.name}
          </button>
          <span className={`badge ${lv.cls}`} data-tip={c.issues.length ? `Что не так: ${c.issues.join(', ')}` : 'Полный состав, состояние в норме'}>
            {lv.text}
          </span>
          <Menu
            sm
            items={[
              { label: 'Открыть', onClick: open },
              {
                label: 'Восстановить полностью',
                disabled: !can,
                onClick: () => restoreForces([f.id]),
                tip: 'Раненые и техника возвращаются, недостающее — до штата из резерва, состояние — к норме',
              },
              { label: 'Дублировать', onClick: () => duplicateForce(f.id) },
              { label: 'Сохранить в файл…', onClick: () => exportJson('force', f.name, { ...f, faction: f.faction ?? '' }) },
              'sep',
              { label: 'Удалить силы', danger: true, onClick: () => void deleteForce(f.id) },
            ]}
          />
        </div>
        <div className="faint small fc-sub">
          {tpl ? `по шаблону «${tpl.name}»` : 'без шаблона'}
          {used.length > 0 && ` · в сценариях: ${used.length}`}
        </div>
        <StrengthBar label="Личный состав" cur={c.persCur} auth={c.persAuth} back={c.wounded} backText={`раненых ${fmt0(c.wounded)}`} unit="чел." />
        {c.equipAuth > 0 && (
          <StrengthBar label="Техника" cur={c.equipCur} auth={c.equipAuth} back={c.repair} backText={`в ремонте ${fmt0(c.repair)}`} unit="ед." />
        )}
        <StateLine c={c} />
        {last && (
          <div className="fc-last small">
            <Icon name="battle" size={13} />
            <span className="grow">
              <a href="#" onClick={(e) => (e.preventDefault(), last.battleId && openTab('battle', last.battleId))}>
                {last.title}
              </a>
              {last.outcome && <span className="faint"> · {last.outcome}</span>}
            </span>
            <span className="faint nowrap">{fmtWhen(last.at)}</span>
          </div>
        )}
        <ForceActions force={f} grid />
      </div>
    );
  };

  return (
    <div className="page catalog forces-page">
      <div className="page-head">
        <span className="page-icon">
          <Icon name={meta.icon} size={22} />
        </span>
        <div className="grow">
          <h1>{meta.label}</h1>
          <div className="page-sub">{meta.about}</div>
        </div>
        <Btn kind="primary" onClick={() => void newForceDialog()}>
          + {meta.create}
        </Btn>
        <Btn onClick={() => importFile()} title="Набор правил, подразделение, сценарий или бой в формате JSON">
          Импорт…
        </Btn>
      </div>

      <div className="catalog-bar">
        <input type="search" className="catalog-search" placeholder="Поиск по названию или команде…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Все (${all.length})` },
            { value: 'need', label: `Ниже нормы (${restorable})` },
            { value: 'ready', label: `Боеготовы (${ready})` },
          ]}
        />
      </div>

      {!shown.length ? (
        <div className="empty-card">
          <div className="empty-icon">
            <Icon name="forces" size={32} />
          </div>
          <div>
            {all.length
              ? 'Ничего не найдено.'
              : 'Сил пока нет. Силы — конкретные подразделения, созданные по шаблонам: у каждого своё состояние и свои потери после боёв.'}
          </div>
          {!all.length && (
            <Btn kind="primary" onClick={() => void newForceDialog()}>
              + {meta.create}
            </Btn>
          )}
        </div>
      ) : (
        teams.map((team) => {
          const list = shown.filter((x) => (x.f.faction?.trim() || '') === team);
          const mine = all.filter((x) => (x.f.faction?.trim() || '') === team);
          const wounded = mine.reduce((a, x) => a + x.c.wounded, 0);
          const repair = mine.reduce((a, x) => a + x.c.repair, 0);
          const okCount = mine.filter((x) => x.c.level === 'ready').length;
          return (
            <div key={team || '_'} className="catalog-group team-group">
              <div className="catalog-group-head team-head">
                <button
                  type="button"
                  className="team-dot"
                  style={{ background: teamColor(team) }}
                  title="Название и цвет команды"
                  onClick={() => setTeamEdit(team)}
                />
                <h3>{team || 'Без команды'}</h3>
                <span className="faint small grow">
                  {mine.length} {plural(mine.length, 'подразделение', 'подразделения', 'подразделений')} · боеготовы: {okCount}
                  {wounded > 0 && ` · раненых: ${fmt0(wounded)}`}
                  {repair > 0 && ` · в ремонте: ${fmt0(repair)} ед.`}
                </span>
                <Btn sm kind="ghost" onClick={() => setTeamEdit(team)} title="Переименовать команду, выбрать цвет">
                  <Icon name="pencil" size={14} /> {team ? 'Название и цвет' : 'Назначить команду'}
                </Btn>
                <Btn sm kind="ghost" onClick={() => void newForceDialog(team || undefined)} title="Новые силы этой команды">
                  <Icon name="plus" size={14} /> Силы
                </Btn>
              </div>
              <div className="force-grid">{list.map(card)}</div>
            </div>
          );
        })
      )}

      {teamEdit !== null && <TeamModal team={teamEdit} onClose={() => setTeamEdit(null)} />}
    </div>
  );
}

/** Панель боеготовности на странице подразделения сил: состояние и действия между боями — на виду. */
export function ForceReadiness({ force }: { force: UnitNode }) {
  useApp((s) => s.forces[force.id]);
  const c = forceStatus(force);
  const lv = LEVEL_LABEL[c.level];
  return (
    <div className={`readiness card lvl-${c.level}`}>
      <div className="rd-status">
        <span className="faint small">Боеготовность</span>
        <span className={`badge ${lv.cls}`}>{lv.text}</span>
        {c.issues.length > 0 && <span className="faint small rd-issues">{c.issues.slice(0, 3).join(' · ')}</span>}
      </div>
      <div className="rd-meters">
        <StrengthBar label="Личный состав" cur={c.persCur} auth={c.persAuth} back={c.wounded} backText={`раненых ${fmt0(c.wounded)}`} unit="чел." />
        {c.equipAuth > 0 && (
          <StrengthBar label="Техника" cur={c.equipCur} auth={c.equipAuth} back={c.repair} backText={`в ремонте ${fmt0(c.repair)}`} unit="ед." />
        )}
      </div>
      <StateLine c={c} />
      <ForceActions force={force} grid />
    </div>
  );
}
