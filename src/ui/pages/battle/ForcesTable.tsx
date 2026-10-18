// Силы сторон в бою: таблица по формированиям, групповой выбор, эффекты, «ввести сейчас».

import { useMemo } from 'react';
import {
  type EngineContext,
  STATUS_LABELS,
  arrivalTurn,
  combatEffectiveness,
  orderChance,
  plural,
  resolveRefs,
  type Battle,
  type BattleResult,
  type ElementState,
  type FormationState,
  type SideId,
} from '../../../engine';
import { SupportPanel, type Target } from '../../components/BattleControls';
import { CommanderSelect } from '../../components/CommanderSelect';
import { Btn, Card, Check, Meter, Sel, fmt0, pct } from '../../components/ui';
import { useTabState } from '../../hooks';
import { type Iv, SIDES } from './common';
import { SideCompare } from './Result';

/** Приказ ГМ ещё в пути (задержка доведения приказов): куда идёт и с каким шансом дойдёт к следующему ходу. */
export function PendingOrder({ E, el }: { E: EngineContext; el: ElementState }) {
  const p = el.pendingOrder;
  if (!p || el.status !== 'active') return null;
  const name = E.orders.get(p.orderId)?.name ?? p.orderId;
  const tip =
    `Приказ «${name}» отдан на ${p.since}-м ходу и ещё не дошёл: пока элемент действует по прежнему приказу. ` +
    `Шанс, что дойдёт в начале следующего хода, — ${Math.round(orderChance(E, el) * 100)}% (связь, командир). ` +
    'Выбор текущего приказа отменяет передачу.';
  return (
    <span className="badge warn order-pending" data-tip={tip}>
      ✉ {name}
    </span>
  );
}

export function statusOf(E: EngineContext, el: ElementState): { label: string; cls: string } {
  if (el.status === 'active') {
    const bh = E.behavior(el);
    if (bh === 'retreat') return { label: 'Отходит', cls: 'status-retreat' };
    if (bh === 'rout') return { label: 'Бежит', cls: 'status-dead' };
    if (bh === 'reserve') return { label: 'В резерве', cls: 'status-out' };
    return { label: 'В бою', cls: 'status-active' };
  }
  if (el.status === 'pending') {
    const t = arrivalTurn(E.b, el);
    return { label: t && t > E.b.turn ? `Подойдёт на ${t}-м ходу` : STATUS_LABELS.pending, cls: 'status-out' };
  }
  if (el.status === 'destroyed') return { label: STATUS_LABELS.destroyed, cls: 'status-dead' };
  if (el.status === 'routed') return { label: STATUS_LABELS.routed, cls: 'status-dead' };
  return { label: STATUS_LABELS.withdrawn, cls: 'status-out' };
}

/** Итоги ветки (формирование со всеми подчинёнными): люди, средняя мораль, боеспособность. */
export interface Agg {
  pers: number;
  start: number;
  moraleW: number;
  w: number;
  ce: number;
  ceStart: number;
}

export function aggregate(b: Battle, E: EngineContext): Map<string, Agg> {
  const out = new Map<string, Agg>();
  const parent = new Map(b.formations.map((f) => [f.id, f.parentId]));
  for (const el of b.elements) {
    const pers = E.personnel(el);
    const ce = combatEffectiveness(E, el);
    for (let fid: string | null | undefined = el.formationId; fid; fid = parent.get(fid)) {
      const a = out.get(fid) ?? { pers: 0, start: 0, moraleW: 0, w: 0, ce: 0, ceStart: 0 };
      a.pers += pers;
      a.start += el.startPersonnel;
      if (el.status === 'active') {
        a.moraleW += el.morale * Math.max(1, pers);
        a.w += Math.max(1, pers);
      }
      a.ce += ce;
      a.ceStart += el.startValue;
      out.set(fid, a);
    }
  }
  return out;
}

/** У большого боя сразу свёрнуты формирования с третьего уровня — видно главное. */
export function initialFold(b: Battle): string[] {
  if (b.elements.length <= 40) return [];
  const parent = new Map(b.formations.map((f) => [f.id, f.parentId]));
  const depth = (id: string) => {
    let d = 0;
    for (let p = parent.get(id); p; p = parent.get(p)) d++;
    return d;
  };
  return b.formations.filter((f) => depth(f.id) >= 2).map((f) => f.id);
}

/** Эффекты, которые действуют на элемент сейчас или со следующего хода. */
export function effectsNext(b: Battle, E: EngineContext, el: ElementState) {
  const next = b.turn + 1;
  return (b.effects ?? []).filter(
    (x) =>
      x.side === el.side &&
      x.until >= next &&
      (!x.elementIds || x.elementIds.includes(el.id)) &&
      (!x.formationId || E.chain(el).some((f) => f.id === x.formationId)),
  );
}

export const CMD_TIP =
  'Командир сейчас. Меняйте по обстановке: удачное решение — выше, ошибка или растерянность — ниже.\nДействует со следующего хода и записывается в журнал.';

export function Forces(props: {
  b: Battle;
  E: EngineContext;
  result: BattleResult;
  tabKey: string;
  onElement: (id: string) => void;
  onFormation: (id: string) => void;
  iv: Iv;
  onEffect: (t: Target) => void;
  onStrike: (side: SideId, assetId?: string, target?: Target) => void;
  onGroupEdit: (ids: string[]) => void;
}) {
  const { b, E, result, iv } = props;
  const [details, setDetails] = useTabState(`${props.tabKey}:details`, false);
  // Групповые решения: отмеченные элементы получают приказ, эффект, удар или правку разом.
  const [picked, setPicked] = useTabState<string[]>(`${props.tabKey}:picked`, []);
  const live = new Set(b.elements.filter((x) => x.status === 'active' || x.status === 'pending').map((x) => x.id));
  const sel = picked.filter((id) => live.has(id));
  const selSet = new Set(sel);
  const onSelect = (ids: string[], on: boolean) => setPicked(on ? [...new Set([...sel, ...ids])] : sel.filter((x) => !ids.includes(x)));
  const selSides = [...new Set(sel.map((id) => E.elements.get(id)!.side))];
  const oneSide = selSides.length === 1 ? selSides[0] : null;
  const selLabel = sel.length === 1 ? resolveRefs(`[[e:${sel[0]}]]`, b) : `${sel.length} ${plural(sel.length, 'элемент', 'элемента', 'элементов')}`;
  const enemySupport = oneSide ? (b.support ?? []).some((a) => a.side !== oneSide && a.left > 0) : false;
  const [folded, setFolded] = useTabState<string[]>(`${props.tabKey}:folded`, initialFold(b));
  const fold = new Set(folded);
  // biome-ignore lint/correctness/useExhaustiveDependencies: сводка зависит от контекста, а он пересоздаётся с каждой ревизией боя
  const agg = useMemo(() => aggregate(b, E), [E]);
  const toggle = (id: string) => setFolded(fold.has(id) ? folded.filter((x) => x !== id) : [...folded, id]);
  const withChildren = b.formations.filter((f) => b.formations.some((x) => x.parentId === f.id) || b.elements.some((x) => x.formationId === f.id));
  const rowsFor = (side: SideId) => {
    const rows: { f: FormationState; depth: number }[] = [];
    const walk = (fs: FormationState, depth: number) => {
      rows.push({ f: fs, depth });
      if (fold.has(fs.id)) return;
      for (const ch of b.formations.filter((x) => x.parentId === fs.id)) walk(ch, depth + 1);
    };
    for (const fs of b.formations.filter((x) => x.side === side && !x.parentId)) walk(fs, 0);
    return rows;
  };
  return (
    <div className="stack">
      <Card tight>
        <SideCompare b={b} result={result} />
      </Card>
      <SupportPanel b={b} iv={iv} onStrike={(side, assetId) => props.onStrike(side, assetId)} onEffect={props.onEffect} />
      {sel.length > 0 && !b.finished && (
        <div className="group-bar">
          <b>Выбрано: {selLabel}</b>
          <Sel
            value=""
            width={150}
            onChange={(v) => v && iv('setOrder', { elementIds: sel.filter((id) => E.elements.get(id)?.status === 'active'), orderId: v })}
            options={[{ value: '', label: 'приказ всем…' }, ...b.ruleset.orders.map((o) => ({ value: o.id, label: o.name }))]}
          />
          <Btn sm onClick={() => props.onGroupEdit(sel)} title="Мораль, усталость, боезапас… сразу всем выбранным">
            Изменить…
          </Btn>
          {b.ruleset.features.ammo && (
            <Btn sm onClick={() => iv('resupply', { elementIds: sel, ammo: 25 })}>
              боезапас +25%
            </Btn>
          )}
          <Btn
            sm
            disabled={!oneSide}
            onClick={() => oneSide && props.onEffect({ side: oneSide, elementIds: sel, label: selLabel })}
            title={oneSide ? 'Временный эффект на выбранных' : 'Эффект — для элементов одной стороны'}
          >
            Эффект…
          </Btn>
          {enemySupport && oneSide && (
            <Btn
              sm
              onClick={() => props.onStrike(oneSide === 'A' ? 'B' : 'A', undefined, { side: oneSide, elementIds: sel, label: selLabel })}
              title="Удар огневой поддержки противника по выбранным"
            >
              Удар по выбранным…
            </Btn>
          )}
          <span className="grow" />
          <button type="button" className="link-btn small" onClick={() => setPicked([])}>
            снять выбор
          </button>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: -8, gap: 14 }}>
        {withChildren.length > 2 && (
          <span className="small">
            <a href="#" onClick={(e) => (e.preventDefault(), setFolded([]))}>
              развернуть всё
            </a>
            {' · '}
            <a href="#" onClick={(e) => (e.preventDefault(), setFolded(b.formations.filter((f) => f.parentId).map((f) => f.id)))}>
              свернуть до верхних
            </a>
          </span>
        )}
        <Check value={details} onChange={setDetails} title="Подавление, усталость, боезапас, техника, обнаружение">
          <span className="muted small">подробные столбцы</span>
        </Check>
      </div>
      {SIDES.map((side) => (
        <Card key={side} title={<span style={{ color: b.sides[side].color }}>{b.sides[side].name}</span>} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl compact forces">
              <thead>
                <tr>
                  <th>Элемент</th>
                  <th>Приказ</th>
                  <th className="num">Люди</th>
                  {b.ruleset.features.morale && <th>Мораль</th>}
                  <th className="num" data-tip="Остаточная боеспособность">
                    Боесп.
                  </th>
                  {details && <DetailHeaders b={b} />}
                </tr>
              </thead>
              <tbody>
                {rowsFor(side).map(({ f: fs, depth }) => (
                  <FormationRows
                    key={fs.id}
                    {...props}
                    fs={fs}
                    depth={depth}
                    details={details}
                    folded={fold.has(fs.id)}
                    onToggle={() => toggle(fs.id)}
                    agg={agg.get(fs.id)}
                    selected={selSet}
                    onSelect={onSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function DetailHeaders({ b }: { b: Battle }) {
  const f = b.ruleset.features;
  return (
    <>
      <th className="num">Техн.</th>
      {f.suppression && <th className="num">Подавл.</th>}
      {f.fatigue && <th className="num">Устал.</th>}
      {f.ammo && <th className="num">БК</th>}
      {f.detection && <th data-tip="Обнаружен противником в этом ходу">Виден</th>}
    </>
  );
}

export function FormationRows(props: {
  b: Battle;
  E: EngineContext;
  fs: FormationState;
  depth: number;
  details: boolean;
  folded: boolean;
  onToggle: () => void;
  agg?: Agg;
  onElement: (id: string) => void;
  onFormation: (id: string) => void;
  iv: Iv;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}) {
  const { b, E, fs, depth, details, iv, agg, selected, onSelect } = props;
  const f = b.ruleset.features;
  const els = props.folded ? [] : b.elements.filter((x) => x.formationId === fs.id);
  // Отметка формирования — все его элементы (с подчинёнными), которые ещё в бою или подойдут.
  const subtree = useMemo(() => {
    const ids = new Set([fs.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of b.formations) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) ids.add(x.id), (grew = true);
    }
    return b.elements.filter((x) => ids.has(x.formationId) && (x.status === 'active' || x.status === 'pending')).map((x) => x.id);
  }, [b, fs.id]);
  const allOn = subtree.length > 0 && subtree.every((id) => selected.has(id));
  // Участок — только если силы стороны стоят на разных участках (иначе метка ничего не говорит).
  const spread = !!b.sectors && new Set(b.elements.filter((x) => x.side === fs.side).map((x) => x.sector)).size > 1;
  const sectorName = (el: ElementState) => (spread ? b.sectors!.find((x) => x.id === el.sector)?.name : undefined);
  const detailCols = details ? 1 + [f.suppression, f.fatigue, f.ammo, f.detection].filter(Boolean).length : 0;
  const orderOptions = b.ruleset.orders.map((o) => ({ value: o.id, label: o.name }));
  const morale = agg && agg.w > 0 ? agg.moraleW / agg.w : 0;
  return (
    <>
      <tr className={`group${props.folded ? ' folded' : ''}`}>
        <td colSpan={2} style={{ paddingLeft: 4 + depth * 14 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {!b.finished && subtree.length > 0 && (
              <input
                type="checkbox"
                className="pick-check"
                checked={allOn}
                onChange={(e) => onSelect(subtree, e.target.checked)}
                title="Отметить всё формирование — для группового решения"
              />
            )}
            <button type="button" className="fold-btn" onClick={props.onToggle} title={props.folded ? 'Развернуть' : 'Свернуть'}>
              {props.folded ? '▸' : '▾'}
            </button>
            <a
              href="#"
              className="nowrap"
              onClick={(e) => (e.preventDefault(), props.onFormation(fs.id))}
              data-tip={`${f.comms ? `связь ${Math.round(fs.comms)}%\n` : ''}снабжение ${Math.round(fs.supply)}%\nЩелчок — приказ всем, связь, снабжение`}
            >
              {fs.name}
            </a>
            {f.command && (
              <CommanderSelect
                levels={b.ruleset.commandLevels}
                allowNone
                tip={CMD_TIP}
                value={fs.commandLevel}
                disabled={b.finished}
                onChange={(v) => iv('setFormation', { formationId: fs.id, commandLevel: v })}
              />
            )}
            {fs.hqLost && <span className="badge bad">штаб потерян</span>}
            {fs.broken && <span className="badge bad">сломлено</span>}
          </div>
        </td>
        <td className="num nowrap">
          {agg ? (
            <>
              {fmt0(agg.pers)}
              <span className="faint">/{fmt0(agg.start)}</span>
            </>
          ) : null}
        </td>
        {f.morale && <td style={{ minWidth: 90 }}>{agg && agg.w > 0 ? <Meter value={morale} /> : null}</td>}
        <td className="num">{agg && agg.ceStart > 0 ? pct((agg.ce / agg.ceStart) * 100) : ''}</td>
        {detailCols > 0 && <td colSpan={detailCols} />}
      </tr>
      {els.map((el) => {
        const st = statusOf(E, el);
        const ce = el.startValue > 0 ? (combatEffectiveness(E, el) / el.startValue) * 100 : 0;
        const active = el.status === 'active' && !b.finished;
        const veh = el.comps.filter((c) => E.type(c.typeId).kind !== 'personnel');
        const vehNow = veh.reduce((a, c) => a + c.current, 0);
        const vehStart = veh.reduce((a, c) => a + c.start, 0);
        return (
          <tr key={el.id} className={el.status !== 'active' ? 'dim' : ''}>
            <td style={{ paddingLeft: 24 + depth * 14 }}>
              {!b.finished && (el.status === 'active' || el.status === 'pending') && (
                <input
                  type="checkbox"
                  className="pick-check"
                  checked={selected.has(el.id)}
                  onChange={(e) => onSelect([el.id], e.target.checked)}
                  title="Отметить — для группового решения"
                />
              )}
              <span className={`status-dot ${st.cls}`} data-tip={st.label} />
              <a href="#" onClick={(e) => (e.preventDefault(), props.onElement(el.id))}>
                {el.name}
              </a>
              {el.isHQ && <span className="faint small"> · штаб</span>}
              {sectorName(el) && <span className="badge sector-badge">{sectorName(el)}</span>}
              {effectsNext(b, E, el).length > 0 && (
                <span
                  className="badge info fx-badge"
                  data-tip={effectsNext(b, E, el)
                    .map((x) => `«${x.name}» до ${x.until}-го хода`)
                    .join('\n')}
                >
                  ◌ {effectsNext(b, E, el).length === 1 ? effectsNext(b, E, el)[0].name : `эффектов: ${effectsNext(b, E, el).length}`}
                </span>
              )}
            </td>
            <td>
              {active && E.behavior(el) !== 'rout' ? (
                <>
                  <Sel value={el.orderId} width={124} onChange={(v) => iv('setOrder', { elementIds: [el.id], orderId: v })} options={orderOptions} />
                  <PendingOrder E={E} el={el} />
                </>
              ) : (
                <span className={`small ${st.cls}`}>{st.label}</span>
              )}
              {el.status === 'pending' && !b.finished && (
                <button
                  type="button"
                  className="link-btn small"
                  onClick={() => iv('arrive', { elementIds: [el.id] })}
                  title="Подкрепление подходит раньше плана (вмешательство ГМ)"
                >
                  {' '}
                  ввести сейчас
                </button>
              )}
            </td>
            <td className="num">
              {fmt0(E.personnel(el))}
              <span className="faint">/{fmt0(el.startPersonnel)}</span>
            </td>
            {f.morale && (
              <td style={{ minWidth: 90 }}>
                <Meter value={el.morale} />
              </td>
            )}
            <td className="num">{pct(ce)}</td>
            {details && (
              <>
                <td className="num">{vehStart ? `${vehNow}/${vehStart}` : <span className="faint">—</span>}</td>
                {f.suppression && <td className={`num ${el.suppression > 50 ? 'bad' : ''}`}>{Math.round(el.suppression)}</td>}
                {f.fatigue && <td className="num">{Math.round(el.fatigue)}</td>}
                {f.ammo && <td className={`num ${el.ammo < b.ruleset.coefficients.lowAmmoThreshold ? 'bad' : ''}`}>{Math.round(el.ammo)}</td>}
                {f.detection && <td className="center">{el.status === 'active' ? el.spotted ? 'да' : <span className="faint">—</span> : ''}</td>}
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ карточка элемента
