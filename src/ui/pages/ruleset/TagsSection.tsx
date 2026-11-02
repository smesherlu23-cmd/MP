// Набор правил: теги — особенности типов. Где тег используется (типы, подразделения, правила), описание,
// переименование и удаление сразу везде, назначение тега нескольким типам.

import { useState } from 'react';
import { KIND_LABELS, rulesetTags, walkUnits, type ComponentKind, type Ruleset, type UnitNode } from '../../../engine';
import { Btn, Card, Check, Info, Menu, Modal, Txt } from '../../components/ui';
import { openUnit, revealAnchor, setTabState, useTabState } from '../../hooks';
import { confirmDialog, defaultRulesetId, openTab, promptDialog, tabKey as keyOf, toast, toastUndoable, useApp } from '../../store';
import type { Upd } from './common';

/** Теги в условиях правила (свои и противника). */
const ruleTags = (vals: unknown) => (Array.isArray(vals) ? vals : [vals]).map(String).filter((x) => x.trim());

/** Подразделения шаблонов и сил этого набора правил, в составе которых (в строю) есть тип с тегом. */
function unitsWithTag(r: Ruleset, tag: string): { name: string; ref: string; nodeId: string }[] {
  const s = useApp.getState();
  const def = defaultRulesetId();
  const typeIds = new Set(r.componentTypes.filter((t) => t.tags.includes(tag)).map((t) => t.id));
  const out: { name: string; ref: string; nodeId: string }[] = [];
  if (!typeIds.size) return out;
  const scan = (root: UnitNode, ref: string) => {
    if ((root.rulesetId ?? def) !== r.id) return;
    walkUnits(root, (n) => {
      if (n.composition.some((c) => c.current > 0 && typeIds.has(c.typeId)))
        out.push({ name: n.id === root.id ? n.name : `${n.name} · ${root.name}`, ref, nodeId: n.id });
    });
  };
  for (const f of Object.values(s.forces)) scan(f, `force:${f.id}`);
  for (const f of Object.values(s.formations)) scan(f, `lib:${f.id}`);
  return out;
}

export function TagsSection({ r, upd, tabKey }: { r: Ruleset; upd: Upd; tabKey: string }) {
  const [sel] = useTabState<string>(`${tabKey}:tag`, '');
  const [pick, setPick] = useState<{ tag: string; isNew: boolean } | null>(null);
  const tags = rulesetTags(r).sort((a, b) => a.localeCompare(b, 'ru'));
  const typeTags = new Set(r.componentTypes.flatMap((t) => t.tags));
  const openType = (id: string) => {
    setTabState(`${keyOf('ruleset', r.id)}:type`, id);
    openTab('ruleset', r.id, { sub: 'types' });
  };
  const openRule = (id: string) => {
    openTab('ruleset', r.id, { sub: 'modifiers' });
    revealAnchor(`rule-${id}`);
  };

  const rename = async (tag: string) => {
    const next = (await promptDialog(`Переименовать тег «${tag}»`, tag, 'Тег сменится у всех типов, в условиях своих правил и у тега разведки.'))?.trim();
    if (!next || next === tag) return;
    if (tags.includes(next) && !(await confirmDialog(`Тег «${next}» уже есть`, `Объединить «${tag}» с «${next}»?`, 'Объединить'))) return;
    upd((d) => {
      for (const t of d.componentTypes) if (t.tags.includes(tag)) t.tags = [...new Set(t.tags.map((x) => (x === tag ? next : x)))];
      for (const m of d.modifiers)
        for (const c of m.when) {
          if (c.field !== 'tag' && c.field !== 'enemy.tag') continue;
          if (Array.isArray(c.value)) c.value = [...new Set(c.value.map((x) => (String(x) === tag ? next : String(x))))];
          else if (String(c.value) === tag) c.value = next;
        }
      if (d.reconTag === tag) d.reconTag = next;
      if (d.tagDescriptions?.[tag] !== undefined) {
        d.tagDescriptions[next] ??= d.tagDescriptions[tag];
        delete d.tagDescriptions[tag];
      }
    });
    toastUndoable(`Тег «${tag}» переименован в «${next}».`);
  };

  const remove = async (tag: string) => {
    const rules = r.modifiers.filter((m) => m.when.some((c) => (c.field === 'tag' || c.field === 'enemy.tag') && ruleTags(c.value).includes(tag)));
    if (
      !(await confirmDialog(
        `Удалить тег «${tag}»?`,
        `Тег уберётся у всех типов${rules.length ? ` и из условий «любой из / ни один из» в правилах: ${rules.map((m) => `«${m.name}»`).join(', ')}. Условия только на этот тег останутся — проверьте эти правила` : ''}.`,
        'Удалить',
        true,
      ))
    )
      return;
    upd((d) => {
      for (const t of d.componentTypes) t.tags = t.tags.filter((x) => x !== tag);
      for (const m of d.modifiers)
        for (const c of m.when)
          if ((c.field === 'tag' || c.field === 'enemy.tag') && Array.isArray(c.value) && c.value.length > 1)
            c.value = c.value.filter((x) => String(x) !== tag);
      if (d.tagDescriptions) delete d.tagDescriptions[tag];
    });
    toastUndoable(`Тег «${tag}» удалён.`);
  };

  const addTag = async () => {
    const tag = (
      await promptDialog('Новый тег', '', 'Особенность типа: «кавалерия», «ночное видение», «сапёр». Потом выберите типы, у которых она есть.')
    )?.trim();
    if (!tag) return;
    if (tags.includes(tag)) {
      toast(`Тег «${tag}» уже есть.`);
      setPick({ tag, isNew: false });
      return;
    }
    setPick({ tag, isNew: true });
  };

  return (
    <>
      <div className="row">
        <Btn kind="primary" onClick={addTag}>
          + Тег
        </Btn>
        <Info text="Тег — особенность типа: задаётся у типов в каталоге. Подразделение получает теги всех типов своего состава; по тегам работают свои правила («если тег …») и разведка. Здесь — все теги набора: где они используются, описание (видно подсказкой у тега), переименование и удаление сразу везде." />
      </div>
      {!tags.length && <div className="empty">Тегов пока нет. Добавьте тег и выберите типы, у которых он есть.</div>}
      {tags.length > 0 && (
        <Card tight>
          <table className="tbl tags-tbl">
            <thead>
              <tr>
                <th>Тег</th>
                <th>Описание</th>
                <th>Типы</th>
                <th className="num">Подразделений</th>
                <th>Правила</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const types = r.componentTypes.filter((t) => t.tags.includes(tag));
                const rules = r.modifiers.filter((m) => m.when.some((c) => (c.field === 'tag' || c.field === 'enemy.tag') && ruleTags(c.value).includes(tag)));
                const units = unitsWithTag(r, tag);
                const orphan = !typeTags.has(tag);
                return (
                  <tr key={tag} data-anchor={`tag-${tag}`} className={sel === tag ? 'sel' : undefined}>
                    <td className="nowrap">
                      <b>{tag}</b>
                      {tag === r.reconTag && (
                        <span className="faint small" data-tip="Тег разведки (раздел «Общее»): типы с ним — лучшие наблюдатели">
                          {' '}
                          · тег разведки
                        </span>
                      )}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      <Txt
                        value={r.tagDescriptions?.[tag] ?? ''}
                        onChange={(v) =>
                          upd((d) => {
                            if (v.trim()) (d.tagDescriptions ??= {})[tag] = v;
                            else if (d.tagDescriptions) delete d.tagDescriptions[tag];
                          })
                        }
                        placeholder="описание (необязательно)"
                        width="100%"
                      />
                    </td>
                    <td>
                      {orphan ? (
                        <span
                          className="warn small"
                          data-tip="Тег есть только в условиях правил или как тег разведки: такие правила не сработают, пока тег не назначен типу"
                        >
                          нет ни у одного типа
                        </span>
                      ) : (
                        <span className="row" style={{ gap: 4 }}>
                          {types.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              className="chip chip-btn"
                              data-tip={KIND_LABELS[t.kind as ComponentKind]}
                              onClick={() => openType(t.id)}
                            >
                              {t.name}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                    <td
                      className="num"
                      data-tip={
                        units.length
                          ? units
                              .slice(0, 12)
                              .map((u) => `• ${u.name}`)
                              .join('\n') + (units.length > 12 ? `\nи ещё ${units.length - 12}` : '')
                          : undefined
                      }
                    >
                      {units.length || <span className="faint">—</span>}
                    </td>
                    <td>
                      {rules.length ? (
                        <span className="row" style={{ gap: 4 }}>
                          {rules.map((m) => (
                            <button key={m.id} type="button" className={`chip chip-btn${m.enabled ? '' : ' faint'}`} onClick={() => openRule(m.id)}>
                              {m.name}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td style={{ width: 40 }}>
                      <Menu
                        sm
                        items={[
                          { label: 'Типы с этим тегом…', onClick: () => setPick({ tag, isNew: false }) },
                          ...(units.length ? [{ label: 'Открыть первое подразделение', onClick: () => openUnit(units[0].ref, units[0].nodeId) }] : []),
                          { label: 'Переименовать…', onClick: () => void rename(tag) },
                          'sep' as const,
                          { label: 'Удалить тег', danger: true, onClick: () => void remove(tag) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {pick && <TypePicker r={r} upd={upd} tag={pick.tag} isNew={pick.isNew} onClose={() => setPick(null)} />}
    </>
  );
}

/** Выбор типов, у которых есть тег: отмеченным тег добавляется, у снятых — убирается. */
function TypePicker({ r, upd, tag, isNew, onClose }: { r: Ruleset; upd: Upd; tag: string; isNew: boolean; onClose: () => void }) {
  const [on, setOn] = useState(() => new Set(r.componentTypes.filter((t) => t.tags.includes(tag)).map((t) => t.id)));
  const apply = () => {
    upd((d) => {
      for (const t of d.componentTypes) {
        const has = t.tags.includes(tag);
        if (on.has(t.id) && !has) t.tags = [...t.tags, tag];
        if (!on.has(t.id) && has) t.tags = t.tags.filter((x) => x !== tag);
      }
    });
    onClose();
  };
  return (
    <Modal
      title={`${isNew ? 'Новый тег' : 'Тег'} «${tag}»: у каких типов`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">Отмечено: {on.size}</span>
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={apply} disabled={isNew && !on.size}>
            Готово
          </Btn>
        </>
      }
    >
      {(['personnel', 'weapon', 'vehicle'] as ComponentKind[]).map((k) => {
        const list = r.componentTypes.filter((t) => t.kind === k);
        if (!list.length) return null;
        return (
          <div key={k} style={{ marginBottom: 10 }}>
            <div className="faint small" style={{ marginBottom: 4 }}>
              {KIND_LABELS[k]}
            </div>
            <div className="feature-grid">
              {list.map((t) => (
                <Check
                  key={t.id}
                  value={on.has(t.id)}
                  onChange={(v) =>
                    setOn((prev) => {
                      const n = new Set(prev);
                      if (v) n.add(t.id);
                      else n.delete(t.id);
                      return n;
                    })
                  }
                >
                  {t.name}
                </Check>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
