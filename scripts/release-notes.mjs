// Раздел CHANGELOG.md для версии — описание релиза: node scripts/release-notes.mjs 1.0.0 > notes.md

import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const lines = text.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`В CHANGELOG.md нет раздела «## [${version}]».`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
process.stdout.write(
  `${lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()}\n`,
);
