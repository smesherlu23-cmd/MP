import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, Field, Modal, Num, Seg } from '../components/ui';
import { storage, storageKind, type BackupInfo, type TrashItem } from '../storage';
import { confirmDialog, deleteBattles, fmtDate, installExamples, restoreBackup, restoreFromTrash, toast, updateSettings, useApp } from '../store';

export function SettingsPage() {
  const s = useApp((x) => x.settings);
  const battles = Object.values(useApp((x) => x.battleIndex));
  const finished = battles.filter((b) => b.finished);
  const [dir, setDir] = useState('');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [modal, setModal] = useState<'backups' | 'trash' | null>(null);
  const refresh = useCallback(() => {
    storage.backups().then(setBackups, () => setBackups([]));
    storage.trash().then(setTrash, () => setTrash([]));
  }, []);
  useEffect(() => {
    storage.getDataDir().then(setDir);
    refresh();
  }, [refresh]);
  // Удаление в другой вкладке тоже должно появиться в корзине.
  const libSize = useApp((x) => Object.keys(x.rulesets).length + Object.keys(x.formations).length + Object.keys(x.forces).length + Object.keys(x.scenarios).length + Object.keys(x.battleIndex).length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: сведения о папке обновляются при изменении данных
  useEffect(refresh, [libSize, refresh]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Настройки</h1>
      </div>
      <div className="grid two" style={{ maxWidth: 1100 }}>
        <Card title="Внешний вид">
          <div className="stack" style={{ gap: 12 }}>
            <Field label="Тема">
              <Seg value={s.theme} onChange={(v) => updateSettings({ theme: v })} options={[{ value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }]} />
            </Field>
            <Field label="Плотность">
              <Seg value={s.density} onChange={(v) => updateSettings({ density: v })} options={[{ value: 'normal', label: 'Обычная' }, { value: 'compact', label: 'Компактная' }]} />
            </Field>
          </div>
        </Card>
        <Card title="Бой и прогоны">
          <div className="stack" style={{ gap: 12 }}>
            <Field label="Подробность журнала по умолчанию" hint="Её можно менять прямо в журнале боя.">
              <Seg
                value={String(s.logLevel) as '0' | '1' | '2'}
                onChange={(v) => updateSettings({ logLevel: Number(v) as 0 | 1 | 2 })}
                options={[
                  { value: '0', label: 'Ключевое' },
                  { value: '1', label: 'Обычное' },
                  { value: '2', label: 'Подробное' },
                ]}
              />
            </Field>
            <Field label="Прогонов по умолчанию">
              <Num value={s.mcRuns} onChange={(v) => updateSettings({ mcRuns: v })} min={10} max={20000} integer width={120} />
            </Field>
            <Field label="Сохранённые бои" hint="Бои хранятся без подробного журнала — подробности и разборы восстанавливаются повтором боя, когда их открывают.">
              <div className="row">
                <span className="muted">
                  всего {battles.length}, завершённых {finished.length}
                </span>
                <Btn sm disabled={!finished.length} onClick={() => deleteBattles(finished.map((b) => b.id), 'Удалить завершённые бои?')}>
                  Удалить завершённые
                </Btn>
                <Btn sm kind="danger" disabled={!battles.length} onClick={() => deleteBattles(battles.map((b) => b.id), 'Удалить все бои?')}>
                  Удалить все
                </Btn>
              </div>
            </Field>
          </div>
        </Card>
        <Card title="Данные">
          <div className="stack" style={{ gap: 10 }}>
            <Field label="Папка данных" hint="Наборы правил, подразделения, сценарии и бои хранятся там как JSON-файлы — их можно копировать, переносить и править вручную.">
              <div className="mono small" style={{ wordBreak: 'break-all' }}>
                {dir}
              </div>
            </Field>
            {storageKind === 'electron' && (
              <div className="row">
                <Btn onClick={() => storage.openDataDir()}>Открыть папку</Btn>
                <Btn
                  onClick={async () => {
                    const d = await storage.chooseDataDir();
                    if (d) {
                      toast('Папка данных изменена. Перезапуск…', 'good');
                      setTimeout(() => location.reload(), 600);
                    }
                  }}
                >
                  Сменить папку…
                </Btn>
              </div>
            )}
            <Field
              label="Резервные копии"
              hint="Наборы правил, шаблоны, силы и сценарии копируются при запуске и раз в час, если что-то изменилось (бои не копируются — они воспроизводятся из сценария). Хранятся 10 последних копий и по одной за 14 последних дней."
            >
              <div className="row">
                <span className="muted">{backups.length ? `последняя — ${fmtDate(backups[0].createdAt)} · всего ${backups.length}` : 'копий пока нет'}</span>
                <Btn
                  sm
                  onClick={async () => {
                    const b = await storage.backup('manual');
                    toast(!b ? 'Копировать пока нечего.' : b.unchanged ? `Изменений нет — копия от ${fmtDate(b.createdAt)} актуальна.` : 'Резервная копия сделана.', 'good');
                    refresh();
                  }}
                >
                  Сделать копию сейчас
                </Btn>
                <Btn sm disabled={!backups.length} onClick={() => setModal('backups')}>
                  Восстановить из копии…
                </Btn>
              </div>
            </Field>
            <Field label="Корзина" hint="Удалённые наборы правил, подразделения, сценарии и бои хранятся здесь 30 дней, затем удаляются насовсем.">
              <div className="row">
                <span className="muted">{trash.length ? `объектов: ${trash.length}` : 'пусто'}</span>
                <Btn sm disabled={!trash.length} onClick={() => setModal('trash')}>
                  Открыть корзину…
                </Btn>
              </div>
            </Field>
            <div className="row">
              <Btn
                onClick={async () => {
                  if (!(await confirmDialog('Установить примеры заново?', 'Будут восстановлены примеры наборов правил, подразделений и сценариев (с исходными идентификаторами — ваши изменения в примерах будут заменены). Перед этим делается резервная копия.'))) return;
                  await storage.backup('examples').catch(() => null);
                  await installExamples();
                  toast('Примеры установлены.', 'good');
                  refresh();
                }}
              >
                Восстановить примеры
              </Btn>
            </div>
          </div>
        </Card>
        {modal === 'backups' && <BackupsModal list={backups} onClose={() => setModal(null)} />}
        {modal === 'trash' && (
          <TrashModal
            list={trash}
            onChange={refresh}
            onClose={() => {
              setModal(null);
              refresh();
            }}
          />
        )}
        <Card title="О программе">
          <p>WarSim — модульный симулятор боя для варгейма. Расчёт боя (движок) отделён от интерфейса и не зависит от него.</p>
          <p className="muted small">Режим: {storageKind === 'electron' ? 'настольное приложение' : 'браузер (данные в localStorage)'}.</p>
        </Card>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  auto: 'автоматически',
  manual: 'вручную',
  restore: 'перед восстановлением',
  examples: 'перед установкой примеров',
};

const countsText = (c: Record<string, number>) =>
  [`наборов правил ${c.rulesets ?? 0}`, `шаблонов ${c.formations ?? 0}`, `сил ${c.forces ?? 0}`, `сценариев ${c.scenarios ?? 0}`].join(' · ');

function BackupsModal({ list, onClose }: { list: BackupInfo[]; onClose: () => void }) {
  return (
    <Modal
      title="Восстановить из резервной копии"
      onClose={onClose}
      footer={
        <>
          {storageKind === 'electron' && <Btn onClick={() => storage.openDataDir('backups')}>Открыть папку копий</Btn>}
          <Btn onClick={onClose}>Закрыть</Btn>
        </>
      }
    >
      <p className="muted small">Копия заменит наборы правил, шаблоны, силы и сценарии своими версиями; созданное позже копии останется.</p>
      <div className="data-list">
        {list.map((b) => (
          <div key={b.id} className="data-row">
            <div className="grow">
              <div>
                {fmtDate(b.createdAt)} <span className="muted small">· {KIND_LABEL[b.kind] ?? b.kind}</span>
              </div>
              <div className="muted small">{countsText(b.counts)}</div>
            </div>
            <Btn sm onClick={() => restoreBackup(b.id, fmtDate(b.createdAt))}>
              Восстановить
            </Btn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const COL_TITLE: Record<TrashItem['col'], string> = { rulesets: 'Наборы правил', formations: 'Шаблоны', forces: 'Силы', scenarios: 'Сценарии', battles: 'Бои' };

function TrashModal({ list, onChange, onClose }: { list: TrashItem[]; onChange: () => void; onClose: () => void }) {
  const back = async (items: TrashItem[]) => {
    const n = await restoreFromTrash(items);
    if (n) toast(n === 1 ? `Возвращено: «${items[0].name}».` : `Возвращено объектов: ${n}.`, 'good');
    onChange();
  };
  return (
    <Modal
      title="Корзина"
      onClose={onClose}
      footer={
        <>
          <Btn
            kind="danger"
            disabled={!list.length}
            onClick={async () => {
              if (!(await confirmDialog('Очистить корзину?', `Объекты будут удалены насовсем: ${list.length}.`, 'Очистить', true))) return;
              await storage.purgeTrash();
              toast('Корзина очищена.', 'good');
              onChange();
            }}
          >
            Очистить корзину
          </Btn>
          <Btn onClick={onClose}>Закрыть</Btn>
        </>
      }
    >
      {!list.length && <p className="muted">Корзина пуста.</p>}
      {(Object.keys(COL_TITLE) as TrashItem['col'][]).map((col) => {
        const items = list.filter((x) => x.col === col);
        if (!items.length) return null;
        return (
          <div key={col} className="data-group">
            <div className="data-group-head">
              <span>
                {COL_TITLE[col]} <span className="muted">· {items.length}</span>
              </span>
              {items.length > 1 && (
                <Btn sm kind="ghost" onClick={() => back(items)}>
                  Вернуть все
                </Btn>
              )}
            </div>
            <div className="data-list">
              {items.map((x) => (
                <div key={x.key} className="data-row">
                  <div className="grow">
                    <div>{x.name}</div>
                    <div className="muted small">удалено {fmtDate(x.deletedAt)}</div>
                  </div>
                  <Btn sm onClick={() => back([x])}>
                    Вернуть
                  </Btn>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
