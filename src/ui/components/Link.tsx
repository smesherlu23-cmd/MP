// «Гиперссылки» на объекты: клик открывает страницу объекта.

import type { ReactNode } from 'react';
import { openTab, type TabKind } from '../store';

export function Link(props: { kind: TabKind; refId?: string; sub?: string; children: ReactNode; title?: string; className?: string }) {
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTab(props.kind, props.refId, { sub: props.sub });
  };
  return (
    <a href="#" className={props.className} title={props.title ?? 'Открыть'} onClick={go}>
      {props.children}
    </a>
  );
}
