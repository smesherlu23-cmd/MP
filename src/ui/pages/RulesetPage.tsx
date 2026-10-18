// Редактор набора правил: всё, что влияет на расчёт, редактируется здесь без изменения кода.

import { useState } from 'react';
import type { Ruleset } from '../../engine';
import { TransferModal } from '../components/RulesetTransfer';
import { Menu } from '../components/ui';
import { Crumbs } from '../components/Crumbs';
import { createRuleset, deleteRuleset, exportJson, setTabSub, updateRuleset, useApp, type Tab } from '../store';
import type { Upd } from './ruleset/common';
import { CoefficientsSection, FeaturesSection, General, JsonSection, OutcomesSection, TempEffectsSection } from './ruleset/General';
import { BandsSection, ClassesSection, TypesSection } from './ruleset/Types';
import { ConditionsSection, LevelsSection, OptionsSection, OrdersSection } from './ruleset/Orders';
import { ModifiersSection } from './ruleset/Modifiers';

export const SECTIONS: { id: string; label: string; count?: (r: Ruleset) => number }[] = [
  { id: 'general', label: 'Общее' },
  { id: 'types', label: 'Каталог типов', count: (r) => r.componentTypes.length },
  { id: 'classes', label: 'Классы и дистанции' },
  { id: 'orders', label: 'Приказы', count: (r) => r.orders.length },
  { id: 'levels', label: 'Опыт и командиры' },
  { id: 'conditions', label: 'Условия боя' },
  { id: 'modifiers', label: 'Свои правила', count: (r) => r.modifiers.length },
  { id: 'effects', label: 'Временные эффекты', count: (r) => r.tempEffects?.length ?? 0 },
  { id: 'coefficients', label: 'Коэффициенты' },
  { id: 'outcomes', label: 'Исходы' },
];

/** Старые адреса разделов — на них ссылаются справка и другие страницы. */
const ALIASES: Record<string, string> = {
  features: 'general',
  bands: 'classes',
  experience: 'levels',
  command: 'levels',
  fortifications: 'conditions',
  intel: 'conditions',
};

export function RulesetPage({ tab }: { tab: Tab }) {
  const r = useApp((s) => s.rulesets[tab.ref!]);
  const [transfer, setTransfer] = useState(false);
  if (!r) return <div className="empty">Набор правил не найден.</div>;
  const sub = ALIASES[tab.sub ?? ''] ?? tab.sub ?? 'general';
  const upd: Upd = (fn) => updateRuleset(r.id, fn);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Наборы правил', section: 'rulesets' }]} />
      <div className="page-head">
        <input className="title-input" value={r.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} />
        <Menu
          items={[
            { label: 'Дублировать', onClick: () => createRuleset(r.id), tip: 'Копия для экспериментов с балансом' },
            {
              label: 'Перенести из другого набора…',
              onClick: () => setTransfer(true),
              tip: 'Скопировать типы, приказы, условия, правила или эффекты из другого набора правил',
            },
            { label: 'Сохранить в файл…', onClick: () => exportJson('ruleset', r.name, r) },
            { label: 'Редактировать как JSON', onClick: () => setTabSub(tab.key, 'json') },
            'sep',
            { label: 'Удалить набор правил', danger: true, onClick: () => deleteRuleset(r.id) },
          ]}
        />
      </div>
      <div className="split" style={{ gridTemplateColumns: '190px minmax(0, 1fr)' }}>
        <nav className="vnav">
          {SECTIONS.map((x) => (
            <button type="button" key={x.id} className={sub === x.id ? 'on' : ''} onClick={() => setTabSub(tab.key, x.id)}>
              <span>{x.label}</span>
              {x.count && <span className="faint">{x.count(r)}</span>}
            </button>
          ))}
        </nav>
        <div className="stack">
          {sub === 'general' && (
            <>
              <General r={r} upd={upd} />
              <FeaturesSection r={r} upd={upd} />
            </>
          )}
          {sub === 'types' && <TypesSection r={r} upd={upd} tabKey={tab.key} />}
          {sub === 'classes' && (
            <>
              <ClassesSection r={r} upd={upd} />
              <BandsSection r={r} upd={upd} />
            </>
          )}
          {sub === 'orders' && <OrdersSection r={r} upd={upd} />}
          {sub === 'levels' && (
            <>
              <LevelsSection
                title="Уровни опыта"
                hint="Опыт элемента — номер уровня (1 — первый в списке). Эффекты уровня действуют на все характеристики элемента."
                levels={r.experienceLevels}
                set={(fn) => upd((d) => fn(d.experienceLevels))}
              />
              <LevelsSection
                title="Уровни командиров"
                hint="Командир влияет на все элементы своего формирования; влияние вышестоящих командиров ослабевает с каждым уровнем (коэффициент «Влияние вышестоящего командира»)."
                levels={r.commandLevels}
                set={(fn) => upd((d) => fn(d.commandLevels))}
              />
            </>
          )}
          {sub === 'conditions' && (
            <>
              <ConditionsSection r={r} upd={upd} />
              <OptionsSection
                title="Укрепления"
                hint="Действуют на элементы своей стороны с приказами обороны, засады, закрепления или в резерве."
                options={r.fortifications}
                set={(fn) => upd((d) => fn(d.fortifications))}
              />
              <OptionsSection
                title="Разведданные"
                hint="Влияют на все элементы своей стороны — обычно на обнаружение и инициативу."
                options={r.intelLevels}
                set={(fn) => upd((d) => fn(d.intelLevels))}
              />
            </>
          )}
          {sub === 'modifiers' && <ModifiersSection r={r} upd={upd} />}
          {sub === 'effects' && <TempEffectsSection r={r} upd={upd} />}
          {sub === 'coefficients' && <CoefficientsSection r={r} upd={upd} />}
          {sub === 'outcomes' && <OutcomesSection r={r} upd={upd} />}
          {sub === 'json' && <JsonSection r={r} />}
        </div>
      </div>
      {transfer && <TransferModal target={r} onClose={() => setTransfer(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ временные эффекты
