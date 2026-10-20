// Раздел «Силы»: боеготовность всех подразделений сил с первого взгляда — численность, раненые и ремонт,
// мораль, усталость, боезапас — и восстановление одной кнопкой (одного подразделения, группы или всех сразу).

import { useState } from 'react';
import { ROOT_STATE, type ForceCondition, type UnitNode } from '../../engine';
import { LEVEL_LABEL, ReplenishModal, RestModal } from '../components/ForceCampaign';
import { Icon } from '../components/Icon';
import { Btn, Menu, Seg, fmt0 } from '../components/ui';
import { sectionMeta } from '../nav';
import {
  canRestore,
  defaultRulesetId,
  deleteForce,
  duplicateForce,
  exportJson,
  forceStatus,
  forceUsage,
  importFile,
  newForceDialog,
  openTab,
  restoreForces,
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

export function ForcesPage() {
  const s = useApp();
  const meta = sectionMeta('forces');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [modal, setModal] = useState<{ kind: 'rest' | 'replenish'; force: UnitNode } | null>(null);
  const q = query.trim().toLowerCase();

  const all = Object.values(s.forces)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((f) => ({ f, c: forceStatus(f), can: canRestore(f) }));
  // «Ниже нормы» — всё, что можно восстановить: потери, некомплект против штата, мораль, боезапас…
  const restorable = all.filter((x) => x.can);
  const ready = all.filter((x) => x.c.level === 'ready').length;
  const worn = all.length - ready;
  const wounded = all.reduce((a, x) => a + x.c.wounded, 0);
  const repair = all.reduce((a, x) => a + x.c.repair, 0);

  const shown = all.filter(
    (x) =>
      (!q || x.f.name.toLowerCase().includes(q) || (x.f.faction ?? '').toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'need' ? x.can : x.c.level === 'ready')),
  );
  const factions = [...new Set(shown.map((x) => x.f.faction?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));

  const card = ({ f, c, can }: (typeof all)[number]) => {
    const lv = LEVEL_LABEL[c.level];
    const tpl = f.templateId ? s.formations[f.templateId] : undefined;
    const used = forceUsage(f.id);
    const last = [...(f.history ?? [])].reverse().find((h) => h.kind === 'battle' && h.battleId);
    const open = () => openTab('formation', `force:${f.id}`);
    return (
      <div key={f.id} className={`force-card lvl-${c.level}`}>
        <div className="fc-head">
          <button type="button" className="link fc-name" onClick={open} title="Открыть подразделение">
            {f.name}
          </button>
          <span className={`badge ${lv.cls}`} data-tip={c.issues.length ? `Что не так: ${c.issues.join(', ')}` : 'Полный состав, состояние в норме'}>
            {lv.text}
          </span>
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
        <div className="fc-actions">
          <Btn
            sm
            kind={can && c.level !== 'ready' ? 'primary' : undefined}
            disabled={!can}
            onClick={() => restoreForces([f.id])}
            title={can ? 'Полное восстановление: раненые и техника возвращаются, недостающее — до штата, состояние — к норме' : 'Восстанавливать нечего'}
          >
            <Icon name="restore" size={14} /> Восстановить
          </Btn>
          <Btn sm kind="ghost" onClick={() => setModal({ kind: 'rest', force: f })} title="Отдых на N дней: часть раненых вернётся, техника отремонтируется">
            <Icon name="rest" size={14} /> Отдых…
          </Btn>
          <Btn sm kind="ghost" onClick={() => setModal({ kind: 'replenish', force: f })} title="Пополнить людей и технику до штата">
            <Icon name="replenish" size={14} /> Пополнить…
          </Btn>
          <span className="grow" />
          <Menu
            sm
            items={[
              { label: 'Открыть', onClick: open },
              { label: 'Дублировать', onClick: () => duplicateForce(f.id) },
              { label: 'Сохранить в файл…', onClick: () => exportJson('force', f.name, { ...f, faction: f.faction ?? '' }) },
              'sep',
              { label: 'Удалить силы', danger: true, onClick: () => void deleteForce(f.id) },
            ]}
          />
        </div>
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

      {all.length > 0 && (
        <div className="forces-summary">
          <div className="fs-item">
            <span className="fs-v">{all.length}</span>
            <span className="fs-k">подразделений</span>
          </div>
          <div className="fs-item good">
            <span className="fs-v">{ready}</span>
            <span className="fs-k">боеготовы</span>
          </div>
          <div className={`fs-item${worn ? ' warn' : ''}`}>
            <span className="fs-v">{restorable.length}</span>
            <span className="fs-k">ниже штата или нормы</span>
          </div>
          <div className="fs-item">
            <span className="fs-v">{fmt0(wounded)}</span>
            <span className="fs-k">раненых ждут возвращения</span>
          </div>
          <div className="fs-item">
            <span className="fs-v">{fmt0(repair)}</span>
            <span className="fs-k">ед. техники в ремонте</span>
          </div>
          <span className="grow" />
          <Btn
            kind={restorable.length ? 'primary' : undefined}
            disabled={!restorable.length}
            onClick={() => restoreForces(restorable.map((x) => x.f.id))}
            title="Все силы — в полный состав, состояние — к норме. Отменить — Ctrl+Z."
          >
            <Icon name="restore" size={15} /> Восстановить всех{restorable.length ? ` (${restorable.length})` : ''}
          </Btn>
        </div>
      )}

      <div className="catalog-bar">
        <input
          type="search"
          className="catalog-search"
          placeholder="Поиск по названию или принадлежности…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Все (${all.length})` },
            { value: 'need', label: `Ниже нормы (${restorable.length})` },
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
        factions.map((fa) => {
          const list = shown.filter((x) => (x.f.faction?.trim() || '') === fa);
          const fix = list.filter((x) => x.can);
          return (
            <div key={fa || '_'} className="catalog-group">
              {(factions.length > 1 || fa) && (
                <div className="catalog-group-head">
                  <Icon name="flag" size={15} />
                  <h3 className="grow">{fa || 'Без принадлежности'}</h3>
                  <span className="faint small">{list.length}</span>
                  {fix.length > 0 && (
                    <Btn sm kind="ghost" onClick={() => restoreForces(fix.map((x) => x.f.id))} title="Восстановить все подразделения этой группы">
                      <Icon name="restore" size={14} /> Восстановить группу ({fix.length})
                    </Btn>
                  )}
                  <Btn sm kind="ghost" onClick={() => void newForceDialog(fa || undefined)} title="Новые силы с этой принадлежностью">
                    <Icon name="plus" size={14} /> Силы
                  </Btn>
                </div>
              )}
              <div className="force-grid">{list.map(card)}</div>
            </div>
          );
        })
      )}

      {modal?.kind === 'rest' && (
        <RestModal force={modal.force} rs={s.rulesets[modal.force.rulesetId ?? defaultRulesetId() ?? '']} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'replenish' && (
        <ReplenishModal force={modal.force} rs={s.rulesets[modal.force.rulesetId ?? defaultRulesetId() ?? '']} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

/** Панель боеготовности на странице подразделения сил: состояние и действия между боями — на виду. */
export function ForceReadiness({ force, onRest, onReplenish }: { force: UnitNode; onRest: () => void; onReplenish: () => void }) {
  useApp((s) => s.forces[force.id]);
  const c = forceStatus(force);
  const can = canRestore(force);
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
      <div className="rd-actions">
        <Btn
          kind={can && c.level !== 'ready' ? 'primary' : undefined}
          disabled={!can}
          onClick={() => restoreForces([force.id])}
          title={
            can
              ? 'Полное восстановление: раненые и техника возвращаются, недостающее — до штата, состояние — к норме. Отменить — Ctrl+Z.'
              : 'Восстанавливать нечего'
          }
        >
          <Icon name="restore" size={15} /> Восстановить
        </Btn>
        <Btn sm kind="ghost" onClick={onRest} title="Отдых на N дней: часть раненых вернётся, техника отремонтируется">
          <Icon name="rest" size={14} /> Отдых…
        </Btn>
        <Btn sm kind="ghost" onClick={onReplenish} title="Пополнить людей и технику до штата">
          <Icon name="replenish" size={14} /> Пополнить…
        </Btn>
      </div>
    </div>
  );
}
