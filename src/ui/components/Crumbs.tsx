// «Хлебные крошки» над заголовком страницы: раздел и старшие объекты — куда вернуться.

import { Fragment } from 'react';
import { showSection } from '../nav';
import { openTab, type NavSection, type TabKind } from '../store';

export interface Crumb {
  label: string;
  /** Раздел навигатора. */
  section?: NavSection;
  /** Объект, который откроется по щелчку. */
  open?: [TabKind, string];
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumbs">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep">›</span>}
          {c.section || c.open ? (
            <a
              href="#"
              title={c.section ? 'Показать раздел в навигаторе' : 'Открыть'}
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
    </nav>
  );
}
