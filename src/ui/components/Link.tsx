// «Гиперссылки» на объекты: клик открывает вкладку-окно, Ctrl/средняя кнопка — в фоне.

import type { ReactNode } from 'react';
import { openTab, type TabKind } from '../store';

export function Link(props: { kind: TabKind; refId?: string; sub?: string; children: ReactNode; title?: string; className?: string }) {
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTab(props.kind, props.refId, { background: e.ctrlKey || e.metaKey || e.button === 1, sub: props.sub });
  };
  return (
    <a
      href="#"
      className={props.className}
      title={props.title ?? 'Открыть (Ctrl+клик — в фоне)'}
      onClick={go}
      onAuxClick={(e) => e.button === 1 && go(e)}
    >
      {props.children}
    </a>
  );
}
