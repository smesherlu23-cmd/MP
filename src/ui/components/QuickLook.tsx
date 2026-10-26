// Быстрый просмотр (как Quick Look в Finder): пробел на строке списка или пункт меню показывает главное
// об объекте во всплывающем окне — без перехода на его страницу. Пробел или Esc закрывают.

import { useEffect, type ReactNode } from 'react';
import { plural, resolveScenario, sideUnits, summarizeUnits } from '../../engine';
import { OBJ_ICON, OBJ_NOUN, objName, openObj, quickLook, useQuickLook, type Obj } from '../objects';
import { fmtWhen } from '../pages/HomePage';
import { StateLine, StrengthBar } from '../pages/ForcesPage';
import { computeStats } from '../pages/unit/model';
import { defaultRulesetId, forceStatus, forceUsage, teamColor, templateUsages, useApp } from '../store';
import { LEVEL_LABEL } from './ForceCampaign';
import { Icon } from './Icon';
import { Btn, Modal, fmt0 } from './ui';

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="ql-facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ o }: { o: Obj }) {
  const s = useApp();
  if (o.kind === 'scenario') {
    const sc = s.scenarios[o.id];
    const rs = s.rulesets[sc.rulesetId];
    const battles = Object.values(s.battleIndex).filter((b) => b.scenarioId === sc.id);
    const sides = rs ? resolveScenario(sc, s.forces).sides : [];
    return (
      <>
        <div className="ql-sides">
          {sides.map((sd) => {
            const sum = summarizeUnits(sideUnits(sd), rs!);
            return (
              <div key={sd.id} className="ql-side" style={{ borderColor: sd.color }}>
                <b style={{ color: sd.color }}>{sd.name}</b>
                <span>
                  {fmt0(sum.persCur)} чел.{sum.equip.length ? ` · ${fmt0(sum.equip.reduce((a, q) => a + q.cur, 0))} ед.` : ''}
                </span>
                <span className="faint small">
                  {sd.formations.length} {plural(sd.formations.length, 'подразделение', 'подразделения', 'подразделений')}
                </span>
              </div>
            );
          })}
        </div>
        <Facts
          items={[
            ['Набор правил', rs?.name ?? <span className="bad">не найден</span>],
            ['Боёв', battles.length || '—'],
            ['Изменён', fmtWhen(sc.updatedAt) || '—'],
          ]}
        />
      </>
    );
  }
  if (o.kind === 'force') {
    const f = s.forces[o.id];
    const c = forceStatus(f);
    const lv = LEVEL_LABEL[c.level];
    const tpl = f.templateId ? s.formations[f.templateId] : undefined;
    const used = forceUsage(f.id);
    return (
      <>
        <div className="row" style={{ gap: 8 }}>
          <span className="team-dot sm" style={{ background: teamColor(f.faction ?? '') }} />
          <span>{f.faction || 'Без команды'}</span>
          <span className={`badge ${lv.cls}`}>{lv.text}</span>
          {c.issues.length > 0 && <span className="faint small">{c.issues.slice(0, 3).join(' · ')}</span>}
        </div>
        <StrengthBar label="Личный состав" cur={c.persCur} auth={c.persAuth} back={c.wounded} backText={`раненых ${fmt0(c.wounded)}`} unit="чел." />
        {c.equipAuth > 0 && (
          <StrengthBar label="Техника" cur={c.equipCur} auth={c.equipAuth} back={c.repair} backText={`в ремонте ${fmt0(c.repair)}`} unit="ед." />
        )}
        <StateLine c={c} />
        <Facts
          items={[
            ['Шаблон', tpl?.name ?? '—'],
            ['В сценариях', used.length ? used.map((x) => x.name).join(', ') : '—'],
            ['Изменены', fmtWhen(f.updatedAt) || '—'],
          ]}
        />
      </>
    );
  }
  if (o.kind === 'template') {
    const f = s.formations[o.id];
    const rs = s.rulesets[f.rulesetId ?? defaultRulesetId() ?? ''];
    const stats = rs ? computeStats(f, rs) : null;
    const st = stats?.get(f.id);
    const forces = templateUsages(f.id).filter((u) => u.ref.startsWith('force:')).length;
    return (
      <>
        <Facts
          items={[
            ['Уровень', f.level || '—'],
            ['По штату', st ? `${fmt0(st.persAuth)} чел.${st.equip ? ` · ${fmt0(st.equip)} ед.` : ''}` : '—'],
            ['Набор правил', rs?.name ?? '—'],
            ['Создано сил', forces || '—'],
          ]}
        />
        {f.children.length > 0 && (
          <div className="ql-list">
            {f.children.slice(0, 12).map((c) => (
              <div key={c.id}>
                <span className="grow">{c.name}</span>
                <span className="faint small">{stats?.get(c.id) ? `${fmt0(stats.get(c.id)!.persAuth)} чел.` : ''}</span>
              </div>
            ))}
            {f.children.length > 12 && <div className="faint small">и ещё {f.children.length - 12}</div>}
          </div>
        )}
      </>
    );
  }
  if (o.kind === 'ruleset') {
    const r = s.rulesets[o.id];
    const used = Object.values(s.scenarios).filter((x) => x.rulesetId === r.id).length;
    return (
      <Facts
        items={[
          ['Эпоха', r.era || '—'],
          ['Типов вооружения', r.componentTypes.length],
          ['Приказов', r.orders.length],
          ['Дистанций', r.rangeBands.map((b) => b.name).join(', ')],
          ['Сценариев', used || '—'],
          ['Изменён', fmtWhen(r.updatedAt) || '—'],
        ]}
      />
    );
  }
  const b = s.battleIndex[o.id];
  const sc = s.scenarios[b.scenarioId];
  return (
    <Facts
      items={[
        ['Сценарий', sc?.name ?? '—'],
        ['Состояние', b.finished ? 'окончен' : `идёт · ход ${b.turn}${b.maxTurns ? ` из ${b.maxTurns}` : ''}`],
        ...(b.finished ? ([['Итог', b.headline ?? '—']] as [string, ReactNode][]) : []),
        ...(b.unrecorded
          ? ([
              [
                'Силы',
                <span key="u" className="warn">
                  итоги не записаны
                </span>,
              ],
            ] as [string, ReactNode][])
          : []),
        ['Изменён', fmtWhen(b.updatedAt) || '—'],
      ]}
    />
  );
}

export function QuickLookHost() {
  const o = useQuickLook((x) => x.obj);
  useApp();
  const name = o ? objName(o) : undefined;
  useEffect(() => {
    if (!o) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || (e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      e.stopPropagation();
      quickLook(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [o]);
  if (!o || name === undefined) return null;
  return (
    <Modal
      title={
        <span className="ql-title">
          <Icon name={OBJ_ICON[o.kind]} size={18} />
          <span>
            <span className="ql-kind">{OBJ_NOUN[o.kind]}</span>
            {name}
          </span>
        </span>
      }
      onClose={() => quickLook(null)}
      footer={
        <>
          <span className="faint small grow">Пробел или Esc — закрыть</span>
          <Btn
            kind="primary"
            onClick={() => {
              quickLook(null);
              openObj(o);
            }}
          >
            Открыть
          </Btn>
        </>
      }
    >
      <div className="ql-body stack">
        <Body o={o} />
      </div>
    </Modal>
  );
}
