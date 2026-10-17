import { useEffect, useState } from 'react';
import { Btn, Card, Field, Num, Seg } from '../components/ui';
import { storage, storageKind } from '../storage';
import { confirmDialog, deleteBattles, installExamples, toast, updateSettings, useApp } from '../store';

export function SettingsPage() {
  const s = useApp((x) => x.settings);
  const battles = Object.values(useApp((x) => x.battleIndex));
  const finished = battles.filter((b) => b.finished);
  const [dir, setDir] = useState('');
  useEffect(() => {
    storage.getDataDir().then(setDir);
  }, []);
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
            <div className="row">
              <Btn
                onClick={async () => {
                  if (!(await confirmDialog('Установить примеры заново?', 'Будут восстановлены примеры наборов правил, подразделений и сценария (с исходными идентификаторами — ваши изменения в примерах будут заменены).'))) return;
                  await installExamples();
                  toast('Примеры установлены.', 'good');
                }}
              >
                Восстановить примеры
              </Btn>
            </div>
          </div>
        </Card>
        <Card title="О программе">
          <p>WarSim — модульный симулятор боя для варгейма. Расчёт боя (движок) отделён от интерфейса и не зависит от него.</p>
          <p className="muted small">Режим: {storageKind === 'electron' ? 'настольное приложение' : 'браузер (данные в localStorage)'}.</p>
        </Card>
      </div>
    </div>
  );
}
