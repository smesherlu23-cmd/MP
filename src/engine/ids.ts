// Идентификаторы новых объектов — один счётчик на всю программу (не влияют на расчёт боя).

let idCounter = 0;

/** Уникальный идентификатор: время, счётчик и случайный хвост. */
export function newId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1679616;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}
