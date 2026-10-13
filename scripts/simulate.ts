// Запуск боя без интерфейса — показывает, что движок отделён от программы.
//   npm run sim                         — демо-сценарий
//   npm run sim -- scenario.json ruleset.json [--seed X] [--runs 100] [--log 0|1|2]

import { readFileSync } from 'node:fs';
import {
  createBattle,
  formatLog,
  formatReport,
  makeDemoScenario,
  makeUniversalRuleset,
  runMany,
  runToEnd,
  type Ruleset,
  type Scenario,
} from '../src/engine';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const scenario: Scenario = files[0] ? JSON.parse(readFileSync(files[0], 'utf8')) : makeDemoScenario();
const ruleset: Ruleset = files[1] ? JSON.parse(readFileSync(files[1], 'utf8')) : makeUniversalRuleset();
const seed = opt('seed') ?? scenario.seed;
const runs = Number(opt('runs') ?? 0);

if (runs > 0) {
  const r = runMany(scenario, ruleset, runs, seed);
  console.log(`${r.n} прогонов за ${r.ms} мс. Победа ${r.sideNames.A}: ${r.winA.toFixed(1)}%, ${r.sideNames.B}: ${r.winB.toFixed(1)}%, ничья: ${r.draw.toFixed(1)}%`);
  for (const o of r.outcomes) console.log(`  ${o.label}: ${o.pct.toFixed(1)}%`);
  for (const m of r.metrics) {
    const s = m.stats;
    const side = m.side ? `${r.sideNames[m.side]}: ` : '';
    console.log(`  ${side}${m.label} (${m.unit}) — среднее ${s.mean.toFixed(1)}, медиана ${s.median.toFixed(1)}, 10–90% [${s.p10.toFixed(1)} … ${s.p90.toFixed(1)}], мин–макс [${s.min.toFixed(1)} … ${s.max.toFixed(1)}]`);
  }
} else {
  const b = createBattle(scenario, ruleset, { seed });
  runToEnd(b);
  const level = Number(opt('log') ?? -1);
  if (level >= 0) console.log(formatLog(b, b.log, level as 0 | 1 | 2, level >= 2).join('\n'), '\n');
  console.log(formatReport(b));
}
