// Сводка подразделения с подчинёнными: численность, техника, огневая мощь, риск паники.

import { summarizeUnits, type Id, type Resolved, type Ruleset, type UnitNode } from '../../../engine';
import { Card, Info, Section, fmt0, fmt1 } from '../../components/ui';

export function FireTable({ fire, rs }: { fire: Record<string, Record<string, number>>; rs: Ruleset }) {
  return (
    <table className="tbl compact">
      <thead>
        <tr>
          <th>По классу цели</th>
          {rs.rangeBands.map((b) => (
            <th key={b.id} className="num">
              {b.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rs.targetClasses.map((c) => (
          <tr key={c.id}>
            <td>{c.name}</td>
            {rs.rangeBands.map((b) => (
              <td key={b.id} className="num">
                {fmt1(fire[c.id]?.[b.id] ?? 0)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Сводка узла с подчинёнными; у шаблона — только штат (состояния у него нет). */
export function SummaryCard({ node, rs, resolved, template }: { node: UnitNode; rs: Ruleset; resolved: Map<Id, Resolved>; template: boolean }) {
  const s = summarizeUnits([node], rs, resolved);
  const shortage = s.persAuth > 0 ? (1 - s.persCur / s.persAuth) * 100 : 0;
  return (
    <div className="stack">
      <Card title={node.children.length ? 'Сводка с подчинёнными' : 'Сводка'}>
        <div className="stat-row">
          <div className="stat">
            <span className="k">{template ? 'По штату' : 'Личный состав'}</span>
            <span className="v">
              {template ? (
                fmt0(s.persAuth)
              ) : (
                <>
                  {fmt0(s.persCur)} <small>из {fmt0(s.persAuth)}</small>
                </>
              )}
            </span>
          </div>
          <div className="stat" data-tip="Сумма очков боевой ценности всех единиц">
            <span className="k">Ценность</span>
            <span className="v">{fmt0(s.value)}</span>
          </div>
          {!template && rs.features.morale && s.combatUnits > 0 && (
            <div className="stat">
              <span className="k">Мораль</span>
              <span className="v">{Math.round(s.morale)}</span>
            </div>
          )}
        </div>
        <div className="faint small row" style={{ marginTop: 4, gap: 4 }}>
          в бою — элементов: {s.combatUnits}
          <Info text="Каждое подразделение с собственным составом сражается в бою как отдельный элемент: стреляет, несёт потери, может отступить." />
          {!template && shortage >= 1 ? ` · некомплект ${fmt1(shortage)}%` : ''}
          {!template && s.recoverable ? ` · раненых ${s.recoverable}` : ''}
        </div>
        {s.equip.length > 0 && (
          <table className="tbl compact" style={{ marginTop: 10 }}>
            <tbody>
              {s.equip.map((q) => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td className="num nowrap">
                    {template ? (
                      q.auth
                    ) : (
                      <>
                        {q.cur} <span className="faint">из {q.auth}</span>
                        {q.rec ? <span className="faint"> (+{q.rec} в ремонте)</span> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Section id="formation-fire" title="Огневая мощь" summary="за ход, без модификаторов" tight>
        <FireTable fire={s.fire} rs={rs} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ редактор подразделения
