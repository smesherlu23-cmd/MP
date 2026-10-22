// Огонь: распределение по целям, потери, подавление; удары огневой поддержки вне поля боя.

import { type EngineContext, clamp, e, fm, lerp, round1, s } from '../context';
import { dec, plural } from '../labels';
import type { ElementState, Factor, Id, SideId, StrikeOrder } from '../types';
import { subtreeIds } from './common';
import { frontage, frontageKey } from './frontage';
import type { Initiative } from './initiative';

// ------------------------------------------------------------------ огонь

export interface Shot {
  /** Стрелок на поле боя; у ударов огневой поддержки его нет — есть название средства. */
  shooter?: ElementState;
  source?: string;
  target: ElementState;
  cls: Id;
  fire: number;
  lethality: number;
  suppressive: number;
}

export function phaseFire(E: EngineContext, ini: Initiative) {
  const second = E.enemyOf(ini.first);
  if (ini.sequential) {
    applyShots(E, computeFire(E, ini.first, 1));
    applyShots(E, computeFire(E, second, 1));
  } else {
    const a = computeFire(E, ini.first, ini.bonusSide === ini.first ? E.k.initiativeBonus : 1);
    const b2 = computeFire(E, second, 1);
    applyShots(E, a);
    applyShots(E, b2);
  }
}

/** Множитель огня стрелка (состояние элемента + модификаторы). */
export function shooterMult(E: EngineContext, el: ElementState, out?: Factor[]): number {
  const { k, f } = E;
  let m = E.mult(el, 'fire', {}, out);
  const add = (label: string, v: number) => {
    if (Math.abs(v - 1) < 1e-9) return;
    m *= v;
    out?.push({ label, value: v, kind: 'mult' });
  };
  add(`Атака элемента ${el.attackMod}%`, el.attackMod / 100);
  if (f.cohesion) add(`Слаженность ${Math.round(el.cohesion)}%`, lerp(k.cohesionFireMin, 1, el.cohesion / 100));
  if (f.readiness) add(`Готовность ${Math.round(el.readiness)}%`, lerp(k.readinessFireMin, 1, el.readiness / 100));
  if (f.morale) add(`Мораль ${Math.round(el.morale)}`, lerp(k.moraleFireMin, 1, el.morale / 100));
  if (f.equipment) add(`Снаряжение ${Math.round(el.equipment)}%`, lerp(k.equipmentFireMin, 1, el.equipment / 100));
  if (f.fatigue) add(`Усталость ${Math.round(el.fatigue)}%`, 1 - (el.fatigue / 100) * k.fatigueFirePenalty);
  if (f.suppression) add(`Подавление ${Math.round(el.suppression)}%`, 1 - (el.suppression / 100) * k.suppressionFirePenalty);
  if (f.ammo) add(`Боезапас ${Math.round(el.ammo)}%`, el.ammo >= k.lowAmmoThreshold ? 1 : lerp(k.noAmmoFire, 1, el.ammo / Math.max(1, k.lowAmmoThreshold)));
  if (f.comms) add(`Связь ${Math.round(E.comms(el) * 100)}%`, lerp(k.commsFireMin, 1, E.comms(el)));
  const luck = E.b.sides[el.side].luck;
  if (luck) add('Удача и исполнение стороны в этом бою', luck);
  return Math.max(0, m);
}

export function exposureOf(E: EngineContext, t: ElementState, indirect: boolean): number {
  const k = E.k;
  let ex: number;
  if (indirect) ex = t.echelon === 'front' ? 1 : t.echelon === 'support' ? k.indirectExposureSupport : k.indirectExposureRear;
  else ex = t.echelon === 'front' ? k.exposureFront : t.echelon === 'support' ? k.exposureSupport : k.exposureRear;
  return ex * E.order(t).exposure;
}

function computeFire(E: EngineContext, side: SideId, bonus: number): Shot[] {
  const { k, b } = E;
  if (!E.band?.id) return [];
  const shots: Shot[] = [];
  // Участки: прямой огонь — только по своему участку, навесной — и по соседним (с весом sectorIndirectShare).
  const sectored = !!b.sectors;
  const bandIdOf = (el: ElementState) => E.bandOf(el).id;
  const targets = E.sideElements(E.enemyOf(side)).filter((t) => t.status === 'active' && E.order(t).exposure > 0 && E.size(t) > 0);
  if (!targets.length) return shots;
  const shooters = E.sideElements(side).filter((x) => E.engaged(x));
  // Ширина фронта: прямой огонь сил сверх охвата или фронта — с меньшим весом.
  const front = frontage(E, side);
  // Присутствие классов целей в каждом элементе противника (вес при выборе цели)
  const presenceOf = new Map<Id, Map<Id, number>>();
  for (const t of targets) {
    const presence = new Map<Id, number>();
    for (const c of t.comps) {
      if (c.current <= 0) continue;
      const tt = E.type(c.typeId);
      presence.set(tt.targetClass, (presence.get(tt.targetClass) ?? 0) + c.current * Math.max(0.1, tt.value));
    }
    presenceOf.set(t.id, presence);
  }
  // Наибольшая огневая мощь типа на дистанции (для расхода боезапаса) — по дистанциям участков.
  const maxFpCache = new Map<Id, Map<Id, number>>();
  const maxFpOf = (band: Id) => {
    let m = maxFpCache.get(band);
    if (!m) {
      m = new Map();
      for (const t of E.rs.componentTypes) {
        let v = 0;
        for (const cls of E.rs.targetClasses) v = Math.max(v, t.firepower[cls.id]?.[band] ?? 0);
        m.set(t.id, v);
      }
      maxFpCache.set(band, m);
    }
    return m;
  };

  for (const sh of shooters) {
    const factors: Factor[] | undefined = E.logging ? [] : undefined;
    let sm = shooterMult(E, sh, factors) * bonus;
    if (bonus !== 1) factors?.push({ label: 'Инициатива', value: bonus, kind: 'mult' });
    if (sm <= 0) continue;
    let ambush = false;
    if (E.behavior(sh) === 'ambush' && !sh.ambushUsed && !sh.spotted) {
      sm *= k.ambushFirstVolley;
      ambush = true;
      factors?.push({ label: 'Первый залп из засады', value: k.ambushFirstVolley, kind: 'mult' });
    }
    const rnd = Math.max(0, 1 + k.randomSpread * (E.rng.next() + E.rng.next() - 1));
    factors?.push({ label: 'Случайность', value: rnd, kind: 'mult' });
    sm *= rnd;

    const allocation = new Map<Id, number>();
    let firedAny = false;
    let ammoNum = 0;
    let ammoDen = 0;
    const ownBand = bandIdOf(sh);
    const fr = front.get(frontageKey(sh));
    const frontMult = fr?.factor ?? 1;
    if (frontMult < 1 && sh.comps.some((c) => c.current > 0 && !E.type(c.typeId).indirect))
      factors?.push({
        label: `Ширина фронта: в первой линии ~${Math.round(fr!.engaged)}% сил стороны (${fr!.by === 'width' ? 'ширина фронта' : 'охват'}), прямой огонь`,
        value: frontMult,
        kind: 'mult',
      });
    for (const indirect of [false, true]) {
      const comps = sh.comps.filter((c) => c.current > 0 && E.type(c.typeId).indirect === indirect);
      if (!comps.length) continue;
      // Огневая мощь пула по классам целей — на дистанции участка цели (без участков она одна).
      const pools = new Map<Id, { raw: Map<Id, number>; supp: Map<Id, number> }>();
      const poolAt = (band: Id) => {
        let pl = pools.get(band);
        if (pl) return pl;
        pl = { raw: new Map(), supp: new Map() };
        for (const c of comps) {
          const t = E.type(c.typeId);
          let cf = 1;
          if (t.kind === 'vehicle' && E.f.vehicleCondition) cf *= lerp(k.vehicleConditionFireMin, 1, sh.vehicleCondition / 100);
          if (!indirect) cf *= sh.echelon === 'support' ? k.fireSupport : sh.echelon === 'rear' ? k.fireRear : 1;
          for (const cls of E.rs.targetClasses) {
            const v = (t.firepower[cls.id]?.[band] ?? 0) * c.current * cf;
            if (v > 0) {
              pl.raw.set(cls.id, (pl.raw.get(cls.id) ?? 0) + v);
              pl.supp.set(cls.id, (pl.supp.get(cls.id) ?? 0) + v * t.suppressive);
            }
          }
        }
        pools.set(band, pl);
        return pl;
      };
      const ownPool = poolAt(ownBand);
      const mf = maxFpOf(ownBand);
      for (const c of comps) {
        const t = E.type(c.typeId);
        const maxFp = mf.get(t.id) ?? 0;
        ammoNum += c.current * maxFp * t.ammoUse;
        ammoDen += c.current * maxFp;
      }
      if (!ownPool.raw.size && !(sectored && indirect && k.sectorIndirectShare > 0)) continue;
      // Распределение огня по целям
      const cands: { t: ElementState; cls: Id; w: number; vis: number; pursuit: number; raw: Map<Id, number>; supp: Map<Id, number> }[] = [];
      for (const t of targets) {
        let pool = ownPool;
        let across = 1;
        if (sectored && t.sector !== sh.sector) {
          if (!indirect || k.sectorIndirectShare <= 0) continue;
          across = k.sectorIndirectShare;
          pool = poolAt(bandIdOf(t));
        }
        const ex = exposureOf(E, t, indirect) * across;
        if (ex <= 0) continue;
        const vis = !E.f.detection || t.spotted ? 1 : indirect ? k.indirectUnspottedMult : k.unspottedFireMult;
        const bh = E.behavior(t);
        const pursuit = bh === 'retreat' ? k.pursuitMult : bh === 'rout' ? k.routPursuitMult : 1;
        for (const [cls, pres] of presenceOf.get(t.id)!) {
          const r = pool.raw.get(cls);
          if (!r) continue;
          cands.push({ t, cls, w: r * Math.sqrt(pres) * ex * vis * pursuit, vis, pursuit, raw: pool.raw, supp: pool.supp });
        }
      }
      const W = cands.reduce((a, c) => a + c.w, 0);
      if (W <= 0) continue;
      firedAny = true;
      for (const c of cands) {
        const share = c.w / W;
        const r = c.raw.get(c.cls)!;
        const ctxFire = E.contextual(sh, 'fire', { enemy: c.t, targetClass: c.cls });
        const fire = r * share * c.vis * c.pursuit * sm * ctxFire * (indirect ? 1 : frontMult);
        if (fire <= 0) continue;
        const cls = E.classes.get(c.cls);
        const leth = (cls?.lethality ?? 1) * E.mult(sh, 'lethality', { enemy: c.t, targetClass: c.cls }) * k.casualtyScale;
        shots.push({ shooter: sh, target: c.t, cls: c.cls, fire, lethality: leth, suppressive: (c.supp.get(c.cls) ?? r) / r });
        allocation.set(c.t.id, (allocation.get(c.t.id) ?? 0) + fire);
      }
    }
    if (!firedAny) continue;
    sh.firedThisTurn = true;
    if (ambush) sh.ambushUsed = true;
    if (E.f.ammo && ammoDen > 0) {
      const use = (ammoNum / ammoDen) * E.mult(sh, 'ammoUse') * (E.f.suppression ? 1 - (sh.suppression / 100) * 0.5 : 1);
      sh.ammo = Math.max(0, sh.ammo - use);
    }
    if (E.logging) {
      const total = [...allocation.values()].reduce((a, x) => a + x, 0);
      const list = [...allocation.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([id, v]) => `${e(id)} ${Math.round((v / total) * 100)}%`)
        .join(', ');
      E.log({
        phase: 'fire',
        level: 2,
        side,
        refs: [sh.id, ...allocation.keys()],
        text: `${e(sh)} ведёт ${ambush ? 'огонь из засады' : 'огонь'} по: ${list}. Эффективность ×${dec(sm / bonus / rnd, 2)}.`,
        factors,
      });
    }
  }
  return shots;
}

function protectionMult(E: EngineContext, t: ElementState, cls: Id, shooter: ElementState | undefined, out?: Factor[]): number {
  let m = E.mult(t, 'protection', { enemy: shooter, targetClass: cls }, out);
  const add = (label: string, v: number) => {
    if (Math.abs(v - 1) < 1e-9) return;
    m *= v;
    out?.push({ label, value: v, kind: 'mult' });
  };
  add(`Защита элемента ${t.defenseMod}%`, t.defenseMod / 100);
  if (t.digInTurns > 0) add(`Закрепление (${t.digInTurns} ход.)`, 1 + Math.min(E.k.digInMax, t.digInTurns * E.k.digInPerTurn));
  return Math.max(0.05, m);
}

export function applyShots(E: EngineContext, shots: Shot[]) {
  const { k, rng } = E;
  const byTarget = new Map<Id, Shot[]>();
  for (const sh of shots) {
    const list = byTarget.get(sh.target.id) ?? [];
    list.push(sh);
    byTarget.set(sh.target.id, list);
  }
  for (const [, list] of byTarget) {
    const t = list[0].target;
    const routing = E.behavior(t) === 'rout';
    const perClass = new Map<Id, { hits: number; supp: number }>();
    const shooters = new Set<Id>();
    const sources = new Set<string>();
    for (const sh of list) {
      const eff = sh.fire / protectionMult(E, t, sh.cls, sh.shooter);
      const pc = perClass.get(sh.cls) ?? { hits: 0, supp: 0 };
      pc.hits += eff * sh.lethality;
      pc.supp += eff * sh.suppressive;
      perClass.set(sh.cls, pc);
      if (sh.shooter) shooters.add(sh.shooter.id);
      else if (sh.source) sources.add(sh.source);
    }
    t.underFireThisTurn = true;
    const sizeBefore = E.size(t);
    const loss = { pers: 0, kia: 0, wia: 0, mia: 0, value: 0, equip: new Map<Id, { destroyed: number; damaged: number; abandoned: number }>() };
    let suppIn = 0;
    for (const [cls, pc] of perClass) {
      suppIn += pc.supp;
      const comps = t.comps.filter((c) => c.current > 0 && E.type(c.typeId).targetClass === cls);
      const N = comps.reduce((a, c) => a + c.current, 0);
      if (N <= 0 || pc.hits <= 0) continue;
      for (const c of comps) {
        const tt = E.type(c.typeId);
        const p = 1 - Math.exp(-pc.hits / (N * Math.max(0.05, tt.protection)));
        const n = rng.binomial(c.current, p);
        if (n <= 0) continue;
        c.current -= n;
        loss.value += n * tt.value;
        if (tt.kind === 'personnel') {
          const [kk, ww, mm] = splitCasualties(E, n, routing);
          c.kia += kk;
          c.wia += ww;
          c.mia += mm;
          loss.pers += n;
          loss.kia += kk;
          loss.wia += ww;
          loss.mia += mm;
        } else {
          const destroyed = rng.binomial(n, k.vehicleDestroyedShare);
          let damaged = n - destroyed;
          let abandoned = 0;
          if (routing) {
            abandoned = damaged;
            damaged = 0;
          }
          c.destroyed += destroyed;
          c.damaged += damaged;
          c.abandoned += abandoned;
          const crewHit = rng.binomial(destroyed * tt.crew, k.crewLossDestroyed) + rng.binomial((damaged + abandoned) * tt.crew, k.crewLossDamaged);
          const [kk, ww, mm] = splitCasualties(E, crewHit, routing);
          c.kia += kk;
          c.wia += ww;
          c.mia += mm;
          loss.pers += crewHit;
          loss.kia += kk;
          loss.wia += ww;
          loss.mia += mm;
          const q = loss.equip.get(c.typeId) ?? { destroyed: 0, damaged: 0, abandoned: 0 };
          q.destroyed += destroyed;
          q.damaged += damaged;
          q.abandoned += abandoned;
          loss.equip.set(c.typeId, q);
        }
      }
    }
    t.turnValueLost += loss.value;
    t.turnPersonnelLost += loss.pers;
    if (loss.value > 0) E.invalidate(t);
    let suppGain = 0;
    const before = t.suppression;
    if (E.f.suppression) {
      const size = Math.max(1, sizeBefore);
      suppGain = Math.min(k.suppressionMaxPerTurn, (suppIn / size) * k.suppressionScale * E.mult(t, 'suppression'));
      t.suppression = clamp(t.suppression + suppGain, 0, 100);
    }
    if (E.logging) {
      const parts: string[] = [];
      if (loss.pers > 0) {
        const kinds = [loss.kia && `убито ${loss.kia}`, loss.wia && `ранено ${loss.wia}`, loss.mia && `пропало ${loss.mia}`].filter(Boolean).join(', ');
        parts.push(`${loss.pers} чел. (${kinds})`);
      }
      for (const [typeId, q] of loss.equip) {
        const sub: string[] = [];
        if (q.destroyed) sub.push(`уничтожено ${q.destroyed}`);
        if (q.damaged) sub.push(`повреждено ${q.damaged}`);
        if (q.abandoned) sub.push(`брошено ${q.abandoned}`);
        parts.push(`${E.type(typeId).name}: ${sub.join(', ')}`);
      }
      const factors: Factor[] = [];
      const mainCls = [...perClass.entries()].sort((a, b2) => b2[1].hits - a[1].hits)[0]?.[0];
      if (mainCls) {
        factors.push({
          label: `Воздействие по классу «${E.classes.get(mainCls)?.name ?? mainCls}»`,
          value: round1(perClass.get(mainCls)!.hits * 100) / 100,
          kind: 'base',
        });
        const pf: Factor[] = [];
        protectionMult(E, t, mainCls, undefined, pf);
        for (const x of pf) factors.push({ ...x, label: `Защищённость — ${x.label}` });
      }
      if (E.f.suppression && suppGain > 0)
        factors.push({ label: `Подавление ${Math.round(before)} → ${Math.round(t.suppression)}%`, value: round1(suppGain), kind: 'add' });
      const who = [...[...shooters].map((id) => E.elements.get(id)?.name ?? id), ...[...sources].map((x) => `«${x}» (огневая поддержка)`)].join(', ');
      factors.unshift({ label: `Огонь вели: ${who}`, value: shooters.size + sources.size, kind: 'base' });
      E.log({
        phase: 'losses',
        level: parts.length ? 1 : 2,
        side: t.side,
        severity: parts.length ? 'bad' : 'info',
        refs: [t.id, ...shooters],
        text: parts.length
          ? `${e(t)}: потери — ${parts.join('; ')}.`
          : `${e(t)} под огнём, потерь нет${E.f.suppression ? ` (подавление ${Math.round(t.suppression)}%)` : ''}.`,
        factors,
        data: parts.length
          ? {
              pers: loss.pers,
              kia: loss.kia,
              wia: loss.wia,
              mia: loss.mia,
              equip: Object.fromEntries([...loss.equip].map(([id, q]) => [id, q.destroyed + q.damaged + q.abandoned])),
            }
          : undefined,
      });
    }
  }
}

function splitCasualties(E: EngineContext, n: number, routing: boolean): [number, number, number] {
  if (n <= 0) return [0, 0, 0];
  const k = E.k;
  let ks = Math.max(0, k.killedShare);
  let ws = Math.max(0, k.woundedShare);
  let ms = Math.max(0, k.missingShare);
  if (routing) {
    const rest = Math.max(0, 1 - k.routMissingShare);
    const kw = ks + ws || 1;
    ks = (ks / kw) * rest;
    ws = (ws / kw) * rest;
    ms = k.routMissingShare;
  }
  const sum = ks + ws + ms || 1;
  ks /= sum;
  ws /= sum;
  ms /= sum;
  const kia = E.rng.binomial(n, ks);
  const wia = E.rng.binomial(n - kia, ws + ms > 0 ? ws / (ws + ms) : 0);
  return [kia, wia, n - kia - wia];
}

// ------------------------------------------------------------------ огневая поддержка

/** Удары огневой поддержки, назначенные на этот ход: средство вне поля боя бьёт по цели. */
export function phaseStrikes(E: EngineContext) {
  const { b } = E;
  for (const st of b.strikes ?? []) {
    if (st.done || st.turn !== b.turn) continue;
    st.done = true;
    resolveStrike(E, st);
  }
}

function resolveStrike(E: EngineContext, st: StrikeOrder) {
  const { b, k } = E;
  const asset = b.support?.find((a) => a.side === st.side && a.id === st.assetId);
  const t = asset && E.types.get(asset.typeId);
  if (!asset || !t) return;
  const enemy = E.enemyOf(st.side);
  let pool = E.sideElements(enemy);
  let target = `всей стороне ${s(enemy)}`;
  if (st.formationId) {
    const ids = subtreeIds(E, st.formationId);
    pool = pool.filter((x) => ids.has(x.formationId));
    target = fm(st.formationId);
  } else if (st.elementIds) {
    const ids = new Set(st.elementIds);
    pool = pool.filter((x) => ids.has(x.id));
    target = pool.length === 1 ? e(pool[0]) : `${pool.length} ${plural(pool.length, 'элемент', 'элемента', 'элементов')}`;
  }
  const targets = pool.filter((x) => x.status === 'active' && E.size(x) > 0 && exposureOf(E, x, t.indirect) > 0);
  if (!targets.length) {
    asset.left++;
    E.log({ phase: 'fire', level: 1, side: st.side, text: `«${asset.name}»: цель ${target} вне досягаемости — удар не нанесён, вызов не израсходован.` });
    return;
  }
  // Огневая мощь единицы — лучшая по дистанциям (средство бьёт издалека).
  const raw = new Map<Id, number>();
  for (const cls of E.rs.targetClasses) {
    let m = 0;
    for (const band of E.rs.rangeBands) m = Math.max(m, t.firepower[cls.id]?.[band.id] ?? 0);
    if (m > 0) raw.set(cls.id, m * asset.count * k.strikeScale);
  }
  const rnd = Math.max(0, 1 + k.strikeSpread * (E.rng.next() + E.rng.next() - 1)) * (b.sides[st.side].luck ?? 1);
  const cands: { t: ElementState; cls: Id; w: number; vis: number }[] = [];
  for (const x of targets) {
    const ex = exposureOf(E, x, t.indirect);
    const vis = !E.f.detection || x.spotted ? 1 : k.strikeUnspotted;
    const pres = new Map<Id, number>();
    for (const c of x.comps)
      if (c.current > 0) {
        const tt = E.type(c.typeId);
        pres.set(tt.targetClass, (pres.get(tt.targetClass) ?? 0) + c.current * Math.max(0.1, tt.value));
      }
    for (const [cls, p] of pres) {
      const r = raw.get(cls);
      if (r) cands.push({ t: x, cls, w: r * Math.sqrt(p) * ex * vis, vis });
    }
  }
  const W = cands.reduce((a, c) => a + c.w, 0);
  const shots: Shot[] = [];
  if (W > 0)
    for (const c of cands) {
      const fire = raw.get(c.cls)! * (c.w / W) * c.vis * rnd;
      if (fire <= 0) continue;
      const cls = E.classes.get(c.cls);
      shots.push({ source: asset.name, target: c.t, cls: c.cls, fire, lethality: (cls?.lethality ?? 1) * k.casualtyScale, suppressive: t.suppressive });
    }
  const unseen = targets.filter((x) => E.f.detection && !x.spotted).length;
  E.log({
    phase: 'fire',
    level: 0,
    side: st.side,
    severity: 'info',
    refs: targets.map((x) => x.id),
    text: `${s(st.side)}: удар «${asset.name}» (${asset.count} × ${t.name}) по ${target}${unseen === targets.length ? ' — цель не обнаружена, огонь по площади' : ''}.`,
    factors: [
      { label: `${asset.count} × ${t.name}`, value: asset.count, kind: 'base' },
      { label: 'Сила ударов (коэффициент)', value: k.strikeScale, kind: 'mult' },
      { label: 'Случайность', value: rnd, kind: 'mult' },
      ...(unseen ? [{ label: `Необнаруженные цели (${unseen})`, value: k.strikeUnspotted, kind: 'mult' as const }] : []),
    ],
  });
  applyShots(E, shots);
}
