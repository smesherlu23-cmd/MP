// «Гиперссылки» на объекты: клик открывает страницу объекта; правый щелчок — действия с ним, пробел —
// быстрый просмотр (для сценариев, сил, шаблонов, наборов правил и боёв).

import type { ReactNode } from 'react';
import { objFromKey, objMenu, toggleQuickLook } from '../objects';
import { openTab, tabKey, type TabKind } from '../store';
import { openContextMenu } from './ui';

export function Link(props: { kind: TabKind; refId?: string; sub?: string; children: ReactNode; title?: string; className?: string }) {
  const obj = objFromKey(tabKey(props.kind, props.refId));
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTab(props.kind, props.refId, { sub: props.sub });
  };
  return (
    <a
      href="#"
      className={props.className}
      title={props.title ?? 'Открыть'}
      onClick={go}
      onContextMenu={obj ? (e) => openContextMenu(e, objMenu(obj)) : undefined}
      onKeyDown={
        obj
          ? (e) => {
              if (e.key !== ' ') return;
              e.preventDefault();
              toggleQuickLook(obj);
            }
          : undefined
      }
    >
      {props.children}
    </a>
  );
}
