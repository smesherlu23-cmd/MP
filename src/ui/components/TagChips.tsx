// Теги — особенности типов: чипы только для показа, с описанием тега в подсказке.

import type { Ruleset } from '../../engine';

export function TagChips({
  tags,
  rs,
  onPick,
  className,
}: {
  tags: string[];
  rs: Pick<Ruleset, 'tagDescriptions' | 'reconTag'>;
  onPick?: (tag: string) => void;
  className?: string;
}) {
  if (!tags.length) return null;
  return (
    <span className={`tags readonly${className ? ` ${className}` : ''}`}>
      {tags.map((t) => {
        const tip = [rs.tagDescriptions?.[t], t === rs.reconTag ? 'Тег разведки: лучшие наблюдатели' : ''].filter(Boolean).join('\n') || undefined;
        return onPick ? (
          <button key={t} type="button" className="chip chip-btn" data-tip={tip} onClick={() => onPick(t)}>
            {t}
          </button>
        ) : (
          <span key={t} className="chip" data-tip={tip}>
            {t}
          </span>
        );
      })}
    </span>
  );
}
