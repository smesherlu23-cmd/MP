// Сводка подразделения с подчинёнными: численность, люди и техника по типам, огневая мощь.

import { summarizeUnits, type Id, type Resolved, type Ruleset, type UnitNode } from '../../../engine';
import { Card, Info, ScrollX, Section, fmt0, fmt1 } from '../../components/ui';

export function FireTable({ fire, rs, fmt = fmt1 }: { fire: Record<string, Record<string, number>>; rs: Ruleset; fmt?: (v: number) => string }) {
  return (
    <ScrollX>
      <table className="tbl compact fire-tbl">
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
                  {fmt(fire[c.id]?.[b.id] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

/**
 * Сводка узла с подчинёнными; у шаблона — только штат (состояния у него нет). У корня сил численность,
 * мораль, некомплект и раненые — в шапке страницы, здесь их не повторяем.
 */
export function SummaryCard(props: { node: UnitNode; rs: Ruleset; resolved: Map<Id, Resolved>; template: boolean; forceRoot?: boolean }) {
  const { node, rs, resolved, template, forceRoot } = props;
  const s = summarizeUnits([node], rs, resolved);
  const shortage = s.persAuth > 0 ? (1 - s.persCur / s.persAuth) * 100 : 0;
  const own = !template && !forceRoot;
  return (
    <div className="stack">
      <Card title={node.children.length ? 'Сводка с подчинёнными' : 'Сводка'}>
        <div className="stat-row">
          {!forceRoot && (
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
          )}
          {own && rs.features.morale && s.combatUnits > 0 && (
            <div className="stat">
              <span className="k">Мораль</span>
              <span className="v">{Math.round(s.morale)}</span>
            </div>
          )}
        </div>
        <div className="faint small row" style={{ marginTop: 4, gap: 4 }}>
          в бою — элементов: {s.combatUnits}
          <Info text="Каждое подразделение с собственным составом сражается в бою как отдельный элемент: стреляет, несёт потери, может отступить." />
          {own && shortage >= 1 ? ` · некомплект ${fmt1(shortage)}%` : ''}
        </div>
        {s.people.length + s.equip.length > 0 && (
          <table className="tbl compact" style={{ marginTop: 10 }}>
            <tbody>
              {[...s.people, ...s.equip].map((q) => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td className="num nowrap">
                    {template ? (
                      q.auth
                    ) : (
                      <>
                        {q.cur} <span className="faint">из {q.auth}</span>
                        {q.rec ? (
                          <span className="faint">
                            {' '}
                            (+{q.rec} {q.kind === 'personnel' ? 'раненых' : 'в ремонте'})
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Section id="formation-fire" title="Огневая мощь" summary="в среднем за ход, без модификаторов" tight>
        <FireTable fire={s.fire} rs={rs} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ редактор подразделения
