// Путь к странице (раздел и старшие объекты — куда вернуться): показывается в панели инструментов под заголовком окна.

import { Fragment, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { showSection } from '../nav';
import { openTab, type NavSection, type TabKind } from '../store';

export interface Crumb {
  label: string;
  /** Раздел: щелчок открывает его каталог. */
  section?: NavSection;
  /** Объект, который откроется по щелчку. */
  open?: [TabKind, string];
}

export function Crumbs({ items }: { items: Crumb[] }) {
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => setHost(document.getElementById('tb-crumbs')), []);
  if (!host) return null;
  return createPortal(
    <nav className="breadcrumbs">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep">›</span>}
          {c.section || c.open ? (
            <a
              href="#"
              title={c.section ? 'Открыть каталог раздела' : 'Открыть'}
              onClick={(e) => {
                e.preventDefault();
                if (c.section) showSection(c.section);
                if (c.open) openTab(c.open[0], c.open[1]);
              }}
            >
              {c.label}
            </a>
          ) : (
            <span>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>,
    host,
  );
}
