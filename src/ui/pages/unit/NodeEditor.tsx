// Редактор узла подразделения: уровень, эшелон, состав, состояние; вставка из шаблонов.

import { Icon } from '../../components/Icon';
import { useState } from 'react';
import {
  ECHELON_LABELS,
  KIND_LABELS,
  ROOT_RESOLVED,
  STATE_LABELS,
  findParent,
  findUnit,
  isOutdated,
  nextName,
  summarizeUnits,
  type ComponentKind,
  type Echelon,
  type Id,
  type StateKey,
  type UnitNode,
} from '../../../engine';
import { Link } from '../../components/Link';
import { Area, Btn, Card, Check, Field, Info, Menu, Modal, Num, Range, Section, Sel, Tags, fmt0, pressable } from '../../components/ui';
import { instantiateLibrary, returnPart, updateCopy } from '../../store';
import { type Ctx, canInsertTemplate, nodeActions } from './model';

export function InheritRange(props: {
  label: string;
  own: number | null | undefined;
  inherited: number;
  isRoot: boolean;
  onSet: (v: number) => void;
  onClear: () => void;
  hint?: string;
}) {
  const isOwn = props.own !== undefined && props.own !== null;
  return (
    <Field
      label={
        <>
          {props.label}
          {isOwn ? (
            <a
              href="#"
              className="small"
              onClick={(e) => (e.preventDefault(), props.onClear())}
              data-tip={props.isRoot ? 'Вернуть значение по умолчанию' : 'Брать значение у старшего'}
            >
              <Icon name="undo" size={12} />
            </a>
          ) : (
            <span className="faint small">{props.isRoot ? '· по умолчанию' : '· как у старшего'}</span>
          )}
        </>
      }
      hint={props.hint}
    >
      <Range value={isOwn ? props.own! : props.inherited} onChange={props.onSet} />
    </Field>
  );
}

export function NodeEditor({ ctx, node }: { ctx: Ctx; node: UnitNode }) {
  const { rs } = ctx;
  const isRoot = node.id === ctx.root.id;
  const parent = isRoot ? null : findParent(ctx.root, node.id);
  const pr = parent ? ctx.resolved.get(parent.id)! : ROOT_RESOLVED;
  const ft = rs.features;
  const un = (fn: (n: UnitNode) => void) => ctx.upd((d) => fn(findUnit(d, node.id)!));
  const setState = (k: StateKey, v: number | undefined) =>
    un((n) => {
      if (v === undefined) delete n.state[k];
      else n.state[k] = v;
    });
  const inheritText = isRoot ? 'по умолчанию' : 'как у старшего';
  const expName = (lv: number) => `${lv}. ${rs.experienceLevels[lv - 1]?.name ?? ''}`;
  const types = new Map(rs.componentTypes.map((t) => [t.id, t]));
  let ownCur = 0;
  let ownAuth = 0;
  for (const c of node.composition) {
    const t = types.get(c.typeId);
    if (!t) continue;
    const crew = t.kind === 'personnel' ? 1 : t.crew;
    ownCur += c.current * crew;
    ownAuth += c.authorized * crew;
  }
  const showRecoverable = !ctx.isLib && node.composition.some((c) => (c.recoverable ?? 0) > 0);
  const stateKeys = (['morale', 'cohesion', 'readiness', 'fatigue', 'ammo', 'fuel', 'equipment', 'vehicleCondition'] as StateKey[]).filter(
    (k) => (ft as unknown as Record<string, boolean>)[k] !== false,
  );
  const tpl = node.templateId ? ctx.lib[node.templateId] : undefined;
  const isLibRoot = ctx.isLib && isRoot;
  // Сводка свёрнутого «Состояния»: только заданные здесь значения.
  const own = [
    node.state.experience !== undefined && `опыт ${node.state.experience}`,
    ...stateKeys.filter((k) => node.state[k] !== undefined).map((k) => `${STATE_LABELS[k].toLowerCase()} ${Math.round(node.state[k]!)}`),
    ft.comms && node.comms !== null && `связь ${node.comms}`,
    node.supply !== null && `снабжение ${node.supply}`,
  ].filter(Boolean);
  const stateSummary = own.length ? own.join(', ') : isRoot ? 'по умолчанию' : 'всё как у старшего';

  return (
    <div className="stack">
      <Card
        title={
          <input
            className="title-input node-title"
            style={{ fontSize: 15, minWidth: 160, width: '100%' }}
            value={node.name}
            onChange={(e) => un((n) => void (n.name = e.target.value))}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          />
        }
        actions={<Menu sm items={nodeActions(ctx, node)} />}
      >
        {((tpl && !isLibRoot) || node.attachedFrom !== undefined || node.transfer) && (
          <div className="meta" style={{ marginBottom: 10 }}>
            {tpl && !isLibRoot && (
              <span>
                шаблон:{' '}
                <Link kind="formation" refId={`lib:${tpl.id}`}>
                  {tpl.name}
                </Link>
                {isOutdated(node, tpl) && (
                  <>
                    {' '}
                    — <span className="warn">изменён</span>{' '}
                    <a href="#" onClick={(e) => (e.preventDefault(), updateCopy(ctx.ref, node.id))}>
                      обновить
                    </a>
                  </>
                )}
              </span>
            )}
            {node.transfer && (
              <span>
                передано из «{node.transfer.fromName}»{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    const p = findParent(ctx.root, node.id);
                    if (p) ctx.setSel(p.id);
                    returnPart(node.id);
                  }}
                  title={node.transfer.parentId ? 'Вернуть на прежнее место у прежнего старшего' : 'Снова самостоятельные силы'}
                >
                  вернуть
                </a>
              </span>
            )}
            {node.attachedFrom !== undefined && !node.transfer && <span>придано{node.attachedFrom ? ` из: ${node.attachedFrom}` : ''}</span>}
          </div>
        )}
        <div className="fields">
          <Field label="Эшелон" hint="Насколько подразделение подставлено под прямой огонь.">
            <Sel
              value={node.echelon ?? ''}
              onChange={(v) => un((n) => void (n.echelon = (v || null) as Echelon | null))}
              options={[
                { value: '', label: `${ECHELON_LABELS[pr.echelon]} (${inheritText})` },
                ...(Object.keys(ECHELON_LABELS) as Echelon[]).map((k) => ({ value: k, label: ECHELON_LABELS[k] })),
              ]}
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 18 }}>
          <Check value={node.isHQ} onChange={(v) => un((n) => void (n.isHQ = v))} title="Потеря штаба лишает старшее подразделение командира и ухудшает связь">
            Штаб
          </Check>
        </div>
      </Card>

      <Card
        title={
          <>
            Собственный состав{' '}
            <Info text="Люди, вооружение и техника самого подразделения, без подчинённых. Подразделение с собственным составом сражается в бою как отдельный элемент; без состава — только управляет подчинёнными." />
          </>
        }
        actions={
          node.composition.length > 0 &&
          (ctx.isLib ? (
            <span className="muted small">по штату {fmt0(ownAuth)} чел.</span>
          ) : (
            <span className="row" style={{ gap: 8 }}>
              <span className="muted small">
                {fmt0(ownCur)} из {fmt0(ownAuth)} чел.
              </span>
              <Btn sm kind="ghost" onClick={() => un((n) => n.composition.forEach((c) => (c.current = c.authorized)))} title="Пополнить до штата">
                До штата
              </Btn>
            </span>
          ))
        }
        tight
      >
        {node.composition.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl comp-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th className="num">Штат</th>
                  {!ctx.isLib && <th className="num">В строю</th>}
                  {showRecoverable && (
                    <th className="num" data-tip="Раненые (люди) или техника в ремонте — могут вернуться в строй">
                      Ран./ремонт
                    </th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {node.composition.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <Sel
                        value={c.typeId}
                        onChange={(v) => un((n) => void (n.composition[i].typeId = v))}
                        options={rs.componentTypes.map((tt) => ({ value: tt.id, label: tt.name }))}
                      />
                    </td>
                    <td className="num">
                      <Num
                        value={c.authorized}
                        onChange={(v) =>
                          un((n) => {
                            n.composition[i].authorized = v;
                            // В шаблоне только штат: «в строю» всегда по штату.
                            if (ctx.isLib) n.composition[i].current = v;
                          })
                        }
                        min={0}
                        integer
                        width={80}
                      />
                    </td>
                    {!ctx.isLib && (
                      <td className="num">
                        <Num value={c.current} onChange={(v) => un((n) => void (n.composition[i].current = v))} min={0} integer width={80} />
                      </td>
                    )}
                    {showRecoverable && (
                      <td className="num nowrap">
                        {c.recoverable ? (
                          <>
                            {c.recoverable}{' '}
                            <Btn
                              sm
                              kind="ghost"
                              title="Вернуть в строй"
                              onClick={() =>
                                un((n) => {
                                  const cc = n.composition[i];
                                  cc.current += cc.recoverable ?? 0;
                                  cc.recoverable = 0;
                                })
                              }
                            >
                              вернуть
                            </Btn>
                          </>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    )}
                    <td style={{ width: 30 }}>
                      <Btn sm kind="ghost" icon title="Убрать" onClick={() => un((n) => void n.composition.splice(i, 1))}>
                        ×
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '6px 14px 4px' }}>
          {types.size ? (
            <select
              className="comp-add"
              value=""
              onChange={(ev) => {
                const id = ev.target.value;
                if (id) un((n) => void n.composition.push({ typeId: id, authorized: 10, current: 10 }));
              }}
            >
              <option value="">+ Добавить из каталога…</option>
              {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => (
                <optgroup key={k} label={KIND_LABELS[k]}>
                  {rs.componentTypes
                    .filter((t) => t.kind === k)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="muted">
              Каталог пуст — добавьте типы в{' '}
              <Link kind="ruleset" refId={rs.id} sub="types">
                наборе правил
              </Link>
              .
            </span>
          )}
        </div>
      </Card>

      {!ctx.isLib && (
        <Section
          id="unit-state"
          title={
            <>
              Состояние{' '}
              <Info text="Незаданное значение берётся у старшего подразделения — так можно задать мораль или опыт целому батальону и уточнить только отдельные роты. Значок ↺ возвращает наследование." />
            </>
          }
          summary={stateSummary}
        >
          <div className="fields two">
            <Field label={<>Опыт{node.state.experience === undefined && <span className="faint small">· {inheritText}</span>}</>}>
              <Sel
                value={node.state.experience ?? 0}
                onChange={(v) => setState('experience', v || undefined)}
                options={[
                  { value: 0, label: `${expName(pr.state.experience)} (${inheritText})` },
                  ...rs.experienceLevels.map((_, i) => ({ value: i + 1, label: expName(i + 1) })),
                ]}
              />
            </Field>
            {stateKeys.map((k) => (
              <InheritRange
                key={k}
                label={`${STATE_LABELS[k]}${k === 'morale' || k === 'cohesion' || k === 'readiness' ? '' : ', %'}`}
                own={node.state[k]}
                inherited={pr.state[k]}
                isRoot={isRoot}
                onSet={(v) => setState(k, v)}
                onClear={() => setState(k, undefined)}
              />
            ))}
            {ft.comms && (
              <InheritRange
                label="Связь, %"
                own={node.comms}
                inherited={pr.comms}
                isRoot={isRoot}
                onSet={(v) => un((n) => void (n.comms = v))}
                onClear={() => un((n) => void (n.comms = null))}
              />
            )}
            <InheritRange
              label="Снабжение, %"
              own={node.supply}
              inherited={pr.supply}
              isRoot={isRoot}
              onSet={(v) => un((n) => void (n.supply = v))}
              onClear={() => un((n) => void (n.supply = null))}
              hint="Скорость подвоза боезапаса и топлива во время боя."
            />
          </div>
        </Section>
      )}

      <Section
        id="unit-extra"
        title="Дополнительно"
        summary={
          [node.attackMod !== 100 && `атака ${node.attackMod}%`, node.defenseMod !== 100 && `защита ${node.defenseMod}%`, ...node.tags]
            .filter(Boolean)
            .join(', ') || 'атака и защита, теги, заметки'
        }
      >
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <Field label="Атака, %" hint="100% — как в каталоге. Особое вооружение, выучка, тактика.">
              <Num value={node.attackMod} onChange={(v) => un((n) => void (n.attackMod = v))} min={0} />
            </Field>
            <Field label="Защита, %">
              <Num value={node.defenseMod} onChange={(v) => un((n) => void (n.defenseMod = v))} min={1} />
            </Field>
          </div>
          <Field label="Теги" hint={`Используются в своих правилах. Тег «${rs.reconTag}» делает подразделение разведчиком.`}>
            <Tags
              value={node.tags}
              onChange={(v) => un((n) => void (n.tags = v))}
              suggestions={[...new Set(rs.componentTypes.flatMap((t) => t.tags).concat(rs.reconTag ? [rs.reconTag] : []))]}
            />
          </Field>
          <Area value={node.notes ?? ''} onChange={(v) => un((n) => void (n.notes = v))} rows={2} placeholder="Заметки" />
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ вставка из шаблонов

export function InsertDialog({ ctx, targetId, attach, onClose }: { ctx: Ctx; targetId: Id; attach: boolean; onClose: () => void }) {
  const target = findUnit(ctx.root, targetId);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Id | null>(null);
  const [count, setCount] = useState(1);
  const [att, setAtt] = useState(attach);
  const [from, setFrom] = useState('');
  const items = Object.values(ctx.lib)
    .filter((u) => (!u.rulesetId || u.rulesetId === ctx.rs.id) && canInsertTemplate(ctx, u.id))
    .filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const doInsert = (id: Id | null = pick) => {
    const tpl = id ? ctx.lib[id] : undefined;
    if (!tpl || !target) return;
    const numbered = /^\d/.test(tpl.name);
    const copies = Array.from({ length: count }, (_, i) => {
      // «1-й взвод» → «1-й», «2-й»…; «Взвод» → «Взвод 1», «Взвод 2»…
      const name = count > 1 ? (numbered ? nextName(tpl.name, i) : `${tpl.name} ${i + 1}`) : undefined;
      return instantiateLibrary(tpl.id, { attachedFrom: att ? from.trim() : undefined, name })!;
    });
    ctx.upd((d) => void findUnit(d, targetId)!.children.push(...copies));
    ctx.setSel(copies[0].id);
    onClose();
  };
  return (
    <Modal
      title={`${attach ? 'Придать' : 'Вставить'} в «${target?.name ?? ''}»`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="row" style={{ gap: 6 }}>
            <span className="muted small">Количество</span>
            <Num value={count} onChange={setCount} min={1} max={50} integer width={70} />
          </span>
          <Check value={att} onChange={setAtt} title="Отметить как приданное подразделение">
            придано
          </Check>
          {att && <input value={from} placeholder="откуда (необязательно)" onChange={(e) => setFrom(e.target.value)} style={{ width: 200 }} />}
          <div className="grow" />
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" disabled={!pick} onClick={() => doInsert()}>
            {count > 1 ? `Вставить ×${count}` : 'Вставить'}
          </Btn>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 10, flexWrap: 'nowrap' }}>
        <input type="search" autoFocus placeholder="Поиск по шаблонам…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <Info text="Копия помнит свой шаблон: если позже изменить шаблон, копию можно обновить, не теряя её потерь и состояния." />
      </div>
      <div className="insert-list">
        {items.map((u) => {
          const s = summarizeUnits([u], ctx.rs);
          return (
            <div
              key={u.id}
              className={`insert-item${pick === u.id ? ' sel' : ''}`}
              onClick={() => setPick(u.id)}
              onDoubleClick={() => doInsert(u.id)}
              onFocus={() => setPick(u.id)}
              {...pressable(() => doInsert(u.id))}
            >
              <span className="grow">{u.name}</span>
              <span className="faint small nowrap">
                {fmt0(s.persCur)} чел.{u.children.length ? ` · подчинённых: ${u.children.length}` : ''}
              </span>
            </div>
          );
        })}
        {!items.length && <div className="empty">Подходящих шаблонов нет. Соберите взвод или роту и сохраните как шаблон через меню «⋯».</div>}
      </div>
    </Modal>
  );
}
